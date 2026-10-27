// 경과 타임라인 본문(m3-s1-spec 4~6절): 위 = 과거 → 아래 = 최근. 달 머리·주 행·무기록 접힘·쉬는 구간·구분선.
// 처음 열 때·업무를 바꿀 때 맨 아래(이번 주)로. 항목을 누르면 보드의 그 칸으로(인사이트는 닫힘).
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { DAY_MARK_LABEL } from "../../domain/dayMark";
import {
  foldBefore,
  monthOf,
  splitMatches,
  type SearchResult,
  type TimelineItem,
  type TimelineRow,
} from "../../domain/insights";
import { splitLinks, shortUrl } from "../../domain/links";
import { DAY_LABELS, dayIndex, type DateStr } from "../../domain/week";
import { STR } from "../../shared/strings";
import { doneDate } from "../../domain/important";
import { IconDone } from "../common/icons";
import { openLink } from "../common/openLink";
import { revealOnBoard, setVisibleWeeks, toggleMonth, useInsights } from "./insightsStore";
import styles from "./Insights.module.css";

const md = (d: DateStr) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const mdd = (a: DateStr, b: DateStr) =>
  `${md(a)}~${a.slice(5, 7) === b.slice(5, 7) ? Number(b.slice(8, 10)) : md(b)}`;
const weekLabel = (a: string, b: string) => (a === b ? a.slice(5) : `${a.slice(5)}~${b.slice(5)}`);
const dayTag = (d: DateStr) => `(${DAY_LABELS[dayIndex(d)]})`;

interface Props {
  rows: TimelineRow[];
  /** 달 접기 기준일(그 앞 3개 달 이전을 접는다) */
  today: DateStr;
  categoryId: string;
  query: string;
  search: SearchResult;
  currentMatch: string | null;
  /** 업무·기간이 바뀌면 맨 아래로 다시 */
  resetKey: string;
  top?: React.ReactNode;
}

/** 항목 글: 링크(밑줄 + ↗, Ctrl+클릭·↗ = 기본 브라우저)와 검색 강조 */
function ItemText({ text, query }: { text: string; query: string }) {
  return (
    <span className={styles.text}>
      {splitLinks(text).map((seg, i) =>
        seg.url ? (
          <span key={i} data-url={seg.url}>
            <span className={styles.link} title={`${seg.url}\n${STR.links.ctrlClick}`}>
              {shortUrl(seg.url)}
            </span>
            <span
              className={styles.linkOpen}
              data-open
              role="button"
              aria-label={STR.links.openAria(seg.url)}
            >
              ↗
            </span>
          </span>
        ) : (
          splitMatches(seg.text, query).map((p, j) =>
            p.hit ? (
              <mark key={`${i}-${j}`} className={styles.hit}>
                {p.text}
              </mark>
            ) : (
              <span key={`${i}-${j}`}>{p.text}</span>
            ),
          )
        ),
      )}
    </span>
  );
}

export function Timeline({ rows, today, categoryId, query, search, currentMatch, resetKey, top }: Props) {
  const monthOpen = useInsights((s) => s.monthOpen);
  const jump = useInsights((s) => s.jump);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [memoOpen, setMemoOpen] = useState<Record<string, boolean>>({});
  const foldUntil = foldBefore(today);
  const searching = query.trim() !== "";

  const isFolded = (month: string) => {
    if (!month) return false;
    if (searching && search.months.has(month)) return false;
    return !(monthOpen[month] ?? month >= foldUntil);
  };

  // 업무·기간이 바뀌면 맨 아래(이번 주)로
  const lastReset = useRef("");
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !rows.length || lastReset.current === resetKey) return;
    lastReset.current = resetKey;
    el.scrollTop = el.scrollHeight;
  });

  // 화면에 보이는 주 → 경과 지도의 파란 테두리
  const measure = () => {
    const el = scrollRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const out: string[] = [];
    for (const row of el.querySelectorAll<HTMLElement>("[data-week]")) {
      const r = row.getBoundingClientRect();
      if (r.bottom > box.top && r.top < box.bottom) out.push(row.dataset.week!);
    }
    setVisibleWeeks(out);
  };
  const frame = useRef(0);
  const onScroll = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(measure);
  };
  useEffect(() => {
    measure();
  });

  // 지도 칸 → 그 주(달)로. 접힌 달이면 먼저 펼친다
  const handledJump = useRef(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !jump || jump.n === handledJump.current) return;
    const { key, unit } = jump;
    const month = unit === "week" ? monthOf(key) : key;
    if (isFolded(month) && rows.some((r) => r.month === month)) {
      toggleMonth(month, true);
      return;
    }
    handledJump.current = jump.n;
    let target: HTMLElement | null;
    if (unit === "week") {
      target =
        el.querySelector<HTMLElement>(`[data-week="${key}"]`) ??
        [...el.querySelectorAll<HTMLElement>("[data-from]")].find(
          (x) => x.dataset.from! <= key && x.dataset.to! >= key,
        ) ??
        null;
    } else {
      target =
        [...el.querySelectorAll<HTMLElement>("[data-start]")].find(
          (x) => x.dataset.start!.slice(0, 7) >= key,
        ) ?? null;
    }
    target?.scrollIntoView({ block: "start" });
    target?.focus({ preventScroll: true });
  });

  // 검색의 지금 일치 항목을 화면 안으로
  useEffect(() => {
    if (!currentMatch) return;
    scrollRef.current
      ?.querySelector<HTMLElement>(`[data-item="${currentMatch}"]`)
      ?.scrollIntoView({ block: "center" });
  }, [currentMatch]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const all = [...el.querySelectorAll<HTMLElement>("[data-tl-nav]")];
      const i = all.indexOf(document.activeElement as HTMLElement);
      const next =
        i < 0 ? (e.key === "ArrowDown" ? all[0] : all.at(-1)) : all[i + (e.key === "ArrowDown" ? 1 : -1)];
      if (next) {
        e.preventDefault();
        next.focus();
        next.scrollIntoView({ block: "nearest" });
      }
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      el.scrollTop = e.key === "Home" ? 0 : el.scrollHeight;
    } else if (e.key === "ArrowLeft" && !(e.target as HTMLElement).closest("input")) {
      const cur = document.querySelector<HTMLElement>("[data-cat-current]");
      if (cur) {
        e.preventDefault();
        cur.focus();
      }
    }
  };

  const reveal = (it: TimelineItem) => void revealOnBoard({ id: it.id, date: it.date, categoryId });
  const onItemMouseDown = (e: MouseEvent<HTMLElement>, it: TimelineItem) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest("[data-memo-chip]")) return;
    const url = t.closest<HTMLElement>("[data-url]")?.dataset.url;
    if (url && (t.closest("[data-open]") || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void openLink(url);
      return;
    }
    e.preventDefault();
    reveal(it);
  };

  const item = (it: TimelineItem, weekId: string) => {
    const open = memoOpen[it.id] ?? false;
    const day = DAY_LABELS[dayIndex(it.date)]!;
    return (
      <div key={it.id}>
        <div
          className={[
            styles.item,
            it.depth === 1 ? styles.itemSub : "",
            it.flagged ? styles.itemFlag : "",
            currentMatch === it.id ? styles.itemCurrent : "",
          ].join(" ")}
          role="button"
          tabIndex={-1}
          aria-label={STR.insights.itemAria(day, it.text)}
          data-tl-nav
          data-item={it.id}
          data-testid="timeline-item"
          onMouseDown={(e) => onItemMouseDown(e, it)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              reveal(it);
            }
          }}
        >
          {it.depth === 0 ? (
            <span className={styles.day}>{dayTag(it.date)}</span>
          ) : (
            <span aria-hidden="true">·</span>
          )}
          {it.flagged && (
            <span className={styles.star} aria-label={STR.insights.flagged}>
              ★
            </span>
          )}
          {it.doneAt && (
            <span
              className={styles.doneMark}
              role="img"
              aria-label={STR.important.doneBadge(doneDate(it.doneAt))}
              title={STR.important.doneBadge(doneDate(it.doneAt))}
              data-testid="timeline-done"
            >
              <IconDone size={14} />
            </span>
          )}
          <ItemText text={it.text} query={query} />
          {it.repeat && (
            <span className={styles.repeatMark} aria-label={STR.insights.repeat} title={STR.insights.repeat}>
              ↻
            </span>
          )}
          {it.memos.length > 0 && (
            <button
              type="button"
              className={styles.memoChip}
              tabIndex={-1}
              aria-expanded={open}
              aria-label={STR.insights.memoAria(it.memos.length, open)}
              data-memo-chip
              data-testid="memo-chip"
              onClick={() => setMemoOpen((m) => ({ ...m, [it.id]: !open }))}
            >
              {STR.insights.memo(it.memos.length)} {open ? "▴" : "▾"}
            </button>
          )}
          <span className={styles.openHint} aria-hidden="true">
            {STR.insights.openOnBoard}
          </span>
        </div>
        {open && (
          <div className={styles.memoBox} data-testid="memo-box">
            <div className={styles.memoHead}>{STR.insights.memoHead(weekId.slice(5))}</div>
            {it.memos.map((m, i) => (
              <pre key={i} className={styles.memoText}>
                {m}
              </pre>
            ))}
          </div>
        )}
      </div>
    );
  };

  const out: React.ReactNode[] = [];
  for (const [i, r] of rows.entries()) {
    if (r.kind === "month") {
      const folded = isFolded(r.month);
      const hits = searching
        ? search.ids.filter((id) =>
            rows.some((x) => x.kind === "week" && x.month === r.month && x.items.some((it) => it.id === id)),
          ).length
        : 0;
      out.push(
        folded ? (
          <button
            key={`m-${r.month}`}
            type="button"
            className={styles.folded}
            aria-expanded={false}
            data-tl-nav
            data-month-head={r.month}
            data-testid="month-folded"
            onClick={() => toggleMonth(r.month, true)}
          >
            <span aria-hidden="true">▸</span>
            <b>{r.label}</b>
            <span className={styles.muted}>{STR.insights.monthFolded(r.weeks, r.items)}</span>
            <span className={styles.grow} />
            <span className={styles.muted}>{STR.insights.unfold}</span>
          </button>
        ) : (
          <div key={`m-${r.month}`} className={styles.monthHead} data-month-head={r.month}>
            <button
              type="button"
              className={styles.foldBtn}
              aria-expanded={true}
              aria-label={`${r.label} ${STR.insights.fold}`}
              title={STR.insights.fold}
              onClick={() => toggleMonth(r.month, false)}
            >
              ▾
            </button>
            {r.label}
            {hits > 0 && <span className={styles.hitChip}>{STR.insights.matchesIn(hits)}</span>}
          </div>
        ),
      );
      continue;
    }
    if (isFolded(r.month)) continue;
    switch (r.kind) {
      case "week":
        out.push(
          <div
            key={r.weekId}
            className={[
              styles.week,
              r.current ? styles.weekNow : "",
              searching && !search.weeks.has(r.weekId) ? styles.dim : "",
            ].join(" ")}
            data-week={r.weekId}
            data-start={r.start}
            data-testid="timeline-week"
            tabIndex={-1}
          >
            <div className={styles.weekHead}>
              <b>{r.weekId.slice(5)}</b>
              <span className={styles.muted}>{mdd(r.start, r.end)}</span>
              {r.current && <span className={styles.nowChip}>{STR.insights.thisWeek}</span>}
            </div>
            <div>
              {r.marks.length > 0 && (
                <div className={styles.marks}>
                  {r.marks.map((m) => (
                    <span key={m.date} className={styles.markChip}>
                      {DAY_MARK_LABEL[m.kind]} {md(m.date)}
                      {dayTag(m.date)}
                    </span>
                  ))}
                </div>
              )}
              {r.items.map((it) => item(it, r.weekId))}
            </div>
          </div>,
        );
        break;
      case "gap":
        out.push(
          <div
            key={`g-${r.fromWeek}`}
            className={styles.gap}
            data-from={r.fromWeek}
            data-to={r.toWeek}
            data-testid="timeline-gap"
            tabIndex={-1}
          >
            · · · {STR.insights.gap(r.count, weekLabel(r.fromWeek, r.toWeek))} · · ·
          </div>,
        );
        break;
      case "rest":
        out.push(
          <div
            key={`r-${r.fromWeek}`}
            className={styles.restRow}
            data-from={r.fromWeek}
            data-to={r.toWeek}
            data-testid="timeline-rest"
            tabIndex={-1}
          >
            {STR.insights.rest(r.count, weekLabel(r.fromWeek, r.toWeek))}
          </div>,
        );
        break;
      case "boundary":
        out.push(
          <div
            key={`b-${i}`}
            className={`${styles.boundary} ${r.type === "end" ? styles.bEnd : styles.bStart}`}
            data-testid="timeline-boundary"
          >
            {STR.insights.boundary[r.type]} {r.date} {dayTag(r.date)}
          </div>,
        );
        break;
    }
  }

  return (
    <div
      ref={scrollRef}
      className={styles.scroll}
      tabIndex={-1}
      data-testid="timeline"
      onScroll={onScroll}
      onKeyDown={onKeyDown}
    >
      {top}
      {out}
    </div>
  );
}
