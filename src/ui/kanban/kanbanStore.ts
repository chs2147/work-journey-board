// 칸반 보드 화면 상태(docs/improve-v21-spec.md 2·3절). 인사이트처럼 보드 자리를 덮고, 주간 보드는 숨긴 채 그대로 둔다.
// 일지 전환 무결성(CLAUDE.md 4-7): 읽어 온 저장소(repo)를 기억하고 await 뒤 바뀌었으면 결과를 버린다 · detachKanban 등록.
import { create } from "zustand";
import {
  DEFAULT_KANBAN_FILTER,
  DEFAULT_KANBAN_COLUMNS,
  DEFAULT_KANBAN_LAYOUT,
  defaultColumnIcon,
  freeSpot,
  mergeColumnOrder,
  moveColumn as moveInOrder,
  type KanbanColumns,
  equalRects,
  fillRects,
  readingOrder,
  type KanbanLayout,
  type KanbanRect,
  DONE,
  TODO,
  sortCards,
  type KanbanFilter,
  type KanbanSection,
  type SectionColor,
  type SectionKey,
} from "../../domain/kanban";
import type { JournalRepository } from "../../data/repository";
import { KanbanError, type KanbanCard, type StatusLogRow } from "../../data/kanbanRepository";
import {
  flushAll,
  notifyItemsChanged,
  onItemsChanged,
  refreshImportant,
  reportError,
  syncItems,
  toast,
  track,
  useBoard,
} from "../board/boardStore";
import { flushNote } from "../note/noteStore";
import { STR } from "../../shared/strings";
import { cellKey } from "../../data/repository";
import type { ItemDraft } from "../../domain/types";
import { groupCell as groupItems } from "../../domain/kanban";
import { DAY_LABELS, weekIdOf, type DateStr } from "../../domain/week";
import { reload as reloadBoard } from "../board/boardStore";
import { useAppStore } from "../common/appStore";

export const DONE_PAGE = 50;

export interface KanbanState {
  open: boolean;
  loading: boolean;
  filter: KanbanFilter;
  sections: KanbanSection[];
  /** TODO·사용자 섹션 카드(정렬 전) */
  openCards: KanbanCard[];
  done: KanbanCard[];
  doneTotal: number;
  /** 펼친 DONE 카드 */
  expanded: Record<string, boolean>;
  /** 강조할 카드(중요 업무 목록에서 누름 등) */
  highlight: string | null;
  /** 끄는 중인 카드 */
  dragging: string | null;
  /** 업무 목록(필터·추가 창) — 종료 여부 포함 */
  categories: { id: string; name: string; color: string; ended: boolean }[];
  /** 섹션 추가/이름 바꾸기 창(상단 막대 [섹션 추가]도 연다, improve-v22-spec 5절) */
  sectionDialog: { id: string | null } | null;
  /** 완료 축하 모션(7절) — DONE에 들어간 카드가 있던 자리 */
  celebrating: { key: number; x: number; y: number; w: number; h: number } | null;
  /** 설정 › 화면 [완료 축하 모션](이 PC 설정, 기본 켬) */
  celebrateOn: boolean;
  /** 배치 모드(4절) — 일지 설정 ui.kanbanLayout */
  layout: KanbanLayout;
  /** 열 순서(TODO·DONE 포함)·아이콘(improve-v23-spec 2·8절) — 일지 설정 ui.kanbanColumns */
  columns: KanbanColumns;
  /** 잠깐 강조할 열(자유 배치에 새로 놓은 섹션 등) */
  flashKey: string | null;
}

const initial: KanbanState = {
  open: false,
  loading: false,
  filter: DEFAULT_KANBAN_FILTER,
  sections: [],
  openCards: [],
  done: [],
  doneTotal: 0,
  expanded: {},
  highlight: null,
  dragging: null,
  categories: [],
  sectionDialog: null,
  celebrating: null,
  celebrateOn: true,
  layout: DEFAULT_KANBAN_LAYOUT,
  columns: DEFAULT_KANBAN_COLUMNS,
  flashKey: null,
};

export const useKanban = create<KanbanState>(() => initial);
const set = useKanban.setState;
const get = useKanban.getState;

let repo: JournalRepository | null = null;
let loadSeq = 0;
let unsub: (() => void) | null = null;

/** 일지를 바꿀 때 모두 비운다(CLAUDE.md 4-7) */
export function detachKanban() {
  repo = null;
  loadSeq++;
  unsub?.();
  unsub = null;
  set({ ...initial, celebrateOn: get().celebrateOn });
}

let celebrateKey = 0;
type Rect = { x: number; y: number; w: number; h: number };
/**
 * 축하 시작점(improve-v23-spec 6절): 끌어 놓기 = 놓은 마우스 위치, 메뉴·단축키·중요 목록 ✓ = DONE 열 맨 위 첫 줄.
 * 화면 안으로 맞춘다(창 밖 좌표에 그려 안 보이는 일이 없게).
 */
function cheerRect(at?: { x: number; y: number }): Rect {
  const w = 160,
    h = 70;
  let x: number, y: number;
  if (at) {
    x = at.x - w / 2;
    y = at.y - h / 2;
  } else {
    const head = document
      .querySelector<HTMLElement>('[data-section="done"] [data-testid="kanban-col-head"]')
      ?.getBoundingClientRect();
    x = head ? head.left + head.width / 2 - w / 2 : window.innerWidth / 2 - w / 2;
    y = head ? head.bottom + 8 : window.innerHeight / 3;
  }
  return {
    x: Math.max(4, Math.min(x, window.innerWidth - w - 4)),
    y: Math.max(4, Math.min(y, window.innerHeight - h - 4)),
    w,
    h,
  };
}
/** 칸반이 보일 때 DONE으로 끝낸 순간(일괄 완료 제외) — 놓는 순간 바로 */
export function celebrateDone(at?: { x: number; y: number }) {
  if (!get().celebrateOn || !get().open) return;
  celebrate(cheerRect(at));
}
function celebrate(r: Rect) {
  const key = ++celebrateKey;
  set({ celebrating: { key, ...r } });
  setTimeout(() => {
    if (get().celebrating?.key === key) set({ celebrating: null });
  }, 1100);
}

export function setCelebrateOn(on: boolean) {
  set({ celebrateOn: on, ...(on ? {} : { celebrating: null }) });
}

export async function initKanban(r: JournalRepository) {
  repo = r;
  const s = await r.getSettings();
  if (repo !== r) return;
  set({ filter: s.ui.kanban, layout: s.ui.kanbanLayout, columns: s.ui.kanbanColumns });
  // 중요 업무 목록의 섹션 칩이 칸반을 열기 전에도 보이게 섹션만 먼저 읽는다
  void r.kanban
    .listSections()
    .then((sections) => {
      if (repo === r && !get().sections.length) set({ sections });
    })
    .catch(() => undefined);
  void useAppStore
    .getState()
    .platform?.loadConfig()
    .then((c) => {
      if (repo === r) set({ celebrateOn: c?.celebrate !== false });
    })
    .catch(() => undefined);
  unsub?.();
  // 주간 보드·중요 업무에서 완료하면 칸반도 새로 읽는다
  unsub = onItemsChanged(() => {
    if (get().open) void load();
  });
}

const today = () => useBoard.getState().today;

/** 열 → 그 열의 카드(정렬 반영) */
export function cardsOf(key: SectionKey, s: KanbanState = get()): KanbanCard[] {
  if (key === DONE) return s.done;
  const list = s.openCards.filter((c) => (c.sectionId ?? TODO) === key);
  return sortCards(list, s.filter.sort);
}

export async function load(more = false) {
  const r = repo;
  if (!r) return;
  const seq = ++loadSeq;
  const f = get().filter;
  if (!more) set({ loading: true });
  try {
    const [cats, sections, openCards, done] = await Promise.all([
      r.listCategories(),
      r.kanban.listSections(),
      more ? Promise.resolve(get().openCards) : r.kanban.listOpen(f, today()),
      r.kanban.listDone(
        f,
        today(),
        more ? get().done.length + DONE_PAGE : Math.max(DONE_PAGE, get().done.length),
      ),
    ]);
    if (repo !== r || seq !== loadSeq) return;
    // 지워진 섹션에 남은 카드는 TODO로 보이게(섹션 목록과 맞춘다)
    const ids = new Set(sections.map((x) => x.id));
    const open = new Set(cats.periods.filter((p) => p.endDate === null).map((p) => p.categoryId));
    set({
      categories: cats.categories.map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        ended: !open.has(c.id),
      })),
      sections,
      openCards: openCards.map((c) => (c.sectionId && !ids.has(c.sectionId) ? { ...c, sectionId: null } : c)),
      done: done.cards,
      doneTotal: done.total,
      loading: false,
    });
  } catch (e) {
    if (repo === r && seq === loadSeq) {
      set({ loading: false });
      reportError(e);
    }
  }
}

export async function openKanban() {
  await flushAll();
  await flushNote(true);
  set({ open: true, expanded: {} });
  await load();
}

export function closeKanban() {
  set({ open: false, dragging: null });
}

// ── 배치 모드(improve-v22-spec 4절) ───────────────────────────────────────────
/** 실제 열 순서 — 저장된 순서 + 지금 섹션(새 섹션은 DONE 앞) */
export function columnKeys(s: KanbanState = get()): SectionKey[] {
  return mergeColumnOrder(
    s.columns.order,
    s.sections.map((x) => x.id),
  );
}
const allKeys = columnKeys;

/** 열 이름(TODO·DONE은 고정 글자) */
export function columnName(key: SectionKey, s: KanbanState = get()): string {
  if (key === TODO) return STR.kanban.todo;
  if (key === DONE) return STR.kanban.done;
  return s.sections.find((x) => x.id === key)?.name ?? "";
}

/** 열 아이콘 id — 고른 것, 없으면 기본(TODO 📋·DONE ✅·이름 추천) */
export function columnIcon(key: SectionKey, s: KanbanState = get()): string {
  return s.columns.icons[key] ?? defaultColumnIcon(key, columnName(key, s));
}

function saveColumns(next: KanbanColumns) {
  const keys = new Set<string>(allKeys());
  const icons = Object.fromEntries(Object.entries(next.icons).filter(([k]) => keys.has(k)));
  const columns = { order: next.order.filter((k) => keys.has(k)), icons };
  set({ columns });
  void repo?.updateSettings({ ui: { kanbanColumns: columns } }).catch(() => undefined);
}

/** 사용자 섹션의 DB 순서(sort_order)도 열 순서와 같게(다른 화면·내보내기 호환) */
async function syncSectionOrder(r: JournalRepository, order: readonly SectionKey[]) {
  const ids = order.filter((k) => k !== TODO && k !== DONE);
  if (
    ids.join() ===
    get()
      .sections.map((x) => x.id)
      .join()
  )
    return;
  await track(() => r.kanban.reorderSections(ids)).catch(reportError);
}

/** 열을 순서 안의 toIndex 자리로(머리 끌기·Alt+Shift+←/→ — TODO·DONE 포함, 2절) · 되돌리기 알림 */
export async function placeColumn(key: SectionKey, toIndex: number) {
  const r = repo;
  if (!r) return;
  const before = columnKeys();
  const next = moveInOrder(before, key, toIndex);
  if (next.join() === before.join()) return;
  const name = columnName(key);
  saveColumns({ ...get().columns, order: next });
  await syncSectionOrder(r, next);
  if (repo !== r) return;
  await load();
  toast(STR.kanban.sectionMoved(name), {
    label: STR.toast.undo,
    run: () =>
      void (async () => {
        if (repo !== r) return;
        saveColumns({ ...get().columns, order: before });
        await syncSectionOrder(r, before);
        if (repo === r) await load();
      })(),
  });
}

/** 섹션 ⋯ [← 왼쪽으로]·[오른쪽으로 →] */
export function shiftColumn(key: SectionKey, dir: -1 | 1) {
  const i = columnKeys().indexOf(key);
  if (i < 0) return Promise.resolve();
  return placeColumn(key, dir < 0 ? i - 1 : i + 2);
}

/** 열 아이콘 바꾸기(null = 기본) */
export function setColumnIcon(key: SectionKey, id: string | null) {
  const icons = { ...get().columns.icons };
  if (id) icons[key] = id;
  else delete icons[key];
  saveColumns({ ...get().columns, order: columnKeys(), icons });
}

let flashTimer = 0;
function flash(key: string) {
  window.clearTimeout(flashTimer);
  set({ flashKey: key });
  flashTimer = window.setTimeout(() => set({ flashKey: null }), 1500);
}

function saveLayout(layout: KanbanLayout) {
  // 지운 섹션 자리는 버린다
  const keys = new Set<string>(allKeys());
  const rects = Object.fromEntries(Object.entries(layout.rects).filter(([k]) => keys.has(k)));
  const next = { ...layout, rects };
  set({ layout: next });
  void repo?.updateSettings({ ui: { kanbanLayout: next } }).catch(() => undefined);
}

/** 보드 자리 크기(균등 모습 계산용) */
function boardSize(): { w: number; h: number } {
  const el = document.querySelector<HTMLElement>('[data-testid="kanban-board"]');
  return el ? { w: el.clientWidth - 32, h: el.clientHeight - 24 } : { w: 1200, h: 600 };
}

/** 균등 ↔ 자유. 처음 자유로 바꾸면 지금 균등 모습 그대로의 자리에서 시작 */
export function setLayoutMode(mode: KanbanLayout["mode"], board = boardSize()) {
  const l = get().layout;
  if (l.mode === mode) return;
  const rects =
    mode === "free" && !Object.keys(l.rects).length && board
      ? equalRects(allKeys(), board.w, board.h)
      : l.rects;
  saveLayout({ mode, rects });
}

/** [배치 초기화] — 균등 분할 모습으로 다시 놓기(자유 모드 그대로) */
export function resetLayout(board = boardSize()) {
  saveLayout({ mode: "free", rects: equalRects(allKeys(), board.w, board.h) });
}

/** 자유 배치의 열 자리 — 지금 섹션 모두(없는 것은 맨 오른쪽 빈 자리) */
export function layoutRects(s: KanbanState = get()): Record<string, KanbanRect> {
  return fillRects(allKeys(s), s.layout.rects);
}

/** 상자 하나를 옮기거나 크기를 바꿈 → 사용자 섹션 순서는 왼쪽 위부터 읽는 순서로 맞춘다 */
export async function setRect(key: SectionKey, rect: KanbanRect) {
  const rects = { ...layoutRects(), [key]: rect };
  saveLayout({ ...get().layout, rects });
  const r = repo;
  const keys = columnKeys();
  const order = readingOrder(keys, rects);
  if (!r || order.join() === keys.join()) return;
  saveColumns({ ...get().columns, order });
  await syncSectionOrder(r, order);
  if (repo === r) await load();
}

export function setFilter(patch: Partial<KanbanFilter>) {
  const filter = { ...get().filter, ...patch };
  set({ filter, done: [] });
  void repo?.updateSettings({ ui: { kanban: filter } }).catch(() => undefined);
  void load();
}

export function toggleExpanded(id: string) {
  set((s) => ({ expanded: { ...s.expanded, [id]: !s.expanded[id] } }));
}

export function setDragging(id: string | null) {
  set({ dragging: id });
}

export function setHighlight(id: string | null) {
  set({ highlight: id });
  if (id)
    setTimeout(() => {
      if (get().highlight === id) set({ highlight: null });
    }, 1800);
}

const nameOf = (key: SectionKey) =>
  key === TODO ? "TODO" : key === DONE ? "DONE" : (get().sections.find((s) => s.id === key)?.name ?? key);

/** 카드 옮기기(끌어 놓기·메뉴·단축키) — 알림 [되돌리기] */
export async function moveCard(id: string, to: SectionKey, at?: { x: number; y: number }) {
  const r = repo;
  if (!r) return;
  // 축하는 저장을 기다리지 않고 놓는 순간 시작(6절)
  if (to === DONE && get().done.every((c) => c.id !== id)) celebrateDone(at);
  await flushAll();
  if (repo !== r) return;
  let res: Awaited<ReturnType<JournalRepository["kanban"]["move"]>>;
  try {
    res = await track(() => r.kanban.move(id, to));
  } catch (e) {
    reportError(e);
    return;
  }
  if (repo !== r || !res) return;
  const kids = res.changed.length - 1;
  await afterChange(r, res.changed);
  const undo = res.undo;
  toast(
    to === DONE && kids > 0 ? STR.kanban.movedWithChildren(nameOf(to), kids) : STR.kanban.moved(nameOf(to)),
    {
      label: STR.toast.undo,
      run: () => void undoMove(r, undo, res!.changed),
    },
  );
}

async function undoMove(
  r: JournalRepository,
  undo: Parameters<JournalRepository["kanban"]["restore"]>[0],
  ids: string[],
) {
  if (repo !== r) return;
  try {
    await track(() => r.kanban.restore(undo));
  } catch (e) {
    reportError(e);
    return;
  }
  await afterChange(r, ids);
}

/** 주간 보드 화면·중요 업무 목록·칸반을 함께 맞춘다 */
async function afterChange(r: JournalRepository, ids: string[]) {
  if (repo !== r) return;
  await syncItems(ids);
  await refreshImportant();
  notifyItemsChanged();
  await load();
}

/** 옆 섹션으로(Alt+Shift+←/→) */
export function neighborKey(id: string, dir: -1 | 1): SectionKey | null {
  const s = get();
  const keys = columnKeys(s);
  const card = s.openCards.find((c) => c.id === id) ?? s.done.find((c) => c.id === id);
  if (!card) return null;
  const cur = s.done.some((c) => c.id === id) ? DONE : (card.sectionId ?? TODO);
  const i = keys.indexOf(cur) + dir;
  return i >= 0 && i < keys.length ? keys[i]! : null;
}

export async function statusLog(id: string): Promise<StatusLogRow[]> {
  return repo ? repo.kanban.statusLog(id) : [];
}

// ── 섹션 ───────────────────────────────────────
export function sectionError(e: unknown): string | null {
  if (e instanceof KanbanError) return STR.kanban.sectionProblem[e.problem] ?? e.problem;
  return null;
}

export async function createSection(
  name: string,
  color: SectionColor,
  icon: string | null = null,
): Promise<string | null> {
  const r = repo;
  if (!r) return null;
  let made: KanbanSection;
  try {
    made = await track(() => r.kanban.createSection(name, color));
  } catch (e) {
    const msg = sectionError(e);
    if (msg) return msg;
    reportError(e);
    return null;
  }
  if (repo !== r) return null;
  await load();
  if (repo !== r) return null;
  if (icon && icon !== defaultColumnIcon(made.id, made.name)) setColumnIcon(made.id, icon);
  placeNewInFree(made.id);
  return null;
}

/**
 * 자유 배치에 새 열 자리(3절) — 보이는 영역 안 빈자리, 없으면 맨 아래 왼쪽. 그 자리로 스크롤 + 잠깐 강조.
 * 균등 분할이면 강조만.
 */
function placeNewInFree(key: string) {
  const l = get().layout;
  const board = document.querySelector<HTMLElement>('[data-testid="kanban-board"]');
  if (l.mode === "free" && board) {
    const others = Object.entries(layoutRects())
      .filter(([k]) => k !== key)
      .map(([, v]) => v);
    const spot = freeSpot(others, {
      x: board.scrollLeft,
      y: board.scrollTop,
      w: board.clientWidth - 32,
      h: board.clientHeight - 24,
    });
    saveLayout({ ...l, rects: { ...layoutRects(), [key]: spot } });
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(`[data-testid="kanban-free-item"][data-key="${CSS.escape(key)}"]`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" }),
    );
  }
  flash(key);
}

export async function updateSection(
  id: string,
  patch: { name?: string; color?: SectionColor },
): Promise<string | null> {
  const r = repo;
  if (!r) return null;
  try {
    await track(() => r.kanban.updateSection(id, patch));
  } catch (e) {
    const msg = sectionError(e);
    if (msg) return msg;
    reportError(e);
    return null;
  }
  await load();
  return null;
}

/** 섹션을 사용자 섹션 순서 안의 toIndex 자리로(머리 끌기·Alt+Shift+←/→, improve-v22-spec 3절) — 되돌리기 알림 */
export async function placeSection(id: string, toIndex: number) {
  const r = repo;
  if (!r) return;
  const before = get().sections.map((s) => s.id);
  const from = before.indexOf(id);
  if (from < 0) return;
  const ids = before.filter((x) => x !== id);
  const at = Math.max(0, Math.min(ids.length, toIndex > from ? toIndex - 1 : toIndex));
  ids.splice(at, 0, id);
  if (ids.join() === before.join()) return;
  const name = get().sections[from]!.name;
  try {
    await track(() => r.kanban.reorderSections(ids));
  } catch (e) {
    reportError(e);
    return;
  }
  await load();
  toast(STR.kanban.sectionMoved(name), {
    label: STR.toast.undo,
    run: () =>
      void (async () => {
        if (repo !== r) return;
        await track(() => r.kanban.reorderSections(before)).catch(reportError);
        await load();
      })(),
  });
}

export async function moveSection(id: string, dir: -1 | 1) {
  const r = repo;
  if (!r) return;
  const ids = get().sections.map((s) => s.id);
  const i = ids.indexOf(id),
    j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  await track(() => r.kanban.reorderSections(ids)).catch(reportError);
  await load();
}

export async function deleteSection(id: string) {
  const r = repo;
  if (!r) return;
  let undo: Awaited<ReturnType<JournalRepository["kanban"]["deleteSection"]>>;
  try {
    undo = await track(() => r.kanban.deleteSection(id));
  } catch (e) {
    reportError(e);
    return;
  }
  await afterChange(r, undo.itemIds);
  toast(STR.kanban.sectionDeleted(undo.section.name), {
    label: STR.toast.undo,
    run: () =>
      void (async () => {
        if (repo !== r) return;
        await track(() => r.kanban.restoreSection(undo)).catch(reportError);
        await afterChange(r, undo.itemIds);
      })(),
  });
}

/** 이 섹션의 카드 모두 TODO로 */
export async function clearSection(id: string) {
  const r = repo;
  if (!r) return;
  const ids = get()
    .openCards.filter((c) => c.sectionId === id)
    .map((c) => c.id);
  for (const cid of ids) await track(() => r.kanban.move(cid, TODO)).catch(reportError);
  await afterChange(r, ids);
}

// ── 일괄 완료 ───────────────────────────────────────
export async function bulkPreview(o: Parameters<JournalRepository["kanban"]["bulkPreview"]>[0]) {
  return repo ? repo.kanban.bulkPreview(o) : null;
}

export async function bulkComplete(cards: KanbanCard[], mode: "record" | "now") {
  const r = repo;
  if (!r || !cards.length) return;
  await flushAll();
  if (repo !== r) return;
  let info: Awaited<ReturnType<JournalRepository["kanban"]["bulkComplete"]>>;
  try {
    info = await track(() => r.kanban.bulkComplete(cards, mode));
  } catch (e) {
    reportError(e);
    return;
  }
  const ids = cards.flatMap((c) => [c.id, ...c.children.map((x) => x.id)]);
  await afterChange(r, ids);
  toast(STR.kanban.bulkDone(info.count), { label: STR.toast.undo, run: () => void undoBulk(info.id, ids) });
}

export async function listBulk() {
  return repo ? repo.kanban.listBulk() : [];
}

export async function undoBulk(id: string, ids?: string[]) {
  const r = repo;
  if (!r) return;
  try {
    const n = await track(() => r.kanban.undoBulk(id));
    await afterChange(r, ids ?? []);
    toast(STR.kanban.bulkUndone(n));
  } catch (e) {
    reportError(e);
  }
}

/** 지금 일지의 저장소(창·대화상자가 직접 쓰기 — 같은 일지인지 확인용) */
export const kanbanRepo = () => repo;

// ── 카드 내용 고치기(항목 추가·편집 창, 카드 메뉴) — 그 칸을 저장소에서 읽어 그대로 다시 쓴다 ──────────────

async function readCell(r: JournalRepository, date: DateStr, categoryId: string): Promise<ItemDraft[]> {
  const wk = await r.getWeek(weekIdOf(date));
  return (wk.items[cellKey(date, categoryId)] ?? []).map((it) => ({ ...it }));
}

/** 같은 주를 보고 있으면 주간 보드를 새로 읽는다 */
async function refreshBoardIfShown(date: DateStr) {
  const v = useBoard.getState().view;
  if (v && v.weekId === weekIdOf(date)) await reloadBoard();
}

async function writeCell(r: JournalRepository, date: DateStr, categoryId: string, items: ItemDraft[]) {
  await track(() => r.saveCell(date, categoryId, items));
  if (repo !== r) return;
  await refreshBoardIfShown(date);
  await refreshImportant();
  notifyItemsChanged();
}

export interface NewItems {
  categoryId: string;
  date: DateStr;
  sectionId: string | null;
  drafts: ItemDraft[];
  repeat: boolean;
}

/** 칸 맨 끝에 덧붙이기 — 본 항목마다 카드 1장 */
export async function addItems(n: NewItems): Promise<boolean> {
  const r = repo;
  const drafts = n.drafts.filter((d) => d.text.trim());
  if (!r || !drafts.length) return false;
  if (drafts[0]!.depth === 1) drafts[0] = { ...drafts[0]!, depth: 0 };
  await flushAll();
  if (repo !== r) return false;
  try {
    const cur = await readCell(r, n.date, n.categoryId);
    await writeCell(r, n.date, n.categoryId, [...cur, ...drafts]);
    if (repo !== r) return false;
    const heads = drafts.filter((d) => d.depth === 0).map((d) => d.id);
    if (n.sectionId) await track(() => r.kanban.placeInSection(heads, n.sectionId!));
    if (n.repeat)
      for (const g of groupItems(drafts.map((d, i) => ({ ...d, seq: i + 1 }))))
        await track(() => r.enableRepeat([g.head.id, ...g.children.map((c) => c.id)], !!g.head.flagged));
    toast(STR.kanban.added(heads.length));
    await refreshBoardIfShown(n.date);
    await load();
    return true;
  } catch (e) {
    reportError(e);
    return false;
  }
}

/** 카드(본 항목 + 세부 항목) 내용 바꾸기 — id가 같은 항목은 표시를 이어받는다 */
export async function replaceCard(card: KanbanCard, drafts: ItemDraft[]): Promise<boolean> {
  const r = repo;
  const next = drafts.filter((d) => d.text.trim());
  if (!r || !next.length) return false;
  if (next[0]!.depth === 1) next[0] = { ...next[0]!, depth: 0 };
  await flushAll();
  if (repo !== r) return false;
  try {
    const cur = await readCell(r, card.date, card.categoryId);
    const ids = new Set([card.id, ...card.children.map((c) => c.id)]);
    const at = cur.findIndex((x) => x.id === card.id);
    if (at < 0) return false;
    const rest = cur.filter((x) => !ids.has(x.id));
    rest.splice(at, 0, ...next);
    await writeCell(r, card.date, card.categoryId, rest);
    await load();
    return true;
  } catch (e) {
    reportError(e);
    return false;
  }
}

/** 카드 본 항목 하나의 표시 바꾸기(★·마감일·시작 시각) */
export async function patchCard(card: KanbanCard, patch: Partial<ItemDraft>) {
  const r = repo;
  if (!r) return;
  await flushAll();
  try {
    const cur = await readCell(r, card.date, card.categoryId);
    await writeCell(
      r,
      card.date,
      card.categoryId,
      cur.map((x) => (x.id === card.id ? { ...x, ...patch } : x)),
    );
    await load();
  } catch (e) {
    reportError(e);
  }
}

/** 카드 ⋯ [↻ 매주 반복 켜기/끄기]·Alt+R(improve-v23-spec 7절) — 주간 보드 toggleRepeat와 같은 규칙, 알림 [되돌리기] */
export async function toggleCardRepeat(card: KanbanCard) {
  const r = repo;
  if (!r) return;
  await flushAll();
  if (repo !== r) return;
  try {
    const rules = await r.listRecurrences();
    const running =
      card.recurrenceId && rules.some((x) => x.id === card.recurrenceId && x.endWeek === null)
        ? card.recurrenceId
        : null;
    const week = weekIdOf(card.date);
    const after = async () => {
      if (repo !== r) return;
      await reloadBoard();
      await load();
    };
    if (running) {
      const undo = await track(() => r.disableRepeat(running, week));
      await after();
      toast(STR.repeat.off, {
        label: STR.toast.undo,
        run: () => void track(() => r.restoreRepeat(undo)).then(after),
      });
    } else {
      const ids = [card.id, ...card.children.filter((c) => c.text.trim()).map((c) => c.id)];
      const rule = await track(() => r.enableRepeat(ids, Boolean(card.flagged)));
      await after();
      toast(STR.repeat.on(DAY_LABELS[rule.weekday - 1]!), {
        label: STR.toast.undo,
        run: () => void track(() => r.disableRepeat(rule.id, week)).then(after),
      });
    }
  } catch (e) {
    reportError(e);
  }
}

/** 카드가 지금 매주 반복 중인지(메뉴 글자용) */
export async function cardRepeating(card: KanbanCard): Promise<boolean> {
  const r = repo;
  if (!r || !card.recurrenceId) return false;
  return (await r.listRecurrences()).some((x) => x.id === card.recurrenceId && x.endWeek === null);
}

/** 카드 지우기(본 항목 + 세부 항목) — 알림 [되돌리기] */
export async function deleteCard(card: KanbanCard) {
  const r = repo;
  if (!r) return;
  await flushAll();
  try {
    const before = await readCell(r, card.date, card.categoryId);
    const ids = new Set([card.id, ...card.children.map((c) => c.id)]);
    const relations = await r.itemRelations([...ids]);
    await writeCell(
      r,
      card.date,
      card.categoryId,
      before.filter((x) => !ids.has(x.id)),
    );
    await load();
    toast(STR.kanban.cardDeleted(card.children.length), {
      label: STR.toast.undo,
      run: () =>
        void (async () => {
          if (repo !== r) return;
          await writeCell(r, card.date, card.categoryId, before);
          await track(() => r.restoreItemRelations(relations)).catch(reportError);
          await load();
        })(),
    });
  } catch (e) {
    reportError(e);
  }
}

/** 카드의 원래 칸(편집 창이 세부 항목 표시까지 이어받도록) */
export async function cardDrafts(card: KanbanCard): Promise<ItemDraft[]> {
  const r = repo;
  if (!r) return [];
  const cur = await readCell(r, card.date, card.categoryId);
  const ids = new Set([card.id, ...card.children.map((c) => c.id)]);
  return cur.filter((x) => ids.has(x.id));
}

/** Cabinet 줄(폴더·링크)을 카드에 놓기 = 그 항목에 연결(improve-v21-spec 7절) */
export async function linkCabinetItem(itemId: string, entryId: string) {
  const r = repo;
  if (!r) return;
  try {
    const { items, links } = await r.listCabinet();
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    const mine = links.filter((l) => l.itemId === itemId);
    if (mine.some((l) => l.entryId === entryId)) return;
    await track(() =>
      r.setCabinetLinks(itemId, [
        ...mine.map((l) => (l.categoryId ? { categoryId: l.categoryId } : { entryId: l.entryId! })),
        { entryId },
      ]),
    );
    toast(STR.kanban.cabinetLinked(item.title));
    notifyItemsChanged();
    await load();
  } catch (e) {
    reportError(e);
  }
}

/** 중요 업무 목록에서 누른 항목 → 그 카드 강조(세부 항목이면 본 항목 카드) */
export async function revealInKanban(itemId: string) {
  const find = () => {
    const s = get();
    const all = [...s.openCards, ...s.done];
    return all.find((c) => c.id === itemId) ?? all.find((c) => c.children.some((x) => x.id === itemId));
  };
  let card = find();
  if (!card && get().filter.period !== "all") {
    setFilter({ period: "all" });
    await load();
    card = find();
  }
  if (!card) return;
  if (get().done.some((c) => c.id === card!.id))
    set((s) => ({ expanded: { ...s.expanded, [card!.id]: true } }));
  setHighlight(card.id);
}
