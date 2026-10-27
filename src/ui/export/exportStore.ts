// 엑셀 내보내기 흐름(output-spec 4절, i-m2-plan M2-S2): 대화상자 → 저장 대화상자 → (OneDrive 경고) → 파일 쓰기 → 토스트.
// 영속 데이터는 저장소, 파일 쓰기는 Platform만 거친다(CLAUDE.md 4-3). ExcelJS는 처음 내보낼 때만 불러온다.
import { create } from "zustand";
import { weekList } from "../../data/repository";
import { addWeeks, type WeekId } from "../../domain/week";
import { buildWorkbook, type ExportSnapshot } from "../../export/excel";
import { renderNoteSnapshot } from "../../export/noteSnapshot";
import { exportFileName } from "../../export/filename";
import { baseName, dirOf, exportPathProblem } from "../../platform";
import { STR } from "../../shared/strings";
import { flushAll, reportError, toast, useBoard } from "../board/boardStore";
import { useAppStore } from "../common/appStore";
import { flushDraft } from "../summary/summaryStore";
import { flushNote } from "../note/noteStore";
import { memoWeeks, weekSnapshotInput } from "../note/snapshot";

export type RangeKind = "thisWeek" | "last4" | "custom" | "all";

export interface ExportChoice {
  kind: RangeKind;
  /** 기간 지정일 때 */
  from: WeekId;
  to: WeekId;
  weekly: boolean;
  ledger: boolean;
  /** 메모 보드 스냅샷 시트(improve-1027v3-spec 1-5) */
  snapshots: boolean;
}

interface ExportState {
  open: boolean;
  busy: boolean;
  /** 메모 그림 만드는 중 i/n */
  progress: string | null;
}

export const useExport = create<ExportState>(() => ({ open: false, busy: false, progress: null }));

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
export function resolveRange(c: ExportChoice, current: WeekId, firstRecord: WeekId | null): [WeekId, WeekId] {
  switch (c.kind) {
    case "thisWeek":
      return [current, current];
    case "last4":
      return [addWeeks(current, -3), current];
    case "custom":
      return c.from <= c.to ? [c.from, c.to] : [c.to, c.from];
    case "all": {
      const first = firstRecord && firstRecord < current ? firstRecord : current;
      return [first, current];
    }
  }
}

/** 내보내기 실행. 저장했으면 저장 경로, 취소했으면 null */
export async function runExport(c: ExportChoice): Promise<string | null> {
  if (useExport.getState().busy) return null;
  useExport.setState({ busy: true });
  try {
    const { repo, dataDir, platform } = ready();
    // 입력 중인 칸·수정본까지 저장한 뒤에 읽는다
    await flushAll();
    await flushDraft();
    await flushNote();
    const current = repo.currentWeek();
    const [from, to] = resolveRange(c, current, await repo.firstRecordWeek());

    const settings = await repo.getSettings();
    let dir = settings.ui.lastExportDir;
    if (!dir || !(await platform.stat(dir)).isDir) {
      dir = platform.join(dataDir, "exports");
      await platform.ensureDir(dir);
    }
    const path = await platform.pickSaveFile(
      STR.export.saveTitle,
      platform.join(dir, exportFileName(from, to, c.kind === "all")),
    );
    if (!path) return null;
    const problem = exportPathProblem(path, dataDir);
    if (problem) {
      toast(problem);
      return null;
    }
    if ((await platform.isOneDrivePath(path)) && !window.confirm(STR.export.oneDrive)) return null;

    const weeks = await repo.exportWeeks(from, to);
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
        useExport.setState({
          progress: STR.export.snapshotsProgress(images.length + 1, withMemo.length),
        });
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
    const ExcelJS = (await import("exceljs")).default;
    const bytes = await buildWorkbook(ExcelJS, weeks, {
      from,
      to,
      weekly: c.weekly,
      ledger: c.ledger,
      snapshots,
      appVersion: __APP_VERSION__,
      exportedAt: platform.now(),
    });
    await platform.writeExport(path, bytes);
    await repo.updateSettings({ ui: { lastExportDir: dirOf(path), exportSnapshots: c.snapshots } });

    useExport.setState({ open: false });
    toast(STR.export.saved(baseName(path)), [
      { label: STR.export.openFolder, run: () => void platform.openFolder(dirOf(path)).catch(reportError) },
      { label: STR.export.openFile, run: () => void platform.openFile(path).catch(reportError) },
    ]);
    return path;
  } catch (e) {
    reportError(e);
    return null;
  } finally {
    useExport.setState({ busy: false, progress: null });
  }
}

/** 대화상자 기본값: 기간 지정은 최근 4주 */
export function defaultChoice(): ExportChoice {
  const current = useBoard.getState().weekId;
  return {
    kind: "thisWeek",
    from: addWeeks(current, -3),
    to: current,
    weekly: true,
    ledger: true,
    snapshots: false,
  };
}
