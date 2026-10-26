// 주간 보드 화면 상태 + 저장 흐름. 영속 데이터는 JournalRepository만 거친다(CLAUDE.md 4-3).
// - 셀 편집은 화면 상태(cells)를 즉시 바꾸고, 0.5초 뒤 또는 칸을 벗어날 때 저장한다(overview 10-3).
// - 실행 취소 단위 = 저장 1회(체크포인트). 저장 전에는 대기 중인 저장을 먼저 끝낸다.
import { create } from "zustand";
import type { DayMarkKind } from "../../domain/dayMark";
import { appendCopies, deleteAt, normalizeCell } from "../../domain/items";
import { matchesTagFilter, NO_TAG, type Tag } from "../../domain/tags";
import type { VisibleCategory } from "../../domain/categories";
import { groupRange, type Recurrence } from "../../domain/recurrence";
import type { ImportantItem, ItemDraft } from "../../domain/types";
import {
  addDays,
  addWeeks,
  DAY_LABELS,
  dayIndex,
  weekDays,
  weekIdOf,
  type DateStr,
  type WeekId,
} from "../../domain/week";
import { uuidv7 } from "../../data/ids";
import {
  cellKey,
  ValidationError,
  type JournalRepository,
  type RepeatPreview,
  type WeekView,
} from "../../data/repository";
import type { CategoryColorKey } from "../../shared/palette";
import { STR } from "../../shared/strings";

export const SAVE_DELAY_MS = 500;
/** 목록에서 항목으로 이동했을 때 강조 테두리 시간 */
export const PULSE_MS = 1200;
export const UNDO_LIMIT = 50;
export const TOAST_MS = 5000;

export type FocusTarget = { kind: "item"; key: string; index: number; caret: "start" | "end" | number };

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  message: string;
  actions: ToastAction[];
}

interface UndoEntry {
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

export interface BoardState {
  ready: boolean;
  today: DateStr;
  weekId: WeekId;
  focusDay: DateStr;
  view: WeekView | null;
  /** 화면에 보이는 셀의 편집 상태(키: cellKey) */
  cells: Record<string, ItemDraft[]>;
  nudges: string[];
  nudgeWeeks: number;
  saving: number;
  failed: string[];
  canUndo: boolean;
  canRedo: boolean;
  toasts: Toast[];
  focus: FocusTarget | null;
  yearOpen: boolean;
  /** "+ 업무 추가" 입력칸이 열려 있는가 */
  addOpen: boolean;
  /** 중요 업무(모든 주, 처리 전) · 최근 완료(7일) — important-repeat-spec 2절 */
  important: ImportantItem[];
  recentDone: ImportantItem[];
  /** 왼쪽 중요 업무 패널 열림 */
  panelOpen: boolean;
  /** 패널을 열 때 목록으로 포커스를 옮길지 */
  panelFocus: boolean;
  /** 목록에서 이동해 온 항목(잠깐 강조) */
  pulseId: string | null;
  /** 반복 중인 규칙 id(끝 주 없음) — 항목의 ↻ 표시(spec 3-4) */
  repeating: string[];
  /** 미래 주의 반복 "예정"(키: cellKey) — spec 3-2 */
  previews: Record<string, RepeatPreview[]>;
  /** 이 주의 연차·반차 표시(improve-1026-spec 1절) */
  dayMarks: Record<DateStr, DayMarkKind>;
  /** 포커스 열 기준 업무별 직전 기록일(빈 칸의 가져오기 단추, spec 3-2) — 키: 업무 id */
  prevDates: Record<string, DateStr>;
  /** 모든 태그(순서대로)와 업무별 태그 id(improve-1026-spec 4절) */
  tags: Tag[];
  categoryTags: Record<string, string[]>;
  /** 보드 태그 필터(spec 6절) — 빈 배열 = 전체 */
  tagFilter: string[];
  /** 주간 뷰 / 오늘 뷰(spec 8절) — 오늘 뷰는 focusDay 하루를 보여 준다 */
  viewMode: "week" | "today";
  /** 포커스 열 기준 업무별 직전 기록 내역(오늘 뷰 카드 미리보기) — 키: 업무 id */
  prevItems: Record<string, { depth: 0 | 1; text: string }[]>;
}

// 화면 밖 상태(렌더링과 무관)
let repo: JournalRepository | null = null;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const persistedCells = new Map<string, ItemDraft[]>();
const undoStack: UndoEntry[] = [];
const redoStack: UndoEntry[] = [];
let toastSeq = 0;

const sameItems = (a: ItemDraft[], b: ItemDraft[]) =>
  a.length === b.length &&
  a.every(
    (x, i) =>
      x.id === b[i]!.id &&
      x.depth === b[i]!.depth &&
      x.text === b[i]!.text &&
      Boolean(x.flagged) === Boolean(b[i]!.flagged),
  );

export const splitKey = (key: string) => {
  const i = key.indexOf("|");
  return { date: key.slice(0, i), categoryId: key.slice(i + 1) };
};

export const newDraft = (text = "", depth: 0 | 1 = 0): ItemDraft => ({ id: uuidv7(), depth, text });

export const useBoard = create<BoardState>(() => ({
  ready: false,
  today: "",
  weekId: "",
  focusDay: "",
  view: null,
  cells: {},
  nudges: [],
  nudgeWeeks: 3,
  saving: 0,
  failed: [],
  canUndo: false,
  canRedo: false,
  toasts: [],
  focus: null,
  yearOpen: false,
  addOpen: false,
  important: [],
  recentDone: [],
  panelOpen: false,
  panelFocus: false,
  pulseId: null,
  repeating: [],
  previews: {},
  dayMarks: {},
  prevDates: {},
  tags: [],
  categoryTags: {},
  tagFilter: [],
  viewMode: "week",
  prevItems: {},
}));

const set = useBoard.setState;
const get = useBoard.getState;

function requireRepo(): JournalRepository {
  if (!repo) throw new Error("저장소가 연결되지 않았습니다");
  return repo;
}

function syncUndoFlags() {
  set({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 });
}

function pushUndo(entry: UndoEntry) {
  undoStack.push(entry);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack.length = 0;
  syncUndoFlags();
}

function markFailed(key: string, failed: boolean) {
  const cur = get().failed.filter((k) => k !== key);
  set({ failed: failed ? [...cur, key] : cur });
}

/** 저장 중 표시(상단 "저장 중…")를 켠 채 일을 한다 — 주간 요약 수정본 저장도 같은 표시를 쓴다 */
export async function track<T>(work: () => Promise<T>): Promise<T> {
  set((s) => ({ saving: s.saving + 1 }));
  try {
    return await work();
  } finally {
    set((s) => ({ saving: s.saving - 1 }));
  }
}

/** 토스트(5초). 단추는 0~여러 개(예: 내보내기 완료 [폴더 열기] [파일 열기]) */
export function toast(message: string, action?: ToastAction | ToastAction[]) {
  const id = ++toastSeq;
  const actions = action === undefined ? [] : Array.isArray(action) ? action : [action];
  set((s) => ({ toasts: [...s.toasts, { id, message, actions }] }));
  setTimeout(() => dismissToast(id), TOAST_MS);
}

export function dismissToast(id: number) {
  set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

export function reportError(e: unknown) {
  toast(
    e instanceof ValidationError ? e.message : STR.toast.error(e instanceof Error ? e.message : String(e)),
  );
}

// ── 셀 저장 ────────────────────────────────────────────
/** 저장 없이 셀 상태와 저장본을 맞춘다(실행 취소·다시 실행용). */
async function applyCell(key: string, items: ItemDraft[]) {
  const t = timers.get(key);
  if (t) clearTimeout(t);
  timers.delete(key);
  const { date, categoryId } = splitKey(key);
  if (key in get().cells) set((s) => ({ cells: { ...s.cells, [key]: items } }));
  await track(() => requireRepo().saveCell(date, categoryId, items));
  persistedCells.set(key, normalizeCell(items));
  void refreshImportant();
}

/** 칸을 저장한다. 실행 취소 1단계를 쌓았으면 true. quiet = 기본 "항목 N개 삭제됨" 토스트를 부르는 쪽이 대신 띄움 */
async function persistCell(key: string, quiet = false): Promise<boolean> {
  timers.delete(key);
  const current = get().cells[key];
  if (!current) return false;
  const before = persistedCells.get(key) ?? [];
  const after = normalizeCell(current);
  if (sameItems(before, after)) return false;
  const { date, categoryId } = splitKey(key);
  try {
    await track(() => requireRepo().saveCell(date, categoryId, after));
  } catch (e) {
    markFailed(key, true);
    reportError(e);
    return false;
  }
  persistedCells.set(key, after);
  markFailed(key, false);
  if (date < get().focusDay) void refreshPrevDates();
  if (before.some((i) => i.flagged) || after.some((i) => i.flagged)) void refreshImportant();
  const entry: UndoEntry = { undo: () => applyCell(key, before), redo: () => applyCell(key, after) };
  pushUndo(entry);
  const keptIds = new Set(after.map((i) => i.id));
  const lost = before.filter((i) => !keptIds.has(i.id) && i.text.trim()).length;
  if (lost > 0 && !quiet)
    toast(STR.toast.itemsDeleted(lost), { label: STR.toast.undo, run: () => void undo() });
  return true;
}

/**
 * 행 삭제(improve-1026v2-spec 1·2절): 본 항목이면 딸린 세부 항목까지 묶음째. 확인 없이 지우고 바로 저장 →
 * 실행 취소 1단계 + 토스트 [되돌리기]. moveFocus = 키보드(Alt+Delete)일 때 커서를 위 항목 끝(없으면 아래 항목 앞)으로
 */
export async function deleteItemAt(key: string, index: number, moveFocus = false) {
  const items = get().cells[key] ?? [];
  if (!items[index]) return;
  const { items: next, removed, start } = deleteAt(items, index);
  const focus: FocusTarget | null =
    !moveFocus || next.length === 0
      ? null
      : start > 0
        ? { kind: "item", key, index: start - 1, caret: "end" }
        : { kind: "item", key, index: 0, caret: "start" };
  set((s) => ({ cells: { ...s.cells, [key]: next }, ...(focus ? { focus } : {}) }));
  const t = timers.get(key);
  if (t) clearTimeout(t);
  const pushed = await persistCell(key, true);
  const written = removed.filter((i) => i.text.trim());
  if (!pushed || written.length === 0) return;
  const subs = written.filter((i) => i.depth === 1).length;
  toast(STR.toast.rowsDeleted(written.length, removed[0]!.depth === 0 ? subs : 0), {
    label: STR.toast.undo,
    run: () => void undo(),
  });
}

function schedule(key: string, run: () => Promise<unknown>) {
  const t = timers.get(key);
  if (t) clearTimeout(t);
  timers.set(
    key,
    setTimeout(() => void run(), SAVE_DELAY_MS),
  );
}

/** 대기 중인 저장을 모두 지금 실행한다(주 이동·실행 취소·종료 전에). */
export async function flushAll() {
  const keys = [...timers.keys()];
  for (const k of keys) {
    clearTimeout(timers.get(k)!);
    timers.delete(k);
  }
  for (const k of keys) await persistCell(k);
}

// ── 주 불러오기·이동 ───────────────────────────────────
async function loadWeek(weekId: WeekId, focusDay: DateStr) {
  const r = requireRepo();
  await flushAll();
  const today = r.today();
  const current = weekIdOf(today);
  // 매주 반복: 이번 주는 처음 열 때 들어온다. 지난 주는 채우지 않고, 미래 주는 "예정"만(spec 3-2)
  let created = 0;
  if (weekId === current) {
    try {
      created = await r.materializeWeek(weekId);
    } catch (e) {
      reportError(e); // 다음에 그 주를 열 때 다시 시도
    }
  }
  const view = await r.getWeek(weekId);
  const rules: Recurrence[] = await r.listRecurrences();
  const previews: Record<string, RepeatPreview[]> = {};
  if (weekId > current) {
    for (const p of await r.previewWeek(weekId))
      (previews[cellKey(p.date, p.rule.categoryId)] ??= []).push(p);
  }
  const settings = await r.getSettings();
  const nudges = weekId === weekIdOf(today) ? await r.getNudges(weekId) : [];
  const [tags, categoryTags] = await Promise.all([r.listTags(), r.getCategoryTags()]);
  const cells: Record<string, ItemDraft[]> = {};
  persistedCells.clear();
  for (const vc of view.categories) {
    for (const day of view.days) {
      const key = cellKey(day, vc.category.id);
      const drafts = (view.items[key] ?? []).map((i): ItemDraft => ({
        id: i.id,
        depth: i.depth,
        text: i.text,
        flagged: i.flagged,
        flagDoneAt: i.flagDoneAt,
        recurrenceId: i.recurrenceId,
      }));
      cells[key] = drafts;
      persistedCells.set(key, drafts);
    }
  }
  set({
    ready: true,
    today,
    weekId,
    focusDay,
    view,
    cells,
    nudges,
    nudgeWeeks: settings.nudgeWeeks,
    repeating: rules.filter((x) => x.endWeek === null).map((x) => x.id),
    previews,
    dayMarks: view.dayMarks,
    tags,
    categoryTags,
    tagFilter: liveFilter(get().tagFilter, tags),
  });
  await Promise.all([refreshImportant(), refreshPrevDates()]);
  if (created > 0) toast(STR.repeat.created(created));
}

/** 같은 요일을 유지하며 주를 옮긴다. 이번 주로 오면 오늘로. */
function focusDayFor(weekId: WeekId, preferIndex: number, today: DateStr): DateStr {
  if (weekId === weekIdOf(today)) return today;
  return weekDays(weekId)[preferIndex]!;
}

export async function init(r: JournalRepository) {
  repo = r;
  undoStack.length = 0;
  redoStack.length = 0;
  const today = r.today();
  const ui = (await r.getSettings()).ui;
  set({ tagFilter: ui.tagFilter, viewMode: ui.viewMode });
  await loadWeek(weekIdOf(today), today);
  // 패널 열림은 기억하되, 켤 때 0건이면 닫힌 채 시작(spec 2-5)
  const settings = await r.getSettings();
  set({ panelOpen: settings.ui.importantPanelOpen && get().important.length > 0, panelFocus: false });
  focusStartCell();
}

// ── 중요 업무(important-repeat-spec 2절) ───────────────
export async function refreshImportant() {
  const r = repo;
  if (!r) return;
  const [important, recentDone] = await Promise.all([r.listImportant(), r.listRecentDone()]);
  set({ important, recentDone });
}

/** 입력 중 항목의 중요 표시 켜기/끄기(☆ 버튼·Alt+I). 빈 항목은 무시. 실행 취소 기록에 들어간다. */
export async function toggleFlag(key: string, index: number) {
  const items = get().cells[key];
  const item = items?.[index];
  if (!items || !item || !item.text.trim()) return;
  const next = items.map((it, i) => (i === index ? { ...it, flagged: !it.flagged, flagDoneAt: null } : it));
  set((s) => ({ cells: { ...s.cells, [key]: next } }));
  const t = timers.get(key);
  if (t) clearTimeout(t);
  await persistCell(key);
}

/** 화면에 있는 같은 항목의 표시를 저장본과 맞춘다(목록에서 처리·되돌리기 후). */
function patchLocalItem(id: string, marks: Pick<ItemDraft, "flagged" | "flagDoneAt">) {
  const cells = { ...get().cells };
  for (const [key, items] of Object.entries(cells)) {
    if (!items.some((i) => i.id === id)) continue;
    cells[key] = items.map((i) => (i.id === id ? { ...i, ...marks } : i));
    const saved = persistedCells.get(key);
    if (saved)
      persistedCells.set(
        key,
        saved.map((i) => (i.id === id ? { ...i, ...marks } : i)),
      );
  }
  set({ cells });
}

/** 목록에서 체크 = 처리 완료(강조 해제). 토스트로 되돌리기. */
export async function completeImportant(id: string) {
  const r = requireRepo();
  await flushAll();
  try {
    await track(() => r.completeFlag(id));
  } catch (e) {
    reportError(e);
    return;
  }
  patchLocalItem(id, { flagged: false, flagDoneAt: new Date().toISOString() });
  await refreshImportant();
  toast(STR.important.completed, { label: STR.toast.undo, run: () => void undoImportant(id) });
}

export async function undoImportant(id: string) {
  const r = requireRepo();
  await flushAll();
  try {
    await track(() => r.undoComplete(id));
  } catch (e) {
    reportError(e);
    return;
  }
  patchLocalItem(id, { flagged: true, flagDoneAt: null });
  await refreshImportant();
}

/** 목록 항목으로 이동: 그 주·그 요일로 가서 그 항목 입력칸에 커서(글 끝) + 잠깐 강조 */
export async function revealItem(it: ImportantItem) {
  const wk = weekIdOf(it.date);
  if (wk !== get().weekId) await loadWeek(wk, it.date);
  else set({ focusDay: it.date });
  const key = cellKey(it.date, it.categoryId);
  const index = (get().cells[key] ?? []).findIndex((i) => i.id === it.id);
  if (index < 0) return;
  set({ focus: { kind: "item", key, index, caret: "end" }, pulseId: it.id });
  setTimeout(() => {
    if (get().pulseId === it.id) set({ pulseId: null });
  }, PULSE_MS);
}

// ── 매주 반복(important-repeat-spec 3절) ───────────────
/** 같은 주를 다시 불러오고 커서를 그 칸·그 위치로 돌려놓는다 */
async function reloadAt(key: string, index: number) {
  const { weekId, focusDay } = get();
  await loadWeek(weekId, focusDay);
  const n = get().cells[key]?.length ?? 0;
  if (n > 0) set({ focus: { kind: "item", key, index: Math.min(index, n - 1), caret: "end" } });
}

/** 입력 중 항목(묶음)의 매주 반복 켜기/끄기(↻·Alt+R). 토스트로 되돌리기. */
export async function toggleRepeat(key: string, index: number) {
  const r = requireRepo();
  await flushAll();
  const items = get().cells[key] ?? [];
  if (!items[index]) return;
  const { start, end } = groupRange(items, index);
  const parent = items[start]!;
  if (!parent.text.trim()) return;
  const { date } = splitKey(key);
  const running =
    parent.recurrenceId && get().repeating.includes(parent.recurrenceId) ? parent.recurrenceId : null;
  try {
    if (running) {
      const undoInfo = await track(() => r.disableRepeat(running, weekIdOf(date)));
      await reloadAt(key, index);
      toast(STR.repeat.off, {
        label: STR.toast.undo,
        run: () => void track(() => r.restoreRepeat(undoInfo)).then(() => reloadAt(key, index)),
      });
    } else {
      const ids = items
        .slice(start, end + 1)
        .filter((i) => i.text.trim())
        .map((i) => i.id);
      const rule = await track(() => r.enableRepeat(ids, Boolean(parent.flagged)));
      await reloadAt(key, index);
      toast(STR.repeat.on(DAY_LABELS[rule.weekday - 1]!), {
        label: STR.toast.undo,
        run: () =>
          void track(() => r.disableRepeat(rule.id, weekIdOf(date))).then(() => reloadAt(key, index)),
      });
    }
  } catch (e) {
    reportError(e);
  }
}

/** 미래 주 "예정"을 눌렀을 때: 그 반복을 이 주에 지금 만들고 그 항목에 커서(spec 3-2) */
export async function materializePreview(key: string, ruleId: string) {
  const r = requireRepo();
  const { weekId, focusDay } = get();
  try {
    await track(() => r.materializeWeek(weekId, ruleId));
  } catch (e) {
    reportError(e);
    return;
  }
  await loadWeek(weekId, splitKey(key).date || focusDay);
  const items = get().cells[key] ?? [];
  const index = items.findIndex((i) => i.recurrenceId === ruleId);
  if (index >= 0) set({ focus: { kind: "item", key, index, caret: "end" } });
}

export function setPanelOpen(open: boolean, focusList = false) {
  set({ panelOpen: open, panelFocus: open && focusList });
  void repo?.updateSettings({ ui: { importantPanelOpen: open } }).catch(() => undefined);
}

export async function reload() {
  const { weekId, focusDay } = get();
  await loadWeek(weekId, focusDay);
}

export async function goWeek(delta: number) {
  const { weekId, focusDay, today } = get();
  const next = addWeeks(weekId, delta);
  await loadWeek(next, focusDayFor(next, dayIndex(focusDay), today));
}

export async function goToWeek(weekId: WeekId) {
  const { focusDay, today } = get();
  await loadWeek(weekId, focusDayFor(weekId, dayIndex(focusDay), today));
}

/** 오늘 뷰의 하루 이동(◀ ▶·Alt+←/→, spec 8-1). 주를 넘으면 그 주를 불러온다 */
export async function goDay(delta: number) {
  const { focusDay, weekId } = get();
  const day = addDays(focusDay, delta);
  if (weekIdOf(day) !== weekId) await loadWeek(weekIdOf(day), day);
  else setFocusDay(day);
  focusStartCell();
}

/** 주간 / 오늘 뷰 바꾸기(상단 [주간|오늘]·Alt+V) — 마지막 뷰를 기억하고 그 뷰의 첫 업무 칸으로 */
export function setViewMode(viewMode: "week" | "today") {
  if (get().viewMode === viewMode) return;
  set({ viewMode });
  void repo?.updateSettings({ ui: { viewMode } }).catch(() => undefined);
  focusStartCell();
}

export async function goToday() {
  const today = requireRepo().today();
  await loadWeek(weekIdOf(today), today);
  focusStartCell();
}

export function setFocusDay(day: DateStr) {
  if (get().focusDay === day) return;
  set({ focusDay: day });
  void refreshPrevDates();
}

/** 포커스 열의 첫 업무 칸(기록이 있으면 마지막 항목 끝)으로 커서. 업무가 없으면 업무 추가 입력칸. */
export function focusStartCell() {
  const { focusDay, cells } = get();
  const cats = shownCategories(get());
  const first = cats.find((c) => c.state === "active") ?? cats[0];
  if (!first) return set({ addOpen: true });
  const key = cellKey(focusDay, first.category.id);
  const items = cells[key] ?? [];
  if (items.length === 0) {
    set((s) => ({
      cells: { ...s.cells, [key]: [newDraft()] },
      focus: { kind: "item", key, index: 0, caret: "end" },
    }));
  } else {
    set({ focus: { kind: "item", key, index: items.length - 1, caret: "end" } });
  }
}

export function setFocus(focus: FocusTarget | null) {
  set({ focus });
}

export function setAddOpen(addOpen: boolean) {
  set({ addOpen });
}

/** 칸으로 들어가기(키보드 이동). 빈 칸이면 빈 항목 하나를 만들어 커서를 둔다. */
export function enterCell(key: string, from: "above" | "below") {
  const items = get().cells[key] ?? [];
  setFocusDay(splitKey(key).date);
  if (items.length === 0) {
    set((s) => ({
      cells: { ...s.cells, [key]: [newDraft()] },
      focus: { kind: "item", key, index: 0, caret: "end" },
    }));
  } else if (from === "above") {
    set({ focus: { kind: "item", key, index: 0, caret: "start" } });
  } else {
    set({ focus: { kind: "item", key, index: items.length - 1, caret: "end" } });
  }
}

// ── 셀·메모 편집 ───────────────────────────────────────
export function editCell(key: string, items: ItemDraft[], focus?: FocusTarget) {
  set((s) => ({ cells: { ...s.cells, [key]: items }, ...(focus ? { focus } : {}) }));
  schedule(key, () => persistCell(key));
}

/** 칸을 벗어날 때: 바로 저장하고, 빈 항목만 남았으면 화면에서도 비운다. */
export async function leaveCell(key: string) {
  const items = get().cells[key];
  if (items && items.every((i) => !i.text.trim()) && items.length > 0) {
    set((s) => ({ cells: { ...s.cells, [key]: [] } }));
  }
  if (timers.has(key)) {
    clearTimeout(timers.get(key)!);
    await persistCell(key);
  }
}

export async function retryFailed() {
  const failed = get().failed;
  for (const k of failed) await persistCell(k);
}

// ── 실행 취소 ──────────────────────────────────────────
export async function undo() {
  await flushAll();
  const e = undoStack.pop();
  if (!e) return;
  try {
    await e.undo();
    redoStack.push(e);
  } catch (err) {
    reportError(err);
  }
  syncUndoFlags();
}

export async function redo() {
  await flushAll();
  const e = redoStack.pop();
  if (!e) return;
  try {
    await e.redo();
    undoStack.push(e);
  } catch (err) {
    reportError(err);
  }
  syncUndoFlags();
}

// ── 업무(카테고리) ────────────────────────────────────
export async function addCategory(name: string): Promise<boolean> {
  try {
    const r = requireRepo();
    const c = await track(() => r.createCategory(name, get().weekId));
    // 태그로 거른 보기에서 만든 업무는 고른 태그를 달아 둔다 — 만들자마자 숨지 않게(improve-1026-spec 6-1)
    for (const id of get().tagFilter.filter((x) => x !== NO_TAG)) await r.setCategoryTag(c.id, id, true);
    await reload();
    return true;
  } catch (e) {
    reportError(e);
    return false;
  }
}

export async function renameCategory(id: string, name: string) {
  const before = get().view?.categories.find((c) => c.category.id === id)?.category.name;
  if (!before || before === name.trim()) return;
  try {
    await track(() => requireRepo().renameCategory(id, name));
    const after = name;
    pushUndo({
      undo: async () => {
        await requireRepo().renameCategory(id, before);
        await reload();
      },
      redo: async () => {
        await requireRepo().renameCategory(id, after);
        await reload();
      },
    });
    await reload();
  } catch (e) {
    reportError(e);
  }
}

export async function setCategoryColor(id: string, color: CategoryColorKey) {
  const before = get().view?.categories.find((c) => c.category.id === id)?.category.color;
  if (!before || before === color) return;
  await track(() => requireRepo().setCategoryColor(id, color));
  pushUndo({
    undo: async () => {
      await requireRepo().setCategoryColor(id, before);
      await reload();
    },
    redo: async () => {
      await requireRepo().setCategoryColor(id, color);
      await reload();
    },
  });
  await reload();
}

/**
 * 보드에 보이는 순서 기준으로 순서를 바꾼다. 보이지 않는 업무(그 주에 없거나 태그 필터로 숨은 업무)는
 * 제자리에 두고, 보이는 업무가 있던 자리들만 새 순서로 채운다.
 */
export async function reorderVisible(idsInOrder: string[]) {
  const before = (await requireRepo().listCategories()).categories.map((c) => c.id);
  const moving = new Set(idsInOrder);
  let k = 0;
  const after = before.map((id) => (moving.has(id) ? idsInOrder[k++]! : id));
  if (before.join() === after.join()) return;
  await track(() => requireRepo().reorderCategories(after));
  pushUndo({
    undo: async () => {
      await requireRepo().reorderCategories(before);
      await reload();
    },
    redo: async () => {
      await requireRepo().reorderCategories(after);
      await reload();
    },
  });
  await reload();
}

export async function moveCategory(id: string, dir: -1 | 1) {
  const ids = shownCategories(get()).map((c) => c.category.id);
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  await reorderVisible(ids);
}

export async function archiveCategory(id: string) {
  const name = get().view?.categories.find((c) => c.category.id === id)?.category.name ?? "";
  await flushAll();
  await track(() => requireRepo().archiveCategory(id));
  await reload();
  toast(STR.toast.archived(name), {
    label: STR.toast.undo,
    run: () =>
      void (async () => {
        await requireRepo().reactivateCategory(id);
        await reload();
      })(),
  });
}

export async function countItems(id: string) {
  return requireRepo().countItems(id);
}

export async function deleteCategory(id: string): Promise<boolean> {
  await flushAll();
  const ok = await track(() => requireRepo().deleteCategoryIfEmpty(id));
  await reload();
  return ok;
}

export async function keepCategory(id: string) {
  await track(() => requireRepo().snoozeNudge(id, get().weekId));
  await reload();
}

// ── 연차·반차 표시(improve-1026-spec 1절) ───────────────
/** 표시 바꾸기(null = 근무). 보드 실행 취소에 들어간다 */
export async function setDayMark(date: DateStr, kind: DayMarkKind | null) {
  const before = get().dayMarks[date] ?? null;
  if (before === kind) return;
  const apply = async (k: DayMarkKind | null) => {
    await track(() => requireRepo().setDayMark(date, k));
    const { [date]: _old, ...rest } = get().dayMarks; // eslint-disable-line @typescript-eslint/no-unused-vars
    set({ dayMarks: k ? { ...rest, [date]: k } : rest });
    // 직전 기록일은 종일 연차를 건너뛰므로 다시 찾는다
    void refreshPrevDates();
  };
  try {
    await apply(kind);
  } catch (e) {
    reportError(e);
    return;
  }
  pushUndo({ undo: () => apply(before), redo: () => apply(kind) });
}

// ── 직전 기록 가져오기(improve-1026-spec 3절) ───────────
/** `10/28(수)` */
export function pullLabel(date: DateStr) {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}(${DAY_LABELS[dayIndex(date)]})`;
}

async function refreshPrevDates() {
  const r = repo;
  const day = get().focusDay;
  if (!r || !day) return;
  try {
    const recs = await r.previousRecordsByCategory(day);
    if (get().focusDay !== day) return;
    const prevDates: Record<string, DateStr> = {};
    const prevItems: BoardState["prevItems"] = {};
    for (const rec of recs)
      for (const [id, items] of Object.entries(rec.cells)) {
        prevDates[id] = rec.date;
        prevItems[id] = items;
      }
    set({ prevDates, prevItems });
  } catch {
    // 단추 표시용 — 실패해도 가져오기(Alt+P)는 그때 다시 찾는다
  }
}

/** 전체 가져오기 대상: 보드에 보이는(태그 필터 적용) 진행 중 업무(보드 순서) */
const activeCategoryIds = () =>
  shownCategories(get())
    .filter((c) => c.state === "active")
    .map((c) => c.category.id);

/** 요일 머리 메뉴에 보일 직전 기록일(없으면 null) */
export async function previousDayFor(date: DateStr): Promise<DateStr | null> {
  const prev = await requireRepo().previousRecord(date, activeCategoryIds());
  return prev?.date ?? null;
}

/** 칸 하나(Alt+P·빈 칸 단추): 그 업무의 직전 기록일 내역을 칸 끝에 덧붙이고 마지막 항목에 커서 */
export async function pullPrevious(key: string) {
  await flushAll();
  const { date, categoryId } = splitKey(key);
  let prev;
  try {
    prev = await requireRepo().previousRecord(date, [categoryId]);
  } catch (e) {
    reportError(e);
    return;
  }
  const source = prev?.cells[categoryId];
  if (!prev || !source?.length) return toast(STR.pull.none);
  const { items, added } = appendCopies(get().cells[key] ?? [], source, uuidv7);
  const label = pullLabel(prev.date);
  if (added === 0) return toast(STR.pull.already(label));
  set((s) => ({
    cells: { ...s.cells, [key]: items },
    focus: { kind: "item", key, index: items.length - 1, caret: "end" },
  }));
  await persistCell(key);
  toast(STR.pull.done(label, added), { label: STR.toast.undo, run: () => void undo() });
}

/** 요일 전체(Alt+Shift+P·요일 머리 메뉴): 직전 기록일의 모든 업무 내역을 이 날 각 업무 칸 끝에. 되돌리기 한 번 */
export async function pullPreviousDay(date: DateStr) {
  await flushAll();
  let prev;
  try {
    prev = await requireRepo().previousRecord(date, activeCategoryIds());
  } catch (e) {
    reportError(e);
    return;
  }
  if (!prev) return toast(STR.pull.none);
  const label = pullLabel(prev.date);
  const changes: { key: string; before: ItemDraft[]; after: ItemDraft[] }[] = [];
  let total = 0;
  try {
    for (const id of activeCategoryIds()) {
      const source = prev.cells[id];
      if (!source?.length) continue;
      const key = cellKey(date, id);
      const before = persistedCells.get(key) ?? [];
      const { items, added } = appendCopies(get().cells[key] ?? [], source, uuidv7);
      if (added === 0) continue;
      await applyCell(key, items);
      changes.push({ key, before, after: normalizeCell(items) });
      total += added;
    }
  } catch (e) {
    reportError(e);
  }
  if (changes.length === 0) return toast(STR.pull.already(label));
  setFocusDay(date);
  pushUndo({
    undo: async () => {
      for (const c of changes) await applyCell(c.key, c.before);
    },
    redo: async () => {
      for (const c of changes) await applyCell(c.key, c.after);
    },
  });
  toast(STR.pull.doneAll(label, total, changes.length), { label: STR.toast.undo, run: () => void undo() });
}

// ── 업무 태그·태그 필터(improve-1026-spec 4~6절) ─────────
/** 필터에서 없어진 태그를 뺀다 */
function liveFilter(filter: string[], tags: Tag[]): string[] {
  const ids = new Set(tags.map((t) => t.id));
  return filter.filter((x) => x === NO_TAG || ids.has(x));
}

/** 보드에 보일 업무(그 주에 보이는 업무 중 태그 필터에 맞는 것, 보드 순서) */
export function shownCategories(
  s: Pick<BoardState, "view" | "categoryTags" | "tagFilter">,
): VisibleCategory[] {
  return (s.view?.categories ?? []).filter((c) =>
    matchesTagFilter(s.categoryTags[c.category.id] ?? [], s.tagFilter),
  );
}

/** 태그 목록·업무별 태그를 다시 읽는다(설정에서 태그를 바꾼 뒤) */
export async function refreshTags() {
  const r = repo;
  if (!r) return;
  const [tags, categoryTags] = await Promise.all([r.listTags(), r.getCategoryTags()]);
  const tagFilter = liveFilter(get().tagFilter, tags);
  if (tagFilter.length !== get().tagFilter.length) saveFilter(tagFilter);
  set({ tags, categoryTags, tagFilter });
}

function saveFilter(tagFilter: string[]) {
  void repo?.updateSettings({ ui: { tagFilter } }).catch(() => undefined);
}

export function setTagFilter(tagFilter: string[]) {
  set({ tagFilter });
  saveFilter(tagFilter);
}

/** 업무에 태그 붙이기/떼기 — 바로 저장, 보드 실행 취소에 들어간다 */
export async function toggleCategoryTag(categoryId: string, tagId: string) {
  const on = !(get().categoryTags[categoryId] ?? []).includes(tagId);
  const apply = async (v: boolean) => {
    await track(() => requireRepo().setCategoryTag(categoryId, tagId, v));
    await refreshTags();
  };
  try {
    await apply(on);
  } catch (e) {
    reportError(e);
    return;
  }
  pushUndo({ undo: () => apply(!on), redo: () => apply(on) });
}

/** 새 태그를 만들어 그 업무에 붙인다(같은 이름이 있으면 그 태그를 붙임). 성공하면 태그 id */
export async function createTagFor(categoryId: string, name: string): Promise<string | null> {
  const r = requireRepo();
  try {
    const tag = await track(() => r.createTag(name));
    await refreshTags();
    await toggleCategoryTag(categoryId, tag.id);
    return tag.id;
  } catch (e) {
    reportError(e);
    return null;
  }
}

/** 설정 > 태그: 이름 바꾸기·순서·지우기(지우면 모든 업무에서 떨어짐 — 부르는 쪽이 먼저 확인) */
export async function renameTag(id: string, name: string): Promise<boolean> {
  try {
    await track(() => requireRepo().renameTag(id, name));
    await refreshTags();
    return true;
  } catch (e) {
    reportError(e);
    return false;
  }
}

export async function moveTag(id: string, dir: -1 | 1) {
  const ids = get().tags.map((t) => t.id);
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  await track(() => requireRepo().reorderTags(ids));
  await refreshTags();
}

export async function deleteTag(id: string) {
  await track(() => requireRepo().deleteTag(id));
  await refreshTags();
}

// ── 연간 보기 ──────────────────────────────────────────
export function setYearOpen(open: boolean) {
  set({ yearOpen: open });
}

export function yearDensity(isoYear: number) {
  return requireRepo().getYearDensity(isoYear);
}
