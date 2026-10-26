// 인사이트 화면 상태(m3-s1-spec 1-2): 보드는 숨겨 둔 채 그대로 두고, 고른 업무·기간·펼친 달·검색은 앱 실행 중 유지한다.
// 영속 데이터는 저장소의 읽기 전용 조회만 쓴다(11-1). 고른 업무·탭만 설정에 기억(다음 실행의 "마지막에 보던 업무").
// S2(m3-s2-spec): 탭 줄, 업무 고르기(두 탭 공통, 앱 실행 중만), 활동 히트맵의 단위·기준·자료.
import { create } from "zustand";
import {
  defaultMapUnit,
  heatRange,
  journeySpan,
  periodRange,
  spanDates,
  type ActivityRow,
  type HeatUnit,
  type MapUnit,
  type PeriodFilter,
  type WeekSpan,
} from "../../domain/insights";
import type { DayMarkKind } from "../../domain/dayMark";
import type { NoteDoc } from "../../domain/note";
import type { Category, CategoryPeriod, EntryItem } from "../../domain/types";
import { weekIdOf, type DateStr, type WeekId } from "../../domain/week";
import type { JournalRepository } from "../../data/repository";
import { flushAll, reportError, revealCell, revealItem, splitKey, useBoard } from "../board/boardStore";
import { flushNote } from "../note/noteStore";

export interface CategoryStat {
  first: DateStr;
  last: DateStr;
  inRange: number;
}

export interface InsightsData {
  categories: Category[];
  periods: CategoryPeriod[];
  stats: Record<string, CategoryStat>;
  /** 고른 업무 */
  span: WeekSpan | null;
  entries: EntryItem[];
  notes: Record<WeekId, NoteDoc>;
  dayMarks: Record<DateStr, DayMarkKind>;
  /** 고른 업무의 날짜별 항목 수(전체 수명, 경과 지도) */
  days: { date: DateStr; items: number }[];
}

export type InsightTab = "timeline" | "overview";

/** 활동 히트맵 자료(지금 범위) */
export interface HeatData {
  unit: HeatUnit;
  from: DateStr;
  to: DateStr;
  activity: ActivityRow[];
  dayMarks: Record<DateStr, DayMarkKind>;
}

export interface InsightsState {
  open: boolean;
  tab: InsightTab;
  /** 업무 고르기(2절): null = 전체(새 업무도 자동으로 들어감), 배열 = 고른 업무만 */
  picked: string[] | null;
  heatUnit: HeatUnit;
  /** 단위별 기준(null = 이번 주 / 올해) — 앱 실행 중 유지(3절) */
  heatAnchor: Record<HeatUnit, string | null>;
  heat: HeatData | null;
  categoryId: string | null;
  period: PeriodFilter;
  includeEnded: boolean;
  query: string;
  /** 사용자가 직접 펼치거나(true) 접은(false) 달 — 없으면 기본(4-6) */
  monthOpen: Record<string, boolean>;
  /** 경과 지도 단위(null = 업무 기간으로 자동) */
  mapUnit: MapUnit | null;
  mapOpen: boolean;
  /** 타임라인에 지금 보이는 주(지도의 파란 테두리) */
  visibleWeeks: WeekId[];
  /** 타임라인을 이 주(또는 달)로 스크롤해 달라는 요청 */
  jump: { key: string; unit: MapUnit; n: number } | null;
  loading: boolean;
  data: InsightsData | null;
}

const EMPTY: InsightsData = {
  categories: [],
  periods: [],
  stats: {},
  span: null,
  entries: [],
  notes: {},
  dayMarks: {},
  days: [],
};

export const useInsights = create<InsightsState>(() => ({
  open: false,
  tab: "timeline",
  picked: null,
  heatUnit: "day",
  heatAnchor: { day: null, week: null },
  heat: null,
  categoryId: null,
  period: { kind: "12w" },
  includeEnded: false,
  query: "",
  monthOpen: {},
  mapUnit: null,
  mapOpen: true,
  visibleWeeks: [],
  jump: null,
  loading: false,
  data: null,
}));

const set = useInsights.setState;
const get = useInsights.getState;

let repo: JournalRepository | null = null;
let jumpSeq = 0;
let loadSeq = 0;
let heatSeq = 0;

export async function initInsights(r: JournalRepository) {
  repo = r;
  const s = await r.getSettings();
  set({
    categoryId: s.ui.insightCategory,
    mapOpen: s.ui.insightMapOpen,
    tab: s.ui.insightTab,
    open: false,
    data: null,
    heat: null,
  });
}

/** 진행 중 = 열린 구간이 있음 */
export const isOngoing = (periods: CategoryPeriod[], id: string) =>
  periods.some((p) => p.categoryId === id && p.endDate === null);

/**
 * 인사이트 열기(레일·Alt+3·업무 머리 메뉴). categoryId를 주면 그 업무, 아니면 마지막에 보던 업무(없으면 보드 첫 업무).
 * 탭은 마지막에 본 탭 — 업무 머리 메뉴는 늘 타임라인(tab). 대기 중인 칸·메모 저장을 먼저 끝내 방금 친 글까지 보이게 한다(1-2)
 */
export async function openInsights(categoryId?: string, tab?: InsightTab) {
  await flushAll();
  await flushNote(true);
  const board = useBoard.getState();
  const fallback = board.view?.categories[0]?.category.id ?? null;
  const id = categoryId ?? get().categoryId ?? fallback;
  set({ open: true, categoryId: id });
  if (tab) setTab(tab);
  if (categoryId) rememberCategory(categoryId);
  await loadInsights();
  if (get().tab === "overview") await loadHeat();
}

export function setTab(tab: InsightTab) {
  if (get().tab === tab) return;
  set({ tab });
  void repo?.updateSettings({ ui: { insightTab: tab } }).catch(() => undefined);
  if (tab === "overview" && get().open && get().data) void loadHeat();
}

// ── 업무 고르기(2절) ──────────────────────────────────
/** 고른 업무인가(null = 전체) */
export const isPicked = (picked: string[] | null, id: string) => picked === null || picked.includes(id);

/** 하나 켜기/끄기. all = 지금 고를 수 있는 업무 전부(태그 필터·종료 포함 반영) — 다 고르면 다시 "전체" */
export function togglePicked(id: string, all: string[]) {
  const cur = get().picked ?? all;
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  set({ picked: all.every((x) => next.includes(x)) ? null : next });
}

export function pickAll() {
  set({ picked: null });
}

export function pickNone() {
  set({ picked: [] });
}

// ── 활동 히트맵(3절) ──────────────────────────────────
export function setHeatUnit(heatUnit: HeatUnit) {
  if (get().heatUnit === heatUnit) return;
  set({ heatUnit });
  void loadHeat();
}

export function moveHeat(anchor: string) {
  const unit = get().heatUnit;
  set({ heatAnchor: { ...get().heatAnchor, [unit]: anchor } });
  void loadHeat();
}

/** 첫 기록일(앱 전체) — ◀ 한계 */
export const firstRecordOf = (d: InsightsData | null) =>
  Object.values(d?.stats ?? {})
    .map((s) => s.first)
    .sort()[0] ?? null;

/** 지금 단위·기준의 활동·연차를 읽는다 */
export async function loadHeat() {
  const r = repo;
  if (!r) return;
  const seq = ++heatSeq;
  const { heatUnit: unit, heatAnchor } = get();
  const range = heatRange(unit, heatAnchor[unit], r.today(), firstRecordOf(get().data));
  try {
    const [activity, dayMarks] = await Promise.all([
      r.getActivity(range.from, range.to),
      r.getDayMarks(range.from, range.to),
    ]);
    if (seq !== heatSeq) return;
    set({ heat: { unit, from: range.from, to: range.to, activity, dayMarks } });
  } catch (e) {
    reportError(e);
  }
}

/** 히트맵 칸 → 보드(7절): 일 = 그 날, 주 = 그 업무의 그 주 첫 기록일(없으면 월요일). 인사이트는 닫힌다 */
export async function revealHeatCell(date: DateStr, categoryId: string | null) {
  closeInsights();
  await revealCell(date, categoryId);
}

/** 히트맵 행 이름 → 타임라인 탭 그 업무 */
export function openTimelineOf(categoryId: string) {
  setTab("timeline");
  selectCategory(categoryId);
}

export function closeInsights() {
  set({ open: false });
}

function rememberCategory(id: string) {
  void repo?.updateSettings({ ui: { insightCategory: id } }).catch(() => undefined);
}

export function selectCategory(id: string) {
  if (get().categoryId === id) return;
  set({ categoryId: id, query: "", monthOpen: {}, visibleWeeks: [], mapUnit: null });
  rememberCategory(id);
  void loadInsights();
}

export function setPeriod(period: PeriodFilter) {
  set({ period, monthOpen: {} });
  void loadInsights();
}

export function setIncludeEnded(includeEnded: boolean) {
  set({ includeEnded });
}

export function setQuery(query: string) {
  set({ query });
}

export function toggleMonth(month: string, open: boolean) {
  set({ monthOpen: { ...get().monthOpen, [month]: open } });
}

export function setMapUnit(mapUnit: MapUnit) {
  set({ mapUnit });
}

export function setMapOpen(mapOpen: boolean) {
  set({ mapOpen });
  void repo?.updateSettings({ ui: { insightMapOpen: mapOpen } }).catch(() => undefined);
}

export function setVisibleWeeks(weeks: WeekId[]) {
  const cur = get().visibleWeeks;
  if (cur.length === weeks.length && cur.every((w, i) => w === weeks[i])) return;
  set({ visibleWeeks: weeks });
}

/** 지도 칸 → 타임라인 그 자리로(4-0). 기간 밖이면 기간을 "전체"로 넓힌 뒤 */
export async function jumpTo(key: string, unit: MapUnit) {
  const span = get().data?.span;
  const week = unit === "week" ? key : weekIdOf(`${key}-01`);
  if (span && (week < span.fromWeek || week > span.toWeek)) {
    set({ period: { kind: "all" }, monthOpen: {} });
    await loadInsights();
  }
  set({ jump: { key, unit, n: ++jumpSeq } });
}

export const mapUnitOf = (s: InsightsState): MapUnit | null => {
  if (s.mapUnit) return s.mapUnit;
  const d = s.data;
  if (!d || !s.categoryId) return null;
  const span = journeySpan(
    d.periods.filter((p) => p.categoryId === s.categoryId),
    d.days,
    useBoard.getState().today,
  );
  return span ? defaultMapUnit(span) : null;
};

/** 항목 → 보드의 그 칸(6절). 인사이트는 닫히고, Alt+3으로 돌아오면 같은 자리 */
export async function revealOnBoard(it: { id: string; date: DateStr; categoryId: string }) {
  closeInsights();
  await revealItem(it);
}

/** 보드 칸에 커서가 있으면 그 칸의 업무(Alt+3) */
export function focusedCategory(): string | undefined {
  const key = (document.activeElement as Element | null)?.closest<HTMLElement>("[data-cell-key]")?.dataset
    .cellKey;
  return key ? splitKey(key).categoryId : undefined;
}

/** 지금 업무·기간으로 다시 읽는다(열 때·업무/기간을 바꿀 때·다시 시작한 뒤) */
export async function loadInsights() {
  const r = repo;
  if (!r) return;
  const seq = ++loadSeq;
  set({ loading: true });
  try {
    const today = r.today();
    const { categories, periods } = await r.listCategories();
    let id = get().categoryId;
    if (!id || !categories.some((c) => c.id === id)) id = categories[0]?.id ?? null;
    let data: InsightsData = { ...EMPTY, categories, periods };
    if (id) {
      const days = await r.getCategoryDays(id);
      const own = periods.filter((p) => p.categoryId === id);
      const span = periodRange(get().period, today, {
        firstRecord: days[0]?.date ?? null,
        lastRecord: days.at(-1)?.date ?? null,
        categoryStart: own.map((p) => p.startDate).sort()[0] ?? null,
      });
      const { from, to } = spanDates(span);
      const [entries, notes, dayMarks] = await Promise.all([
        r.getCategoryEntries(id, from, to),
        r.getWeekNotesBetween(span.fromWeek, span.toWeek),
        r.getDayMarks(from, to),
      ]);
      data = { ...data, span, days, entries, notes, dayMarks };
    }
    // 목록의 항목 수 = 지금 기간(업무마다 같은 범위 — "전체"는 전 기간)
    const listSpan = data.span ?? periodRange(get().period, today);
    const { from, to } =
      get().period.kind === "all" ? { from: "0000-01-01", to: "9999-12-31" } : spanDates(listSpan);
    const stats = Object.fromEntries(
      (await r.getCategoryStats(from, to)).map((s) => [
        s.categoryId,
        { first: s.first, last: s.last, inRange: s.inRange },
      ]),
    );
    if (seq !== loadSeq) return;
    set({ data: { ...data, stats }, categoryId: id, loading: false });
  } catch (e) {
    if (seq === loadSeq) set({ loading: false });
    reportError(e);
  }
}
