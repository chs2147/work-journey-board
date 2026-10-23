import { useEffect } from "react";
import { loadPlatform } from "../platform";
import { STR } from "../shared/strings";
import { useAppStore, type JournalStatus } from "./common/appStore";
import { TopBar } from "./common/TopBar";
import styles from "./App.module.css";

export function App() {
  const journal = useAppStore((s) => s.journal);

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
        if (!cancelled) setJournal({ state: "ready", driver, sqliteVersion: row?.v ?? "?" });
      } catch (e) {
        if (!cancelled) setJournal({ state: "error", message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={styles.shell}>
      <TopBar />
      <main className={styles.main}>
        <p className={styles.placeholder}>{STR.board.placeholder}</p>
      </main>
      <footer className={styles.status} data-testid="journal-status">
        {statusText(journal)}
      </footer>
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
