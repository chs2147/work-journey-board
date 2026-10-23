import { useEffect } from "react";
import { JournalRepository } from "../data/repository";
import { loadPlatform } from "../platform";
import { STR } from "../shared/strings";
import { init as initBoard, flushAll } from "./board/boardStore";
import { BoardView } from "./board/BoardView";
import { useShortcuts } from "./board/useShortcuts";
import { useAppStore, type JournalStatus } from "./common/appStore";
import { Toasts } from "./common/Toasts";
import { TopBar } from "./common/TopBar";
import styles from "./App.module.css";

export function App() {
  const journal = useAppStore((s) => s.journal);
  useShortcuts();

  useEffect(() => {
    let cancelled = false;
    const { setPlatform, setJournal } = useAppStore.getState();
    (async () => {
      try {
        const platform = await loadPlatform();
        if (cancelled) return;
        setPlatform(platform);
        const driver = await platform.openJournal();
        if (cancelled) return;
        if (!driver) return setJournal({ state: "not-configured" });
        const [row] = await driver.select<{ v: string }>("SELECT sqlite_version() AS v");
        await initBoard(new JournalRepository(driver, () => platform.now()));
        if (!cancelled) setJournal({ state: "ready", driver, sqliteVersion: row?.v ?? "?" });
      } catch (e) {
        if (!cancelled) setJournal({ state: "error", message: e instanceof Error ? e.message : String(e) });
      }
    })();
    const beforeUnload = () => void flushAll();
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      cancelled = true;
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, []);

  return (
    <div className={styles.shell}>
      <TopBar />
      <main className={styles.main}>
        {journal.state === "ready" ? (
          <BoardView />
        ) : (
          <p className={styles.placeholder}>{statusText(journal)}</p>
        )}
      </main>
      <footer className={styles.status} data-testid="journal-status">
        {statusText(journal)}
      </footer>
      <Toasts />
    </div>
  );
}

function statusText(journal: JournalStatus): string {
  switch (journal.state) {
    case "loading":
      return STR.status.loading;
    case "ready":
      return STR.status.dbReady(journal.sqliteVersion, journal.driver.label);
    case "not-configured":
      return STR.status.dbNotConfigured;
    case "error":
      return STR.status.dbError(journal.message);
  }
}
