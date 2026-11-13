import { SaveStatus } from "./SaveStatus";
import { DAY_LABELS, dayIndex, weekTitle } from "../../domain/week";
import { STR } from "../../shared/strings";
import {
  goDay,
  goToday,
  goWeek,
  retryFailed,
  setViewMode,
  setAddOpen,
  setYearOpen,
  useBoard,
} from "../board/boardStore";
import { YearMinimap } from "../board/YearMinimap";
import { toggleExport } from "../export/exportStore";
import { toggleSummary, useSummary } from "../summary/summaryStore";

import { leaveSettings } from "./appController";
import { useAppStore } from "./appStore";
import { BrandLockup } from "./Brand";
import { sameDir } from "../../domain/workspace";
import { IconCategoryAdd, IconSummaryDoc, IconExportFile, IconDayView, IconWeekView } from "./icons";
import { TagFilterMenu } from "./TagFilterMenu";
import { SearchBox } from "../search/SearchViews";
import { useInsights } from "../insights/insightsStore";
import { useUniverse } from "../universe/universeStore";
import { useKanban } from "../kanban/kanbanStore";
import { KanbanActions, KanbanFilters, KanbanLayoutToggle } from "../kanban/KanbanToolbar";
import { AddCategoryDialog } from "../board/AddCategoryDialog";
import styles from "./TopBar.module.css";

export function TopBar() {
  const addOpen = useBoard((s) => s.addOpen);
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
  // Universe(universe-spec 4절): 인사이트처럼 보드 자리를 덮는다 — 주 단위 기능은 감춘다
  const universe = useUniverse((s) => s.open) && !settings;
  // 칸반(improve-v21-spec 2-1): 주 단위 기능은 감추고 제목만 — 필터·추가는 칸반 화면 안에
  const kanban = useKanban((k) => k.open) && !settings && !insights && !universe;
  const week = !insights && !settings && !universe && !kanban;

  const savedAt = useBoard((s) => s.savedAt);

  return (
    <header className={styles.header}>
      {/* 1줄: 앱 타이틀만 */}
      <div className={styles.brandRow}>
        <BrandLockup size="bar" />
        <WorkspaceName />
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
        {/* 칸반(improve-v22-spec 5절): 제목 글자 없이 업무 거르기·기간 아이콘부터 — 주간 보드와 같은 한 줄 */}
        {ready && journalReady && kanban && <KanbanFilters />}
        {ready && journalReady && universe && (
          <div className={styles.insightTitle} data-testid="universe-title">
            <b>{STR.universe.title}</b>
            <span>{STR.universe.subtitle}</span>
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
        {ready && journalReady && (week || kanban) && <SearchBox />}
        {ready && journalReady && !settings && <TagFilterMenu />}
        {ready && journalReady && kanban && <KanbanLayoutToggle segmentClass={styles.segment ?? ""} />}
        {ready && journalReady && (week || kanban) && (
          <button
            type="button"
            className={`${styles.textButton} ${styles.actionButton}`}
            data-testid="category-add"
            onClick={() => setAddOpen(true)}
          >
            <IconCategoryAdd />
            {STR.categoryCreate.button}
          </button>
        )}
        {ready && journalReady && (week || kanban) && addOpen && <AddCategoryDialog />}
        {ready && journalReady && kanban && (
          <KanbanActions className={`${styles.textButton} ${styles.actionButton}`} />
        )}
        {ready && journalReady && week && (
          <button
            type="button"
            className={`${styles.textButton} ${styles.actionButton}`}
            title={STR.summary.buttonTitle}
            aria-pressed={summaryOpen}
            data-testid="summary-toggle"
            onClick={() => toggleSummary()}
          >
            <IconSummaryDoc />
            {STR.summary.button}
          </button>
        )}
        {ready && journalReady && week && (
          <button
            type="button"
            className={`${styles.textButton} ${styles.actionButton}`}
            title={STR.export.buttonTitle}
            data-testid="export-open"
            onClick={() => toggleExport()}
          >
            <IconExportFile />
            {STR.export.button}
          </button>
        )}
        {ready && journalReady && (
          <SaveStatus
            saving={saving > 0}
            error={failed > 0 ? STR.save.failedTitle : undefined}
            onRetry={() => void retryFailed()}
            savedAt={savedAt}
          />
        )}
      </div>
    </header>
  );
}

/** 상단 1줄 앱 이름 옆 지금 공간 이름(multi-board-spec 3-1) — 공간이 2개 이상일 때만 */
function WorkspaceName() {
  const list = useAppStore((s) => s.workspaces);
  const dir = useAppStore((s) => (s.journal.state === "ready" ? s.journal.dataDir : null));
  const cur = list.find((e) => dir && sameDir(e.dir, dir));
  if (!cur || list.length < 2) return null;
  return (
    <span className={styles.workspaceName} data-testid="workspace-name">
      <span className={styles.workspaceDot} style={{ background: `var(--cat-${cur.color})` }} />
      {cur.name}
    </span>
  );
}
