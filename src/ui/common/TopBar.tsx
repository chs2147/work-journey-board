import { weekTitle } from "../../domain/week";
import { STR } from "../../shared/strings";
import { goToday, goWeek, retryFailed, setYearOpen, useBoard } from "../board/boardStore";
import { YearMinimap } from "../board/YearMinimap";
import { setSettingsOpen } from "./appController";
import { useAppStore } from "./appStore";
import { BrandLockup } from "./Brand";
import styles from "./TopBar.module.css";

export function TopBar() {
  const ready = useBoard((s) => s.ready);
  const weekId = useBoard((s) => s.weekId);
  const yearOpen = useBoard((s) => s.yearOpen);
  const saving = useBoard((s) => s.saving);
  const failed = useBoard((s) => s.failed.length);
  const journalReady = useAppStore((s) => s.journal.state === "ready");

  return (
    <header className={styles.bar}>
      <span className={styles.title}>
        <BrandLockup size="bar" />
      </span>
      {ready && journalReady && (
        <nav className={styles.nav}>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={STR.topBar.prevWeek}
            title={STR.topBar.prevWeek}
            onClick={() => void goWeek(-1)}
          >
            ◀
          </button>
          <span className={styles.week} data-testid="week-title">
            {weekTitle(weekId)}
          </span>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={STR.topBar.nextWeek}
            title={STR.topBar.nextWeek}
            onClick={() => void goWeek(1)}
          >
            ▶
          </button>
          <button
            type="button"
            className={styles.textButton}
            title={STR.topBar.todayTitle}
            onClick={() => void goToday()}
          >
            {STR.topBar.today}
          </button>
          <div className={styles.yearWrap}>
            <button
              type="button"
              className={styles.textButton}
              title={STR.topBar.yearTitle}
              aria-expanded={yearOpen}
              data-year-toggle
              onClick={() => setYearOpen(!yearOpen)}
            >
              {STR.topBar.year}
            </button>
            {yearOpen && <YearMinimap />}
          </div>
        </nav>
      )}
      <div className={styles.spacer} />
      {ready &&
        journalReady &&
        (failed > 0 ? (
          <button
            type="button"
            className={styles.saveFailed}
            title={STR.save.failedTitle}
            onClick={() => void retryFailed()}
          >
            {STR.save.failed}
          </button>
        ) : (
          <span className={styles.saveState} data-testid="save-state">
            {saving > 0 ? STR.save.saving : STR.save.saved}
          </span>
        ))}
      <button
        type="button"
        className={styles.iconButton}
        aria-label={STR.topBar.settings}
        title={journalReady ? STR.topBar.settings : STR.topBar.settingsDisabled}
        disabled={!journalReady}
        onClick={() => setSettingsOpen(true)}
      >
        ⚙
      </button>
    </header>
  );
}
