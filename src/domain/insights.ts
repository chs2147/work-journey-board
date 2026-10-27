// 인사이트(viz-spec 1절, m3-s1-spec): 경과 타임라인·업무 경과 지도의 계산. 순수 함수만 — UI·저장소·플랫폼 import 금지.
// 주차는 week.ts, 활성 구간은 category_period, 항목 표기는 자동 집계(aggregate.ts)와 같은 규칙을 쓴다(CLAUDE.md 4-4).
import { summaryItemLines } from "./aggregate";
import { DAY_MARK_KINDS, type DayMark, type DayMarkKind } from "./dayMark";
import { boxText, isLinkedTo, readingOrder, type NoteBox, type NoteDoc } from "./note";
import type { CategoryPeriod, Depth, EntryItem } from "./types";
import {
  addDays,
  addWeeks,
  compareWeekId,
  formatDate,
  parseDate,
  parseWeekId,
  weekIdOf,
  weekRange,
  weekStart,
  weeksOfIsoYear,
  type DateStr,
  type WeekId,
} from "./week";

// ── 기간 필터(m3-s1-spec 2절) ─────────────────────────
export type PeriodKind = "4w" | "12w" | "year" | "all" | "custom";
export interface PeriodFilter {
  kind: PeriodKind;
  /** 직접 지정일 때만 */
  from?: WeekId;
  to?: WeekId;
}

export interface WeekSpan {
  fromWeek: WeekId;
  toWeek: WeekId;
}

const minWeek = (a: WeekId, b: WeekId) => (compareWeekId(a, b) <= 0 ? a : b);
const maxWeek = (a: WeekId, b: WeekId) => (compareWeekId(a, b) >= 0 ? a : b);

/**
 * 기간 필터 → 주 범위. 끝은 이번 주(직접 지정 제외) — 단 이번 주 뒤의 기록(미리 적은 일정)이 있으면 그 주까지 늘린다.
 * 전체 = 그 업무의 첫 구간 시작·첫 기록 중 이른 주부터
 */
export function periodRange(
  f: PeriodFilter,
  today: DateStr,
  ctx: { firstRecord?: DateStr | null; lastRecord?: DateStr | null; categoryStart?: DateStr | null } = {},
): WeekSpan {
  const thisWeek = weekIdOf(today);
  if (f.kind === "custom" && f.from && f.to) {
    return { fromWeek: minWeek(f.from, f.to), toWeek: maxWeek(f.from, f.to) };
  }
  const toWeek =
    ctx.lastRecord && ctx.lastRecord > today ? maxWeek(thisWeek, weekIdOf(ctx.lastRecord)) : thisWeek;
  let fromWeek: WeekId;
  switch (f.kind) {
    case "4w":
      fromWeek = addWeeks(thisWeek, -3);
      break;
    case "year":
      fromWeek = `${parseWeekId(thisWeek).year}-W01`;
      break;
    case "all": {
      const starts = [ctx.firstRecord, ctx.categoryStart].filter((d): d is DateStr => !!d).sort();
      fromWeek = starts.length ? minWeek(weekIdOf(starts[0]!), thisWeek) : thisWeek;
      break;
    }
    default:
      fromWeek = addWeeks(thisWeek, -11);
  }
  return { fromWeek, toWeek };
}

export const spanDates = (s: WeekSpan) => ({ from: weekStart(s.fromWeek), to: weekRange(s.toWeek).end });

export function weeksBetween(s: WeekSpan): WeekId[] {
  const out: WeekId[] = [];
  for (let w = s.fromWeek; compareWeekId(w, s.toWeek) <= 0; w = addWeeks(w, 1)) out.push(w);
  return out;
}

// ── 달(목요일 기준 — 연간 보기와 같은 규칙) ───────────
/** `2026-10` — 주는 그 주 목요일이 속한 달 */
export function monthOf(weekId: WeekId): string {
  return addDays(weekStart(weekId), 3).slice(0, 7);
}

export const monthLabel = (key: string) => `${Number(key.slice(0, 4))}년 ${Number(key.slice(5, 7))}월`;

/** 접기 기본값(4-6): 오늘이 든 달 포함 최근 3개 달은 펼치고 그 이전 달은 접는다 */
export function foldBefore(today: DateStr): string {
  const d = parseDate(today);
  const m = new Date(d.getFullYear(), d.getMonth() - 2, 1);
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`;
}

// ── 활성 구간 ─────────────────────────────────────────
const overlaps = (p: CategoryPeriod, from: DateStr, to: DateStr) =>
  p.startDate <= to && (p.endDate === null || p.endDate >= from);

export function isActiveWeek(periods: CategoryPeriod[], weekId: WeekId): boolean {
  const { start, end } = weekRange(weekId);
  return periods.some((p) => overlaps(p, start, end));
}

// ── 경과 타임라인(4절) ────────────────────────────────
export interface TimelineItem {
  id: string;
  date: DateStr;
  depth: Depth;
  text: string;
  /** 중요(처리 전) */
  flagged: boolean;
  /** 매주 반복으로 들어온 항목 */
  repeat: boolean;
  /** 이 항목에 연결된 메모 글(읽는 순서) */
  memos: string[];
}

export type TimelineRow =
  | { kind: "month"; month: string; label: string; weeks: number; items: number }
  | {
      kind: "week";
      month: string;
      weekId: WeekId;
      start: DateStr;
      end: DateStr;
      current: boolean;
      items: TimelineItem[];
      marks: DayMark[];
    }
  | { kind: "gap"; month: string; fromWeek: WeekId; toWeek: WeekId; count: number }
  | { kind: "rest"; month: string; fromWeek: WeekId; toWeek: WeekId; count: number }
  | { kind: "boundary"; month: string; type: "start" | "end" | "resume"; date: DateStr };

export interface TimelineInput {
  items: EntryItem[];
  /** 이 업무의 구간 */
  periods: CategoryPeriod[];
  span: WeekSpan;
  today: DateStr;
  dayMarks?: Record<DateStr, DayMarkKind>;
  /** 주별 메모 문서 — 상자의 ref.item으로 항목에 붙인다 */
  notes?: Record<WeekId, NoteDoc>;
}

/** 연결된 메모 상자 하나의 글(4-4): 글 상자는 글, 이미지는 `(이미지) 설명`, 링크 카드는 `(링크) 제목` */
export function linkedMemoText(b: NoteBox): string {
  if (b.kind === "image") return b.caption.trim() ? `(이미지) ${b.caption.trim()}` : "(이미지)";
  if (b.kind === "link") return `(링크) ${b.title}`;
  return boxText(b);
}

/**
 * 줄 목록: 달 머리 → (시작/재개 구분선) → 주 행·무기록 접힘·쉬는 구간 → (종료 구분선). 주는 그 업무가 보이는 주만 —
 * 첫 구간 시작 전·마지막 종료 뒤의 빈 주는 그리지 않는다(기록이 있으면 그린다). 무기록·쉬는 구간은 달을 넘지 않게 끊는다.
 */
export function buildTimeline(input: TimelineInput): TimelineRow[] {
  const { span, today } = input;
  const periods = [...input.periods].sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  const thisWeek = weekIdOf(today);
  const byWeek = new Map<WeekId, EntryItem[]>();
  for (const it of input.items) {
    if (!it.text.trim()) continue;
    const w = weekIdOf(it.date);
    byWeek.set(w, [...(byWeek.get(w) ?? []), it]);
  }
  const memoFor = (weekId: WeekId, itemId: string) =>
    readingOrder((input.notes?.[weekId]?.boxes ?? []).filter((b) => isLinkedTo(b, itemId)))
      .map(linkedMemoText)
      .filter((t) => t.trim() !== "");

  const firstStart = periods[0]?.startDate ?? null;
  const lastEnd = periods.length && periods.every((p) => p.endDate !== null) ? periods.at(-1)!.endDate : null;

  const rows: TimelineRow[] = [];
  let month = "";
  type Run = { kind: "gap" | "rest"; month: string; fromWeek: WeekId; toWeek: WeekId; count: number };
  let run: Run | null = null;
  const flush = () => {
    if (run) rows.push(run);
    run = null;
  };

  for (const w of weeksBetween(span)) {
    const { start, end } = weekRange(w);
    const items = byWeek.get(w) ?? [];
    const active = isActiveWeek(periods, w);
    const beforeAll = firstStart === null || end < firstStart;
    const afterAll = lastEnd !== null && start > lastEnd;
    if (!items.length && (beforeAll || afterAll)) continue;

    // 쉬는 구간(종료 ~ 재개 사이 빈 주): 달을 넘어 한 줄로 잇고, 달 접기와 무관하게 늘 보인다(month = "")
    if (!items.length && !active) {
      const cur = run as Run | null;
      if (cur && cur.kind === "rest") {
        cur.toWeek = w;
        cur.count++;
      } else {
        flush();
        run = { kind: "rest", month: "", fromWeek: w, toWeek: w, count: 1 };
      }
      continue;
    }

    const m = monthOf(w);
    if (m !== month) {
      flush();
      month = m;
      rows.push({ kind: "month", month: m, label: monthLabel(m), weeks: 0, items: 0 });
    }
    // 이 주에 시작하는 구간 → 구분선(첫 구간 = 시작, 그 뒤 = 재개)
    for (const [i, p] of periods.entries()) {
      if (p.startDate >= start && p.startDate <= end) {
        flush();
        rows.push({ kind: "boundary", month: m, type: i === 0 ? "start" : "resume", date: p.startDate });
      }
    }
    if (items.length) {
      flush();
      const marks: DayMark[] = [];
      for (const [date, kind] of Object.entries(input.dayMarks ?? {})) {
        if (date >= start && date <= end && DAY_MARK_KINDS.includes(kind)) marks.push({ date, kind });
      }
      marks.sort((a, b) => (a.date < b.date ? -1 : 1));
      rows.push({
        kind: "week",
        month: m,
        weekId: w,
        start,
        end,
        current: w === thisWeek,
        marks,
        items: items.map((it) => ({
          id: it.id,
          date: it.date,
          depth: it.depth,
          text: it.text,
          flagged: it.flagged === true,
          repeat: !!it.recurrenceId,
          memos: memoFor(w, it.id),
        })),
      });
    } else {
      // 무기록 주(활성 구간 안): 이어지면 한 줄로, 달은 넘지 않게(달 접기와 맞게)
      const cur = run as Run | null;
      if (cur && cur.kind === "gap" && cur.month === m) {
        cur.toWeek = w;
        cur.count++;
      } else {
        flush();
        run = { kind: "gap", month: m, fromWeek: w, toWeek: w, count: 1 };
      }
    }
    // 이 주에 끝나는 구간 → 종료 구분선(진행 중 구간은 없음)
    for (const p of periods) {
      if (p.endDate !== null && p.endDate >= start && p.endDate <= end) {
        flush();
        rows.push({ kind: "boundary", month: m, type: "end", date: p.endDate });
      }
    }
  }
  flush();

  // 달 머리의 주 수(보이는 주)·항목 수, 줄이 하나도 없는 달 머리는 뺀다
  const out: TimelineRow[] = [];
  let head: Extract<TimelineRow, { kind: "month" }> | null = null;
  for (const r of rows) {
    if (r.kind === "month") head = r;
    else {
      if (head) {
        if (r.kind === "week") {
          head.weeks++;
          head.items += r.items.length;
        } else if (r.kind === "gap") head.weeks += r.count;
      }
    }
    out.push(r);
  }
  return out.filter((r, i) => r.kind !== "month" || (out[i + 1] && out[i + 1]!.kind !== "month"));
}

/** 기간 안 요약(머리 숫자): 활성 주 수·기록한 주 수·항목 수 */
export function timelineCounts(rows: TimelineRow[]) {
  let recorded = 0;
  let empty = 0;
  let items = 0;
  for (const r of rows) {
    if (r.kind === "week") {
      recorded++;
      items += r.items.length;
    } else if (r.kind === "gap") empty += r.count;
  }
  return { recordedWeeks: recorded, activeWeeks: recorded + empty, items };
}

// ── 검색(5절) ─────────────────────────────────────────
const norm = (s: string) => s.normalize("NFKC").toLowerCase();

export interface SearchResult {
  /** 일치 항목 id(보이는 순서) */
  ids: string[];
  weeks: Set<WeekId>;
  months: Set<string>;
}

export function searchTimeline(rows: TimelineRow[], query: string): SearchResult {
  const q = norm(query.trim());
  const res: SearchResult = { ids: [], weeks: new Set(), months: new Set() };
  if (!q) return res;
  for (const r of rows) {
    if (r.kind !== "week") continue;
    for (const it of r.items) {
      if (norm(it.text).includes(q)) {
        res.ids.push(it.id);
        res.weeks.add(r.weekId);
        res.months.add(r.month);
      }
    }
  }
  return res;
}

/** 글을 일치 부분과 나머지로 나눈다(강조 표시용, 대소문자·전각 무시) */
export function splitMatches(text: string, query: string): { text: string; hit: boolean }[] {
  const q = norm(query.trim());
  if (!q) return [{ text, hit: false }];
  const n = norm(text);
  // NFKC로 길이가 바뀌는 글자가 있으면 위치가 어긋나므로 강조하지 않는다(일치 판정은 그대로)
  if (n.length !== text.length) return [{ text, hit: false }];
  const out: { text: string; hit: boolean }[] = [];
  let i = 0;
  for (let at = n.indexOf(q); at >= 0; at = n.indexOf(q, at + q.length)) {
    if (at > i) out.push({ text: text.slice(i, at), hit: false });
    out.push({ text: text.slice(at, at + q.length), hit: true });
    i = at + q.length;
  }
  if (i < text.length) out.push({ text: text.slice(i), hit: false });
  return out;
}

// ── 경과 복사(7절) ────────────────────────────────────
const md = (d: DateStr) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const weekSpanLabel = (a: WeekId, b: WeekId) =>
  a === b ? a : a.slice(0, 4) === b.slice(0, 4) ? `${a}~W${b.slice(-2)}` : `${a}~${b}`;

export interface TimelineMeta {
  name: string;
  span: WeekSpan;
  /** 첫 구간 시작일 */
  startDate: DateStr | null;
  /** 진행 중이면 null */
  endDate: DateStr | null;
}

/** 지금 기간 전체를 평문으로(접힌 달도 펼친 것처럼). ★·↻·연차는 넣지 않고 연결 메모는 `[메모]` 줄 */
export function timelineText(rows: TimelineRow[], meta: TimelineMeta): string {
  const c = timelineCounts(rows);
  const head = [
    `[업무 경과] ${meta.name}`,
    [
      `기간 ${meta.span.fromWeek} ~ ${meta.span.toWeek} (기록한 주 ${c.recordedWeeks} · 항목 ${c.items})`,
      meta.startDate ? `${meta.startDate} 시작` : null,
      meta.endDate ? `${meta.endDate} 종료` : "진행 중",
    ]
      .filter(Boolean)
      .join(" · "),
  ].join("\n");
  const blocks: string[] = [head];
  for (const r of rows) {
    switch (r.kind) {
      case "week": {
        const lines = [`■ ${r.weekId} (${md(r.start)}~${md(r.end)})`];
        for (const it of r.items) {
          lines.push(...summaryItemLines(it));
          for (const memo of it.memos) {
            memo.split("\n").forEach((l, i) => lines.push((i === 0 ? "  [메모] " : "         ") + l));
          }
        }
        blocks.push(lines.join("\n"));
        break;
      }
      case "gap":
        blocks.push(`(${weekSpanLabel(r.fromWeek, r.toWeek)} 기록 없음)`);
        break;
      case "rest":
        blocks.push(`(쉬는 구간 ${r.count}주: ${weekSpanLabel(r.fromWeek, r.toWeek)})`);
        break;
      case "boundary":
        blocks.push(`── ${{ start: "시작", end: "종료", resume: "재개" }[r.type]} ${r.date} ──`);
        break;
      default:
        break;
    }
  }
  return blocks.join("\n\n");
}

// ── 업무 경과 지도(4-0) ───────────────────────────────
export type MapUnit = "week" | "month";

/** 주 칸: 그 주에 기록한 날 수 → 0 · 1 · 2 · 3~4 · 5+ (viz-spec 2-3 연간 모드와 같은 단계) */
export function dayLevel(days: number): 0 | 1 | 2 | 3 | 4 {
  return days <= 0 ? 0 : days === 1 ? 1 : days === 2 ? 2 : days <= 4 ? 3 : 4;
}

/** 달 칸: 그 달에 기록한 날 수 → 0 · 1~3 · 4~7 · 8~12 · 13+ */
export function monthLevel(days: number): 0 | 1 | 2 | 3 | 4 {
  return days <= 0 ? 0 : days <= 3 ? 1 : days <= 7 ? 2 : days <= 12 ? 3 : 4;
}

export interface MapCell {
  /** 주: WeekId, 달: `YYYY-MM` */
  key: string;
  from: DateStr;
  to: DateStr;
  /** 기록한 날 수 */
  days: number;
  items: number;
  level: 0 | 1 | 2 | 3 | 4;
  /** 업무가 종료돼 쉬던 칸(기록 없음) */
  rest: boolean;
  current: boolean;
  /** 달 머리 묶음용(주 칸 = 목요일 기준 달, 달 칸 = 그 달) */
  month: string;
  /** ISO 연도·주 번호(주 칸) — 1년이 넘으면 연도 줄에 주 번호 자리로 놓는다 */
  year: number;
  index: number;
}

/**
 * 지도의 범위(4-0): 첫 구간 시작·첫 기록 중 이른 주 → 진행 중이면 이번 주(뒤에 미리 적은 기록이 있으면 그 주),
 * 종료면 마지막 종료·마지막 기록 중 늦은 주. 구간도 기록도 없으면 null
 */
export function journeySpan(
  periods: CategoryPeriod[],
  days: { date: DateStr }[],
  today: DateStr,
): WeekSpan | null {
  const starts = [...periods.map((p) => p.startDate), ...days.map((d) => d.date)].sort();
  if (!starts.length) return null;
  const lastRecord =
    days
      .map((d) => d.date)
      .sort()
      .at(-1) ?? null;
  const open = periods.some((p) => p.endDate === null);
  const ends = open
    ? [today, lastRecord ?? today]
    : [...periods.map((p) => p.endDate!), ...(lastRecord ? [lastRecord] : [])];
  const end = ends.sort().at(-1)!;
  const fromWeek = weekIdOf(starts[0]!);
  const toWeek = weekIdOf(end < starts[0]! ? starts[0]! : end);
  return { fromWeek, toWeek };
}

/** 기본 단위: 업무 기간 26주 이하 = 주차, 더 길면 = 월 */
export function defaultMapUnit(span: WeekSpan): MapUnit {
  return weeksBetween(span).length <= 26 ? "week" : "month";
}

export function journeyMap(
  days: { date: DateStr; items: number }[],
  periods: CategoryPeriod[],
  span: WeekSpan,
  today: DateStr,
  unit: MapUnit,
): MapCell[] {
  const thisWeek = weekIdOf(today);
  if (unit === "week") {
    return weeksBetween(span).map((w) => {
      const { start, end } = weekRange(w);
      const inWeek = days.filter((d) => d.date >= start && d.date <= end && d.items > 0);
      const n = inWeek.length;
      const { year, week } = parseWeekId(w);
      return {
        key: w,
        from: start,
        to: end,
        days: n,
        items: inWeek.reduce((s, d) => s + d.items, 0),
        level: dayLevel(n),
        rest: n === 0 && !isActiveWeek(periods, w),
        current: w === thisWeek,
        month: monthOf(w),
        year,
        index: week,
      };
    });
  }
  const { from, to } = spanDates(span);
  const cells: MapCell[] = [];
  const first = parseDate(from);
  const last = parseDate(to);
  for (let d = new Date(first.getFullYear(), first.getMonth(), 1); d <= last; d.setMonth(d.getMonth() + 1)) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const mStart = `${key}-01`;
    const mEnd = formatDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    const inMonth = days.filter((x) => x.date.startsWith(key) && x.items > 0);
    const n = inMonth.length;
    cells.push({
      key,
      from: mStart,
      to: mEnd,
      days: n,
      items: inMonth.reduce((s, x) => s + x.items, 0),
      level: monthLevel(n),
      rest: n === 0 && !periods.some((p) => overlaps(p, mStart, mEnd)),
      current: today.startsWith(key),
      month: key,
      year: d.getFullYear(),
      index: d.getMonth() + 1,
    });
  }
  return cells;
}

/** 주 칸을 1년 넘게 그리면 ISO 연도마다 줄을 바꾼다(4-0 배치) */
export const mapNeedsYearRows = (cells: MapCell[]) => cells.length > 53;

/** 이어 놓은 칸 위의 달 머리: 연속한 같은 달 칸 묶음 */
export function monthSpans(cells: MapCell[]): { month: string; count: number }[] {
  const out: { month: string; count: number }[] = [];
  for (const c of cells) {
    const last = out.at(-1);
    if (last && last.month === c.month) last.count++;
    else out.push({ month: c.month, count: 1 });
  }
  return out;
}

// ── 활동 히트맵(m3-s2-spec 3~5절) ─────────────────────
export type HeatUnit = "day" | "week";

/** 그날 그 업무의 기록(저장소 getActivity) */
export interface ActivityRow {
  categoryId: string;
  date: DateStr;
  /** 본 항목(depth 0) 수 */
  mains: number;
  /** 세부 항목(depth 1) 수 */
  subs: number;
  /** 첫 본 항목 글 */
  firstText: string | null;
}

/** 일 칸: 그날 본 항목 수 → 0 · 1 · 2~3 · 4~5 · 6+ (viz-spec 2-2) */
export function itemLevel(n: number): 0 | 1 | 2 | 3 | 4 {
  return n <= 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 5 ? 3 : 4;
}

export interface HeatRange {
  unit: HeatUnit;
  /** 일: 끝 주(WeekId), 주: ISO 연도(`2026`) */
  anchor: string;
  from: DateStr;
  to: DateStr;
  /** 머리 글: `2026-W32 ~ W43` / `2026년 (53주)` */
  label: string;
  /** ◀ ▶ 다음 기준(갈 수 없으면 null) */
  prev: string | null;
  next: string | null;
}

/** 기본 기준: 일 = 이번 주, 주 = 올해(ISO 연도) */
export const defaultHeatAnchor = (unit: HeatUnit, today: DateStr) =>
  unit === "day" ? weekIdOf(today) : String(parseWeekId(weekIdOf(today)).year);

/**
 * 범위(3절): 일 = 끝 주부터 11주 전 월요일까지 84일(◀ ▶ 12주씩, ▶는 이번 주에서 멈춤),
 * 주 = ISO 연도 W01~W52/53(◀ ▶ 한 해씩, ▶는 올해에서 멈춤). ◀는 첫 기록 주보다 1년 넘게 앞으로 가지 않는다
 */
export function heatRange(
  unit: HeatUnit,
  anchor: string | null,
  today: DateStr,
  firstRecord: DateStr | null = null,
): HeatRange {
  const thisWeek = weekIdOf(today);
  const limit = addWeeks(weekIdOf(firstRecord && firstRecord < today ? firstRecord : today), -52);
  if (unit === "day") {
    const end = minWeek(anchor ?? thisWeek, thisWeek);
    const start = addWeeks(end, -11);
    const prevEnd = addWeeks(end, -12);
    return {
      unit,
      anchor: end,
      from: weekStart(start),
      to: weekRange(end).end,
      label: `${start} ~ ${start.slice(0, 4) === end.slice(0, 4) ? end.slice(5) : end}`,
      prev: compareWeekId(prevEnd, limit) >= 0 ? prevEnd : null,
      next: compareWeekId(end, thisWeek) < 0 ? minWeek(addWeeks(end, 12), thisWeek) : null,
    };
  }
  const thisYear = parseWeekId(thisWeek).year;
  const year = Math.min(Number(anchor ?? thisYear) || thisYear, thisYear);
  const n = weeksOfIsoYear(year).length;
  return {
    unit,
    anchor: String(year),
    from: weekStart(`${year}-W01`),
    to: weekRange(`${year}-W${String(n).padStart(2, "0")}`).end,
    label: `${year}년 (${n}주)`,
    prev: year - 1 >= parseWeekId(limit).year ? String(year - 1) : null,
    next: year < thisYear ? String(year + 1) : null,
  };
}

export interface HeatColumn {
  /** 일: 날짜, 주: WeekId */
  key: string;
  from: DateStr;
  to: DateStr;
  /** 토·일(일 단위, 폭 절반) */
  weekend: boolean;
  /** 오늘 / 이번 주 */
  current: boolean;
  /** 오늘 뒤 */
  future: boolean;
  /** 연차·반차(일 단위 열 머리) */
  mark: DayMarkKind | null;
  /** 달 머리 묶음: 일 = 그 날의 달, 주 = 목요일의 달 */
  month: string;
  week: WeekId;
}

export function heatColumns(
  range: HeatRange,
  today: DateStr,
  dayMarks: Record<DateStr, DayMarkKind> = {},
): HeatColumn[] {
  const out: HeatColumn[] = [];
  if (range.unit === "day") {
    for (let d = range.from; d <= range.to; d = addDays(d, 1)) {
      const wd = parseDate(d).getDay();
      out.push({
        key: d,
        from: d,
        to: d,
        weekend: wd === 0 || wd === 6,
        current: d === today,
        future: d > today,
        mark: dayMarks[d] ?? null,
        month: d.slice(0, 7),
        week: weekIdOf(d),
      });
    }
    return out;
  }
  const thisWeek = weekIdOf(today);
  for (const { weekId } of weeksOfIsoYear(Number(range.anchor))) {
    const { start, end } = weekRange(weekId);
    out.push({
      key: weekId,
      from: start,
      to: end,
      weekend: false,
      current: weekId === thisWeek,
      future: start > today,
      mark: null,
      month: monthOf(weekId),
      week: weekId,
    });
  }
  return out;
}

/** 열 머리 묶음(달·주): 이어진 같은 값의 열 수 */
export function columnSpans(cols: HeatColumn[], by: (c: HeatColumn) => string) {
  const out: { key: string; count: number }[] = [];
  for (const c of cols) {
    const k = by(c);
    const last = out.at(-1);
    if (last && last.key === k) last.count++;
    else out.push({ key: k, count: 1 });
  }
  return out;
}

export interface HeatCell {
  key: string;
  /** 칸 값: 일 = 본 항목 수, 주 = 기록한 날 수 */
  value: number;
  level: 0 | 1 | 2 | 3 | 4;
  mains: number;
  subs: number;
  /** 기록한 날 수(일 칸은 0/1) */
  days: number;
  firstText: string | null;
  /** 업무 기간 밖(기록 없음) */
  outside: boolean;
  /** 오지 않은 날·주(기록 없음 — 미리 적은 기록이 있으면 false로 값대로 칠함) */
  future: boolean;
  /** 모든 업무 행: 업무별 값(값 > 0만, 보드 순서) */
  parts?: { categoryId: string; value: number }[];
}

export interface HeatRow {
  /** 업무 id, 모든 업무 = null */
  categoryId: string | null;
  cells: HeatCell[];
  /** 그 범위에서 기록한 날 수 */
  recordedDays: number;
}

/**
 * 격자(4·5절): 맨 위 모든 업무(보이는 업무의 합) + 업무 행(받은 순서). 기록이 없는 업무도 행은 남긴다.
 * 일 칸 = 본 항목 수(itemLevel), 주 칸 = 기록한 날 수(dayLevel — 경과 지도와 같은 함수)
 */
export function heatGrid(
  activity: ActivityRow[],
  categoryIds: string[],
  periods: CategoryPeriod[],
  columns: HeatColumn[],
  unit: HeatUnit,
): HeatRow[] {
  const shown = new Set(categoryIds);
  const byKey = new Map<string, ActivityRow>();
  for (const a of activity) if (shown.has(a.categoryId)) byKey.set(`${a.categoryId}|${a.date}`, a);
  const has = (a: ActivityRow | undefined): a is ActivityRow => !!a && a.mains + a.subs > 0;
  const own = new Map(categoryIds.map((id) => [id, periods.filter((p) => p.categoryId === id)]));

  const cellOf = (id: string, col: HeatColumn): HeatCell => {
    const ps = own.get(id) ?? [];
    if (unit === "day") {
      const a = byKey.get(`${id}|${col.key}`);
      const rec = has(a);
      const mains = a?.mains ?? 0;
      return {
        key: col.key,
        value: mains,
        level: itemLevel(mains),
        mains,
        subs: a?.subs ?? 0,
        days: rec ? 1 : 0,
        firstText: a?.firstText ?? null,
        outside: !rec && !ps.some((p) => overlaps(p, col.from, col.to)),
        future: !rec && col.future,
      };
    }
    let mains = 0;
    let subs = 0;
    let days = 0;
    for (let d = col.from; d <= col.to; d = addDays(d, 1)) {
      const a = byKey.get(`${id}|${d}`);
      if (!has(a)) continue;
      days++;
      mains += a.mains;
      subs += a.subs;
    }
    return {
      key: col.key,
      value: days,
      level: dayLevel(days),
      mains,
      subs,
      days,
      firstText: null,
      outside: days === 0 && !isActiveWeek(ps, col.key),
      future: days === 0 && col.future,
    };
  };

  const rows: HeatRow[] = categoryIds.map((id) => {
    const cells = columns.map((c) => cellOf(id, c));
    return { categoryId: id, cells, recordedDays: cells.reduce((s, c) => s + c.days, 0) };
  });

  // 모든 업무: 일 = 본 항목 합, 주 = 무엇이든 기록한 날 수
  const anyDates = new Set(activity.filter((a) => shown.has(a.categoryId) && has(a)).map((a) => a.date));
  const total: HeatCell[] = columns.map((col, i) => {
    const parts = rows
      .map((r) => ({ categoryId: r.categoryId!, value: r.cells[i]!.value }))
      .filter((p) => p.value > 0);
    const mains = rows.reduce((s, r) => s + r.cells[i]!.mains, 0);
    const subs = rows.reduce((s, r) => s + r.cells[i]!.subs, 0);
    let days = 0;
    for (let d = col.from; d <= col.to; d = addDays(d, 1)) if (anyDates.has(d)) days++;
    const value = unit === "day" ? mains : days;
    return {
      key: col.key,
      value,
      level: unit === "day" ? itemLevel(mains) : dayLevel(days),
      mains,
      subs,
      days,
      firstText: null,
      outside: false,
      future: days === 0 && col.future,
      parts,
    };
  });
  const recordedDays = [...anyDates].filter(
    (d) => columns.length > 0 && d >= columns[0]!.from && d <= columns.at(-1)!.to,
  ).length;
  return [{ categoryId: null, cells: total, recordedDays }, ...rows];
}

export interface HeatTableCell {
  mains: number;
  days: number;
  /** 묶음 전체가 업무 기간 밖 */
  outside: boolean;
}

/** [표로 보기](8절): 일 = 업무 × 주(본 항목 수 · 기록한 날 수), 주 = 업무 × 달(기록한 날 수). 끝 열 = 합계 */
export function heatTable(rows: HeatRow[], columns: HeatColumn[], unit: HeatUnit) {
  const groups = columnSpans(columns, (c) => (unit === "day" ? c.week : c.month));
  const head = groups.map((g) => g.key);
  const body = rows.map((r) => {
    let i = 0;
    const cells: HeatTableCell[] = groups.map((g) => {
      const part = r.cells.slice(i, i + g.count);
      i += g.count;
      return {
        mains: part.reduce((s, c) => s + c.mains, 0),
        days: part.reduce((s, c) => s + c.days, 0),
        outside: part.every((c) => c.outside),
      };
    });
    return {
      categoryId: r.categoryId,
      cells,
      total: { mains: cells.reduce((s, c) => s + c.mains, 0), days: r.recordedDays, outside: false },
    };
  });
  return { head, body };
}
