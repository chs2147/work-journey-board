// 주간 메모 상태(weekly-note-spec 4절): 보드에서 보고 있는 주의 메모 문서 1개, 자동 저장, 상자 단위 실행 취소, 도크.
// - 상자 안 글의 실행 취소는 편집기(상자마다)가, 상자 만들기·옮기기·크기·삭제는 여기의 메모 기록이 맡는다.
// - 영속 데이터는 저장소만 거친다(CLAUDE.md 4-3). 저장한 적 없는 주의 예전 요일 메모는 처음 저장할 때 옮겨진다.
import { create } from "zustand";
import {
  BOX_DEFAULT_W,
  BOX_GAP,
  clampImageWidth,
  clampLinkWidth,
  clampWidth,
  cleanLinkText,
  makeLinkBox,
  emptyContent,
  emptyDoc,
  IMAGE_FIRST_W,
  isNoteEmpty,
  noteAssetIds,
  positionBelow,
  readingOrder,
  snap,
  topZ,
  CAPTION_MAX,
  boxEdges,
  cleanEdgeLabel,
  edgesOf,
  findEdge,
  withEdges,
  withoutBoxes,
  type EdgeDir,
  type NoteEdge,
  type ImageMime,
  type NoteBg,
  type NoteBox,
  type NoteDoc,
  type PMNode,
} from "../../domain/note";
import type { WeekId } from "../../domain/week";
import { clampZoom, stepZoom } from "../../domain/noteZoom";
import { uuidv7 } from "../../data/ids";
import type { JournalRepository } from "../../data/repository";
import { NOTE_DOCK_MIN } from "../../data/settings";
import { STR } from "../../shared/strings";
import { useAppStore } from "../common/appStore";
import { baseName, dirOf, exportPathProblem } from "../../platform";
import { exportImageBytes, ImageInputError, prepareImage } from "./imageProcess";
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
  /**
   * 빈 곳 클릭으로 연 "대기" 상자(improve-1026-spec 2절) — 커서 자리만 보이고 첫 글자를 칠 때 상자가 된다.
   * 문서에는 들어 있지만 메모 기록·저장에는 없다(빈 텍스트 상자는 저장하지 않는다)
   */
  pendingId: string | null;
  /** 편집기에 커서를 넣어 달라는 요청(상자 id + 회차) */
  focusRequest: { id: string; n: number } | null;
  dockHeight: number;
  /** 보드 우선 자동 높이(14절 F1) — false면 dockHeight로 고정 */
  dockAuto: boolean;
  collapsed: boolean;
  /** [크게 보기] — 메모가 보드 영역 전체를 덮는다 */
  expanded: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** 이 주의 메모 이미지(id → 그림). 문서는 id만 가리킨다 */
  assets: Record<string, NoteImage>;
  /** 그림을 넣는 중(줄이기·저장) */
  busy: boolean;
  /** 메모 보드 배율(improve-1026-spec 11절) — 앱 전체 하나 */
  zoom: number;
  /** 미니맵 펼침 */
  minimap: boolean;
  /** [화면에 맞춤] 요청 회차(판이 보이는 영역을 알아 배율을 정한다) */
  fitRequest: number;
  /** 잠깐 강조할 상자(보드 배지로 찾아온 상자) */
  pulseId: string | null;
  /** 상자로 포커스·화면 안으로(보드 배지) — 이미 선택된 상자여도 다시 가게 회차를 둔다 */
  revealRequest: { id: string; n: number } | null;
  // ── 관계선(note-relation-spec) ──
  /** 선택한 관계선(상자 선택과 동시에 하나만) */
  edgeId: string | null;
  /** 선 선택 전에 선택돼 있던 상자(Esc로 돌아갈 곳·Shift+L 차례) */
  edgeOrigin: string | null;
  /** 이름표 입력 칸이 열려 있음 */
  edgeLabelOpen: boolean;
  /** 상자 ⋯ 목록에서 마우스를 올린 선(판에서 강조) */
  edgeHover: string | null;
  /** 잇는 중: 끌기(연결점) 또는 키보드(L) */
  linking: {
    from: string;
    mode: "drag" | "keys";
    target: string | null;
    pointer: { x: number; y: number } | null;
  } | null;
  /** [관계선 보기] — 앱 실행 중만 */
  showEdges: boolean;
}

export interface NoteImage {
  mime: ImageMime;
  data: string;
  width: number;
  height: number;
  bytes: number;
}

export const useNote = create<NoteState>(() => ({
  weekId: "",
  doc: emptyDoc(),
  legacy: false,
  editingId: null,
  selectedId: null,
  pendingId: null,
  focusRequest: null,
  dockHeight: 280,
  dockAuto: true,
  collapsed: false,
  expanded: false,
  canUndo: false,
  canRedo: false,
  assets: {},
  busy: false,
  zoom: 1,
  minimap: true,
  fitRequest: 0,
  pulseId: null,
  revealRequest: null,
  edgeId: null,
  edgeOrigin: null,
  edgeLabelOpen: false,
  edgeHover: null,
  linking: null,
  showEdges: true,
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

/** 선 선택·잇기 상태 비우기(주 이동·실행 취소 등) */
const EDGE_RESET = { edgeId: null, edgeOrigin: null, edgeLabelOpen: false, edgeHover: null, linking: null };

const syncUndo = () => set({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 });

export async function initNote(r: JournalRepository) {
  repo = r;
  const s = await r.getSettings();
  set({
    dockHeight: s.ui.noteDockHeight,
    dockAuto: s.ui.noteDockAuto,
    collapsed: s.ui.noteDockCollapsed,
    expanded: false,
    zoom: clampZoom(s.ui.noteZoom),
    minimap: s.ui.noteMinimap,
  });
  await loadWeek(useBoard.getState().weekId);
  unsubscribe?.();
  unsubscribe = useBoard.subscribe((st, prev) => {
    if (st.weekId !== prev.weekId) void loadWeek(st.weekId);
  });
}

async function loadWeek(weekId: WeekId, finish = true) {
  if (!repo || !weekId) return;
  if (finish) await finishNote();
  try {
    const [{ doc, legacy }, rows] = await Promise.all([repo.getWeekNote(weekId), repo.getNoteAssets(weekId)]);
    if (useBoard.getState().weekId !== weekId) return;
    undoStack.length = 0;
    redoStack.length = 0;
    lastEditedId = null;
    const assets = Object.fromEntries(rows.map(({ id, ...a }) => [id, a]));
    set({
      weekId,
      doc,
      legacy,
      assets,
      editingId: null,
      selectedId: null,
      pendingId: null,
      focusRequest: null,
      ...EDGE_RESET,
    });
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

/** 저장소에서 이 주 메모를 다시 읽기(가져오기·되돌리기가 메모를 바꾼 뒤). 대기 중인 저장은 부르는 쪽이 먼저 끝낸다 */
export async function reloadNote() {
  await loadWeek(useBoard.getState().weekId, false);
}

/**
 * 이 주를 떠날 때(주 이동·앱 종료): 저장을 끝내고, 문서가 더는 가리키지 않는 이미지를 지운다.
 * 이 주의 메모 실행 취소 기록도 함께 사라지는 때라, 지운 상자를 되살릴 길이 없을 때만 정리한다(스펙 5-2).
 */
export async function finishNote() {
  await flushNote();
  const r = repo;
  const { weekId, doc, legacy } = get();
  if (!r || !weekId || legacy) return;
  await r.pruneNoteAssets(weekId, noteAssetIds(doc)).catch(reportError);
}

/** 메모 기록에 넣을 문서 — 대기 상자는 기록에 남기지 않는다 */
function withoutPending(doc: NoteDoc): NoteDoc {
  const id = get().pendingId;
  return id ? { ...doc, boxes: doc.boxes.filter((b) => b.id !== id) } : doc;
}

/** 문서를 바꾼다. undoable이면 바꾸기 전 문서를 메모 기록에 쌓는다 */
function commit(next: NoteDoc, undoable: boolean) {
  if (undoable) {
    undoStack.push(withoutPending(get().doc));
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
/**
 * 그 자리(8px 맞춤)에 커서를 둔다 — "대기" 상자(improve-1026-spec 2절). 첫 글자를 치면 그때 상자가 생겨
 * 메모 기록에 들어가고, 아무것도 치지 않고 떠나면 흔적 없이 사라진다.
 */
export function addBox(x: number, y: number, itemId?: string): string {
  const old = get().pendingId;
  if (old) dropPending(old);
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
    ...(itemId ? { ref: { item: itemId } } : {}),
  };
  // 저장도 기록도 하지 않는다 — 첫 글자(updateContent)에서 상자가 된다
  set({ doc: { ...doc, boxes: [...doc.boxes, box] }, pendingId: box.id });
  requestFocus(box.id);
  return box.id;
}

/** 대기 상자를 흔적 없이 치운다 */
function dropPending(id: string) {
  const doc = get().doc;
  set({
    doc: withoutBoxes(doc, new Set([id])),
    pendingId: null,
    editingId: get().editingId === id ? null : get().editingId,
    selectedId: get().selectedId === id ? null : get().selectedId,
  });
}

/** 가장 아래 상자 아래에 새 상자(Ctrl+Enter·[+ 텍스트 상자]) */
export function addBoxBelow(): string {
  const { x, y } = positionBelow(withoutPending(get().doc));
  return addBox(x, y);
}

// ── 업무 항목 연결(improve-1026v2-spec 4~7절) ─────────
/** 메모가 접혀 있으면 펼친다(주간 뷰의 아래 도크만 — 오늘 뷰의 왼쪽 메모는 늘 펼쳐져 있다) */
function openDock() {
  if (get().collapsed && useBoard.getState().viewMode === "week") setCollapsed(false);
}

/**
 * 항목과 연결된 글 상자(4절): 행의 [메모] = 가장 아래 상자 밑, 행을 판에 끌어 놓기 = 놓은 자리.
 * 본문은 비어 있고(타이틀 띠가 항목을 보여 줌) 글자를 쳐야 상자가 남는다(빈 상자 규칙 그대로)
 */
export function addLinkedBox(itemId: string, at?: { x: number; y: number }): string {
  openDock();
  const editing = get().editingId;
  if (editing) endEditing(editing);
  const place = at ?? positionBelow(withoutPending(get().doc));
  return addBox(place.x, place.y, itemId);
}

/** 기존 상자를 항목에 연결(5절) — 이미 연결돼 있으면 옮겨 간다. 메모 기록 1단계 */
export function linkBox(id: string, itemId: string, before?: NoteDoc) {
  const b = boxOf(id);
  if (!b || b.ref?.item === itemId) return;
  const next = mapBox(id, (x) => ({ ...x, ref: { item: itemId } }));
  if (before) {
    // 끌기 도중 바뀐 자리는 버리고(상자는 원래 자리로) 연결만 한 번에 기록
    undoStack.push(withoutPending(before));
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack.length = 0;
    syncUndo();
    const kept = before.boxes.find((x) => x.id === id) ?? b;
    set({
      doc: { ...next, boxes: next.boxes.map((x) => (x.id === id ? { ...x, x: kept.x, y: kept.y } : x)) },
    });
    scheduleSave();
  } else commit(next, true);
  toast(STR.linked.linked, { label: STR.toast.undo, run: () => undoNote() });
}

/** 연결 해제(7절) — 띠만 사라지고 상자·본문·자리는 그대로 */
export function unlinkBox(id: string) {
  const b = boxOf(id);
  if (!b?.ref) return;
  commit(
    mapBox(id, (x) => {
      const { ref: _gone, ...rest } = x; // eslint-disable-line @typescript-eslint/no-unused-vars
      return rest as NoteBox;
    }),
    true,
  );
  toast(STR.linked.unlinked, { label: STR.toast.undo, run: () => undoNote() });
}

/** 보드 배지 → 그 메모 상자로(6-2): 메모를 펼치고 상자를 선택(선택되면 포커스·화면 안으로) */
export function revealBox(id: string) {
  openDock();
  if (get().expanded) set({ expanded: false });
  const editing = get().editingId;
  if (editing && editing !== id) endEditing(editing);
  set({ selectedId: id, editingId: null, pulseId: id, revealRequest: { id, n: ++focusSeq } });
  setTimeout(() => {
    if (get().pulseId === id) set({ pulseId: null });
  }, 1200);
}

export function requestFocus(id: string) {
  set({ editingId: id, selectedId: null, focusRequest: { id, n: ++focusSeq } });
}

/** 편집기 글이 바뀜(상자 안 실행 취소는 편집기가 맡아 메모 기록에 넣지 않는다) */
export function updateContent(id: string, content: PMNode) {
  lastEditedId = id;
  const next = mapBox(id, (b) => (b.kind === "text" ? { ...b, content } : b));
  if (id === get().pendingId) {
    const box = next.boxes.find((b) => b.id === id)!;
    if (isNoteEmpty({ v: 1, boxes: [box] })) return set({ doc: next });
    // 첫 글자 — 이제 상자다. 메모 기록에는 "상자가 없던 문서"를 남겨 되돌리면 상자째 사라진다
    undoStack.push(withoutPending(get().doc));
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack.length = 0;
    set({ pendingId: null });
    syncUndo();
  }
  commit(next, false);
}

/** 이미지 설명(한 줄, 200자). 글처럼 메모 기록에는 넣지 않는다 */
export function setCaption(id: string, caption: string) {
  commit(
    mapBox(id, (b) =>
      b.kind === "image" ? { ...b, caption: caption.replace(/\s+/g, " ").slice(0, CAPTION_MAX) } : b,
    ),
    false,
  );
}

// ── 이미지(스펙 4-4) ──────────────────────────────────
/**
 * 붙여넣기 자리: 편집 중인 빈 텍스트 상자가 있으면 그 자리(빈 곳 클릭 → Ctrl+V), 편집·선택 중인 상자가 있으면 그 아래,
 * 없으면 가장 아래 상자 아래.
 */
export function pastePlace(): { x: number; y: number } {
  const { editingId, selectedId, doc } = get();
  const cur = boxOf(editingId ?? selectedId ?? "");
  if (cur && cur.kind === "text" && editingId === cur.id && isNoteEmpty({ v: 1, boxes: [cur] }))
    return { x: cur.x, y: cur.y };
  if (cur) return { x: cur.x, y: snap(cur.y + (cur.h ?? 48) + BOX_GAP) };
  return positionBelow(doc);
}

/** 그림 파일들을 이미지 상자로(겹치지 않게 24px씩 비켜). 실패한 파일은 토스트로 알린다 */
export async function addImages(files: Blob[], at: { x: number; y: number }) {
  const r = repo;
  const images = files.filter((f) => f.type.startsWith("image/"));
  if (!r || !images.length) return;
  const weekId = get().weekId;
  // 편집 중이던 빈 텍스트 상자는 그 자리를 이미지에 내주고 사라진다
  const editing = get().editingId;
  if (editing) endEditing(editing);
  set({ busy: true });
  let n = 0;
  try {
    for (const f of images) {
      try {
        const img = await prepareImage(f);
        const asset = await r.addNoteAsset(weekId, img);
        if (get().weekId !== weekId) return;
        const doc = get().doc;
        const box: NoteBox = {
          id: uuidv7(),
          kind: "image",
          x: snap(at.x + n * 24),
          y: snap(at.y + n * 24),
          w: clampImageWidth(Math.min(IMAGE_FIRST_W, img.width)),
          z: topZ(doc) + 1,
          asset,
          caption: "",
        };
        set({ assets: { ...get().assets, [asset]: img } });
        commit({ ...doc, boxes: [...doc.boxes, box] }, true);
        set({ selectedId: box.id, editingId: null });
        n++;
      } catch (e) {
        if (e instanceof ImageInputError) toast(e.message);
        else reportError(e);
      }
    }
  } finally {
    set({ busy: false });
  }
}

// ── 링크 카드(improve-1026-spec 10-1) ─────────────────
/** 링크 카드 넣기(붙여넣기·끌어다 놓기·[링크 넣기]) — 앱은 그 주소에 접속하지 않는다. 넣은 카드를 선택 */
export function addLinkBox(url: string, at: { x: number; y: number }, title = "", note = ""): string {
  const editing = get().editingId;
  if (editing) endEditing(editing); // 빈 곳의 커서 자리(대기 상자)는 카드에 자리를 내준다
  const doc = get().doc;
  const box = makeLinkBox(uuidv7(), url, { ...at, z: topZ(doc) + 1 }, title, note);
  commit({ ...doc, boxes: [...doc.boxes, box] }, true);
  set({ selectedId: box.id, editingId: null });
  return box.id;
}

/** 카드 제목·메모 고치기(한 번의 메모 기록) */
export function updateLinkText(id: string, title: string, note: string) {
  const b = boxOf(id);
  if (!b || b.kind !== "link") return;
  const next = cleanLinkText(b, title, note);
  if (next.title === b.title && next.note === b.note) return;
  commit(
    mapBox(id, (x) => (x.kind === "link" ? { ...x, ...next } : x)),
    true,
  );
}

/** 카드 썸네일 = 사용자가 고른 그림(이미지 상자와 같은 줄이기·저장) */
export async function setLinkThumb(id: string, file: Blob) {
  const r = repo;
  if (!r) return;
  const weekId = get().weekId;
  set({ busy: true });
  try {
    const img = await prepareImage(file);
    const asset = await r.addNoteAsset(weekId, img);
    if (get().weekId !== weekId) return;
    set({ assets: { ...get().assets, [asset]: img } });
    commit(
      mapBox(id, (x) => (x.kind === "link" ? { ...x, asset } : x)),
      true,
    );
  } catch (e) {
    if (e instanceof ImageInputError) toast(e.message);
    else reportError(e);
  } finally {
    set({ busy: false });
  }
}

export function clearLinkThumb(id: string) {
  commit(
    mapBox(id, (x) => {
      if (x.kind !== "link") return x;
      const { asset: _gone, ...rest } = x; // eslint-disable-line @typescript-eslint/no-unused-vars
      return rest;
    }),
    true,
  );
}

export function setEditing(id: string | null) {
  set(id ? { editingId: id, selectedId: null, ...EDGE_RESET } : { editingId: null });
}

/** 편집 끝 — 빈 상자는 저절로 없앤다(빈 상자가 쌓이지 않게, 스펙 4-2) */
export function endEditing(id: string, select = false) {
  if (id === get().pendingId) return dropPending(id);
  const box = boxOf(id);
  if (box && isNoteEmpty({ v: 1, boxes: [box] })) {
    const doc = get().doc;
    // 방금 만든 빈 상자는 기록 없이 지운다(만들기 기록도 함께 되돌림)
    const prev = undoStack.at(-1);
    if (prev && !prev.boxes.some((b) => b.id === id)) {
      undoStack.pop();
      syncUndo();
    }
    commit(withoutBoxes(doc, new Set([id])), false);
    set({ editingId: null, selectedId: null });
    return;
  }
  set({
    editingId: get().editingId === id ? null : get().editingId,
    selectedId: select ? id : get().selectedId,
  });
}

export function selectBox(id: string | null) {
  set({ selectedId: id, editingId: id ? null : get().editingId, edgeId: null, edgeLabelOpen: false });
}

/** 끌기·크기 조절 같은 연속 동작: 시작할 때 문서를 기억해 두고, 끝날 때 바뀌었으면 한 번만 기록 */
export function beginGesture(): NoteDoc {
  return get().doc;
}
export function endGesture(before: NoteDoc) {
  if (before === get().doc) return;
  undoStack.push(withoutPending(before));
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack.length = 0;
  syncUndo();
  scheduleSave();
}

export function moveBoxLive(id: string, x: number, y: number) {
  set({ doc: mapBox(id, (b) => ({ ...b, x: snap(x), y: snap(y) })) });
}
/**
 * [이미지로 저장…]: 내보내기와 같은 저장 대화상자·규칙(.png·.webp만, 일지 파일·backups 거부 — CLAUDE.md 4-3).
 * 저장한 형식(WebP)과 다른 확장자를 고르면 그 형식으로 바꿔 쓴다.
 */
export async function saveImage(id: string) {
  const box = boxOf(id);
  const j = useAppStore.getState().journal;
  const platform = useAppStore.getState().platform;
  if (!box || box.kind !== "image" || j.state !== "ready" || !platform) return;
  const img = get().assets[box.asset];
  if (!img) return toast(STR.note.imageMissing);
  try {
    const settings = await j.repo.getSettings();
    let dir = settings.ui.lastExportDir;
    if (!dir || !(await platform.stat(dir)).isDir) {
      dir = platform.join(j.dataDir, "exports");
      await platform.ensureDir(dir);
    }
    const images = readingOrder(get().doc.boxes).filter((b) => b.kind === "image");
    const ext = img.mime === "image/webp" ? "webp" : "png";
    const name = STR.note.imageFileName(get().weekId, images.findIndex((b) => b.id === id) + 1, ext);
    const path = await platform.pickSaveFile(STR.note.saveImageTitle, platform.join(dir, name), "image");
    if (!path) return;
    const problem = exportPathProblem(path, j.dataDir, "image");
    if (problem) return toast(problem);
    const bytes = await exportImageBytes(
      img.mime,
      img.data,
      path.toLowerCase().endsWith(".webp") ? "webp" : "png",
    );
    await platform.writeExport(path, bytes);
    await j.repo.updateSettings({ ui: { lastExportDir: dirOf(path) } });
    toast(STR.note.imageSaved(baseName(path)));
  } catch (e) {
    if (e instanceof ImageInputError) toast(e.message);
    else reportError(e);
  }
}

export function resizeBoxLive(id: string, w: number) {
  set({
    doc: mapBox(id, (b) => ({
      ...b,
      w: b.kind === "image" ? clampImageWidth(w) : b.kind === "link" ? clampLinkWidth(w) : clampWidth(w),
    })),
  });
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
  // 그 상자의 관계선도 함께 — 되돌리기 한 번에 둘 다(note-relation-spec 5-2)
  const lines = boxEdges(doc, id).length;
  commit(withoutBoxes(doc, new Set([id])), true);
  set({ editingId: null, selectedId: null, ...EDGE_RESET });
  toast(lines ? STR.note.deletedWithEdges(lines) : STR.note.deleted, {
    label: STR.toast.undo,
    run: () => undoNote(),
  });
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
    mapBox(id, (b) => (b.kind === "text" ? { ...b, bg } : b)),
    true,
  );
}

// ── 메모 기록(실행 취소) ──────────────────────────────
export function undoNote() {
  const pending = get().pendingId;
  if (pending) dropPending(pending);
  const prev = undoStack.pop();
  if (!prev) return;
  redoStack.push(get().doc);
  set({ doc: prev, editingId: null, selectedId: null, ...EDGE_RESET });
  syncUndo();
  scheduleSave();
}

export function redoNote() {
  const pending = get().pendingId;
  if (pending) dropPending(pending);
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(get().doc);
  set({ doc: next, editingId: null, selectedId: null, ...EDGE_RESET });
  syncUndo();
  scheduleSave();
}

// ── 키보드 흐름·도크 ──────────────────────────────────
/** 메모로 가기(Alt+M·마지막 업무 칸 ↓): 마지막으로 고친 상자 끝, 없으면 읽는 순서 마지막 상자, 그것도 없으면 새 상자 */
export function focusNote() {
  // 오늘 뷰의 왼쪽 메모는 늘 펼쳐져 있다 — 아래 도크의 접힘 상태는 건드리지 않는다
  openDock();
  const texts = get().doc.boxes.filter((b) => b.kind === "text");
  const target = (lastEditedId && texts.find((b) => b.id === lastEditedId)) || readingOrder(texts).at(-1);
  if (target) requestFocus(target.id);
  else addBoxBelow();
}

/** 메모에서 보드로(Alt+M·Esc 두 번) */
export function leaveNote() {
  const { editingId } = get();
  if (editingId) endEditing(editingId);
  set({ selectedId: null, expanded: false, ...EDGE_RESET });
  focusStartCell();
}

/** 경계선으로 정한 높이 — 자동 높이를 끄고 고정 */
export function setDockHeight(h: number) {
  const height = Math.max(NOTE_DOCK_MIN, Math.round(h));
  set({ dockHeight: height, dockAuto: false });
  void repo?.updateSettings({ ui: { noteDockHeight: height, noteDockAuto: false } }).catch(() => undefined);
}

/** 보드 우선 자동 높이로 되돌리기(도크 머리·경계선 두 번 누르기) */
export function setDockAuto() {
  set({ dockAuto: true });
  void repo?.updateSettings({ ui: { noteDockAuto: true } }).catch(() => undefined);
}

/** 보드 칸에서 붙인 그림을 메모로(14절 F3 — 안내 토스트의 [메모에 붙이기]) */
export function pasteImagesFromBoard(files: Blob[]) {
  if (get().collapsed) setCollapsed(false);
  void addImages(files, positionBelow(get().doc));
}

export function setCollapsed(collapsed: boolean) {
  set({ collapsed, expanded: collapsed ? false : get().expanded });
  void repo?.updateSettings({ ui: { noteDockCollapsed: collapsed } }).catch(() => undefined);
}

// ── 줌·미니맵(improve-1026-spec 11절) ─────────────────
let zoomAnchor: { x: number; y: number } | null = null;
let zoomSaveTimer: ReturnType<typeof setTimeout> | null = null;

/** 배율 바꾸기. at = 보이는 영역 안에서 그대로 둘 점(커서) — 없으면 가운데 */
export function setZoom(z: number, at?: { x: number; y: number }) {
  const zoom = clampZoom(z);
  if (zoom === get().zoom) return;
  zoomAnchor = at ?? null;
  set({ zoom });
  // 휠은 잇달아 오므로 멈춘 뒤 한 번만 저장
  if (zoomSaveTimer) clearTimeout(zoomSaveTimer);
  zoomSaveTimer = setTimeout(() => {
    void repo?.updateSettings({ ui: { noteZoom: get().zoom } }).catch(() => undefined);
  }, 400);
}

/** 판이 배율을 그린 직후 한 번 꺼내 쓴다 */
export function takeZoomAnchor() {
  const a = zoomAnchor;
  zoomAnchor = null;
  return a;
}

export const zoomStep = (dir: 1 | -1) => setZoom(stepZoom(get().zoom, dir));

export function requestFit() {
  set({ fitRequest: get().fitRequest + 1 });
}

export function setMinimap(minimap: boolean) {
  set({ minimap });
  void repo?.updateSettings({ ui: { noteMinimap: minimap } }).catch(() => undefined);
}

export function setExpanded(expanded: boolean) {
  set({ expanded, collapsed: expanded ? false : get().collapsed });
}

// ── 관계선(note-relation-spec) ─────────────────────────
const edgeOf = (id: string) => edgesOf(get().doc).find((e) => e.id === id);
/** 이을 수 있는 상자(대기 상자 빼고) */
const linkable = (id: string | null) => !!id && id !== get().pendingId && !!boxOf(id);

/** 선 선택(상자 선택은 풀고, 돌아갈 상자를 기억) */
export function selectEdge(id: string | null, origin?: string | null) {
  const editing = get().editingId;
  if (editing) endEditing(editing);
  if (!id) return set({ edgeId: null, edgeLabelOpen: false });
  const e = edgeOf(id);
  if (!e) return;
  set({
    edgeId: id,
    edgeOrigin: origin ?? get().selectedId ?? e.from,
    selectedId: null,
    editingId: null,
    edgeLabelOpen: false,
    linking: null,
  });
}

/** 두 상자 잇기(2-1·2-2): 같은 쌍이 있으면 그 선을 선택하고 알린다. 새 선 = →·실선·이름표 없음, 바로 선택 */
export function connect(from: string, to: string) {
  set({ linking: null });
  if (from === to || !linkable(from) || !linkable(to)) return;
  const doc = get().doc;
  const same = findEdge(doc, from, to);
  if (same) {
    selectEdge(same.id, from);
    toast(STR.note.edgeExists);
    return;
  }
  const e: NoteEdge = { id: uuidv7(), from, to, dir: "one", dash: false, label: "" };
  commit(withEdges(doc, [...edgesOf(doc), e]), true);
  selectEdge(e.id, from);
}

export function updateEdge(id: string, patch: Partial<Pick<NoteEdge, "dir" | "dash" | "label">>) {
  const e = edgeOf(id);
  if (!e) return;
  const next: NoteEdge = {
    ...e,
    ...patch,
    ...(patch.label !== undefined ? { label: cleanEdgeLabel(patch.label) } : {}),
  };
  if (next.dir === e.dir && next.dash === e.dash && next.label === e.label) return;
  const doc = get().doc;
  commit(
    withEdges(
      doc,
      edgesOf(doc).map((x) => (x.id === id ? next : x)),
    ),
    true,
  );
}

export const setEdgeDir = (id: string, dir: EdgeDir) => updateEdge(id, { dir });

/** 방향 바꾸기(출발·도착 맞바꿈) */
export function reverseEdge(id: string) {
  const e = edgeOf(id);
  if (!e) return;
  const doc = get().doc;
  commit(
    withEdges(
      doc,
      edgesOf(doc).map((x) => (x.id === id ? { ...x, from: e.to, to: e.from } : x)),
    ),
    true,
  );
}

/** 선 해제(하나 또는 여러 개) — 확인 없이, 토스트 [되돌리기] */
export function removeEdges(ids: string[]) {
  const doc = get().doc;
  const gone = new Set(ids);
  const kept = edgesOf(doc).filter((e) => !gone.has(e.id));
  const n = edgesOf(doc).length - kept.length;
  if (!n) return;
  commit(withEdges(doc, kept), true);
  const origin = get().edgeOrigin;
  const back = get().edgeId && gone.has(get().edgeId!) ? origin : null;
  set({ edgeId: null, edgeLabelOpen: false, edgeHover: null });
  if (back && boxOf(back)) set({ selectedId: back });
  toast(n === 1 ? STR.note.edgeRemoved : STR.note.edgesRemoved(n), {
    label: STR.toast.undo,
    run: () => undoNote(),
  });
}

/** 상자의 관계선 모두 해제 */
export const removeBoxEdges = (boxId: string) => removeEdges(boxEdges(get().doc, boxId).map((e) => e.id));

export function setEdgeLabelOpen(edgeLabelOpen: boolean) {
  set({ edgeLabelOpen });
}

export function setEdgeHover(edgeHover: string | null) {
  if (get().edgeHover !== edgeHover) set({ edgeHover });
}

/** 선 선택 → 원래 상자 선택으로(Esc) */
export function backToOrigin() {
  const origin = get().edgeOrigin;
  set({ edgeId: null, edgeLabelOpen: false });
  if (origin && boxOf(origin)) selectBox(origin);
}

/** Shift+L: 이 상자의 선을 차례로 선택(지금 선 다음) */
export function cycleBoxEdges(boxId: string) {
  const list = boxEdges(get().doc, boxId);
  if (!list.length) {
    toast(STR.note.edgeNone);
    return;
  }
  const cur = list.findIndex((e) => e.id === get().edgeId);
  selectEdge(list[(cur + 1) % list.length]!.id, boxId);
}

// 잇기(연결점 끌기·L)
export function startLinking(from: string, mode: "drag" | "keys") {
  if (!linkable(from)) return;
  if (!get().showEdges) set({ showEdges: true });
  set({ linking: { from, mode, target: null, pointer: null }, edgeId: null, edgeLabelOpen: false });
}

export function setLinkTarget(target: string | null, pointer?: { x: number; y: number } | null) {
  const l = get().linking;
  if (!l) return;
  const t = target && target !== l.from && linkable(target) ? target : null;
  set({ linking: { ...l, target: t, pointer: pointer === undefined ? l.pointer : pointer } });
}

/** 잇기 끝: 고른 상자가 있으면 잇고, 없으면 취소 */
export function finishLinking() {
  const l = get().linking;
  if (!l) return;
  if (l.target) connect(l.from, l.target);
  else cancelLinking();
}

export function cancelLinking() {
  const l = get().linking;
  set({ linking: null });
  // 키보드로 시작했으면 그 상자 선택으로 돌아간다(포커스가 판에 남게)
  if (l?.mode === "keys" && boxOf(l.from)) set({ selectedId: l.from });
}

export function setShowEdges(showEdges: boolean) {
  set({ showEdges, ...(showEdges ? {} : EDGE_RESET) });
}
