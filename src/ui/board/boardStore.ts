// 주간 보드 화면 상태 + 저장 흐름. 영속 데이터는 JournalRepository만 거친다(CLAUDE.md 4-3).
// - 셀 편집은 화면 상태(cells)를 즉시 바꾸고, 0.5초 뒤 또는 칸을 벗어날 때 저장한다(overview 10-3).
// - 실행 취소 단위 = 저장 1회(체크포인트). 저장 전에는 대기 중인 저장을 먼저 끝낸다.
import { create } from "zustand";
import type { DayMarkKind } from "../../domain/dayMark";
import { appendCopies, deleteRange, deleteAt, moveRows, normalizeCell } from "../../domain/items";
import { matchesTagFilter, NO_TAG, type Tag } from "../../domain/tags";
import type { VisibleCategory } from "../../domain/categories";
import { groupRange, type Recurrence } from "../../domain/recurrence";
import type { ImportantItem, ItemDraft } from "../../domain/types";
import {
  addDays,
  addWeeks,
  DAY_LABELS,
  dayIndex,
  shortDateLabel,
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
  type CopiedEntries,
  type RepeatPreview,
  type WeekView,
} from "../../data/repository";
import type { CategoryColorKey } from "../../shared/palette";
import { STR } from "../../shared/strings";
import type { DayMarkInfo } from "../../data/repository";
import { loadPanelWidths } from "../common/panelWidths";
import { loadColWidths } from "./colWidths";

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
  memoLinks: { entryId: string; weekId: WeekId; boxId: string; taskCategoryId?: string }[];
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
  /** 마지막으로 저장을 마친 시각 `14:03`(저장됨 표시 툴팁, improve-1027v5-spec 2절) */
  savedAt: string | null;
  failed: string[];
  canUndo: boolean;
  canRedo: boolean;
  toasts: Toast[];
  focus: FocusTarget | null;
  yearOpen: boolean;
  /** "+ 업무 추가" 입력칸이 열려 있는가 */
  addOpen: boolean;
  /** 중요 업무(모든 주, 처리 전) — important-repeat-spec 2절 · 보고 있는 주에 처리 완료한 항목 — improve-1027v4-spec 4절 */
  important: ImportantItem[];
  weekDone: ImportantItem[];
  weekDoneOpen: boolean;
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
  /** 표시 이름·출처(공휴일·휴가 사유·내장/회사 휴일) */
  dayMarkInfo: Record<DateStr, DayMarkInfo>;
  /** 포커스 열 기준 업무별 직전 기록일(빈 칸의 가져오기 단추, spec 3-2) — 키: 업무 id */
  prevDates: Record<string, DateStr>;
  prevExcluded: Record<string, number>;
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
      Boolean(x.flagged) === Boolean(b[i]!.flagged) &&
      (x.flagDoneAt ?? null) === (b[i]!.flagDoneAt ?? null) &&
      (x.completionWasFlagged ?? true) === (b[i]!.completionWasFlagged ?? true) &&
      (x.startTime ?? null) === (b[i]!.startTime ?? null) &&
      (x.dueDate ?? null) === (b[i]!.dueDate ?? null),
  );

export const splitKey = (key: string) => {
  const i = key.indexOf("|");
  return { date: key.slice(0, i), categoryId: key.slice(i + 1) };
};

export const newDraft = (text = "", depth: 0 | 1 = 0): ItemDraft => ({ id: uuidv7(), depth, text });

export const useBoard = create<BoardState>(() => ({
  memoLinks: [],
  ready: false,
  today: "",
  weekId: "",
  focusDay: "",
  view: null,
  cells: {},
  nudges: [],
  nudgeWeeks: 3,
  saving: 0,
  savedAt: null,
  failed: [],
  canUndo: false,
  canRedo: false,
  toasts: [],
  focus: null,
  yearOpen: false,
  addOpen: false,
  important: [],
  weekDone: [],
  weekDoneOpen: true,
  panelOpen: false,
  panelFocus: false,
  pulseId: null,
  repeating: [],
  previews: {},
  dayMarks: {},
  dayMarkInfo: {},
  prevDates: {},
  prevExcluded: {},
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
    const d = new Date();
    const at = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    set((s) => ({ saving: s.saving - 1, savedAt: s.saving === 1 ? at : s.savedAt }));
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
  const r = requireRepo();
  const removedIds = before.filter((i) => !after.some((j) => j.id === i.id)).map((i) => i.id);
  if (removedIds.length) {
    const { flushNote } = await import("../note/noteStore");
    await flushNote();
    if (repo !== r) return false;
  }
  const relations = removedIds.length ? await r.itemRelations(removedIds) : { notes: [], cabinet: [] };
  if (repo !== r) return false;
  try {
    await track(() => r.saveCell(date, categoryId, after));
  } catch (e) {
    markFailed(key, true);
    reportError(e);
    return false;
  }
  if (repo !== r) return false;
  persistedCells.set(key, after);
  markFailed(key, false);
  if (date < get().focusDay) void refreshPrevDates();
  if (before.some((i) => i.flagged) || after.some((i) => i.flagged)) void refreshImportant();
  const entry: UndoEntry = {
    undo: async () => {
      await applyCell(key, before);
      await r.restoreItemRelations(relations);
      await refreshLinkedObjects();
    },
    redo: async () => {
      await applyCell(key, after);
      await refreshLinkedObjects();
    },
  };
  pushUndo(entry);
  const keptIds = new Set(after.map((i) => i.id));
  const lost = before.filter((i) => !keptIds.has(i.id) && i.text.trim()).length;
  if (lost > 0) await refreshLinkedObjects();
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

/** 여러 칸을 한 batch로 저장하고 상태를 맞춘다(끌어서 옮기기·그 실행 취소/다시 실행). list는 받는 칸을 먼저 */
async function applyCells(list: [string, ItemDraft[]][]) {
  for (const [key] of list) {
    const t = timers.get(key);
    if (t) clearTimeout(t);
    timers.delete(key);
  }
  set((s) => {
    const cells = { ...s.cells };
    for (const [key, items] of list) if (key in cells) cells[key] = items;
    return { cells };
  });
  await track(() =>
    requireRepo().saveCells(list.map(([key, items]) => ({ ...splitKey(key), items: normalizeCell(items) }))),
  );
  for (const [key, items] of list) persistedCells.set(key, normalizeCell(items));
  void refreshImportant();
  void refreshPrevDates();
}

/**
 * 행 끌어서 옮기기(improve-1026v2-spec 3절): fromKey 칸 fromIndex 항목(본 항목이면 세부 항목까지)을 toKey 칸 gap 틈으로.
 * 같은 칸이면 지금 칸 저장과 같은 길, 다른 칸이면 두 칸을 한 batch(saveCells, 받는 칸 먼저)로 → 실행 취소 1단계.
 * 항목 id가 그대로라 ★·처리 완료·매주 반복 연결·가져오기 묶음이 따라간다.
 */
export async function moveRowsTo(fromKey: string, fromIndex: number, toKey: string, gap: number) {
  await flushAll();
  const cells = get().cells;
  const src = cells[fromKey] ?? [];
  const same = fromKey === toKey;
  const r = moveRows(src, fromIndex, same ? null : (cells[toKey] ?? []), gap);
  if (!r) return;
  const movedId = r.moved[0]!.id;
  const pulse = () => {
    set({ pulseId: movedId });
    setTimeout(() => {
      if (get().pulseId === movedId) set({ pulseId: null });
    }, PULSE_MS);
  };
  if (same) {
    set((s) => ({ cells: { ...s.cells, [fromKey]: r.src } }));
    await persistCell(fromKey);
    pulse();
    return;
  }
  const before: [string, ItemDraft[]][] = [
    [fromKey, persistedCells.get(fromKey) ?? []],
    [toKey, persistedCells.get(toKey) ?? []],
  ];
  const after: [string, ItemDraft[]][] = [
    [toKey, r.dst],
    [fromKey, r.src],
  ];
  try {
    await applyCells(after);
  } catch (e) {
    reportError(e);
    set((s) => ({ cells: { ...s.cells, [fromKey]: before[0]![1], [toKey]: before[1]![1] } }));
    return;
  }
  pushUndo({ undo: () => applyCells(before), redo: () => applyCells(after) });
  if (splitKey(toKey).date !== get().focusDay) setFocusDay(splitKey(toKey).date);
  pulse();
}

function schedule(key: string, run: () => Promise<unknown>) {
  if (!repo) return; // 일지를 바꾸는 중(연결 끊김) — 다음 일지에 이전 칸을 쓰지 않는다(v1.8.1)
  const t = timers.get(key);
  if (t) clearTimeout(t);
  timers.set(
    key,
    setTimeout(() => void run(), SAVE_DELAY_MS),
  );
}

/** 대기 중인 저장을 모두 지금 실행한다(주 이동·실행 취소·종료 전에). */
const categoryWrites = new Set<Promise<unknown>>();
export async function flushAll() {
  await Promise.allSettled([...categoryWrites]);
  const keys = [...timers.keys()];
  for (const k of keys) {
    clearTimeout(timers.get(k)!);
    timers.delete(k);
  }
  for (const k of keys) await persistCell(k);
}

// ── 주 불러오기·이동 ───────────────────────────────────
/** 불러오기 차례 — Alt+← 연타처럼 앞선 불러오기가 끝나기 전에 다음 주로 가면 앞선 결과는 버리고 마지막 주만 그린다(optimize-1031-plan O3) */
let loadSeq = 0;
/** 불러오는 중인 주(연타 시 다음 이동의 기준) */
let loading: { weekId: WeekId; focusDay: DateStr } | null = null;

async function loadWeek(weekId: WeekId, focusDay: DateStr) {
  const r = requireRepo();
  const seq = ++loadSeq;
  loading = { weekId, focusDay };
  if (get().weekId !== weekId) set({ addOpen: false });
  const stale = () => seq !== loadSeq;
  try {
    await loadWeekNow(r, weekId, focusDay, stale);
  } finally {
    if (!stale()) loading = null;
  }
}

async function loadWeekNow(r: JournalRepository, weekId: WeekId, focusDay: DateStr, stale: () => boolean) {
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
  if (stale()) return;
  // 메모 문서는 메모 도크(noteStore)가 따로 읽는다 — 보드는 읽지 않음
  const view = await r.getWeek(weekId, { note: false });
  const memoLinks = await r.linkedMemos(Object.values(view.items).flatMap((a) => a.map((i) => i.id)));
  const rules: Recurrence[] = await r.listRecurrences();
  const previews: Record<string, RepeatPreview[]> = {};
  if (weekId > current) {
    for (const p of await r.previewWeek(weekId))
      (previews[cellKey(p.date, p.rule.categoryId)] ??= []).push(p);
  }
  const settings = await r.getSettings();
  const nudges = weekId === weekIdOf(today) ? await r.getNudges(weekId) : [];
  const [tags, categoryTags] = await Promise.all([r.listTags(), r.getCategoryTags()]);
  if (stale()) return;
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
        completionWasFlagged: i.completionWasFlagged,
        recurrenceId: i.recurrenceId,
        startTime: i.startTime ?? null,
        dueDate: i.dueDate ?? null,
      }));
      cells[key] = drafts;
      persistedCells.set(key, drafts);
    }
  }
  set({
    memoLinks,
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
    dayMarkInfo: view.dayMarkInfo,
    tags,
    categoryTags,
    tagFilter: liveFilter(get().tagFilter, tags),
  });
  await Promise.all([refreshImportant(), refreshPrevDates()]);
  if (created > 0) toast(STR.repeat.created(created));
}

/** 다음 이동의 기준 — 불러오는 중이면 그 주(연타해도 한 주씩 쌓이게) */
const baseWeek = () => loading ?? get();

/** 같은 요일을 유지하며 주를 옮긴다. 이번 주로 오면 오늘로. */
function focusDayFor(weekId: WeekId, preferIndex: number, today: DateStr): DateStr {
  if (weekId === weekIdOf(today)) return today;
  return weekDays(weekId)[preferIndex]!;
}

/**
 * 일지를 닫기 직전(공간 전환·복원·다시 열기): flushAll 뒤에 부른다. 남은 예약 저장을 버리고 연결을 끊어
 * 이전 일지의 칸이 다음 일지에 저장되지 않게 한다(v1.8.1 — 칸 키의 업무 id는 일지마다 다르다).
 */
export function detachBoard() {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  persistedCells.clear();
  loadSeq++; // 진행 중인 주 불러오기 결과는 버린다
  loading = null;
  repo = null;
  set({ memoLinks: [], addOpen: false, prevDates: {}, prevItems: {}, prevExcluded: {} });
  undoStack.length = 0;
  redoStack.length = 0;
  syncUndoFlags();
}

export async function init(r: JournalRepository) {
  repo = r;
  undoStack.length = 0;
  redoStack.length = 0;
  const today = r.today();
  const ui = (await r.getSettings()).ui;
  set({ tagFilter: ui.tagFilter, viewMode: ui.viewMode, weekDoneOpen: ui.weekDoneOpen });
  loadPanelWidths(ui);
  loadColWidths(ui);
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
  const weekId = get().weekId;
  const [important, weekDone] = await Promise.all([r.listImportant(), r.listDoneInWeek(weekId)]);
  if (get().weekId === weekId) set({ important, weekDone });
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

/** 시작 시각 정하기·지우기(improve-1103v8-spec T1) — 칸 저장과 같은 길(실행 취소 1단계) */
export async function setStartTime(key: string, index: number, time: string | null) {
  const items = get().cells[key];
  const item = items?.[index];
  if (!items || !item || !item.text.trim()) return;
  if ((item.startTime ?? null) === time) return;
  const next = items.map((it, i) => (i === index ? { ...it, startTime: time } : it));
  set((s) => ({ cells: { ...s.cells, [key]: next } }));
  const t = timers.get(key);
  if (t) clearTimeout(t);
  await persistCell(key);
}

/**
 * 마감일 정하기·지우기(improve-1104v10-spec D1) — 정하면 ★ 중요 표시도 함께 켠다(지워도 ★는 그대로).
 * 칸 저장과 같은 길(실행 취소 1단계)
 */
export async function setDueDate(key: string, index: number, date: string | null) {
  const items = get().cells[key];
  const item = items?.[index];
  if (!items || !item || !item.text.trim()) return;
  if ((item.dueDate ?? null) === date) return;
  const next = items.map((it, i) =>
    i === index
      ? { ...it, dueDate: date, ...(date && !it.flagged ? { flagged: true, flagDoneAt: null } : {}) }
      : it,
  );
  set((s) => ({ cells: { ...s.cells, [key]: next } }));
  const t = timers.get(key);
  if (t) clearTimeout(t);
  await persistCell(key);
  void refreshImportant();
}

/**
 * 다른 날로 옮기기(improve-1103v8-spec T4): 항목(본 항목이면 세부 항목까지)을 같은 업무의 date 칸 맨 아래로.
 * 다른 주의 칸은 저장소에서 읽어 붙이고, 두 칸을 한 batch(받는 칸 먼저) → 실행 취소 1단계.
 * 항목 id가 그대로라 ★·처리 완료·시작 시각·매주 반복·Cabinet·메모 연결이 따라간다.
 */
export async function moveItemToDate(fromKey: string, index: number, date: DateStr) {
  await flushAll();
  const src = get().cells[fromKey] ?? [];
  const item = src[index];
  if (!item || !item.text.trim()) return;
  const { date: fromDate, categoryId } = splitKey(fromKey);
  if (date === fromDate) return;
  const toKey = cellKey(date, categoryId);
  let dst = get().cells[toKey];
  let dstSaved = persistedCells.get(toKey);
  if (!dst) {
    const rows = await requireRepo().getCategoryEntries(categoryId, date, date);
    dst = rows.map((i) => ({
      id: i.id,
      depth: i.depth,
      text: i.text,
      flagged: i.flagged,
      flagDoneAt: i.flagDoneAt,
      completionWasFlagged: i.completionWasFlagged,
      recurrenceId: i.recurrenceId,
      startTime: i.startTime ?? null,
      dueDate: i.dueDate ?? null,
    }));
    dstSaved = dst;
  }
  const r = moveRows(src, index, normalizeCell(dst), Number.MAX_SAFE_INTEGER);
  if (!r) return;
  // 세부 항목 하나만 옮기면 옮긴 날에서 본 항목(남의 본 항목 밑으로 들어가지 않게)
  if (item.depth === 1) r.dst = r.dst.map((x) => (x.id === item.id ? { ...x, depth: 0 as const } : x));
  const before: [string, ItemDraft[]][] = [
    [fromKey, persistedCells.get(fromKey) ?? []],
    [toKey, dstSaved ?? []],
  ];
  const after: [string, ItemDraft[]][] = [
    [toKey, r.dst],
    [fromKey, r.src],
  ];
  try {
    await applyCells(after);
  } catch (e) {
    reportError(e);
    return;
  }
  pushUndo({ undo: () => applyCells(before), redo: () => applyCells(after) });
  void refreshImportant();
  const subs = r.moved.length - 1;
  const movedId = r.moved[0]!.id;
  toast(STR.moveDate.done(STR.moveDate.what(Boolean(item.flagged), subs), shortDateLabel(date)), [
    { label: STR.moveDate.goThere, run: () => void revealItem({ id: movedId, date, categoryId }) },
    { label: STR.toast.undo, run: () => void undo() },
  ]);
}

/** 화면에 있는 같은 항목의 표시를 저장본과 맞춘다(목록에서 처리·되돌리기 후). */
function patchLocalItem(
  id: string,
  marks: Pick<ItemDraft, "flagged" | "flagDoneAt" | "completionWasFlagged">,
) {
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
export async function completeImportant(id: string, strict = false) {
  const r = requireRepo();
  await flushAll();
  if (repo !== r) return;
  let completion: Awaited<ReturnType<JournalRepository["completeFlag"]>>;
  try {
    completion = await track(() => r.completeFlag(id));
  } catch (e) {
    if (strict) throw e;
    reportError(e);
    return;
  }
  if (repo !== r || !completion) return;
  patchLocalItem(id, {
    flagged: false,
    flagDoneAt: completion.at,
    completionWasFlagged: completion.wasImportant,
  });
  await refreshImportant();
  void refreshPrevDates();
  toast(STR.important.completed, { label: STR.toast.undo, run: () => void undoImportant(id) });
  return completion;
}

export async function undoImportant(id: string, strict = false) {
  const r = requireRepo();
  await flushAll();
  if (repo !== r) return;
  let wasImportant: boolean;
  try {
    wasImportant = await track(() => r.undoComplete(id));
  } catch (e) {
    if (strict) throw e;
    reportError(e);
    return;
  }
  if (repo !== r) return;
  patchLocalItem(id, { flagged: wasImportant, flagDoneAt: null });
  await refreshImportant();
  void refreshPrevDates();
}

/** 목록 항목으로 이동: 그 주·그 요일로 가서 그 항목 입력칸에 커서(글 끝) + 잠깐 강조 */
export async function revealItem(it: Pick<ImportantItem, "id" | "date" | "categoryId">) {
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

/**
 * 히트맵 칸 → 보드의 그 날·그 업무 칸 첫 항목(m3-s2-spec 7절). 그 주에 보드에 없는 업무(태그 필터·종료)이거나
 * 업무를 주지 않으면(모든 업무) 그 날의 첫 업무 칸
 */
export async function revealCell(date: DateStr, categoryId: string | null) {
  const wk = weekIdOf(date);
  if (wk !== get().weekId) await loadWeek(wk, date);
  else setFocusDay(date);
  const shown = categoryId && shownCategories(get()).some((c) => c.category.id === categoryId);
  if (shown) enterCell(cellKey(date, categoryId), "above");
  else focusStartCell();
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

/** 패널 아래 "이 주 완료" 펼침(improve-1027v4-spec 4절) — 기억 */
export function setWeekDoneOpen(open: boolean) {
  if (get().weekDoneOpen === open) return;
  set({ weekDoneOpen: open });
  void repo?.updateSettings({ ui: { weekDoneOpen: open } }).catch(() => undefined);
}

export async function reload() {
  const { weekId, focusDay } = get();
  await loadWeek(weekId, focusDay);
}

export async function goWeek(delta: number) {
  const { weekId, focusDay } = baseWeek();
  const { today } = get();
  const next = addWeeks(weekId, delta);
  await loadWeek(next, focusDayFor(next, dayIndex(focusDay), today));
}

export async function goToWeek(weekId: WeekId) {
  const { focusDay } = baseWeek();
  const { today } = get();
  await loadWeek(weekId, focusDayFor(weekId, dayIndex(focusDay), today));
}

/** 오늘 뷰의 하루 이동(◀ ▶·Alt+←/→, spec 8-1). 주를 넘으면 그 주를 불러온다 */
export async function goDay(delta: number) {
  const { focusDay, weekId } = baseWeek();
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

/** 포커스 열의 첫 업무 칸(기록이 있으면 마지막 항목 끝)으로 커서. 업무가 없으면 상단 업무 추가 버튼. */
export function focusStartCell() {
  const { focusDay, cells } = get();
  const cats = shownCategories(get());
  const first = cats.find((c) => c.state === "active") ?? cats[0];
  if (!first) {
    set({ focus: null });
    const source = repo;
    const generation = loadSeq;
    requestAnimationFrame(() => {
      // 첫 실행에서 업무를 만든 뒤 보드 입력칸에 준 포커스를 이전 빈 보드 요청이 빼앗지 않게 한다.
      if (repo !== source || loadSeq !== generation || shownCategories(get()).length || get().addOpen) return;
      document.querySelector<HTMLButtonElement>('[data-testid="category-add"]')?.focus();
    });
    return;
  }
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

/** v11: 업무·새 태그·연결을 한 트랜잭션으로 생성하고 원래 주/공간에서만 화면 갱신. */
export async function addCategoryWithTags(
  name: string,
  tagIds: string[],
  newTags: string[],
  signal: AbortSignal,
) {
  const r = requireRepo();
  const weekId = get().weekId;
  const pending = track(() => r.createCategory(name, weekId, { tagIds, newTags, signal }));
  categoryWrites.add(pending);
  let category;
  try {
    category = await pending;
  } finally {
    categoryWrites.delete(pending);
  }
  if (repo !== r || get().weekId !== weekId || signal.aborted) return false;
  const assigned = (await r.getCategoryTags())[category.id] ?? [];
  if (repo !== r || get().weekId !== weekId || signal.aborted) return false;
  if (get().tagFilter.length && !matchesTagFilter(assigned, get().tagFilter)) {
    setTagFilter([]);
    toast(STR.categoryCreate.filterCleared);
  }
  await reload();
  return repo === r && get().weekId === weekId ? category.id : false;
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

/** 종료된 업무 다시 시작(인사이트 타임라인 머리 — m3-s1-spec 4-1). 되돌리기 = 다시 종료 */
export async function reactivateCategory(id: string, name: string) {
  await flushAll();
  await track(() => requireRepo().reactivateCategory(id));
  await reload();
  toast(STR.settings.reactivated(name), {
    label: STR.toast.undo,
    run: () => void archiveCategory(id),
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
export async function setDayMark(date: DateStr, kind: DayMarkKind | null, label: string | null = null) {
  const before = get().dayMarkInfo[date] ?? null;
  if (before?.source === "user" && before.kind === kind && (before.label ?? null) === (label ?? null)) return;
  if (!before && kind === null) return;
  const apply = async (k: DayMarkKind | null, l: string | null, restoreBuiltin = false) => {
    const r = requireRepo();
    await track(async () => {
      await r.setDayMark(date, k, l);
      if (restoreBuiltin) {
        // 내장 공휴일·회사 휴일로 되돌림(근무로 돌릴 때 더한 "끈 날짜"를 뺀다)
        const s = await r.getSettings();
        await r.updateSettings({ holiday: { off: s.holiday.off.filter((d) => d !== date) } });
      }
    });
    const info = await r.getDayMarkInfo(date, date);
    const { [date]: _a, ...marks } = get().dayMarks; // eslint-disable-line @typescript-eslint/no-unused-vars
    const { [date]: _b, ...infos } = get().dayMarkInfo; // eslint-disable-line @typescript-eslint/no-unused-vars
    const now = info[date];
    set({
      dayMarks: now ? { ...marks, [date]: now.kind } : marks,
      dayMarkInfo: now ? { ...infos, [date]: now } : infos,
    });
    // 직전 기록일은 종일 쉬는 날을 건너뛰므로 다시 찾는다
    void refreshPrevDates();
  };
  try {
    await apply(kind, label);
  } catch (e) {
    reportError(e);
    return;
  }
  const back =
    before === null
      ? () => apply(null, null)
      : before.source === "user"
        ? () => apply(before.kind, before.label)
        : () => apply(null, null, true);
  pushUndo({ undo: back, redo: () => apply(kind, label) });
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
    if (repo !== r || get().focusDay !== day) return;
    const prevDates: Record<string, DateStr> = {};
    const prevExcluded: Record<string, number> = {};
    const prevItems: BoardState["prevItems"] = {};
    for (const rec of recs)
      for (const [id, items] of Object.entries(rec.cells)) {
        prevDates[id] = rec.date;
        prevItems[id] = items;
        prevExcluded[id] = rec.excluded ?? 0;
      }
    set({ prevDates, prevItems, prevExcluded });
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
  await importPrevious([key], splitKey(key).date);
}

export async function pullPreviousDay(date: DateStr) {
  await importPrevious(
    activeCategoryIds().map((id) => cellKey(date, id)),
    date,
    true,
  );
}

async function importPrevious(keys: string[], date: DateStr, all = false) {
  await flushAll();
  const sourceRepo = requireRepo(),
    generation = loadSeq;
  const stale = () => repo !== sourceRepo || loadSeq !== generation;
  try {
    const { flushNote } = await import("../note/noteStore");
    await flushNote();
    if (stale()) return;
    const prev = await sourceRepo.previousRecord(
      date,
      keys.map((key) => splitKey(key).categoryId),
    );
    if (stale()) return;
    if (!prev || !Object.values(prev.cells).some((xs) => xs.length))
      return toast(prev?.excluded ? STR.itemCompletion.emptyPrevious : STR.pull.none);
    const cells: CopiedEntries["cells"] = [];
    const mapping: { source: string; target: string }[] = [];
    for (const key of keys) {
      const { categoryId } = splitKey(key);
      const result = appendCopies(get().cells[key] ?? [], prev.cells[categoryId] ?? [], uuidv7);
      if (!result.added) continue;
      cells.push({ date, categoryId, items: result.items });
      mapping.push(...result.mapping);
    }
    if (!cells.length) return toast(STR.pull.already(pullLabel(prev.date)));
    const copied = await track(() => sourceRepo.copyEntries(cells, mapping));
    if (stale()) return;
    await acceptCopied(copied, sourceRepo);
    if (stale()) return;
    if (!all) {
      const key = keys[0]!;
      set({ focus: { kind: "item", key, index: (get().cells[key]?.length ?? 1) - 1, caret: "end" } });
    } else setFocusDay(date);
    toast(
      (all
        ? STR.pull.doneAll(pullLabel(prev.date), mapping.length, cells.length)
        : STR.pull.done(pullLabel(prev.date), mapping.length)) +
        (prev.excluded ? ` · ${STR.itemCompletion.excluded(prev.excluded)}` : ""),
      { label: STR.toast.undo, run: () => void undo() },
    );
  } catch (e) {
    if (!stale()) reportError(e);
  }
}

/** Update relationships in place, keeping memo content and both independent undo stacks. */
export async function refreshLinkedObjects() {
  const r = repo,
    seq = loadSeq;
  if (!r) return;
  const ids = Object.values(get().cells).flatMap((xs) => xs.map((i) => i.id));
  const memoLinks = await r.linkedMemos(ids);
  if (repo !== r || seq !== loadSeq) return;
  set({ memoLinks });
  const [{ refreshNoteLinks }, { loadCabinet }] = await Promise.all([
    import("../note/noteStore"),
    import("../cabinet/cabinetStore"),
  ]);
  if (repo !== r || seq !== loadSeq) return;
  await refreshNoteLinks();
  await loadCabinet();
}

async function refreshCopiedCells(copy: CopiedEntries, r: JournalRepository) {
  const seq = loadSeq;
  const changes = await Promise.all(
    copy.cells.map(async (c) => ({
      key: cellKey(c.date, c.categoryId),
      items: await r.getCategoryEntries(c.categoryId, c.date, c.date),
    })),
  );
  if (repo !== r || seq !== loadSeq) return;
  set((s) => {
    const cells = { ...s.cells };
    for (const c of changes) {
      if (c.key in cells) cells[c.key] = c.items;
      persistedCells.set(c.key, c.items);
    }
    return { cells };
  });
  await refreshLinkedObjects();
  await refreshImportant();
  void refreshPrevDates();
}

async function acceptCopied(copy: CopiedEntries, r: JournalRepository) {
  await refreshCopiedCells(copy, r);
  if (repo !== r) return;
  pushUndo({
    undo: async () => {
      if (repo !== r) return;
      await r.undoCopiedEntries(copy);
      await refreshCopiedCells(copy, r);
    },
    redo: async () => {
      if (repo !== r) return;
      await r.redoCopiedEntries(copy);
      await refreshCopiedCells(copy, r);
    },
  });
}

export async function copyItemToDate(fromKey: string, itemId: string, date: DateStr, expected: string) {
  await flushAll();
  const r = requireRepo(),
    seq = loadSeq;
  const { flushNote } = await import("../note/noteStore");
  await flushNote();
  if (repo !== r || seq !== loadSeq) throw new ValidationError("화면이 변경되었습니다. 다시 선택해 주세요.");
  const src = get().cells[fromKey] ?? [];
  const index = src.findIndex((x) => x.id === itemId);
  const end = index < 0 ? index : deleteRange(src, index)[1];
  const originals = src.slice(index, end);
  if (index < 0 || JSON.stringify(originals) !== expected)
    throw new ValidationError("원본 항목이 변경되었습니다. 다시 선택해 주세요.");
  const { categoryId } = splitKey(fromKey);
  const target = await r.getCategoryEntries(categoryId, date, date);
  if (repo !== r || seq !== loadSeq) return false;
  const copies = originals.map((i, n): ItemDraft => ({
    id: uuidv7(),
    depth: n === 0 ? 0 : i.depth,
    text: i.text,
    flagged: i.flagDoneAt ? i.completionWasFlagged !== false : !!i.flagged,
    startTime: i.startTime,
    dueDate: i.dueDate,
  }));
  const mapping = originals.map((i, n) => ({ source: i.id, target: copies[n]!.id }));
  const copy = await track(() =>
    r.copyEntries([{ date, categoryId, items: [...target, ...copies] }], mapping),
  );
  if (repo !== r || seq !== loadSeq) return true;
  await acceptCopied(copy, r);
  toast(`${shortDateLabel(date)}에 항목 ${copies.length}개를 복제했습니다.`, [
    { label: STR.moveDate.goThere, run: () => void revealItem({ id: copies[0]!.id, date, categoryId }) },
    { label: STR.toast.undo, run: () => void undo() },
  ]);
  return true;
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
