import { useEffect } from "react";
import { STR } from "../shared/strings";
import { BoardView } from "./board/BoardView";
import { setPanelOpen, useBoard } from "./board/boardStore";
import { useShortcuts } from "./board/useShortcuts";
import { start } from "./common/appController";
import { useAppStore, type JournalStatus } from "./common/appStore";
import { Toasts } from "./common/Toasts";
import { Rail } from "./common/Rail";
import { TopBar } from "./common/TopBar";
import { useMediaQuery, useWindowWidth } from "./common/useMediaQuery";
import { FirstRun } from "./first-run/FirstRun";
import { IntegrityProblem, MissingFolder } from "./first-run/StartScreens";
import { ImportantPanel } from "./important/ImportantPanel";
import { ExportDialog } from "./export/ExportDialog";
import { ImportWizard } from "./import/ImportWizard";
import { useImport } from "./import/importStore";
import { useExport } from "./export/exportStore";
import { SettingsPanel } from "./settings/SettingsPanel";
import { setSummaryOpen, useSummary } from "./summary/summaryStore";
import { SummaryPanel } from "./summary/SummaryPanel";
import { NoteDock } from "./note/NoteDock";
import { TodayView } from "./today/TodayView";
import { InsightsView } from "./insights/InsightsView";
import { useInsights } from "./insights/insightsStore";
import { useNote } from "./note/noteStore";
import { finishSplash } from "./splash";
import styles from "./App.module.css";

let started = false;

export function App() {
  const journal = useAppStore((s) => s.journal);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const exportOpen = useExport((s) => s.open);
  const importOpen = useImport((s) => s.open);
  useShortcuts();

  useEffect(() => {
    if (started) return; // StrictMode 이중 실행 방지
    started = true;
    start().catch((e) => useAppStore.setState({ journal: { state: "error", message: String(e) } }));
  }, []);

  // 시작 화면(보드·첫 실행·오류 등)이 정해지면 스플래시 창에서 메인 창으로 넘어간다.
  useEffect(() => {
    if (journal.state !== "loading") void finishSplash(useAppStore.getState().platform);
  }, [journal.state]);

  return (
    <div className={styles.shell}>
      <TopBar />
      <main className={styles.main}>{screen(journal)}</main>
      <footer className={styles.status} data-testid="journal-status">
        {statusText(journal)}
      </footer>
      {settingsOpen && journal.state === "ready" && <SettingsPanel />}
      {exportOpen && journal.state === "ready" && <ExportDialog />}
      {importOpen && journal.state === "ready" && <ImportWizard />}
      <Toasts />
    </div>
  );
}

function screen(journal: JournalStatus) {
  switch (journal.state) {
    case "ready":
      return <Workspace />;
    case "first-run":
      return <FirstRun />;
    case "missing":
      return <MissingFolder dataDir={journal.dataDir} />;
    case "integrity":
      return <IntegrityProblem dataDir={journal.dataDir} path={journal.path} />;
    default:
      return <p className={styles.placeholder}>{statusText(journal)}</p>;
  }
}

/** 레일·패널 폭(important-repeat-spec 1-3, overview 10-7) */
const RAIL_W = 52;
const IMPORTANT_W = 264;
const SUMMARY_W = 360;
/** 주간 요약 패널을 열어도 보드에 남겨 둘 최소 폭 — 모자라면 패널을 겹쳐 띄운다(i-m2-plan 6절 #2) */
const BOARD_MIN_W = 900;

/** 일지가 열린 화면: 왼쪽 레일 + (중요 업무 패널) + 보드 + (주간 요약 패널) */
function Workspace() {
  const panelOpen = useBoard((s) => s.panelOpen);
  const viewMode = useBoard((s) => s.viewMode);
  const summaryOpen = useSummary((s) => s.open);
  const noteExpanded = useNote((s) => s.expanded);
  // 인사이트(m3-s1-spec 1-2): 보드는 숨겨 둔 채 그대로 — 보던 주·뷰·커서·메모가 남는다
  const insightsOpen = useInsights((s) => s.open);
  // 메모 도크가 자동 높이면 보드는 필요한 만큼만(남는 공간은 메모) — 접혀 있으면 보드가 다 쓴다
  const noteAutoHeight = useNote((s) => s.dockAuto && !s.collapsed);
  // 좁은 창이면 패널을 보드 위에 겹쳐 띄우고, 보드를 누르면 닫는다(spec 1-3)
  const narrow = useMediaQuery("(max-width: 1179px)");
  const width = useWindowWidth();
  const leftW = panelOpen && !narrow ? IMPORTANT_W : 0;
  const summaryOverlay = width - RAIL_W - leftW - SUMMARY_W < BOARD_MIN_W;
  return (
    <div className={styles.workspace}>
      <Rail />
      {panelOpen && <ImportantPanel overlay={narrow} />}
      {insightsOpen && <InsightsView />}
      <div
        className={insightsOpen ? styles.hidden : styles.boardArea}
        onMouseDown={() => {
          if (narrow && panelOpen) setPanelOpen(false);
          if (summaryOverlay && summaryOpen) setSummaryOpen(false);
        }}
      >
        {viewMode === "today" ? (
          <TodayView />
        ) : (
          <>
            {/* [크게 보기]면 메모가 보드 영역을 덮는다(보드는 그대로 두고 숨김 — 입력 상태 유지) */}
            <div
              className={
                noteExpanded
                  ? styles.hidden
                  : `${styles.boardFill} ${noteAutoHeight ? styles.boardFillNatural : ""}`
              }
            >
              <BoardView />
            </div>
            <NoteDock />
          </>
        )}
      </div>
      {summaryOpen && !insightsOpen && <SummaryPanel overlay={summaryOverlay} />}
    </div>
  );
}

function statusText(journal: JournalStatus): string {
  switch (journal.state) {
    case "loading":
      return STR.status.loading;
    case "ready":
      return STR.status.dbReady(journal.sqliteVersion, journal.dataDir);
    case "first-run":
      return STR.status.dbNotConfigured;
    case "missing":
      return STR.missing.title;
    case "integrity":
      return STR.integrity.title;
    case "error":
      return STR.status.dbError(journal.message);
  }
}
