// 엑셀 내보내기 흐름(output-spec 4절, i-m2-plan M2-S2): 대화상자 → 저장 대화상자 → (OneDrive 경고) → 파일 쓰기 → 토스트.
// 영속 데이터는 저장소, 파일 쓰기는 Platform만 거친다(CLAUDE.md 4-3). ExcelJS는 처음 내보낼 때만 불러온다.
import { create } from "zustand";
import { weekList } from "../../data/repository";
import { addWeeks, type WeekId } from "../../domain/week";
import { buildWorkbook, type ExportSnapshot } from "../../export/excel";
import { renderNoteSnapshot } from "../../export/noteSnapshot";
import { exportFileName, yearRange } from "../../export/filename";
import { filterExportWeeks } from "../../export/filterWeeks";
import { buildJournalMarkdown } from "../../export/journalMarkdown";
import { localDate } from "../../domain/localTime";
import { baseName, dirOf, exportPathProblem } from "../../platform";
import { STR } from "../../shared/strings";
import { flushAll, reportError, toast, useBoard } from "../board/boardStore";
import { useAppStore } from "../common/appStore";
import { workspaceLabel } from "../common/appController";
import { flushDraft } from "../summary/summaryStore";
import { flushNote } from "../note/noteStore";
import { memoWeeks, weekSnapshotInput } from "../note/snapshot";

export type RangeKind = "thisWeek" | "last4" | "custom" | "year" | "all";
export type ExportFormat = "xlsx" | "md";

export interface ExportChoice {
  /** 파일 형식(improve-v27 1-5) */
  format: ExportFormat;
  kind: RangeKind;
  /** 연도 범위일 때 그 해(ISO 주의 해) */
  year: number;
  /** 고른 업무 id — null = 전체(improve-v27 1-4, 다음에 열 때는 늘 전체) */
  categoryIds: string[] | null;
  /** 마크다운 포함: 업무 기록 · 주간 요약 · 주간 메모(글) */
  mdRecords: boolean;
  mdSummary: boolean;
  mdMemo: boolean;
  /** 기간 지정일 때 */
  from: WeekId;
  to: WeekId;
  weekly: boolean;
  ledger: boolean;
  summary: boolean;
  /** 메모 보드 스냅샷 시트(improve-1027v3-spec 1-5) */
  snapshots: boolean;
}

interface ExportState {
  open: boolean;
  /** 내보내는 중 — 창 안 다른 조작·앱 단축키를 막고 진행 막대·[취소]만(1.55.1) */
  busy: boolean;
  /** 지금 단계 글(예: 메모 그림 만드는 중 3/12) */
  progress: string | null;
  /** 전체 진행 0~1(저장 위치를 고르는 동안 null) */
  ratio: number | null;
}

export const useExport = create<ExportState>(() => ({
  open: false,
  busy: false,
  progress: null,
  ratio: null,
}));

/** [취소]·Esc로 멈춤 — 단계 사이·주마다·그림마다 확인하고, 파일을 쓰기 시작한 뒤에는 멈추지 않는다 */
class ExportCancelled extends Error {}
let cancelRequested = false;

export function cancelExport() {
  if (useExport.getState().busy) cancelRequested = true;
}

function checkCancel() {
  if (cancelRequested) throw new ExportCancelled();
}

/** 단계 글과 진행(0~1)을 보이고 화면이 그릴 틈을 준다 */
async function step(progress: string, ratio: number) {
  checkCancel();
  useExport.setState({ progress, ratio: Math.max(0, Math.min(1, ratio)) });
  await new Promise((r) => setTimeout(r, 0));
  checkCancel();
}

/** 엑셀용 메모 그림 해상도 배율(파일 크기와 선명도 절충) */
const EXCEL_SNAPSHOT_SCALE = 1.5;

const toBase64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

export function setExportOpen(open: boolean) {
  if (useExport.getState().busy) return;
  useExport.setState({ open });
}

export function toggleExport() {
  setExportOpen(!useExport.getState().open);
}

function ready() {
  const j = useAppStore.getState().journal;
  const platform = useAppStore.getState().platform;
  if (j.state !== "ready" || !platform) throw new Error("일지가 열려 있지 않습니다");
  return { repo: j.repo, dataDir: j.dataDir, platform };
}

/** 고른 범위 → [시작 주, 끝 주]. 전체 = 첫 기록 주 ~ 이번 주(기록이 없으면 이번 주) */
export function resolveRange(
  c: ExportChoice,
  current: WeekId,
  firstRecord: WeekId | null,
  latest = current,
): [WeekId, WeekId] {
  switch (c.kind) {
    case "thisWeek":
      return [current, current];
    case "last4":
      return [addWeeks(current, -3), current];
    case "custom":
      return c.from <= c.to ? [c.from, c.to] : [c.to, c.from];
    case "year":
      return yearRange(c.year, current, firstRecord, latest);
    case "all": {
      const end = latest > current ? latest : current;
      const first = firstRecord && firstRecord < end ? firstRecord : end;
      return [first, end];
    }
  }
}

/** 고른 업무 이름표: 전체 / 이름 하나 / 업무 N개 */
export function categoryLabel(ids: string[] | null, names: Map<string, string>): string {
  if (!ids) return STR.export.categoryAll;
  if (ids.length === 1) return names.get(ids[0]!) ?? STR.export.categoryMany(1);
  return STR.export.categoryMany(ids.length);
}

/** 내보내기 실행. 저장했으면 저장 경로, 취소했으면 null */
export async function runExport(c: ExportChoice): Promise<string | null> {
  if (useExport.getState().busy) return null;
  cancelRequested = false;
  useExport.setState({ busy: true, progress: STR.export.progressPick, ratio: null });
  try {
    const { repo, dataDir, platform } = ready();
    // 입력 중인 칸·수정본까지 저장한 뒤에 읽는다
    await flushAll();
    await flushDraft();
    await flushNote();
    const current = useBoard.getState().weekId;
    const [from, to] = resolveRange(c, current, await repo.firstRecordWeek(), repo.currentWeek());

    const settings = await repo.getSettings();
    let dir = settings.ui.lastExportDir;
    if (!dir || !(await platform.stat(dir)).isDir) {
      dir = platform.join(dataDir, "exports");
      await platform.ensureDir(dir);
    }
    const md = c.format === "md";
    const { categories } = await repo.listCategories();
    const names = new Map(categories.map((x) => [x.id, x.name]));
    const ids = c.categoryIds && c.categoryIds.length ? c.categoryIds : null;
    const label = categoryLabel(ids, names);
    const path = await platform.pickSaveFile(
      md ? STR.export.saveTitleMd : STR.export.saveTitle,
      platform.join(
        dir,
        exportFileName(from, to, c.kind === "all", workspaceLabel(), {
          ext: md ? "md" : "xlsx",
          ...(c.kind === "year" ? { year: c.year } : {}),
          ...(ids ? { categories: label } : {}),
        }),
      ),
    );
    if (!path) return null;
    const problem = exportPathProblem(path, dataDir, md ? "markdown" : "xlsx");
    if (problem) {
      toast(problem);
      return null;
    }
    if ((await platform.isOneDrivePath(path)) && !window.confirm(STR.export.oneDrive)) return null;

    // 진행 비율: 기록 읽기 → (메모 그림) → 파일 만들기 → 쓰기
    const readEnd = md ? 0.85 : c.snapshots ? 0.35 : 0.75;
    await step(STR.export.progressRead(0, 1), 0);
    const raw = await repo.exportWeeks(from, to, (i, n) => {
      checkCancel();
      useExport.setState({ progress: STR.export.progressRead(i + 1, n), ratio: (readEnd * i) / n });
    });
    const weeks = filterExportWeeks(raw, ids);
    if (md) {
      const text = buildJournalMarkdown(weeks, {
        from,
        to,
        records: c.mdRecords,
        summary: c.mdSummary,
        memo: c.mdMemo,
        includeMemo: settings.summary.includeMemo,
        categoryLabel: ids ? ids.map((id) => names.get(id) ?? id).join(", ") : STR.export.categoryAll,
        exportedOn: localDate(platform.now()),
      });
      await step(STR.export.progressWrite, 0.95);
      await platform.writeExport(path, new TextEncoder().encode(text));
      return finish(path, c);
    }
    let snapshots: { images: ExportSnapshot[]; noMemo: WeekId[] } | undefined;
    if (c.snapshots) {
      // 최신 주가 위 — 메모가 있는 주만 그림, 없는 주는 맨 끝 한 줄
      const ids = weekList(from, to).reverse();
      const images: ExportSnapshot[] = [];
      const noMemo: WeekId[] = [];
      const withMemo = await memoWeeks(repo, from, to);
      for (const w of ids) {
        if (!withMemo.includes(w)) {
          noMemo.push(w);
          continue;
        }
        await step(
          STR.export.snapshotsProgress(images.length + 1, withMemo.length),
          readEnd + ((0.85 - readEnd) * images.length) / Math.max(1, withMemo.length),
        );
        const input = await weekSnapshotInput(repo, w, platform.now());
        if (!input) {
          noMemo.push(w);
          continue;
        }
        const { blob, width, height } = await renderNoteSnapshot(input, { scale: EXCEL_SNAPSHOT_SCALE });
        images.push({ weekId: w, base64: await toBase64(blob), width, height });
      }
      snapshots = { images, noMemo: noMemo.reverse() };
    }
    await step(STR.export.progressBuild, 0.87);
    const ExcelJS = (await import("exceljs")).default;
    const bytes = await buildWorkbook(ExcelJS, weeks, {
      from,
      to,
      weekly: c.weekly,
      ledger: c.ledger,
      summary: c.summary ? { includeMemo: settings.summary.includeMemo } : undefined,
      snapshots,
      appVersion: __APP_VERSION__,
      exportedAt: platform.now(),
    });
    await step(STR.export.progressWrite, 0.95);
    await platform.writeExport(path, bytes);
    return finish(path, c);
  } catch (e) {
    if (e instanceof ExportCancelled) toast(STR.export.stopped);
    else reportError(e);
    return null;
  } finally {
    cancelRequested = false;
    useExport.setState({ busy: false, progress: null, ratio: null });
  }
}

/** 저장한 뒤: 마지막 폴더·형식·스냅샷 기억 → 창 닫기 → 알림 */
async function finish(path: string, c: ExportChoice): Promise<string> {
  const { repo, platform } = ready();
  await repo.updateSettings({
    ui: { lastExportDir: dirOf(path), exportSnapshots: c.snapshots, exportFormat: c.format },
  });
  useExport.setState({ open: false });
  toast(STR.export.saved(baseName(path)), [
    { label: STR.export.openFolder, run: () => void platform.openFolder(dirOf(path)).catch(reportError) },
    { label: STR.export.openFile, run: () => void platform.openFile(path).catch(reportError) },
  ]);
  return path;
}

/** 대화상자 기본값: 기간 지정은 최근 4주 */
export function defaultChoice(): ExportChoice {
  const current = useBoard.getState().weekId;
  return {
    format: "xlsx",
    kind: "thisWeek",
    year: Number(current.slice(0, 4)),
    categoryIds: null,
    mdRecords: true,
    mdSummary: true,
    mdMemo: false,
    from: addWeeks(current, -3),
    to: current,
    weekly: true,
    ledger: true,
    summary: false,
    snapshots: false,
  };
}
