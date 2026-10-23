// 주간 보드 화면 상태 + 저장 흐름. 영속 데이터는 JournalRepository만 거친다(CLAUDE.md 4-3).
// - 셀 편집은 화면 상태(cells)를 즉시 바꾸고, 0.5초 뒤 또는 칸을 벗어날 때 저장한다(overview 10-3).
// - 실행 취소 단위 = 저장 1회(체크포인트). 저장 전에는 대기 중인 저장을 먼저 끝낸다.
import { create } from "zustand";
import { normalizeCell } from "../../domain/items";
import type { ItemDraft } from "../../domain/types";
import { addWeeks, dayIndex, weekDays, weekIdOf, type DateStr, type WeekId } from "../../domain/week";
import { uuidv7 } from "../../data/ids";
import { cellKey, ValidationError, type JournalRepository, type WeekView } from "../../data/repository";
import type { CategoryColorKey } from "../../shared/palette";
import { STR } from "../../shared/strings";

export const SAVE_DELAY_MS = 500;
export const UNDO_LIMIT = 50;
export const TOAST_MS = 5000;

export type FocusTarget =
  | { kind: "item"; key: string; index: number; caret: "start" | "end" | number }
  | { kind: "memo"; date: DateStr };

export interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
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
  memos: Record<DateStr, string>;
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
}

const MEMO_PREFIX = "memo|";

// 화면 밖 상태(렌더링과 무관)
let repo: JournalRepository | null = null;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const persistedCells = new Map<string, ItemDraft[]>();
const persistedMemos = new Map<DateStr, string>();
const undoStack: UndoEntry[] = [];
const redoStack: UndoEntry[] = [];
let toastSeq = 0;

const sameItems = (a: ItemDraft[], b: ItemDraft[]) =>
  a.length === b.length &&
  a.every((x, i) => x.id === b[i]!.id && x.depth === b[i]!.depth && x.text === b[i]!.text);

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
  memos: {},
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

async function track<T>(work: () => Promise<T>): Promise<T> {
  set((s) => ({ saving: s.saving + 1 }));
  try {
    return await work();
  } finally {
    set((s) => ({ saving: s.saving - 1 }));
  }
}

export function toast(message: string, action?: Toast["action"]) {
  const id = ++toastSeq;
  set((s) => ({ toasts: [...s.toasts, { id, message, action }] }));
  setTimeout(() => dismissToast(id), TOAST_MS);
}

export function dismissToast(id: number) {
  set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

function reportError(e: unknown) {
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
}

async function persistCell(key: string) {
  timers.delete(key);
  const current = get().cells[key];
  if (!current) return;
  const before = persistedCells.get(key) ?? [];
  const after = normalizeCell(current);
  if (sameItems(before, after)) return;
  const { date, categoryId } = splitKey(key);
  try {
    await track(() => requireRepo().saveCell(date, categoryId, after));
  } catch (e) {
    markFailed(key, true);
    reportError(e);
    return;
  }
  persistedCells.set(key, after);
  markFailed(key, false);
  const entry: UndoEntry = { undo: () => applyCell(key, before), redo: () => applyCell(key, after) };
  pushUndo(entry);
  const keptIds = new Set(after.map((i) => i.id));
  const lost = before.filter((i) => !keptIds.has(i.id) && i.text.trim()).length;
  if (lost > 0) toast(STR.toast.itemsDeleted(lost), { label: STR.toast.undo, run: () => void undo() });
}

// ── 메모 저장 ──────────────────────────────────────────
async function applyMemo(date: DateStr, text: string) {
  const k = MEMO_PREFIX + date;
  const t = timers.get(k);
  if (t) clearTimeout(t);
  timers.delete(k);
  if (date in get().memos || get().view?.days.includes(date))
    set((s) => ({ memos: { ...s.memos, [date]: text } }));
  await track(() => requireRepo().saveMemo(date, text));
  persistedMemos.set(date, text.trim() ? text : "");
}

async function persistMemo(date: DateStr) {
  const k = MEMO_PREFIX + date;
  timers.delete(k);
  const text = get().memos[date] ?? "";
  const before = persistedMemos.get(date) ?? "";
  const after = text.trim() ? text : "";
  if (before === after) return;
  try {
    await track(() => requireRepo().saveMemo(date, after));
  } catch (e) {
    markFailed(k, true);
    reportError(e);
    return;
  }
  persistedMemos.set(date, after);
  markFailed(k, false);
  pushUndo({ undo: () => applyMemo(date, before), redo: () => applyMemo(date, after) });
}

function schedule(key: string, run: () => Promise<void>) {
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
  for (const k of keys) {
    if (k.startsWith(MEMO_PREFIX)) await persistMemo(k.slice(MEMO_PREFIX.length));
    else await persistCell(k);
  }
}

// ── 주 불러오기·이동 ───────────────────────────────────
async function loadWeek(weekId: WeekId, focusDay: DateStr) {
  const r = requireRepo();
  await flushAll();
  const today = r.today();
  const view = await r.getWeek(weekId);
  const settings = await r.getSettings();
  const nudges = weekId === weekIdOf(today) ? await r.getNudges(weekId) : [];
  const cells: Record<string, ItemDraft[]> = {};
  persistedCells.clear();
  for (const vc of view.categories) {
    for (const day of view.days) {
      const key = cellKey(day, vc.category.id);
      const drafts = (view.items[key] ?? []).map((i) => ({ id: i.id, depth: i.depth, text: i.text }));
      cells[key] = drafts;
      persistedCells.set(key, drafts);
    }
  }
  persistedMemos.clear();
  for (const day of view.days) persistedMemos.set(day, view.memos[day] ?? "");
  set({
    ready: true,
    today,
    weekId,
    focusDay,
    view,
    cells,
    memos: { ...view.memos },
    nudges,
    nudgeWeeks: settings.nudgeWeeks,
  });
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
  await loadWeek(weekIdOf(today), today);
  focusStartCell();
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

export async function goToday() {
  const today = requireRepo().today();
  await loadWeek(weekIdOf(today), today);
  focusStartCell();
}

export function setFocusDay(day: DateStr) {
  set({ focusDay: day });
}

/** 포커스 열의 첫 업무 칸(기록이 있으면 마지막 항목 끝)으로 커서. 업무가 없으면 업무 추가 입력칸. */
export function focusStartCell() {
  const { view, focusDay, cells } = get();
  const first = view?.categories.find((c) => c.state === "active") ?? view?.categories[0];
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

export function editMemo(date: DateStr, text: string) {
  set((s) => ({ memos: { ...s.memos, [date]: text } }));
  schedule(MEMO_PREFIX + date, () => persistMemo(date));
}

export async function leaveMemo(date: DateStr) {
  const k = MEMO_PREFIX + date;
  if (timers.has(k)) {
    clearTimeout(timers.get(k)!);
    await persistMemo(date);
  }
}

export async function retryFailed() {
  const failed = get().failed;
  for (const k of failed) {
    if (k.startsWith(MEMO_PREFIX)) await persistMemo(k.slice(MEMO_PREFIX.length));
    else await persistCell(k);
  }
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
    await track(() => requireRepo().createCategory(name, get().weekId));
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

/** 보드에 보이는 순서 기준으로 순서를 바꾼다. 보이지 않는 업무는 뒤에 그대로 둔다. */
export async function reorderVisible(idsInOrder: string[]) {
  const all = (await requireRepo().listCategories()).categories.map((c) => c.id);
  const before = all;
  const rest = all.filter((id) => !idsInOrder.includes(id));
  const after = [...idsInOrder, ...rest];
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
  const ids = (get().view?.categories ?? []).map((c) => c.category.id);
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

// ── 연간 보기 ──────────────────────────────────────────
export function setYearOpen(open: boolean) {
  set({ yearOpen: open });
}

export function yearDensity(isoYear: number) {
  return requireRepo().getYearDensity(isoYear);
}
