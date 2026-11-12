// 칸반 보드 규칙(docs/improve-v21-spec.md 2·3·6절) — 순수 함수만. UI·저장소·플랫폼과 무관.
import { localDate, utcTimestamp } from "./localTime";
import { addDays, addWeeks, parseDate, weekIdOf, weekRange, type DateStr } from "./week";

/** 기본 섹션 키 — 사용자 섹션은 그 섹션 id */
export const TODO = "todo";
export const DONE = "done";
export type SectionKey = string;

export const SECTION_MAX = 8;
export const SECTION_NAME_MAX = 20;
/** 사용자 섹션 색(시안 ⑤ 5색) */
export const SECTION_COLORS = ["violet", "amber", "teal", "rose", "gray"] as const;
export type SectionColor = (typeof SECTION_COLORS)[number];

export interface KanbanSection {
  id: string;
  name: string;
  color: SectionColor;
  sortOrder: number;
}

/** 기간 필터(2026-11-12 사용자 확정) */
export const KANBAN_PERIODS = ["today", "week", "2w", "4w", "12w", "all", "custom"] as const;
export type KanbanPeriod = (typeof KANBAN_PERIODS)[number];
export const DEFAULT_KANBAN_PERIOD: KanbanPeriod = "week";

export type KanbanSort = "new" | "old" | "due";

export interface KanbanFilter {
  /** 빈 배열 = 전체 업무 */
  categories: string[];
  includeEnded: boolean;
  period: KanbanPeriod;
  from: DateStr | null;
  to: DateStr | null;
  sort: KanbanSort;
}

export const DEFAULT_KANBAN_FILTER: KanbanFilter = {
  categories: [],
  includeEnded: false,
  period: DEFAULT_KANBAN_PERIOD,
  from: null,
  to: null,
  sort: "new",
};

/** 기간 → 날짜 범위(양끝 포함). null = 끝없음. 이번 주 = 월~일, 최근 N주 = (N-1)주 전 월요일 ~ 이번 주 일요일 */
export function periodRange(
  f: Pick<KanbanFilter, "period" | "from" | "to">,
  today: DateStr,
): { from: DateStr | null; to: DateStr | null } {
  const wk = weekIdOf(today);
  const weeks = (n: number) => ({ from: weekRange(addWeeks(wk, -(n - 1))).start, to: weekRange(wk).end });
  switch (f.period) {
    case "today":
      return { from: today, to: today };
    case "week":
      return weeks(1);
    case "2w":
      return weeks(2);
    case "4w":
      return weeks(4);
    case "12w":
      return weeks(12);
    case "all":
      return { from: null, to: null };
    case "custom": {
      const from = f.from ?? null,
        to = f.to ?? null;
      return from && to && from > to ? { from: to, to: from } : { from, to };
    }
  }
}

/** 날짜 범위(내 PC 날짜) → 완료 시각(UTC ISO) 비교용 [시작, 끝) */
export function utcRange(r: { from: DateStr | null; to: DateStr | null }): {
  from: string | null;
  to: string | null;
} {
  const start = (d: DateStr) => utcTimestamp(parseDate(d));
  return { from: r.from ? start(r.from) : null, to: r.to ? start(addDays(r.to, 1)) : null };
}

/** 항목의 섹션 — 완료(★ 아님 + 완료 시각) > 사용자 섹션 > TODO */
export function sectionKeyOf(it: {
  flagged?: boolean;
  flagDoneAt?: string | null;
  sectionId?: string | null;
}): SectionKey {
  if (!it.flagged && it.flagDoneAt) return DONE;
  return it.sectionId ?? TODO;
}

export type MoveKind = "complete" | "reopen" | "section" | "none";

/** 옮기기 종류: DONE으로 = 완료, DONE에서 = 되살림(+섹션), 그 밖 = 섹션만 */
export function moveKind(from: SectionKey, to: SectionKey): MoveKind {
  if (from === to) return "none";
  if (to === DONE) return "complete";
  if (from === DONE) return "reopen";
  return "section";
}

/** 섹션 이름 검사 — 1~20자, 기본 이름·기존 이름(대소문자 무시)과 겹치지 않게 */
export function sectionNameProblem(
  raw: string,
  existing: { id: string; name: string }[],
  exceptId: string | null = null,
): "empty" | "long" | "reserved" | "duplicate" | null {
  const name = raw.trim();
  if (!name) return "empty";
  if (name.length > SECTION_NAME_MAX) return "long";
  const key = name.toLowerCase();
  if (key === "todo" || key === "done") return "reserved";
  if (existing.some((s) => s.id !== exceptId && s.name.trim().toLowerCase() === key)) return "duplicate";
  return null;
}

export interface SortableCard {
  date: DateStr;
  seq: number;
  categoryOrder: number;
  dueDate?: string | null;
}

/** 열 안 정렬(D8): 최신(기록일 늦은 순) · 오래된 순 · 마감 임박(마감 없는 카드는 뒤) */
export function sortCards<T extends SortableCard>(cards: T[], sort: KanbanSort): T[] {
  const base = (a: T, b: T) =>
    a.date === b.date ? a.categoryOrder - b.categoryOrder || a.seq - b.seq : a.date < b.date ? -1 : 1;
  const out = [...cards];
  if (sort === "old") return out.sort(base);
  if (sort === "due")
    return out.sort((a, b) => {
      const da = a.dueDate ?? "9999-99-99",
        db = b.dueDate ?? "9999-99-99";
      return da === db ? -base(a, b) : da < db ? -1 : 1;
    });
  return out.sort((a, b) => -base(a, b));
}

/** DONE 구분 머리(시안 ①): 오늘 · 이번 주 · 지난주 · 그 전은 달별 */
export type DoneGroup = { key: string; label: string };
export function doneGroupOf(doneAt: string, today: DateStr): DoneGroup {
  const d = localDate(new Date(doneAt));
  if (d === today) return { key: "today", label: "today" };
  const wk = weekIdOf(today);
  const w = weekIdOf(d);
  if (w === wk) return { key: "week", label: "week" };
  if (w === addWeeks(wk, -1)) return { key: "last", label: "last" };
  return { key: `m${d.slice(0, 7)}`, label: d.slice(0, 7) };
}

/** 완료가 기록일과 다른 날이면 그 날(내 PC 날짜), 같으면 null — 타임라인 T2 */
export function laterDoneDate(recordDate: DateStr, doneAt: string | null | undefined): DateStr | null {
  if (!doneAt) return null;
  const d = localDate(new Date(doneAt));
  return d === recordDate ? null : d;
}

/** 일괄 완료를 "기록일에 끝낸 것으로" 처리할 때의 완료 시각 — 그 날 정오(내 PC) */
export function recordDayDoneAt(date: DateStr): string {
  const d = parseDate(date);
  d.setHours(12, 0, 0, 0);
  return utcTimestamp(d);
}

export interface BulkOptions {
  /** 이 날짜 이전(그날 포함)에 기록한 본 항목 */
  before: DateStr;
  categories: string[];
  skipFlagged: boolean;
  skipFutureDue: boolean;
  skipSections: boolean;
  today: DateStr;
}

export interface BulkCandidate {
  id: string;
  date: DateStr;
  categoryId: string;
  flagged?: boolean;
  dueDate?: string | null;
  sectionId?: string | null;
}

/** 일괄 완료 대상(6절) — 미완료 본 항목만 넘겨받아 조건으로 거른다 */
export function bulkTargets<T extends BulkCandidate>(open: T[], o: BulkOptions): T[] {
  return open.filter(
    (c) =>
      c.date <= o.before &&
      (!o.categories.length || o.categories.includes(c.categoryId)) &&
      !(o.skipFlagged && c.flagged) &&
      !(o.skipFutureDue && c.dueDate && c.dueDate >= o.today) &&
      !(o.skipSections && c.sectionId),
  );
}

/**
 * 칸 안 항목 목록에서 본 항목마다 딸린 세부 항목을 묶는다(칸 순서 기준).
 * 맨 앞이 세부 항목이면(드묾) 그 세부 항목을 본 항목처럼 카드로 본다.
 */
export function groupCell<T extends { id: string; seq: number; depth: number }>(
  items: T[],
): { head: T; children: T[] }[] {
  const out: { head: T; children: T[] }[] = [];
  for (const it of [...items].sort((a, b) => a.seq - b.seq)) {
    const last = out.at(-1);
    if (it.depth === 0 || !last) out.push({ head: it, children: [] });
    else last.children.push(it);
  }
  return out;
}
