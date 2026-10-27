import { DAY_LABELS, dayIndex, weekTitle } from "../../domain/week";
import { STR } from "../../shared/strings";
import { goDay, goToday, goWeek, retryFailed, setViewMode, setYearOpen, useBoard } from "../board/boardStore";
import { YearMinimap } from "../board/YearMinimap";
import { toggleExport } from "../export/exportStore";
import { toggleSummary, useSummary } from "../summary/summaryStore";
import { useEffect, useState } from "react";
import { leaveSettings } from "./appController";
import { useAppStore } from "./appStore";
import { BrandLockup } from "./Brand";
import { IconDayView, IconWeekView } from "./icons";
import { TagFilterMenu } from "./TagFilterMenu";
import { useInsights } from "../insights/insightsStore";
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
  // 설정 화면(improve-1027v5-spec 1-2): 주 단위 기능·태그 필터는 감추고 [← 돌아가기] + "설정"
  const settings = useAppStore((s) => s.settingsOpen);
  const insightsOpen = useInsights((s) => s.open);
  // 인사이트 모드(m3-s1-spec 1-3): 주 단위 기능(주 이동·오늘·연간·보기·주간 요약·내보내기)은 감추고 태그 필터는 남긴다
  const insights = insightsOpen && !settings;
  const week = !insights && !settings;
  const showSaving = useSavingVisible(saving > 0);
  const savedAt = useBoard((s) => s.savedAt);

  return (
    <header className={styles.header}>
      {/* 1줄: 앱 타이틀만 */}
      <div className={styles.brandRow}>
        <BrandLockup size="bar" />
      </div>
      {/* 2줄: 연도·주차 이동 · 저장 상태 · 설정 */}
      <div className={styles.bar}>
        {ready && journalReady && settings && (
          <div className={styles.insightTitle} data-testid="settings-title">
            <button
              type="button"
              className={styles.textButton}
              title={STR.settings.backTitle}
              data-testid="settings-back"
              onClick={leaveSettings}
            >
              {insightsOpen ? STR.settings.backInsights : STR.settings.backBoard}
            </button>
            <b>{STR.settings.title}</b>
          </div>
        )}
        {ready && journalReady && insights && (
          <div className={styles.insightTitle} data-testid="insights-title">
            <b>{STR.insights.title}</b>
            <span>{STR.insights.subtitle}</span>
          </div>
        )}
        {ready && journalReady && week && (
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
        {ready && journalReady && !settings && <TagFilterMenu />}
        {ready && journalReady && week && (
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
        {ready && journalReady && week && (
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
              data-testid="save-failed"
              onClick={() => void retryFailed()}
            >
              <IconAlert />
              <span role="alert">{STR.save.failed}</span>
            </button>
          ) : showSaving ? (
            <span
              className={`${styles.savePill} ${styles.saving}`}
              data-testid="save-state"
              data-state="saving"
            >
              <IconSpin />
              {STR.save.saving}
            </span>
          ) : (
            // 저장됨(improve-1027v5-spec 2절): 초록 글자 + 초록 테두리 알약 + 체크 — 0.4초 안의 저장은 깜빡이지 않게 그대로
            <span
              className={`${styles.savePill} ${styles.saved}`}
              data-testid="save-state"
              data-state="saved"
              // 짧은 저장 중에도 "저장됨"을 유지하므로, 실제로 쓰는 중인지는 따로 둔다(테스트가 저장 끝을 기다림)
              data-idle={saving === 0 ? "true" : "false"}
              title={STR.save.savedTitle(savedAt)}
            >
              <IconSaved />
              {STR.save.saved}
            </span>
          ))}
      </div>
    </header>
  );
}

/** 저장 중 표시는 0.4초 넘게 걸릴 때만(improve-1027v5-spec 2절) — 짧은 저장마다 깜빡이지 않게 */
function useSavingVisible(saving: boolean): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!saving) return;
    const t = setTimeout(() => setLate(true), SAVING_DELAY_MS);
    return () => {
      clearTimeout(t);
      setLate(false);
    };
  }, [saving]);
  return saving && late;
}

const SAVING_DELAY_MS = 400;

const IconSaved = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <circle cx="7" cy="7" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <path
      d="M4.2 7.2 6.1 9.1 9.9 5.2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const IconSpin = () => (
  <svg className={styles.spin} width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <circle cx="7" cy="7" r="5.6" fill="none" stroke="var(--line)" strokeWidth="1.8" />
    <path
      d="M7 1.4a5.6 5.6 0 0 1 5.6 5.6"
      fill="none"
      stroke="var(--accent)"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

const IconAlert = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <circle cx="7" cy="7" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <path d="M7 3.8v3.8M7 9.6v.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);
