// 엑셀 내보내기 흐름(output-spec 4절, i-m2-plan M2-S2): 대화상자 → 저장 대화상자 → (OneDrive 경고) → 파일 쓰기 → 토스트.
// 영속 데이터는 저장소, 파일 쓰기는 Platform만 거친다(CLAUDE.md 4-3). ExcelJS는 처음 내보낼 때만 불러온다.
import { create } from "zustand";
import { addWeeks, type WeekId } from "../../domain/week";
import { buildWorkbook } from "../../export/excel";
import { exportFileName } from "../../export/filename";
import { baseName, dirOf, exportPathProblem } from "../../platform";
import { STR } from "../../shared/strings";
import { flushAll, reportError, toast, useBoard } from "../board/boardStore";
import { useAppStore } from "../common/appStore";
import { flushDraft } from "../summary/summaryStore";
import { flushNote } from "../note/noteStore";

export type RangeKind = "thisWeek" | "last4" | "custom" | "all";

export interface ExportChoice {
  kind: RangeKind;
  /** 기간 지정일 때 */
  from: WeekId;
  to: WeekId;
  weekly: boolean;
  ledger: boolean;
}

interface ExportState {
  open: boolean;
  busy: boolean;
}

export const useExport = create<ExportState>(() => ({ open: false, busy: false }));

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
    const ExcelJS = (await import("exceljs")).default;
    const bytes = await buildWorkbook(ExcelJS, weeks, {
      from,
      to,
      weekly: c.weekly,
      ledger: c.ledger,
      appVersion: __APP_VERSION__,
      exportedAt: platform.now(),
    });
    await platform.writeExport(path, bytes);
    await repo.updateSettings({ ui: { lastExportDir: dirOf(path) } });

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
    useExport.setState({ busy: false });
  }
}

/** 대화상자 기본값: 기간 지정은 최근 4주 */
export function defaultChoice(): ExportChoice {
  const current = useBoard.getState().weekId;
  return { kind: "thisWeek", from: addWeeks(current, -3), to: current, weekly: true, ledger: true };
}
