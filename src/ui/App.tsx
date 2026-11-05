import { useEffect } from "react";
import { STR } from "../shared/strings";
import { BoardView } from "./board/BoardView";
import { setPanelOpen, useBoard } from "./board/boardStore";
import { useShortcuts } from "./board/useShortcuts";
import { start } from "./common/appController";
import { useAppStore, type JournalStatus } from "./common/appStore";
import { Toasts } from "./common/Toasts";
import { NewWorkspaceDialog } from "./common/NewWorkspaceDialog";
import { Rail } from "./common/Rail";
import { TopBar } from "./common/TopBar";
import { useMediaQuery, useWindowWidth } from "./common/useMediaQuery";
import { FirstRun } from "./first-run/FirstRun";
import { IntegrityProblem, MissingFolder } from "./first-run/StartScreens";
import { ImportantPanel } from "./important/ImportantPanel";
import { SearchBand, SearchPanel } from "./search/SearchViews";
import { MarkdownExportDialog } from "./note/MarkdownExportDialog";
import { CabinetPanel } from "./cabinet/CabinetPanel";
import { FolderPanels } from "./cabinet/FolderPanels";
import { useCabinet } from "./cabinet/cabinetStore";
import { onSearchKey, useSearch } from "./search/searchStore";
import { usePanelWidths } from "./common/panelWidths";
import { ExportDialog } from "./export/ExportDialog";
import { ImportWizard } from "./import/ImportWizard";
import { useImport } from "./import/importStore";
import { useExport } from "./export/exportStore";
import { SettingsView } from "./settings/SettingsView";
import { setSummaryOpen, useSummary } from "./summary/summaryStore";
import { SummaryPanel } from "./summary/SummaryPanel";
import { NoteDock } from "./note/NoteDock";
import { TodayView } from "./today/TodayView";
import { InsightsView } from "./insights/InsightsView";
import { useInsights } from "./insights/insightsStore";
import { UniverseView } from "./universe/UniverseView";
import { useUniverse } from "./universe/universeStore";
import { useNote } from "./note/noteStore";
import { finishSplash } from "./splash";
import { checkOnStart, useUpdate } from "./update/updateStore";
import { UpdateBanner, UpdateDialog } from "./update/UpdateViews";
import { runMenuAction } from "./common/menuActions";
import styles from "./App.module.css";

let started = false;

export function App() {
  const journal = useAppStore((s) => s.journal);
  const backingUp = useAppStore((s) => s.backingUp);
  const exportOpen = useExport((s) => s.open);
  const importOpen = useImport((s) => s.open);
  const updateOpen = useUpdate((s) => s.dialogOpen);
  const creatingWorkspace = useAppStore((s) => s.creatingWorkspace);
  useShortcuts();

  useEffect(() => {
    if (started) return; // StrictMode 이중 실행 방지
    started = true;
    start().catch((e) => useAppStore.setState({ journal: { state: "error", message: String(e) } }));
  }, []);

  // 맥 메뉴 막대 항목 → 단축키와 같은 동작(macos-spec 3-1)
  const platform = useAppStore((s) => s.platform);
  useEffect(() => {
    platform?.onMenuAction?.((id) => runMenuAction(id, platform));
  }, [platform]);

  // 시작 화면(보드·첫 실행·오류 등)이 정해지면 스플래시 창에서 메인 창으로 넘어간다.
  useEffect(() => {
    if (journal.state !== "loading") void finishSplash(useAppStore.getState().platform);
  }, [journal.state]);

  // 새 판 확인은 앱을 켤 때 1번(improve-1027v4-spec 1절) — 보드가 뜬 뒤 조금 있다가, 실패해도 조용히
  useEffect(() => {
    if (journal.state !== "ready") return;
    const t = setTimeout(() => void checkOnStart(), 1500);
    return () => clearTimeout(t);
  }, [journal.state]);

  return (
    <div className={styles.shell}>
      <TopBar />
      {journal.state === "ready" && <UpdateBanner />}
      <main className={styles.main}>{screen(journal)}</main>
      <footer className={styles.status} data-testid="journal-status">
        {statusText(journal)}
        {backingUp && <span data-testid="backup-busy"> · {STR.backupMore.busy}</span>}
      </footer>
      {exportOpen && journal.state === "ready" && <ExportDialog />}
      {importOpen && journal.state === "ready" && <ImportWizard />}
      {updateOpen && journal.state === "ready" && <UpdateDialog />}
      {creatingWorkspace && journal.state === "ready" && <NewWorkspaceDialog />}
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

/** 레일 폭(important-repeat-spec 1-3) — 패널 폭은 사용자가 조절(panelWidths, improve-1101 #2) */
const RAIL_W = 52;
/** 주간 요약 패널을 열어도 보드에 남겨 둘 최소 폭 — 모자라면 패널을 겹쳐 띄운다(i-m2-plan 6절 #2) */
const BOARD_MIN_W = 900;

/** 일지가 열린 화면: 왼쪽 레일 + (중요 업무 패널) + 보드 + (주간 요약 패널) */
function Workspace() {
  const panelOpen = useBoard((s) => s.panelOpen);
  const viewMode = useBoard((s) => s.viewMode);
  const summaryOpen = useSummary((s) => s.open);
  const searchPanelOpen = useSearch((s) => s.panelOpen);
  useEffect(() => {
    window.addEventListener("keydown", onSearchKey);
    return () => window.removeEventListener("keydown", onSearchKey);
  }, []);
  const noteExpanded = useNote((s) => s.expanded);
  // 실앱은 Cabinet이 별도 OS 창이라 여기서 그리지 않는다(improve-1102-spec C1)
  const cabinetOpen = useCabinet((s) => s.open);
  const cabinetOsWindow = useAppStore((s) => !!s.platform?.cabinetWindow);
  const cabinetInApp = cabinetOpen && !cabinetOsWindow;
  // 인사이트(m3-s1-spec 1-2): 보드는 숨겨 둔 채 그대로 — 보던 주·뷰·커서·메모가 남는다
  const insightsOpen0 = useInsights((s) => s.open);
  // Universe(universe-spec 4절): 인사이트처럼 보드 자리를 덮는다 — 둘은 함께 열리지 않는다
  const universeOpen = useUniverse((s) => s.open);
  const insightsOpen = insightsOpen0 || universeOpen;
  // 설정(improve-1027v5-spec 1-2)도 인사이트처럼 보드 자리를 덮는다 — 보드·인사이트는 그대로 두고 숨김
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  // 메모 도크가 자동 높이면 보드는 필요한 만큼만(남는 공간은 메모) — 접혀 있으면 보드가 다 쓴다
  const noteAutoHeight = useNote((s) => s.dockAuto && !s.collapsed);
  // 좁은 창이면 패널을 보드 위에 겹쳐 띄우고, 보드를 누르면 닫는다(spec 1-3)
  const narrow = useMediaQuery("(max-width: 1179px)");
  const width = useWindowWidth();
  const importantW = usePanelWidths((s) => s.important);
  const summaryW = usePanelWidths((s) => s.summary);
  const leftW = panelOpen && !universeOpen && !narrow && !settingsOpen ? importantW : 0;
  const summaryOverlay = width - RAIL_W - leftW - summaryW < BOARD_MIN_W;
  return (
    <div className={styles.workspace}>
      <Rail />
      {panelOpen && !universeOpen && !settingsOpen && <ImportantPanel overlay={narrow} />}
      {insightsOpen0 && !universeOpen && !settingsOpen && <InsightsView />}
      {universeOpen && !settingsOpen && <UniverseView />}
      {settingsOpen && <SettingsView />}
      <div
        className={insightsOpen || settingsOpen ? styles.hidden : styles.boardArea}
        onMouseDown={() => {
          if (narrow && panelOpen) setPanelOpen(false);
          if (summaryOverlay && summaryOpen) setSummaryOpen(false);
        }}
      >
        <SearchBand
          rightInset={searchPanelOpen && summaryOverlay && !insightsOpen && !settingsOpen ? summaryW : 0}
        />
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
      <MarkdownExportDialog />
      {/* Cabinet(F5): 모달리스 — 보드·인사이트·설정 어디서나 위에 떠 있다 */}
      {cabinetInApp && <CabinetPanel />}
      <FolderPanels />
      {searchPanelOpen && !insightsOpen && !settingsOpen ? (
        <SearchPanel overlay={summaryOverlay} />
      ) : (
        summaryOpen && !insightsOpen && !settingsOpen && <SummaryPanel overlay={summaryOverlay} />
      )}
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
