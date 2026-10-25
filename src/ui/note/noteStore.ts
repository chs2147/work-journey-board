// 주간 메모 상태(weekly-note-spec 4절): 보드에서 보고 있는 주의 메모 문서 1개, 자동 저장, 상자 단위 실행 취소, 도크.
// - 상자 안 글의 실행 취소는 편집기(상자마다)가, 상자 만들기·옮기기·크기·삭제는 여기의 메모 기록이 맡는다.
// - 영속 데이터는 저장소만 거친다(CLAUDE.md 4-3). 저장한 적 없는 주의 예전 요일 메모는 처음 저장할 때 옮겨진다.
import { create } from "zustand";
import {
  BOX_DEFAULT_W,
  clampWidth,
  emptyContent,
  emptyDoc,
  isNoteEmpty,
  positionBelow,
  readingOrder,
  snap,
  topZ,
  type NoteBg,
  type NoteBox,
  type NoteDoc,
  type PMNode,
} from "../../domain/note";
import type { WeekId } from "../../domain/week";
import { uuidv7 } from "../../data/ids";
import type { JournalRepository } from "../../data/repository";
import { NOTE_DOCK_MIN } from "../../data/settings";
import { STR } from "../../shared/strings";
import {
  focusStartCell,
  reportError,
  SAVE_DELAY_MS,
  toast,
  track,
  UNDO_LIMIT,
  useBoard,
} from "../board/boardStore";

export interface NoteState {
  weekId: WeekId;
  doc: NoteDoc;
  /** 아직 저장한 적 없는 주의 예전 요일 메모를 보여 주는 중 */
  legacy: boolean;
  /** 글을 편집 중인 상자 */
  editingId: string | null;
  /** 선택된 상자(Esc로 편집을 끝낸 상태 — 방향키 이동·Delete) */
  selectedId: string | null;
  /** 편집기에 커서를 넣어 달라는 요청(상자 id + 회차) */
  focusRequest: { id: string; n: number } | null;
  dockHeight: number;
  collapsed: boolean;
  /** [크게 보기] — 메모가 보드 영역 전체를 덮는다 */
  expanded: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

export const useNote = create<NoteState>(() => ({
  weekId: "",
  doc: emptyDoc(),
  legacy: false,
  editingId: null,
  selectedId: null,
  focusRequest: null,
  dockHeight: 280,
  collapsed: false,
  expanded: false,
  canUndo: false,
  canRedo: false,
}));

const set = useNote.setState;
const get = useNote.getState;

let repo: JournalRepository | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;
let focusSeq = 0;
/** 마지막으로 글을 고친 상자(Alt+M으로 돌아갈 자리) */
let lastEditedId: string | null = null;
const undoStack: NoteDoc[] = [];
const redoStack: NoteDoc[] = [];

const syncUndo = () => set({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 });

export async function initNote(r: JournalRepository) {
  repo = r;
  const s = await r.getSettings();
  set({ dockHeight: s.ui.noteDockHeight, collapsed: s.ui.noteDockCollapsed, expanded: false });
  await loadWeek(useBoard.getState().weekId);
  unsubscribe?.();
  unsubscribe = useBoard.subscribe((st, prev) => {
    if (st.weekId !== prev.weekId) void loadWeek(st.weekId);
  });
}

async function loadWeek(weekId: WeekId) {
  if (!repo || !weekId) return;
  await flushNote();
  try {
    const { doc, legacy } = await repo.getWeekNote(weekId);
    if (useBoard.getState().weekId !== weekId) return;
    undoStack.length = 0;
    redoStack.length = 0;
    lastEditedId = null;
    set({ weekId, doc, legacy, editingId: null, selectedId: null, focusRequest: null });
    syncUndo();
  } catch (e) {
    reportError(e);
  }
}

// ── 저장 ──────────────────────────────────────────────
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flushNote(true), SAVE_DELAY_MS);
}

/** 대기 중인 저장을 지금 끝낸다(주 이동·창 닫기·내보내기 전에). force = 타이머 없이도 저장 */
export async function flushNote(force = false) {
  if (!saveTimer && !force) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  const r = repo;
  const { weekId, doc } = get();
  if (!r || !weekId) return;
  try {
    await track(() => r.saveWeekNote(weekId, doc));
    if (get().weekId === weekId) set({ legacy: false });
  } catch (e) {
    reportError(e);
  }
}

/** 문서를 바꾼다. undoable이면 바꾸기 전 문서를 메모 기록에 쌓는다 */
function commit(next: NoteDoc, undoable: boolean) {
  if (undoable) {
    undoStack.push(get().doc);
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack.length = 0;
    syncUndo();
  }
  set({ doc: next });
  scheduleSave();
}

const mapBox = (id: string, f: (b: NoteBox) => NoteBox): NoteDoc => {
  const doc = get().doc;
  return { ...doc, boxes: doc.boxes.map((b) => (b.id === id ? f(b) : b)) };
};
const boxOf = (id: string) => get().doc.boxes.find((b) => b.id === id);

// ── 상자 ──────────────────────────────────────────────
/** 그 자리(8px 맞춤)에 새 텍스트 상자를 만들고 바로 편집 */
export function addBox(x: number, y: number): string {
  const doc = get().doc;
  const box: NoteBox = {
    id: uuidv7(),
    kind: "text",
    x: snap(x),
    y: snap(y),
    w: BOX_DEFAULT_W,
    z: topZ(doc) + 1,
    bg: null,
    content: emptyContent(),
  };
  commit({ ...doc, boxes: [...doc.boxes, box] }, true);
  requestFocus(box.id);
  return box.id;
}

/** 가장 아래 상자 아래에 새 상자(Ctrl+Enter·[+ 텍스트 상자]) */
export function addBoxBelow(): string {
  const { x, y } = positionBelow(get().doc);
  return addBox(x, y);
}

export function requestFocus(id: string) {
  set({ editingId: id, selectedId: null, focusRequest: { id, n: ++focusSeq } });
}

/** 편집기 글이 바뀜(상자 안 실행 취소는 편집기가 맡아 메모 기록에 넣지 않는다) */
export function updateContent(id: string, content: PMNode) {
  lastEditedId = id;
  commit(
    mapBox(id, (b) => ({ ...b, content })),
    false,
  );
}

export function setEditing(id: string | null) {
  set(id ? { editingId: id, selectedId: null } : { editingId: null });
}

/** 편집 끝 — 빈 상자는 저절로 없앤다(빈 상자가 쌓이지 않게, 스펙 4-2) */
export function endEditing(id: string, select = false) {
  const box = boxOf(id);
  if (box && isNoteEmpty({ v: 1, boxes: [box] })) {
    const doc = get().doc;
    // 방금 만든 빈 상자는 기록 없이 지운다(만들기 기록도 함께 되돌림)
    const prev = undoStack.at(-1);
    if (prev && !prev.boxes.some((b) => b.id === id)) {
      undoStack.pop();
      syncUndo();
    }
    commit({ ...doc, boxes: doc.boxes.filter((b) => b.id !== id) }, false);
    set({ editingId: null, selectedId: null });
    return;
  }
  set({
    editingId: get().editingId === id ? null : get().editingId,
    selectedId: select ? id : get().selectedId,
  });
}

export function selectBox(id: string | null) {
  set({ selectedId: id, editingId: id ? null : get().editingId });
}

/** 끌기·크기 조절 같은 연속 동작: 시작할 때 문서를 기억해 두고, 끝날 때 바뀌었으면 한 번만 기록 */
export function beginGesture(): NoteDoc {
  return get().doc;
}
export function endGesture(before: NoteDoc) {
  if (before === get().doc) return;
  undoStack.push(before);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack.length = 0;
  syncUndo();
  scheduleSave();
}

export function moveBoxLive(id: string, x: number, y: number) {
  set({ doc: mapBox(id, (b) => ({ ...b, x: snap(x), y: snap(y) })) });
}
export function resizeBoxLive(id: string, w: number) {
  set({ doc: mapBox(id, (b) => ({ ...b, w: clampWidth(w) })) });
}

/** 방향키 이동(8px, Shift 32px) */
export function nudgeBox(id: string, dx: number, dy: number) {
  const b = boxOf(id);
  if (!b) return;
  commit(
    mapBox(id, (x) => ({ ...x, x: snap(b.x + dx), y: snap(b.y + dy) })),
    true,
  );
}

/** 화면에서 잰 높이 — 8px 넘게 달라졌을 때만 문서에 반영(저장은 하되 기록에는 넣지 않음) */
export function measureBox(id: string, h: number) {
  const b = boxOf(id);
  if (!b || Math.abs((b.h ?? 0) - h) < 8) return;
  set({ doc: mapBox(id, (x) => ({ ...x, h: Math.round(h) })) });
}

export function deleteBox(id: string) {
  const doc = get().doc;
  if (!doc.boxes.some((b) => b.id === id)) return;
  commit({ ...doc, boxes: doc.boxes.filter((b) => b.id !== id) }, true);
  set({ editingId: null, selectedId: null });
  toast(STR.note.deleted, { label: STR.toast.undo, run: () => undoNote() });
}

export function duplicateBox(id: string) {
  const b = boxOf(id);
  if (!b) return;
  const doc = get().doc;
  const copy: NoteBox = { ...b, id: uuidv7(), x: snap(b.x + 24), y: snap(b.y + 24), z: topZ(doc) + 1 };
  commit({ ...doc, boxes: [...doc.boxes, copy] }, true);
  set({ selectedId: copy.id, editingId: null });
}

export function bringToFront(id: string) {
  const top = topZ(get().doc);
  commit(
    mapBox(id, (b) => ({ ...b, z: top + 1 })),
    true,
  );
}

export function sendToBack(id: string) {
  const bottom = get().doc.boxes.reduce((m, b) => Math.min(m, b.z), 0);
  commit(
    mapBox(id, (b) => ({ ...b, z: bottom - 1 })),
    true,
  );
}

export function setBoxBg(id: string, bg: NoteBg | null) {
  commit(
    mapBox(id, (b) => ({ ...b, bg })),
    true,
  );
}

// ── 메모 기록(실행 취소) ──────────────────────────────
export function undoNote() {
  const prev = undoStack.pop();
  if (!prev) return;
  redoStack.push(get().doc);
  set({ doc: prev, editingId: null, selectedId: null });
  syncUndo();
  scheduleSave();
}

export function redoNote() {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(get().doc);
  set({ doc: next, editingId: null, selectedId: null });
  syncUndo();
  scheduleSave();
}

// ── 키보드 흐름·도크 ──────────────────────────────────
/** 메모로 가기(Alt+M·마지막 업무 칸 ↓): 마지막으로 고친 상자 끝, 없으면 읽는 순서 마지막 상자, 그것도 없으면 새 상자 */
export function focusNote() {
  if (get().collapsed) setCollapsed(false);
  const doc = get().doc;
  const target =
    (lastEditedId && doc.boxes.find((b) => b.id === lastEditedId)) || readingOrder(doc.boxes).at(-1);
  if (target) requestFocus(target.id);
  else addBoxBelow();
}

/** 메모에서 보드로(Alt+M·Esc 두 번) */
export function leaveNote() {
  const { editingId } = get();
  if (editingId) endEditing(editingId);
  set({ selectedId: null, expanded: false });
  focusStartCell();
}

export function setDockHeight(h: number) {
  const height = Math.max(NOTE_DOCK_MIN, Math.round(h));
  set({ dockHeight: height });
  void repo?.updateSettings({ ui: { noteDockHeight: height } }).catch(() => undefined);
}

export function setCollapsed(collapsed: boolean) {
  set({ collapsed, expanded: collapsed ? false : get().expanded });
  void repo?.updateSettings({ ui: { noteDockCollapsed: collapsed } }).catch(() => undefined);
}

export function setExpanded(expanded: boolean) {
  set({ expanded, collapsed: expanded ? false : get().collapsed });
}
