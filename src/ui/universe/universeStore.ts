// Universe 화면 상태(universe-spec 4절, UV1 — 읽기만). 그래프는 열 때 일지에서 다시 만든다(파생 자료 — 저장하지 않음).
// 다른 워크스페이스는 읽기 전용으로 잠깐 열어 읽고 바로 닫는다(구조 판이 다르면 빼고 안내, spec 7절).
import { create } from "zustand";
import { CardError, JournalRepository, RelationError } from "../../data/repository";
import { buildPack, type PackItem, type PackKind } from "../../domain/contextPack";
import { baseName, dirOf, exportPathProblem } from "../../platform";
import {
  sourceKey,
  sourceState,
  type CardDraft,
  type CardSourceKind,
  type CardStatus,
  type KnowledgeCard,
  type SourceNow,
  type SourceState,
} from "../../domain/knowledgeCard";
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
  /** 지식 카드 편집기(UV3) */
  cardEditor: null | { draft: CardDraft; revision?: number; error?: string | null };
  /** 작성 중이던 임시본이 있을 때 [이어 쓰기]/[버리기] 묻기 */
  draftPrompt: null | { draft: CardDraft; fresh: CardDraft };
  /** 고른 카드의 출처별 지금 상태 */
  cardView: null | {
    cardId: string;
    card: KnowledgeCard;
    states: Record<string, { state: SourceState; now: SourceNow | null }>;
  };
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
  cardEditor: null,
  draftPrompt: null,
  cardView: null,
}));

/** 보드 ◆ 표시(UV3, spec D9): 카드 출처인 항목 id → 카드 id들 — 지금 공간 일지 기준 */
export const useCardMarks = create<{ byEntry: Record<string, string[]> }>(() => ({ byEntry: {} }));

const set = useUniverse.setState;
const get = useUniverse.getState;

/** 불러오기 차례 — 일지가 바뀌거나 다시 열면 앞선 불러오기 결과는 버린다(CLAUDE.md 4-7) */
let loadSeq = 0;

/** 일지를 닫기 직전(공간 전환·복원 등): 진행 중인 불러오기를 버리고 지도·선택을 비운다 */
function detachUniverse() {
  loadSeq++;
  relUndo.length = 0;
  relRedo.length = 0;
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = null;
  useCardMarks.setState({ byEntry: {} });
  set({
    graphs: {},
    seed: null,
    selected: null,
    open: false,
    loading: false,
    linkDialog: null,
    canUndoRel: false,
    cardEditor: null,
    draftPrompt: null,
    cardView: null,
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
  e instanceof CardError
    ? STR.universe.card.problem[e.problem]
    : e instanceof RelationError
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
  void refreshCardMarks(j.repo);
  const sel = get().cardView?.cardId;
  if (sel) void loadCardView(sel);
  toast(message, { label: STR.universe.rel.undo, run: () => void undoRelation() });
  return null;
}

// ── 지식 카드(UV3, spec 5-2) — 쓰기는 relWrite 한 길(지금 공간 일지에만·같은 실행 취소 기록) ──
let draftTimer: ReturnType<typeof setTimeout> | null = null;
const DRAFT_SAVE_MS = 800;

/** 보드 ◆ 표시 다시 읽기 — 그사이 일지가 바뀌었으면 버린다 */
export async function refreshCardMarks(repo = currentJournal()?.repo) {
  if (!repo) return;
  const byEntry = await repo.cardSourceEntries().catch(() => ({}));
  if (currentJournal()?.repo === repo) useCardMarks.setState({ byEntry });
}

const CARD_SOURCE_KINDS_OK: CardSourceKind[] = ["entry", "note", "cabinet", "category", "tag"];
function sourceOf(n: UNode | undefined): CardDraft["sources"][number] | null {
  const cur = currentDir();
  if (!n || !cur || !sameDir(n.ws, cur) || !CARD_SOURCE_KINDS_OK.includes(n.kind as CardSourceKind))
    return null;
  return n.kind === "note"
    ? { kind: "note", sourceId: n.refId, week: n.weekId ?? null }
    : { kind: n.kind as CardSourceKind, sourceId: n.refId };
}

const emptyDraft = (): CardDraft => ({
  type: "solution",
  title: "",
  summary: "",
  conditions: "",
  body: "",
  status: "draft",
  categoryIds: [],
  sources: [],
});

const draftOf = (c: KnowledgeCard): CardDraft => ({
  id: c.id,
  type: c.type,
  title: c.title,
  summary: c.summary,
  conditions: c.conditions,
  body: c.body,
  status: c.status,
  categoryIds: c.categoryIds,
  sources: c.sources.map((x) => ({
    kind: x.kind,
    sourceId: x.sourceId,
    ...(x.week ? { week: x.week } : {}),
  })),
});

/** [지식 카드로 정리] — 고른 별을 첫 출처로. 작성 중이던 임시본이 있으면 먼저 묻는다 */
export async function openCardEditor(fromId: string) {
  const n = nodeById(fromId);
  const src = sourceOf(n);
  const j = currentJournal();
  if (!n || !src || !j) return toast(STR.universe.card.otherSpaceOnly);
  const fresh: CardDraft = {
    ...emptyDraft(),
    title: n.kind === "entry" || n.kind === "note" ? n.title.slice(0, 120) : "",
    categoryIds: n.categoryId ? [n.categoryId] : n.kind === "category" ? [n.refId] : [],
    sources: [src],
  };
  const saved = await j.repo.getCardDraft().catch(() => null);
  if (currentJournal()?.repo !== j.repo) return;
  if (saved && !saved.id) set({ draftPrompt: { draft: saved, fresh } });
  else set({ cardEditor: { draft: fresh } });
}

export function resolveDraftPrompt(resume: boolean) {
  const p = get().draftPrompt;
  if (!p) return;
  set({ draftPrompt: null, cardEditor: { draft: resume ? p.draft : p.fresh } });
  if (!resume) void currentJournal()?.repo.saveCardDraft(null);
}

/** 카드 [고치기] */
export async function editCard(cardId: string) {
  const j = currentJournal();
  const c = await j?.repo.getCard(cardId);
  if (!c || !j || currentJournal()?.repo !== j.repo) return;
  set({ cardEditor: { revision: c.revision, draft: draftOf(c) } });
}

/** 편집 중 바꾸기 — 새 카드는 이 일지 app_meta에 임시본을 남긴다(창을 닫아도 복구) */
export function patchCardDraft(patch: Partial<CardDraft>) {
  const ed = get().cardEditor;
  if (!ed) return;
  const draft = { ...ed.draft, ...patch };
  set({ cardEditor: { ...ed, draft, error: null } });
  if (draft.id) return;
  const repo = currentJournal()?.repo;
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    draftTimer = null;
    if (repo && currentJournal()?.repo === repo) void repo.saveCardDraft(draft).catch(() => undefined);
  }, DRAFT_SAVE_MS);
}

export function addCardSource(nodeId: string) {
  const ed = get().cardEditor;
  const n = nodeById(nodeId);
  const src = sourceOf(n);
  if (!ed || !src) return;
  if (ed.draft.sources.some((x) => sourceKey(x) === sourceKey(src))) return;
  const cats =
    n?.categoryId && !ed.draft.categoryIds.includes(n.categoryId)
      ? [...ed.draft.categoryIds, n.categoryId]
      : ed.draft.categoryIds;
  patchCardDraft({ sources: [...ed.draft.sources, src], categoryIds: cats });
}
export function removeCardSource(key: string) {
  const ed = get().cardEditor;
  if (ed) patchCardDraft({ sources: ed.draft.sources.filter((x) => sourceKey(x) !== key) });
}

/** 편집기 닫기 — 새 카드의 임시본은 남긴다(다음에 [이어 쓰기]) */
export function closeCardEditor() {
  set({ cardEditor: null });
}

/** [저장] — 새 카드는 만들고 임시본을 지운다, 고치기는 revision이 같을 때만 */
export async function saveCard(): Promise<string | null> {
  const ed = get().cardEditor;
  if (!ed) return null;
  const d = ed.draft;
  let madeId: string | null = null;
  const err = await relWrite(
    async (repo) => {
      if (d.id) {
        const before = await repo.updateCard(d.id, d, ed.revision);
        const back = draftOf(before);
        return { undo: () => repo.updateCard(before.id, back), redo: () => repo.updateCard(before.id, d) };
      }
      const c = await repo.createCard(d);
      madeId = c.id;
      if (draftTimer) clearTimeout(draftTimer);
      draftTimer = null;
      await repo.saveCardDraft(null);
      return { undo: () => repo.deleteCard(c.id), redo: () => repo.restoreCard(c.id) };
    },
    d.id ? STR.universe.card.updated : STR.universe.card.saved,
  );
  if (err) {
    const cur = get().cardEditor;
    if (cur) set({ cardEditor: { ...cur, error: err } });
    return err;
  }
  set({ cardEditor: null });
  const id = d.id ?? madeId;
  if (id) {
    const node = nid(currentDir() ?? "", "card", id);
    set({ seed: node });
    select(node);
  }
  return null;
}

export async function setCardStatus(cardId: string, status: CardStatus) {
  return relWrite(async (repo) => {
    const before = await repo.setCardStatus(cardId, status);
    return { undo: () => repo.setCardStatus(cardId, before), redo: () => repo.setCardStatus(cardId, status) };
  }, STR.universe.card.statusChanged(STR.universe.card.statusName[status]));
}

export async function deleteCard(cardId: string) {
  const err = await relWrite(async (repo) => {
    await repo.deleteCard(cardId);
    return { undo: () => repo.restoreCard(cardId), redo: () => repo.deleteCard(cardId) };
  }, STR.universe.card.removed);
  if (!err && get().cardView?.cardId === cardId) set({ cardView: null, selected: null });
  return err;
}

export async function recheckCardSource(cardId: string, sourceRowId: string) {
  return relWrite(async (repo) => {
    await repo.recheckCardSource(cardId, sourceRowId);
    return null; // 다시 확인은 되돌리지 않는다(당시 발췌를 지금 원문으로 바꾼 것)
  }, STR.universe.card.rechecked);
}

/** 카드 상세: 출처마다 지금 원문·근거 상태 */
export async function loadCardView(cardId: string) {
  const j = currentJournal();
  if (!j) return;
  const card = await j.repo.getCard(cardId);
  if (currentJournal()?.repo !== j.repo) return;
  if (!card) return set({ cardView: null });
  const now = await j.repo.sourcesNow(card.sources);
  if (currentJournal()?.repo !== j.repo) return;
  const states: Record<string, { state: SourceState; now: SourceNow | null }> = {};
  for (const x of card.sources) {
    const n = now.get(sourceKey(x)) ?? null;
    states[x.id] = { state: sourceState(x, n), now: n };
  }
  set({ cardView: { cardId, card, states } });
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
export const select = (id: string | null) => {
  set({ selected: id });
  const n = id ? nodeById(id) : undefined;
  if (n?.kind === "card" && sameDir(n.ws, currentDir() ?? "")) void loadCardView(n.refId);
  else set({ cardView: null });
};

/** 그 노드를 가운데로(초점 보기) */
export function focusOn(id: string) {
  set({ seed: id, mode: "focus" });
  select(id);
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
  if (a !== b) set({ graphs: {}, seed: null, selected: null, open: false, cardView: null });
  // 보드 ◆ 표시는 공간을 열 때마다 그 일지에서(UV3)
  if (a && a !== b && s.journal.state === "ready") void refreshCardMarks(s.journal.repo);
});

/** 보드 ◆ → Universe에서 그 카드(가운데·상세) */
export async function openCard(cardId: string) {
  const dir = currentDir();
  if (!dir) return;
  if (!get().open) await openUniverse();
  const id = nid(dir, "card", cardId);
  if (combined().nodes.some((n) => n.id === id)) focusOn(id);
}

// ── 근거 묶음(UV4, spec 5-3) — 담은 것은 노드 id만(원문은 복사 직전에 다시 읽음), 지금 공간만 ──
export const usePack = create<{
  items: string[];
  question: string;
  purpose: string;
  includePaths: boolean;
  open: boolean;
  notice: string | null;
}>(() => ({ items: [], question: "", purpose: "", includePaths: false, open: false, notice: null }));
const setPack = usePack.setState;

function clearPack() {
  setPack({ items: [], question: "", purpose: "", includePaths: false, open: false, notice: null });
}
onDetach(clearPack); // 다른 일지의 원문이 묶음에 남지 않게(CLAUDE.md 4-7)

export function addToPack(nodeId: string) {
  const cur = currentDir();
  const n = combinedOrLive(nodeId);
  if (!cur || !n || n.kind === "workspace" || !sameDir(n.ws, cur))
    return toast(STR.universe.pack.otherSpaceOnly);
  const { items } = usePack.getState();
  if (items.includes(nodeId)) return toast(STR.universe.pack.already);
  const next = [...items, nodeId];
  setPack({ items: next, notice: null });
  toast(STR.universe.pack.added(next.length), {
    label: STR.universe.pack.openDrawer,
    run: () => void openPackDrawer(),
  });
}

/** 보드 항목 메뉴에서 담기 — Universe를 열지 않은 채 항목 노드 id로 */
export function addEntryToPack(entryId: string) {
  const cur = currentDir();
  if (!cur) return;
  const id = nid(cur, "entry", entryId);
  const { items } = usePack.getState();
  if (items.includes(id)) return toast(STR.universe.pack.already);
  const next = [...items, id];
  setPack({ items: next, notice: null });
  toast(STR.universe.pack.added(next.length), {
    label: STR.universe.pack.openDrawer,
    run: () => void openPackDrawer(),
  });
}

/** 노드 찾기 — Universe를 아직 안 열었으면 그래프 없이 null(서랍을 열 때 다시 읽는다) */
function combinedOrLive(nodeId: string) {
  return combined().nodes.find((n) => n.id === nodeId);
}

export async function openPackDrawer() {
  if (!get().open) await openUniverse();
  setPack({ open: true });
}
export const closePackDrawer = () => setPack({ open: false, notice: null });
export const togglePackDrawer = () => (usePack.getState().open ? closePackDrawer() : void openPackDrawer());
export const setPackField = (p: Partial<{ question: string; purpose: string; includePaths: boolean }>) =>
  setPack({ ...p, notice: null });
export function removeFromPack(id: string) {
  setPack((s) => ({ items: s.items.filter((x) => x !== id), notice: null }));
}
export function movePackItem(id: string, delta: -1 | 1) {
  const items = [...usePack.getState().items];
  const i = items.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= items.length) return;
  [items[i], items[j]] = [items[j]!, items[i]!];
  setPack({ items, notice: null });
}
export function emptyPack() {
  setPack({ items: [], notice: null });
  toast(STR.universe.pack.cleared);
}

/** 담은 노드 → 근거 묶음 글(그래프 기준) */
export function packFrom(g: UGraph, s = usePack.getState()) {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const missing = s.items.filter((id) => !byId.has(id));
  const C = STR.universe.card;
  const items: PackItem[] = s.items
    .map((id) => byId.get(id))
    .filter((n): n is UNode => !!n)
    .map((n) => {
      const cat = n.categoryId ? byId.get(nid(n.ws, "category", n.categoryId))?.title : undefined;
      const where =
        n.kind === "entry"
          ? [cat, n.date].filter(Boolean).join(" · ")
          : n.kind === "note"
            ? `메모 ${n.weekId ?? ""}`
            : n.kind === "card" && n.card
              ? `${C.typeName[n.card.type]} · ${C.statusName[n.card.status]}`
              : "";
      return {
        key: n.id,
        kind: n.kind as PackKind,
        kindLabel: STR.universe.kindName[n.kind],
        title: n.kind === "entry" ? "" : n.title,
        text: n.kind === "cabinet" ? "" : n.text,
        where,
        ...(n.target ? { target: n.target } : {}),
      };
    });
  const r = buildPack(items, { question: s.question, purpose: s.purpose, includePaths: s.includePaths });
  return { ...r, missing };
}

/** 복사·저장 직전: 원문을 다시 읽어 미리보기와 다르면 새로 그리고 다시 확인받는다 */
async function verifiedPack(): Promise<string | null> {
  const j = currentJournal();
  if (!j) return null;
  const s = usePack.getState();
  if (!s.question.trim()) {
    setPack({ notice: STR.universe.pack.needQuestion });
    return null;
  }
  const shown = packFrom(combined()).text;
  const fresh = await loadCurrent();
  if (!fresh || currentJournal()?.repo !== j.repo) return null;
  set((st) => ({ graphs: { ...st.graphs, [j.dir]: fresh } }));
  const now = packFrom(combined()).text;
  if (now !== shown) {
    setPack({ notice: STR.universe.pack.changed });
    return null;
  }
  return now;
}

export async function copyPack() {
  const text = await verifiedPack();
  const p = useAppStore.getState().platform;
  if (!text || !p) return;
  try {
    await p.writeClipboard(text);
    setPack({ notice: null });
    toast(STR.universe.pack.copied);
  } catch (e) {
    reportError(e);
  }
}

export async function savePackMarkdown() {
  const text = await verifiedPack();
  const j = currentJournal();
  const p = useAppStore.getState().platform;
  if (!text || !j || !p) return;
  try {
    const settings = await j.repo.getSettings();
    let dir = settings.ui.lastExportDir;
    if (!dir || !(await p.stat(dir)).isDir) {
      dir = p.join(j.dir, "exports");
      await p.ensureDir(dir);
    }
    const path = await p.pickSaveFile(
      STR.universe.pack.saveTitle,
      p.join(dir, STR.universe.pack.fileName(today())),
      "markdown",
    );
    if (!path) return;
    const problem = exportPathProblem(path, j.dir, "markdown");
    if (problem) return toast(problem);
    if (currentJournal()?.repo !== j.repo) return;
    await p.writeExport(path, new TextEncoder().encode(text));
    await j.repo.updateSettings({ ui: { lastExportDir: dirOf(path) } });
    toast(STR.universe.pack.savedTo(baseName(path)));
  } catch (e) {
    reportError(e);
  }
}
