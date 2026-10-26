import { DAY_LABELS, dayIndex, weekTitle } from "../../domain/week";
import { STR } from "../../shared/strings";
import { goDay, goToday, goWeek, retryFailed, setViewMode, setYearOpen, useBoard } from "../board/boardStore";
import { YearMinimap } from "../board/YearMinimap";
import { toggleExport } from "../export/exportStore";
import { toggleSummary, useSummary } from "../summary/summaryStore";
import { setSettingsOpen } from "./appController";
import { useAppStore } from "./appStore";
import { BrandLockup } from "./Brand";
import { IconDayView, IconWeekView } from "./icons";
import { TagFilterMenu } from "./TagFilterMenu";
import styles from "./TopBar.module.css";

export function TopBar() {
  const ready = useBoard((s) => s.ready);
  const weekId = useBoard((s) => s.weekId);
  const yearOpen = useBoard((s) => s.yearOpen);
  const viewMode = useBoard((s) => s.viewMode);
  const focusDay = useBoard((s) => s.focusDay);
  const todayView = viewMode === "today";
  const dayLabel = focusDay
    ? `${Number(focusDay.slice(5, 7))}/${Number(focusDay.slice(8, 10))}(${DAY_LABELS[dayIndex(focusDay)]})`
    : "";
  const today = useBoard((s) => s.today);
  // 오늘 뷰 아이콘의 숫자 = 그 뷰가 보여 주는 날, 주간 뷰일 때는 오늘(improve-1026v2-spec 10절)
  const iconDay = (todayView ? focusDay : today) || focusDay;
  const iconDayLabel = iconDay
    ? `${Number(iconDay.slice(5, 7))}/${Number(iconDay.slice(8, 10))}(${DAY_LABELS[dayIndex(iconDay)]})`
    : "";
  const saving = useBoard((s) => s.saving);
  const failed = useBoard((s) => s.failed.length);
  const journalReady = useAppStore((s) => s.journal.state === "ready");
  const summaryOpen = useSummary((s) => s.open);

  return (
    <header className={styles.header}>
      {/* 1줄: 앱 타이틀만 */}
      <div className={styles.brandRow}>
        <BrandLockup size="bar" />
      </div>
      {/* 2줄: 연도·주차 이동 · 저장 상태 · 설정 */}
      <div className={styles.bar}>
        {ready && journalReady && (
          <nav className={styles.nav}>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={todayView ? STR.today.prevDay : STR.topBar.prevWeek}
              title={todayView ? STR.today.prevDay : STR.topBar.prevWeek}
              onClick={() => void (todayView ? goDay(-1) : goWeek(-1))}
            >
              ◀
            </button>
            <span className={styles.week} data-testid="week-title">
              {todayView ? `${dayLabel} · ${weekId}` : weekTitle(weekId)}
            </span>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={todayView ? STR.today.nextDay : STR.topBar.nextWeek}
              title={todayView ? STR.today.nextDay : STR.topBar.nextWeek}
              onClick={() => void (todayView ? goDay(1) : goWeek(1))}
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
            {/* [주간 | 오늘] 보기 — 아이콘 두 개(improve-1026v2-spec 9·10절), 이름·단축키는 aria-label·title */}
            <div className={styles.segment} role="group" aria-label={STR.today.viewGroup}>
              <button
                type="button"
                aria-pressed={!todayView}
                aria-label={STR.today.weekView}
                title={STR.today.weekView}
                data-testid="view-week"
                onClick={() => setViewMode("week")}
              >
                <IconWeekView />
              </button>
              <button
                type="button"
                aria-pressed={todayView}
                aria-label={STR.today.dayView(iconDayLabel)}
                title={STR.today.dayView(iconDayLabel)}
                data-testid="view-today"
                onClick={() => setViewMode("today")}
              >
                <IconDayView day={iconDay ? Number(iconDay.slice(8, 10)) : new Date().getDate()} />
              </button>
            </div>
          </nav>
        )}
        <div className={styles.spacer} />
        {ready && journalReady && <TagFilterMenu />}
        {ready && journalReady && (
          <button
            type="button"
            className={styles.textButton}
            title={STR.summary.buttonTitle}
            aria-pressed={summaryOpen}
            data-testid="summary-toggle"
            onClick={() => toggleSummary()}
          >
            {STR.summary.button}
          </button>
        )}
        {ready && journalReady && (
          <button
            type="button"
            className={styles.textButton}
            title={STR.export.buttonTitle}
            data-testid="export-open"
            onClick={() => toggleExport()}
          >
            {STR.export.button}
          </button>
        )}
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
      </div>
    </header>
  );
}
