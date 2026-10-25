// 주간 보드 화면 상태 + 저장 흐름. 영속 데이터는 JournalRepository만 거친다(CLAUDE.md 4-3).
// - 셀 편집은 화면 상태(cells)를 즉시 바꾸고, 0.5초 뒤 또는 칸을 벗어날 때 저장한다(overview 10-3).
// - 실행 취소 단위 = 저장 1회(체크포인트). 저장 전에는 대기 중인 저장을 먼저 끝낸다.
import { create } from "zustand";
import { normalizeCell } from "../../domain/items";
import { groupRange, type Recurrence } from "../../domain/recurrence";
import type { ImportantItem, ItemDraft } from "../../domain/types";
import {
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

export type FocusTarget =
  | { kind: "item"; key: string; index: number; caret: "start" | "end" | number }
  | { kind: "memo"; date: DateStr };

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
  important: [],
  recentDone: [],
  panelOpen: false,
  panelFocus: false,
  pulseId: null,
  repeating: [],
  previews: {},
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
  if (before.some((i) => i.flagged) || after.some((i) => i.flagged)) void refreshImportant();
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
    repeating: rules.filter((x) => x.endWeek === null).map((x) => x.id),
    previews,
  });
  await refreshImportant();
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
