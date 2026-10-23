import { useEffect } from "react";
import { STR } from "../shared/strings";
import { BoardView } from "./board/BoardView";
import { useShortcuts } from "./board/useShortcuts";
import { start } from "./common/appController";
import { useAppStore, type JournalStatus } from "./common/appStore";
import { Toasts } from "./common/Toasts";
import { TopBar } from "./common/TopBar";
import { FirstRun } from "./first-run/FirstRun";
import { IntegrityProblem, MissingFolder } from "./first-run/StartScreens";
import { SettingsPanel } from "./settings/SettingsPanel";
import styles from "./App.module.css";

let started = false;

export function App() {
  const journal = useAppStore((s) => s.journal);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  useShortcuts();

  useEffect(() => {
    if (started) return; // StrictMode 이중 실행 방지
    started = true;
    start().catch((e) => useAppStore.setState({ journal: { state: "error", message: String(e) } }));
  }, []);

  return (
    <div className={styles.shell}>
      <TopBar />
      <main className={styles.main}>{screen(journal)}</main>
      <footer className={styles.status} data-testid="journal-status">
        {statusText(journal)}
      </footer>
      {settingsOpen && journal.state === "ready" && <SettingsPanel />}
      <Toasts />
    </div>
  );
}

function screen(journal: JournalStatus) {
  switch (journal.state) {
    case "ready":
      return <BoardView />;
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
