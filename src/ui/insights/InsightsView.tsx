// 인사이트 화면(m3-s1-spec 1~3·7·8·9절): 필터 줄 + 업무 목록 + (머리 · 업무 경과 지도 · 경과 타임라인).
// 보드는 그대로 숨겨 둔다(1-2). S2(m3-s2-spec): 탭 줄 [경과 타임라인 | 활동 개요], 업무 고르기(두 탭 공통).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  buildTimeline,
  journeyMap,
  journeySpan,
  periodRange,
  searchTimeline,
  spanDates,
  timelineCounts,
  timelineText,
  weeksBetween,
  type PeriodKind,
} from "../../domain/insights";
import { chipsToShow, matchesTagFilter } from "../../domain/tags";
import type { Category, CategoryPeriod } from "../../domain/types";
import { addWeeks, weekIdOf, type DateStr } from "../../domain/week";
import { STR } from "../../shared/strings";
import {
  focusStartCell,
  reactivateCategory,
  reportError,
  setTagFilter,
  toast,
  useBoard,
} from "../board/boardStore";
import { useAppStore } from "../common/appStore";
import { useMediaQuery } from "../common/useMediaQuery";
import { CategoryPicker } from "./CategoryPicker";
import { JourneyMap } from "./JourneyMap";
import { OverviewTab } from "./OverviewTab";
import { Timeline } from "./Timeline";
import {
  closeInsights,
  isOngoing,
  isPicked,
  loadInsights,
  mapUnitOf,
  selectCategory,
  setIncludeEnded,
  setMapOpen,
  setPeriod,
  setQuery,
  setTab,
  useInsights,
  type InsightTab,
} from "./insightsStore";
import styles from "./Insights.module.css";

/** 달 접기 기준일(4-6): 오늘 — 단 마지막 기록이 그보다 앞이면(종료된 업무) 그 날, 마지막 3개 달이 펼쳐진 채 보이게 */
const foldBase = (today: DateStr, last: DateStr | undefined) => (last && last < today ? last : today);
const md = (d: DateStr) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const PERIODS: PeriodKind[] = ["4w", "12w", "year", "all", "custom"];
const TABS: InsightTab[] = ["timeline", "overview"];

const CopyIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <rect x="5" y="5" width="8.5" height="8.5" rx="1.5" />
    <path d="M3 10.5V3.5A1 1 0 0 1 4 2.5h6.5" />
  </svg>
);

const SearchIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    aria-hidden="true"
  >
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5l3 3" strokeLinecap="round" />
  </svg>
);

export function InsightsView() {
  const st = useInsights();
  const today = useBoard((s) => s.today);
  const tags = useBoard((s) => s.tags);
  const categoryTags = useBoard((s) => s.categoryTags);
  const tagFilter = useBoard((s) => s.tagFilter);
  const narrow = useMediaQuery("(max-width: 1099px)");
  const searchRef = useRef<HTMLInputElement>(null);
  const [matchIdx, setMatchIdx] = useState(0);
  const data = st.data;
  const thisWeek = weekIdOf(today);

  const cats = data?.categories ?? [];
  const periods = useMemo(() => data?.periods ?? [], [data]);
  const shown = (c: Category) => matchesTagFilter(categoryTags[c.id] ?? [], tagFilter);
  const lastEnd = (id: string) =>
    periods
      .filter((p) => p.categoryId === id)
      .map((p) => p.endDate ?? "")
      .sort()
      .at(-1) ?? "";
  const ongoing = cats.filter((c) => isOngoing(periods, c.id));
  const ended = cats
    .filter((c) => !isOngoing(periods, c.id))
    .sort((a, b) => (lastEnd(a.id) < lastEnd(b.id) ? 1 : -1));
  // 태그 필터 → 업무 고르기(m3-s2-spec 2절)
  const tagOn = ongoing.filter(shown);
  const tagOff = ended.filter(shown);
  const picked = (c: Category) => isPicked(st.picked, c.id);
  const listOn = tagOn.filter(picked);
  const listOff = st.includeEnded ? tagOff.filter(picked) : [];
  const overviewRows = [
    ...listOn.map((category) => ({ category, ended: false })),
    ...listOff.map((category) => ({ category, ended: true })),
  ];
  const cat = cats.find((c) => c.id === st.categoryId) ?? null;
  const own: CategoryPeriod[] = useMemo(
    () => periods.filter((p) => p.categoryId === st.categoryId),
    [periods, st.categoryId],
  );
  const catOngoing = cat ? isOngoing(periods, cat.id) : false;
  const hiddenByFilter = !!cat && (!shown(cat) || !picked(cat) || (!catOngoing && !st.includeEnded));

  const rows = useMemo(
    () =>
      data?.span
        ? buildTimeline({
            items: data.entries,
            periods: own,
            span: data.span,
            today,
            dayMarks: data.dayMarks,
            notes: data.notes,
          })
        : [],
    [data, own, today],
  );
  const counts = timelineCounts(rows);
  const search = useMemo(() => searchTimeline(rows, st.query), [rows, st.query]);
  const currentMatch = search.ids.length ? search.ids[Math.min(matchIdx, search.ids.length - 1)]! : null;

  // 경과 지도(4-0)
  const unit = mapUnitOf(st);
  const jSpan = data && cat ? journeySpan(own, data.days, today) : null;
  const cells = useMemo(
    () => (data && jSpan && unit ? journeyMap(data.days, own, jSpan, today, unit) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, own, today, unit, jSpan?.fromWeek, jSpan?.toWeek],
  );

  // 머리 숫자
  const start = own.map((p) => p.startDate).sort()[0] ?? null;
  const endDate = !catOngoing && own.length ? lastEnd(cat!.id) : null;
  const weeksSince = jSpan && catOngoing ? weeksBetween(jSpan).length : null;
  const periodName = STR.insights.periods[st.period.kind];

  // 기간 밖 이전 기록(8-3)
  const earlierWeeks = useMemo(() => {
    if (!data?.span) return 0;
    const from = spanDates(data.span).from;
    return new Set(data.days.filter((d) => d.date < from).map((d) => weekIdOf(d.date))).size;
  }, [data]);
  // 앱 전체 기록이 4주 미만(8-4)
  const fewWeeks = useMemo(() => {
    const stats = Object.values(data?.stats ?? {});
    if (!data || !stats.length) return !!data;
    const first = stats.map((s) => s.first).sort()[0]!;
    const last = stats
      .map((s) => s.last)
      .sort()
      .at(-1)!;
    return weeksBetween({ fromWeek: weekIdOf(first), toWeek: weekIdOf(last) }).length < 4;
  }, [data]);

  // 직접 지정의 주 고르기 목록: 그 업무의 처음(또는 2년 전) ~ 이번 주(또는 마지막 기록)
  const weekOptions = useMemo(() => {
    if (st.period.kind !== "custom") return [];
    const first = data?.days[0]?.date;
    const from = first ? weekIdOf(first) : addWeeks(thisWeek, -104);
    const last = data?.days.at(-1)?.date;
    const to = last && weekIdOf(last) > thisWeek ? weekIdOf(last) : thisWeek;
    return weeksBetween({ fromWeek: from < to ? from : to, toWeek: to }).reverse();
  }, [st.period.kind, data, thisWeek]);

  const copy = async () => {
    if (!cat || !data?.span) return;
    const text = timelineText(rows, { name: cat.name, span: data.span, startDate: start, endDate });
    try {
      await useAppStore.getState().platform?.writeClipboard(text);
      toast(STR.insights.copied(counts.recordedWeeks, counts.items));
    } catch (e) {
      reportError(e);
    }
  };

  // Ctrl+F = 찾기, Ctrl+Shift+C = 경과 복사(인사이트가 보일 때만)
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!useInsights.getState().open || useInsights.getState().tab !== "timeline" || e.isComposing) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && !e.shiftKey && e.code === "KeyF") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (mod && e.shiftKey && !e.altKey && e.code === "KeyC") {
        e.preventDefault();
        void copy();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter") {
      e.preventDefault();
      const n = search.ids.length;
      if (n) setMatchIdx((i) => (Math.min(i, n - 1) + (e.shiftKey ? n - 1 : 1)) % n);
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (st.query) {
        setQuery("");
        setMatchIdx(0);
      } else document.querySelector<HTMLElement>("[data-cat-current]")?.focus();
    }
  };

  const onListKey = (e: KeyboardEvent<HTMLElement>) => {
    const list = [...listOn, ...listOff];
    const i = list.findIndex((c) => c.id === st.categoryId);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = list[Math.max(0, Math.min(list.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next) {
        selectCategory(next.id);
        requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-cat-current]")?.focus());
      }
    } else if (e.key === "Enter" || e.key === "ArrowRight") {
      e.preventDefault();
      const tl = document.querySelector<HTMLElement>('[data-testid="timeline"]');
      const first = tl?.querySelectorAll<HTMLElement>("[data-tl-nav]");
      (first?.length ? first[first.length - 1] : tl)?.focus();
    }
  };

  const catButton = (c: Category, isEnded: boolean) => {
    const s = data?.stats[c.id];
    const on = c.id === st.categoryId;
    return (
      <button
        key={c.id}
        type="button"
        className={`${styles.cat} ${on ? styles.catOn : ""}`}
        aria-current={on ? "true" : undefined}
        data-cat-current={on ? "" : undefined}
        data-testid="insight-category"
        tabIndex={on ? 0 : -1}
        onClick={() => selectCategory(c.id)}
      >
        <span className={styles.catName}>
          <span
            className={`${styles.dot} ${isEnded ? styles.dotEnded : ""}`}
            style={isEnded ? undefined : { background: `var(--cat-${c.color})` }}
          />
          {c.name}
        </span>
        <span className={styles.catMeta}>
          {!s
            ? STR.insights.noRecord
            : isEnded
              ? STR.insights.endedAt(md(lastEnd(c.id) || s.last), s.inRange)
              : STR.insights.lastAt(md(s.last), s.inRange)}
        </span>
      </button>
    );
  };

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = TABS[(TABS.indexOf(st.tab) + 1) % TABS.length]!;
    setTab(next);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-insight-tab="${next}"]`)?.focus());
  };

  const picker = (
    <CategoryPicker ongoing={tagOn} ended={tagOff} includeEnded={st.includeEnded} picked={st.picked} />
  );
  const includeEndedBox = (
    <label className={styles.check}>
      <input
        type="checkbox"
        checked={st.includeEnded}
        data-testid="insight-include-ended"
        onChange={(e) => setIncludeEnded(e.target.checked)}
      />
      {STR.insights.includeEnded}
    </label>
  );

  const myTags = cat ? chipsToShow(tags.filter((t) => categoryTags[cat.id]?.includes(t.id))) : null;

  return (
    <div className={styles.view} data-testid="insights">
      <div className={styles.filters}>
        <div className={styles.tabs} role="tablist" aria-label={STR.insights.tabs} onKeyDown={onTabKey}>
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              id={`insight-tab-${t}`}
              aria-selected={st.tab === t}
              aria-controls="insight-panel"
              tabIndex={st.tab === t ? 0 : -1}
              className={styles.tab}
              data-insight-tab={t}
              data-testid={`insight-tab-${t}`}
              onClick={() => setTab(t)}
            >
              {t === "timeline" ? STR.insights.timeline : STR.insights.overview}
            </button>
          ))}
        </div>
        <span className={styles.vsep} />
        {picker}
        {st.tab === "overview" ? (
          <>
            {includeEndedBox}
            <span className={styles.grow} />
            <span className={styles.muted}>{STR.insights.perChart}</span>
          </>
        ) : (
          <>
            {narrow && (
              <label className={styles.check}>
                {STR.insights.categorySelect}
                <select
                  value={st.categoryId ?? ""}
                  aria-label={STR.insights.categorySelect}
                  onChange={(e) => selectCategory(e.target.value)}
                >
                  {[...listOn, ...listOff, ...(cat && hiddenByFilter ? [cat] : [])].map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className={styles.check}>
              {STR.insights.period}
              <select
                value={st.period.kind}
                data-testid="insight-period"
                onChange={(e) => {
                  const kind = e.target.value as PeriodKind;
                  if (kind === "custom") {
                    const cur = data?.span ?? periodRange({ kind: "12w" }, today);
                    setPeriod({ kind, from: cur.fromWeek, to: cur.toWeek });
                  } else setPeriod({ kind });
                }}
              >
                {PERIODS.map((k) => (
                  <option key={k} value={k}>
                    {STR.insights.periods[k]}
                  </option>
                ))}
              </select>
            </label>
            {st.period.kind === "custom" && (
              <>
                <select
                  aria-label={STR.insights.customFrom}
                  value={st.period.from}
                  onChange={(e) => setPeriod({ ...st.period, from: e.target.value })}
                >
                  {weekOptions.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
                ~
                <select
                  aria-label={STR.insights.customTo}
                  value={st.period.to}
                  onChange={(e) => setPeriod({ ...st.period, to: e.target.value })}
                >
                  {weekOptions.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
              </>
            )}
            {includeEndedBox}
            <span className={styles.grow} />
            {data?.span && (
              <span className={styles.muted} data-testid="insight-range">
                {STR.insights.rangeNow(data.span.fromWeek, data.span.toWeek.slice(5), thisWeek)}
              </span>
            )}
          </>
        )}
      </div>
      {fewWeeks && <div className={styles.notice}>{STR.insights.fewWeeks}</div>}

      {st.tab === "overview" ? (
        <div
          className={styles.body}
          role="tabpanel"
          id="insight-panel"
          aria-labelledby="insight-tab-overview"
        >
          <OverviewTab rows={overviewRows} periods={periods} />
        </div>
      ) : (
        <div
          className={styles.body}
          role="tabpanel"
          id="insight-panel"
          aria-labelledby="insight-tab-timeline"
        >
          {!narrow && (
            <nav
              className={styles.list}
              aria-label={STR.insights.listHead}
              onKeyDown={onListKey}
              data-testid="insight-list"
            >
              <div className={styles.listHead}>
                <span>{STR.insights.listHead}</span>
                <span>{STR.insights.listCount(ongoing.length, ended.length)}</span>
              </div>
              {hiddenByFilter && (
                <div className={styles.filterNote}>
                  {STR.insights.hiddenByFilter}
                  {tagFilter.length > 0 && (
                    <>
                      {" · "}
                      <button type="button" className={styles.linkBtn} onClick={() => setTagFilter([])}>
                        {STR.insights.clearFilter}
                      </button>
                    </>
                  )}
                </div>
              )}
              {listOn.map((c) => catButton(c, false))}
              {listOff.length > 0 && <div className={styles.group}>{STR.insights.endedGroup}</div>}
              {listOff.map((c) => catButton(c, true))}
            </nav>
          )}

          <div className={styles.main}>
            {!cat ? (
              <div className={styles.empty} data-testid="insight-empty">
                <strong>{STR.insights.emptyPick}</strong>
                <span>{STR.insights.emptyPickHint}</span>
              </div>
            ) : (
              <>
                <div className={styles.head}>
                  <div className={styles.headText}>
                    <h2 className={styles.title} data-testid="insight-title">
                      <span className={styles.dot} style={{ background: `var(--cat-${cat.color})` }} />
                      {cat.name}
                      {myTags?.shown.map((t) => (
                        <span key={t.id} className={styles.tag}>
                          #{t.name}
                        </span>
                      ))}
                      {myTags && myTags.more > 0 && <span className={styles.tag}>+{myTags.more}</span>}
                    </h2>
                    <span className={styles.muted} data-testid="insight-meta">
                      {[
                        start ? STR.insights.started(start) : null,
                        catOngoing
                          ? STR.insights.ongoing
                          : endDate
                            ? STR.insights.endedOn(md(endDate))
                            : null,
                        own.length > 1 ? STR.insights.resumedTimes(own.length - 1) : null,
                        weeksSince ? STR.insights.weeksSince(weeksSince) : null,
                        STR.insights.recordedWeeks(counts.recordedWeeks, counts.activeWeeks),
                        STR.insights.recordedDays(data?.days.length ?? 0),
                        STR.insights.itemCount(counts.items),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                  <div className={styles.headTools}>
                    {!catOngoing && own.length > 0 && (
                      <button
                        type="button"
                        className={styles.btn}
                        onClick={async () => {
                          await reactivateCategory(cat.id, cat.name);
                          await loadInsights();
                        }}
                      >
                        {STR.insights.reactivate}
                      </button>
                    )}
                    <label className={styles.searchBox}>
                      <SearchIcon />
                      <input
                        ref={searchRef}
                        type="search"
                        value={st.query}
                        placeholder={STR.insights.search}
                        aria-label={STR.insights.searchAria}
                        data-testid="insight-search"
                        onChange={(e) => {
                          setQuery(e.target.value);
                          setMatchIdx(0);
                        }}
                        onKeyDown={onSearchKey}
                      />
                    </label>
                    {st.query.trim() && (
                      <span
                        className={styles.muted}
                        data-testid="insight-search-count"
                        title={STR.insights.searchHelp}
                      >
                        {STR.insights.searchCount(
                          currentMatch ? search.ids.indexOf(currentMatch) + 1 : 0,
                          search.ids.length,
                        )}
                      </span>
                    )}
                    {!st.mapOpen && cells.length > 0 && (
                      <button type="button" className={styles.btn} onClick={() => setMapOpen(true)}>
                        {STR.insights.mapShow}
                      </button>
                    )}
                    <button
                      type="button"
                      className={styles.btn}
                      title={STR.insights.copyTitle}
                      data-testid="insight-copy"
                      disabled={!rows.length}
                      onClick={() => void copy()}
                    >
                      <CopyIcon />
                      {STR.insights.copy}
                    </button>
                  </div>
                </div>

                {st.mapOpen && cells.length > 0 && unit && (
                  <div style={{ padding: "0 24px" }}>
                    <JourneyMap
                      cells={cells}
                      unit={unit}
                      range={data?.span ?? null}
                      rangeLabel={periodName}
                      visibleWeeks={st.visibleWeeks}
                      ongoing={catOngoing}
                    />
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <button type="button" className={styles.linkBtn} onClick={() => setMapOpen(false)}>
                        {STR.insights.mapHide}
                      </button>
                    </div>
                  </div>
                )}

                {!data?.days.length ? (
                  <div className={styles.empty} data-testid="insight-empty-record">
                    <strong>{STR.insights.emptyRecord}</strong>
                    <span>{STR.insights.emptyRecordHint}</span>
                    <button
                      type="button"
                      className={styles.btn}
                      onClick={() => {
                        closeInsights();
                        focusStartCell();
                      }}
                    >
                      {STR.insights.goBoard}
                    </button>
                  </div>
                ) : (
                  <Timeline
                    rows={rows}
                    today={foldBase(today, data.days.at(-1)?.date)}
                    categoryId={cat.id}
                    query={st.query}
                    search={search}
                    currentMatch={st.query.trim() ? currentMatch : null}
                    resetKey={`${cat.id}|${data.span?.fromWeek}|${data.span?.toWeek}`}
                    top={
                      earlierWeeks > 0 && st.period.kind !== "all" ? (
                        <div className={styles.notes} data-testid="insight-earlier">
                          <span>{STR.insights.earlier(periodName, earlierWeeks, data.days[0]!.date)}</span>
                          <span>
                            <button
                              type="button"
                              className={styles.linkBtn}
                              onClick={() => setPeriod({ kind: "all" })}
                            >
                              {STR.insights.showAll}
                            </button>
                          </span>
                        </div>
                      ) : null
                    }
                  />
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
