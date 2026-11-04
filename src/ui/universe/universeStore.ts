// Universe 화면 상태(universe-spec 4절, UV1 — 읽기만). 그래프는 열 때 일지에서 다시 만든다(파생 자료 — 저장하지 않음).
// 다른 워크스페이스는 읽기 전용으로 잠깐 열어 읽고 바로 닫는다(구조 판이 다르면 빼고 안내, spec 7절).
import { create } from "zustand";
import { JournalRepository, RelationError } from "../../data/repository";
import { journalPath } from "../../data/session";
import { LATEST_SCHEMA_VERSION, readSchemaVersion } from "../../data/migrate";
import {
  DEFAULT_FILTER,
  buildGraph,
  levelRange,
  mergeGraphs,
  endOf,
  nid,
  type TimeLevel,
  type URelationType,
  type UFilter,
  type UGraph,
  type UNode,
} from "../../domain/universe";
import { sameDir, type WorkspaceEntry } from "../../domain/workspace";
import { today as todayOf, type DateStr } from "../../domain/week";
import { STR } from "../../shared/strings";
import { goToWeek, reportError, revealItem, setTagFilter, toast, useBoard } from "../board/boardStore";
import { openCabinet } from "../cabinet/cabinetStore";
import { closeInsights, openInsights } from "../insights/insightsStore";
import { revealBox, useNote } from "../note/noteStore";
import { onDetach, setSettingsOpen, switchWorkspace } from "../common/appController";
import { useAppStore } from "../common/appStore";

export type UMode = "focus" | "galaxy";
export type UView = "map" | "list";

interface UniverseState {
  open: boolean;
  loading: boolean;
  mode: UMode;
  view: UView;
  /** 공간 폴더 → 그 공간 그래프 */
  graphs: Record<string, UGraph>;
  /** 함께 볼 공간 폴더(지금 공간은 늘 포함) */
  wsOn: string[];
  /** 읽지 못한 공간 안내 */
  notices: string[];
  seed: string | null;
  selected: string | null;
  filter: UFilter;
  time: { level: TimeLevel; anchor: DateStr; active: boolean };
  /** 직접 연결 대화상자(UV2) — edit = 고치기 */
  linkDialog: null | {
    fromId: string;
    edit?: { relId: string; toId: string; type: URelationType; note: string };
  };
  canUndoRel: boolean;
}

const today = () => todayOf(useAppStore.getState().platform?.now() ?? new Date());

export const useUniverse = create<UniverseState>(() => ({
  open: false,
  loading: false,
  mode: "focus",
  view: "map",
  graphs: {},
  wsOn: [],
  notices: [],
  seed: null,
  selected: null,
  filter: DEFAULT_FILTER,
  time: { level: "year", anchor: todayOf(new Date()), active: false },
  linkDialog: null,
  canUndoRel: false,
}));

const set = useUniverse.setState;
const get = useUniverse.getState;

/** 불러오기 차례 — 일지가 바뀌거나 다시 열면 앞선 불러오기 결과는 버린다(CLAUDE.md 4-7) */
let loadSeq = 0;

/** 일지를 닫기 직전(공간 전환·복원 등): 진행 중인 불러오기를 버리고 지도·선택을 비운다 */
function detachUniverse() {
  loadSeq++;
  relUndo.length = 0;
  relRedo.length = 0;
  set({
    graphs: {},
    seed: null,
    selected: null,
    open: false,
    loading: false,
    linkDialog: null,
    canUndoRel: false,
  });
}

// ── 직접 연결(UV2, spec 5-1) — 쓰기는 지금 공간 일지에만, await 뒤에는 같은 일지인지 확인(CLAUDE.md 4-7) ──
interface RelStep {
  repo: JournalRepository;
  undo(): Promise<unknown>;
  redo(): Promise<unknown>;
}
const relUndo: RelStep[] = [];
const relRedo: RelStep[] = [];
const syncRelUndo = () => set({ canUndoRel: relUndo.length > 0 });

/** 지금 연 일지(저장소·폴더) */
function currentJournal(): { repo: JournalRepository; dir: string } | null {
  const j = useAppStore.getState().journal;
  return j.state === "ready" ? { repo: j.repo, dir: j.dataDir } : null;
}

/** 이 일지 그래프만 다시 읽기(쓰기 뒤) — 그사이 일지가 바뀌었으면 버린다 */
async function refreshCurrent(repo: JournalRepository) {
  const seq = loadSeq;
  const g = await loadCurrent();
  const j = currentJournal();
  if (!g || !j || j.repo !== repo || seq !== loadSeq) return;
  set((s) => ({ graphs: { ...s.graphs, [j.dir]: g } }));
}

const relMessage = (e: unknown) =>
  e instanceof RelationError
    ? STR.universe.rel.problem[e.problem]
    : e instanceof Error
      ? e.message
      : String(e);

/** 쓰기 한 번: 지금 일지 저장소로 실행 → 일지가 그대로면 다시 그림·실행 취소 쌓기. 실패하면 오류 글 */
async function relWrite(
  run: (repo: JournalRepository) => Promise<Omit<RelStep, "repo"> | null>,
  message: string,
): Promise<string | null> {
  const j = currentJournal();
  if (!j) return STR.universe.rel.problem.missing;
  let step: Omit<RelStep, "repo"> | null;
  try {
    step = await run(j.repo);
  } catch (e) {
    return relMessage(e);
  }
  if (currentJournal()?.repo !== j.repo) return null; // 그사이 공간이 바뀜 — 화면에 반영하지 않는다
  if (step) {
    relUndo.push({ repo: j.repo, ...step });
    relRedo.length = 0;
    syncRelUndo();
  }
  await refreshCurrent(j.repo);
  toast(message, { label: STR.universe.rel.undo, run: () => void undoRelation() });
  return null;
}

/** 지금 공간 노드만 이을 수 있다 */
function ownEnd(n: UNode | undefined) {
  const cur = currentDir();
  if (!n || !cur || !sameDir(n.ws, cur)) return null;
  return endOf(n);
}

export function openLinkDialog(fromId: string, edit?: NonNullable<UniverseState["linkDialog"]>["edit"]) {
  set({ linkDialog: { fromId, ...(edit ? { edit } : {}) } });
}
export function closeLinkDialog() {
  set({ linkDialog: null });
}

const nodeById = (id: string) => combined().nodes.find((n) => n.id === id);

/** 새 직접 연결 저장 — 성공하면 null, 아니면 화면에 보일 까닭 */
export async function addRelation(fromId: string, toId: string, type: URelationType, note: string) {
  const from = ownEnd(nodeById(fromId));
  const to = ownEnd(nodeById(toId));
  if (!from || !to) return STR.universe.rel.otherSpaceOnly;
  return relWrite(async (repo) => {
    const r = await repo.addRelation({ from, to, type, note });
    return { undo: () => repo.deleteRelation(r.id), redo: () => repo.restoreRelation(r.id) };
  }, STR.universe.rel.saved);
}

/** 종류·설명·방향 고치기 */
export async function updateRelation(
  relId: string,
  patch: { type?: URelationType; note?: string; swap?: boolean },
) {
  return relWrite(async (repo) => {
    const before = await repo.updateRelation(relId, patch);
    return {
      undo: () => repo.updateRelation(relId, { type: before.type, note: before.note, swap: patch.swap }),
      redo: () => repo.updateRelation(relId, patch),
    };
  }, STR.universe.rel.updated);
}

/** 끊기(원문은 그대로, 되돌리기 가능) */
export async function removeRelation(relId: string) {
  return relWrite(async (repo) => {
    await repo.deleteRelation(relId);
    return { undo: () => repo.restoreRelation(relId), redo: () => repo.deleteRelation(relId) };
  }, STR.universe.rel.removed);
}

async function stepRelation(from: RelStep[], to: RelStep[], pick: (s: RelStep) => Promise<unknown>) {
  const step = from.pop();
  syncRelUndo();
  if (!step) return toast(STR.universe.rel.nothingToUndo);
  if (currentJournal()?.repo !== step.repo) return; // 다른 일지의 작업은 버린다
  try {
    await pick(step);
  } catch (e) {
    return toast(relMessage(e));
  }
  to.push(step);
  syncRelUndo();
  await refreshCurrent(step.repo);
  toast(STR.universe.rel.undone);
}
/** Universe 안 Ctrl+Z / Ctrl+Y — 직접 연결 작업만 */
export const undoRelation = () => stepRelation(relUndo, relRedo, (s) => s.undo());
export const redoRelation = () => stepRelation(relRedo, relUndo, (s) => s.redo());
onDetach(detachUniverse);

function currentDir(): string | null {
  const j = useAppStore.getState().journal;
  return j.state === "ready" ? j.dataDir : null;
}

function entryOf(dir: string): WorkspaceEntry | undefined {
  return useAppStore.getState().workspaces.find((e) => sameDir(e.dir, dir));
}

/** 지금 공간 + 켠 다른 공간의 합친 그래프 */
export function combined(s: Pick<UniverseState, "graphs" | "wsOn"> = get()): UGraph {
  const cur = currentDir();
  const keys = Object.keys(s.graphs).filter(
    (k) => (cur && sameDir(k, cur)) || s.wsOn.some((d) => sameDir(d, k)),
  );
  // 지금 공간을 맨 앞에(은하 배치에서 가운데)
  keys.sort((a, b) => (cur && sameDir(a, cur) ? -1 : cur && sameDir(b, cur) ? 1 : 0));
  return mergeGraphs(keys.map((k) => s.graphs[k]!));
}

/** 필터에 시간 범위를 끼운 값 */
export function effectiveFilter(s: Pick<UniverseState, "filter" | "time"> = get()): UFilter {
  return { ...s.filter, range: s.time.active ? levelRange(s.time.level, s.time.anchor) : null };
}

async function loadCurrent(): Promise<UGraph | null> {
  const j = useAppStore.getState().journal;
  if (j.state !== "ready") return null;
  const e = entryOf(j.dataDir);
  const snap = await j.repo.getUniverseSnapshot({
    key: j.dataDir,
    name: e?.name ?? STR.universe.thisSpace,
    color: e?.color ?? "c1",
  });
  return buildGraph(snap);
}

/** 다른 공간 일지를 읽기 전용으로 — 일지 파일이 없거나 구조 판이 다르면 null + 안내 */
async function loadOther(dir: string): Promise<{ graph: UGraph | null; notice?: string }> {
  const p = useAppStore.getState().platform;
  const e = entryOf(dir);
  const name = e?.name ?? dir;
  if (!p) return { graph: null };
  const path = journalPath(p, dir);
  try {
    if (!(await p.stat(path)).exists) return { graph: null, notice: STR.universe.wsMissing(name) };
    const driver = await p.openDatabase(path);
    try {
      const v = await readSchemaVersion(driver);
      if (v !== LATEST_SCHEMA_VERSION) return { graph: null, notice: STR.universe.wsOldSchema(name) };
      const repo = new JournalRepository(driver, () => p.now());
      const snap = await repo.getUniverseSnapshot({ key: dir, name, color: e?.color ?? "c1" });
      return { graph: buildGraph(snap) };
    } finally {
      await driver.close().catch(() => undefined);
    }
  } catch (err) {
    return {
      graph: null,
      notice: STR.universe.wsFailed(name, err instanceof Error ? err.message : String(err)),
    };
  }
}

/** 기본 씨앗: 오늘까지의 가장 최근 항목(없으면 첫 업무, 그것도 없으면 공간) */
function defaultSeed(g: UGraph): string | null {
  const t = today();
  const entries = g.nodes
    .filter((n) => n.kind === "entry" && (n.date ?? "") <= t)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || b.id.localeCompare(a.id));
  return entries[0]?.id ?? g.nodes.find((n) => n.kind === "category")?.id ?? g.nodes[0]?.id ?? null;
}

/** Universe 열기(레일·Alt+5). seedRef = 보드에서 고른 항목 id(있으면 그 항목이 가운데) */
export async function openUniverse(seedRef?: string) {
  const dir = currentDir();
  if (!dir) return;
  if (useAppStore.getState().settingsOpen) setSettingsOpen(false);
  closeInsights();
  set({ open: true, loading: true, notices: [] });
  const seq = ++loadSeq;
  const stale = () => seq !== loadSeq || !sameDir(currentDir() ?? "", dir);
  try {
    const cur = await loadCurrent();
    if (stale()) return;
    if (!cur) return;
    const graphs: Record<string, UGraph> = { [dir]: cur };
    const notices: string[] = [];
    const wsOn = get().wsOn.filter((d) => !sameDir(d, dir) && entryOf(d));
    for (const d of wsOn) {
      const r = await loadOther(d);
      if (stale()) return;
      if (r.graph) graphs[d] = r.graph;
      if (r.notice) notices.push(r.notice);
    }
    const seedId = seedRef ? nid(dir, "entry", seedRef) : null;
    const keep = get().seed;
    const all = mergeGraphs(Object.values(graphs));
    const has = (id: string | null) => !!id && all.nodes.some((n) => n.id === id);
    const seed = has(seedId) ? seedId : has(keep) ? keep : defaultSeed(cur);
    set({ graphs, wsOn, notices, seed, selected: seed, loading: false });
  } catch (e) {
    set({ loading: false });
    reportError(e);
  }
}

export function closeUniverse() {
  if (get().open) set({ open: false });
}

export function toggleUniverse() {
  if (get().open) closeUniverse();
  else void openUniverse();
}

export const setMode = (mode: UMode) => set({ mode });
export const setView = (view: UView) => set({ view });
export const setFilter = (patch: Partial<UFilter>) => set((s) => ({ filter: { ...s.filter, ...patch } }));
export const resetFilter = () => set({ filter: DEFAULT_FILTER });

/** 노드 고르기(상세 패널) */
export const select = (id: string | null) => set({ selected: id });

/** 그 노드를 가운데로(초점 보기) */
export function focusOn(id: string) {
  set({ seed: id, selected: id, mode: "focus" });
}

/** 다른 공간 켜기/끄기 — 켜면 읽기 전용으로 읽어 온다 */
export async function toggleWorkspace(dir: string) {
  const on = get().wsOn.some((d) => sameDir(d, dir));
  if (on) {
    set((s) => ({ wsOn: s.wsOn.filter((d) => !sameDir(d, dir)) }));
    return;
  }
  set({ loading: true });
  const seq = loadSeq;
  const r = await loadOther(dir);
  if (seq !== loadSeq) return; // 그 사이 일지가 바뀜
  set((s) => ({
    loading: false,
    wsOn: r.graph ? [...s.wsOn, dir] : s.wsOn,
    graphs: r.graph ? { ...s.graphs, [dir]: r.graph } : s.graphs,
    notices: r.notice ? [...s.notices.filter((n) => n !== r.notice), r.notice] : s.notices,
  }));
}

// ── 시간 막대 ───────────────────────────────────────────────────────
const DOWN: Record<TimeLevel, TimeLevel> = { year: "month", month: "week", week: "day", day: "day" };
export function setTimeLevel(level: TimeLevel) {
  set((s) => ({ time: { ...s.time, level, active: true } }));
}
export function setTimeAnchor(anchor: DateStr) {
  set((s) => ({ time: { ...s.time, anchor, active: true } }));
}
/** 칸 누르기 = 한 단계 아래로(그 칸이 범위) */
export function drillTime(from: DateStr) {
  set((s) => ({ time: { level: DOWN[s.time.level], anchor: from, active: true } }));
}
export function clearTime() {
  set((s) => ({ time: { ...s.time, active: false } }));
}

// ── 원본 열기(첨부 U-05) ────────────────────────────────────────────
function noteWeekReady(weekId: string): Promise<void> {
  if (useNote.getState().weekId === weekId) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(done, 2000);
    const un = useNote.subscribe((s) => s.weekId === weekId && done());
    function done() {
      clearTimeout(t);
      un();
      resolve();
    }
  });
}

/** 노드의 원본 자리로: 항목 = 보드의 그 칸, 메모 = 그 주 메모 상자, Cabinet = 그 줄, 업무 = 경과 타임라인, 태그 = 보드 태그 필터 */
export async function revealNode(n: UNode) {
  const cur = currentDir();
  if (cur && !sameDir(n.ws, cur)) {
    // 다른 공간: 그 공간으로 전환한 뒤 같은 자리로
    const err = await switchWorkspace(n.ws);
    if (err) return;
  }
  closeUniverse();
  try {
    if (n.kind === "entry" && n.date && n.categoryId) {
      await revealItem({ id: n.refId, date: n.date, categoryId: n.categoryId });
      const shown = useBoard.getState().view?.categories.some((c) => c.category.id === n.categoryId);
      if (!shown && useBoard.getState().tagFilter.length) {
        setTagFilter([]);
        await new Promise((r) => setTimeout(r, 0));
        await revealItem({ id: n.refId, date: n.date, categoryId: n.categoryId });
      }
    } else if (n.kind === "note" && n.weekId) {
      if (useBoard.getState().weekId !== n.weekId) await goToWeek(n.weekId);
      await noteWeekReady(n.weekId);
      if (!n.refId.startsWith("legacy-")) revealBox(n.refId);
    } else if (n.kind === "cabinet") {
      await openCabinet({ itemId: n.refId });
    } else if (n.kind === "category" && n.categoryId) {
      await openInsights(n.categoryId, "timeline");
    } else if (n.kind === "tag") {
      setTagFilter([n.refId]);
    }
  } catch (e) {
    reportError(e);
  }
}

// 공간을 바꾸면(Universe 밖에서) 다음에 열 때 새로 읽게 비운다
useAppStore.subscribe((s, prev) => {
  const a = s.journal.state === "ready" ? s.journal.dataDir : null;
  const b = prev.journal.state === "ready" ? prev.journal.dataDir : null;
  if (a !== b) set({ graphs: {}, seed: null, selected: null, open: false });
});
