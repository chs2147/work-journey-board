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

// ── 배치 모드(improve-v22-spec 4절): 균등 분할 / 자유 배치 ─────────────────────────
export interface KanbanRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface KanbanLayout {
  mode: "equal" | "free";
  /** 자유 배치의 섹션 자리 — 키 = SectionKey(TODO·DONE·섹션 id) */
  rects: Record<string, KanbanRect>;
}
export const DEFAULT_KANBAN_LAYOUT: KanbanLayout = { mode: "equal", rects: {} };
export const KANBAN_GRID = 8;
export const KANBAN_FREE = { w: 300, h: 560, minW: 220, minH: 200, gap: 16, maxXY: 20000 } as const;
/** 이보다 좁은 창에서는 자유 배치여도 균등 분할로 보인다(결정 K2-b, 저장값은 그대로) */
export const KANBAN_FREE_MIN_VIEW = 900;

export const snapGrid = (v: number) => Math.round(v / KANBAN_GRID) * KANBAN_GRID;

/** 자리가 없는 열에 기본 자리 — 이미 놓인 상자 오른쪽 끝 다음부터 한 줄로(새 섹션 = 맨 오른쪽 빈 자리) */
export function fillRects(keys: SectionKey[], rects: Record<string, KanbanRect>): Record<string, KanbanRect> {
  const out: Record<string, KanbanRect> = {};
  for (const k of keys) if (rects[k]) out[k] = rects[k]!;
  let right = Math.max(0, ...Object.values(out).map((r) => r.x + r.w + KANBAN_FREE.gap));
  for (const k of keys) {
    if (out[k]) continue;
    out[k] = { x: snapGrid(right), y: 0, w: KANBAN_FREE.w, h: KANBAN_FREE.h };
    right = out[k]!.x + KANBAN_FREE.w + KANBAN_FREE.gap;
  }
  return out;
}

/** 균등 분할로 놓았던 모습 그대로의 자리(자유 배치로 처음 바꿀 때·[배치 초기화]) */
export function equalRects(keys: SectionKey[], width: number, height: number): Record<string, KanbanRect> {
  const g = KANBAN_FREE.gap;
  const w = Math.max(KANBAN_FREE.minW, snapGrid((width - g * (keys.length - 1)) / Math.max(1, keys.length)));
  const h = Math.max(KANBAN_FREE.minH, snapGrid(height));
  const out: Record<string, KanbanRect> = {};
  keys.forEach((k, i) => (out[k] = { x: snapGrid(i * (w + g)), y: 0, w, h }));
  return out;
}

/** 자유 배치에서 사용자 섹션 순서 = 왼쪽 위부터 읽는 순서(줄 = 상자 높이 절반 안의 y) */
export function readingOrder(ids: string[], rects: Record<string, KanbanRect>): string[] {
  return [...ids].sort((a, b) => {
    const ra = rects[a],
      rb = rects[b];
    if (!ra || !rb) return 0;
    const row = Math.abs(ra.y - rb.y) < Math.min(ra.h, rb.h) / 2 ? 0 : ra.y - rb.y;
    return row || ra.x - rb.x;
  });
}

// ── 열 순서·섹션 아이콘(improve-v23-spec 2·8절) — TODO·DONE도 순서 자유, 일지 설정에 저장 ─────
export interface KanbanColumns {
  /** 열 순서(TODO·DONE·섹션 id) */
  order: string[];
  /** 열 아이콘 — 값은 sectionIcons의 id */
  icons: Record<string, string>;
}
export const DEFAULT_KANBAN_COLUMNS: KanbanColumns = { order: [], icons: {} };

/**
 * 저장된 순서 + 지금 섹션 → 실제 열 순서. 모르는 키는 버리고, 목록에 없는 섹션(새 섹션·예전 일지)은
 * DONE 바로 앞에 섹션 순서대로 끼운다. TODO·DONE이 빠져 있으면 맨 앞·맨 끝.
 */
export function mergeColumnOrder(order: readonly string[], sectionIds: readonly string[]): SectionKey[] {
  const known = new Set<string>([TODO, DONE, ...sectionIds]);
  const out: string[] = [];
  for (const k of order) if (known.has(k) && !out.includes(k)) out.push(k);
  if (!out.includes(TODO)) out.unshift(TODO);
  const missing = sectionIds.filter((id) => !out.includes(id));
  if (!out.includes(DONE)) out.push(DONE);
  if (missing.length) out.splice(out.indexOf(DONE), 0, ...missing);
  return out;
}

/** key를 순서 안의 toIndex 자리로(toIndex는 옮기기 전 기준 끼울 자리, 0~length) */
export function moveColumn(order: readonly SectionKey[], key: SectionKey, toIndex: number): SectionKey[] {
  const from = order.indexOf(key);
  if (from < 0) return [...order];
  const rest = order.filter((k) => k !== key);
  const at = Math.max(0, Math.min(rest.length, toIndex > from ? toIndex - 1 : toIndex));
  rest.splice(at, 0, key);
  return rest;
}

/**
 * 자유 배치에 새 열 놓을 자리(3절): 보이는 영역(view) 안 첫 빈자리(왼쪽 위부터, 8px 격자) →
 * 없으면 가장 아래 상자 아래 왼쪽.
 */
export function freeSpot(
  rects: readonly KanbanRect[],
  view: { x: number; y: number; w: number; h: number },
  size: { w: number; h: number } = { w: KANBAN_FREE.w, h: 360 },
): KanbanRect {
  const g = KANBAN_FREE.gap;
  const hit = (r: KanbanRect) =>
    rects.some(
      (o) => r.x < o.x + o.w + g && o.x < r.x + r.w + g && r.y < o.y + o.h + g && o.y < r.y + r.h + g,
    );
  for (let y = snapGrid(view.y); y + size.h <= view.y + view.h; y += KANBAN_GRID * 2)
    for (let x = snapGrid(view.x); x + size.w <= view.x + view.w; x += KANBAN_GRID * 2) {
      const r = { x, y, w: size.w, h: size.h };
      if (!hit(r)) return r;
    }
  const bottom = Math.max(0, ...rects.map((r) => r.y + r.h + g));
  return { x: 0, y: snapGrid(bottom), w: size.w, h: size.h };
}

/** 열 기본 아이콘 id — TODO 📋 · DONE ✅ · 사용자 섹션 = 이름 추천(8절) */
export function defaultColumnIcon(key: SectionKey, name = ""): string {
  if (key === TODO) return "clipboard";
  if (key === DONE) return "check-mark-button";
  return suggestIcon(name);
}

const ICON_WORDS: [RegExp, string][] = [
  [/검토|리뷰|review/i, "eyes"],
  [/보류|대기|hold|wait/i, "pause-button"],
  [/진행|작업|doing|wip|progress/i, "rocket"],
  [/테스트|검증|test|qa/i, "test-tube"],
  [/배포|릴리스|출시|release|deploy/i, "package"],
  [/아이디어|idea/i, "light-bulb"],
  [/조사|분석|research/i, "magnifying-glass-tilted-left"],
  [/긴급|급함|urgent/i, "fire"],
  [/논의|회의|meeting/i, "speech-balloon"],
  [/협업|협의/i, "handshake"],
  [/일정|예정|schedule/i, "spiral-calendar"],
];

/** 섹션 이름에 맞는 아이콘 id(없으면 📌) */
export function suggestIcon(name: string): string {
  for (const [re, id] of ICON_WORDS) if (re.test(name)) return id;
  return "pushpin";
}
