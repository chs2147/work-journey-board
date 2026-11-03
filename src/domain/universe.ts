// Universe UV1(universe-spec 3·4·8절): 일지 자료를 노드·선으로 투영하고, 주변 탐색·필터·시간 막대·배치를 계산한다.
// 순수 함수만 — 원본을 고치거나 복제 저장하지 않는다(첨부 명세 U-01·U-02). 같은 자료 = 같은 배치(결정적).
import type { CategoryColorKey } from "../shared/palette";
import { boxName, boxText, readingOrder, type NoteDoc } from "./note";
import { addDays, parseDate, weekIdOf, weekStart, type DateStr, type WeekId } from "./week";

export type UNodeKind = "workspace" | "category" | "tag" | "entry" | "note" | "cabinet";
export type UEdgeSource = "membership" | "tag" | "note-ref" | "note-edge" | "cabinet-link";

export interface UNode {
  /** `<공간 키>/<종류>/<원본 id>` — 메모 상자는 `<공간>/note/<주>/<상자 id>` */
  id: string;
  ws: string;
  kind: UNodeKind;
  /** 원본 id(항목·업무·태그·상자·Cabinet) */
  refId: string;
  title: string;
  /** 상세 패널 원문(읽기 전용) */
  text: string;
  date?: DateStr;
  weekId?: WeekId;
  categoryId?: string;
  color?: CategoryColorKey;
  depth?: 0 | 1;
  flagged?: boolean;
  /** 업무 종료 */
  ended?: boolean;
  noteKind?: "text" | "image" | "link";
  cabinetKind?: "folder" | "link";
}

export interface UEdge {
  id: string;
  from: string;
  to: string;
  source: UEdgeSource;
  /** 메모 관계선 모양 보존(note-relation-spec) */
  dir?: "one" | "both" | "none";
  dash?: boolean;
  label?: string;
}

export interface UGraph {
  nodes: UNode[];
  edges: UEdge[];
}

/** 한 일지(공간)에서 읽은 자료 — 저장소 getUniverseSnapshot */
export interface UniverseSnapshot {
  ws: { key: string; name: string; color: CategoryColorKey };
  categories: { id: string; name: string; color: CategoryColorKey; ended: boolean; tagIds: string[] }[];
  tags: { id: string; name: string }[];
  entries: {
    id: string;
    date: DateStr;
    categoryId: string;
    depth: 0 | 1;
    seq: number;
    text: string;
    flagged: boolean;
  }[];
  notes: { weekId: WeekId; doc: NoteDoc }[];
  cabinet: {
    items: { id: string; kind: "folder" | "link"; title: string; target: string }[];
    links: { itemId: string; categoryId: string | null; entryId: string | null }[];
  };
}

export const nid = (ws: string, kind: UNodeKind, ...ids: string[]) => [ws, kind, ...ids].join("/");

const oneLine = (s: string, max = 80) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** 스냅샷 → 노드·선. 업무 소속·세부 → 본 항목·태그·메모 연결·메모 관계선·Cabinet 연결을 출처별로 나눈다 */
export function buildGraph(s: UniverseSnapshot): UGraph {
  const ws = s.ws.key;
  const nodes: UNode[] = [];
  const edges: UEdge[] = [];
  const wsId = nid(ws, "workspace", ws);
  nodes.push({
    id: wsId,
    ws,
    kind: "workspace",
    refId: ws,
    title: s.ws.name,
    text: s.ws.name,
    color: s.ws.color,
  });
  const catColor = new Map<string, CategoryColorKey>();
  const tagIds = new Set(s.tags.map((t) => t.id));
  for (const t of s.tags)
    nodes.push({
      id: nid(ws, "tag", t.id),
      ws,
      kind: "tag",
      refId: t.id,
      title: `# ${t.name}`,
      text: `# ${t.name}`,
    });
  for (const c of s.categories) {
    catColor.set(c.id, c.color);
    const id = nid(ws, "category", c.id);
    nodes.push({
      id,
      ws,
      kind: "category",
      refId: c.id,
      title: c.name,
      text: c.name,
      categoryId: c.id,
      color: c.color,
      ended: c.ended,
    });
    edges.push({ id: `${id}>ws`, from: id, to: wsId, source: "membership" });
    for (const t of c.tagIds)
      if (tagIds.has(t)) edges.push({ id: `${id}>tag:${t}`, from: id, to: nid(ws, "tag", t), source: "tag" });
  }
  // 항목: 같은 칸(날짜·업무) 안에서 seq 순 — 세부 항목은 바로 위 본 항목에 딸림
  const cells = new Map<string, UniverseSnapshot["entries"]>();
  for (const e of s.entries) {
    if (!catColor.has(e.categoryId)) continue;
    const k = `${e.date}|${e.categoryId}`;
    const list = cells.get(k) ?? [];
    list.push(e);
    cells.set(k, list);
  }
  const entryIds = new Set<string>();
  for (const list of cells.values()) {
    list.sort((a, b) => a.seq - b.seq);
    let parent: string | null = null;
    for (const e of list) {
      if (!e.text.trim()) continue;
      const id = nid(ws, "entry", e.id);
      entryIds.add(e.id);
      nodes.push({
        id,
        ws,
        kind: "entry",
        refId: e.id,
        title: oneLine(e.text, 60),
        text: e.text,
        date: e.date,
        weekId: weekIdOf(e.date),
        categoryId: e.categoryId,
        color: catColor.get(e.categoryId),
        depth: e.depth,
        flagged: e.flagged,
      });
      if (e.depth === 1 && parent)
        edges.push({ id: `${id}>parent`, from: id, to: parent, source: "membership" });
      else
        edges.push({
          id: `${id}>cat`,
          from: id,
          to: nid(ws, "category", e.categoryId),
          source: "membership",
        });
      if (e.depth === 0) parent = id;
    }
  }
  // 메모 상자: 글·그림·링크 카드 — 연결(refs) = 항목, 관계선(edges) = 같은 주 상자끼리
  for (const n of s.notes) {
    const boxIds = new Set<string>();
    for (const b of readingOrder(n.doc.boxes)) {
      const text = boxText(b).trim();
      const title = oneLine(boxName(b) || text || "(빈 상자)", 60);
      const id = nid(ws, "note", n.weekId, b.id);
      boxIds.add(b.id);
      nodes.push({
        id,
        ws,
        kind: "note",
        refId: b.id,
        title,
        text: text || title,
        weekId: n.weekId,
        date: weekStart(n.weekId),
        noteKind: b.kind,
      });
      for (const r of b.refs ?? [])
        if (entryIds.has(r.item))
          edges.push({
            id: `${id}>ref:${r.item}`,
            from: id,
            to: nid(ws, "entry", r.item),
            source: "note-ref",
          });
    }
    for (const e of n.doc.edges ?? [])
      if (boxIds.has(e.from) && boxIds.has(e.to))
        edges.push({
          id: [ws, "note-edge", n.weekId, e.id].join("/"),
          from: nid(ws, "note", n.weekId, e.from),
          to: nid(ws, "note", n.weekId, e.to),
          source: "note-edge",
          dir: e.dir,
          dash: e.dash,
          ...(e.label ? { label: e.label } : {}),
        });
  }
  // Cabinet: 등록 제목만(파일 내용은 읽지 않음, CLAUDE.md 4-3)
  for (const it of s.cabinet.items) {
    const id = nid(ws, "cabinet", it.id);
    nodes.push({
      id,
      ws,
      kind: "cabinet",
      refId: it.id,
      title: it.title,
      text: it.title,
      cabinetKind: it.kind,
    });
  }
  const cabIds = new Set(s.cabinet.items.map((i) => i.id));
  for (const l of s.cabinet.links) {
    if (!cabIds.has(l.itemId)) continue;
    const from = nid(ws, "cabinet", l.itemId);
    if (l.categoryId && catColor.has(l.categoryId))
      edges.push({
        id: `${from}>cat:${l.categoryId}`,
        from,
        to: nid(ws, "category", l.categoryId),
        source: "cabinet-link",
      });
    if (l.entryId && entryIds.has(l.entryId))
      edges.push({
        id: `${from}>entry:${l.entryId}`,
        from,
        to: nid(ws, "entry", l.entryId),
        source: "cabinet-link",
      });
  }
  return { nodes, edges };
}

/** 여러 공간 그래프 합치기 */
export function mergeGraphs(list: UGraph[]): UGraph {
  return { nodes: list.flatMap((g) => g.nodes), edges: list.flatMap((g) => g.edges) };
}

// ── 필터(universe-spec 4-2) ───────────────────────────────────────────
export interface UFilter {
  /** 낱말(공백 구분) 모두 포함 — 지금 검색 규칙과 같게, 2글자 미만은 무시 */
  query: string;
  /** 업무 id(비면 전체) */
  categoryIds: string[];
  tagIds: string[];
  kinds: UNodeKind[];
  sources: UEdgeSource[];
  includeEnded: boolean;
  /** 시간 범위(포함) — null이면 전체 */
  range: { from: DateStr; to: DateStr } | null;
}

export const ALL_KINDS: UNodeKind[] = ["workspace", "category", "tag", "entry", "note", "cabinet"];
export const ALL_SOURCES: UEdgeSource[] = ["membership", "tag", "note-ref", "note-edge", "cabinet-link"];
export const DEFAULT_FILTER: UFilter = {
  query: "",
  categoryIds: [],
  tagIds: [],
  kinds: ALL_KINDS,
  sources: ALL_SOURCES,
  includeEnded: true,
  range: null,
};

const terms = (q: string) =>
  q
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .filter(() => q.trim().length >= 2);

export const inRange = (n: UNode, r: UFilter["range"]) =>
  !r || !n.date || (n.date >= r.from && n.date <= r.to);

/** 노드가 필터를 지나는가(시간 범위는 따로 — 범위 밖은 흐리게만, inRange) */
export function passes(n: UNode, f: UFilter, catTags: Map<string, string[]>): boolean {
  if (!f.kinds.includes(n.kind)) return false;
  if (n.kind === "category" && n.ended && !f.includeEnded) return false;
  if (f.categoryIds.length && n.categoryId && !f.categoryIds.includes(n.categoryId)) return false;
  if (f.tagIds.length && n.categoryId) {
    const tags = catTags.get(n.categoryId) ?? [];
    if (!f.tagIds.some((t) => tags.includes(t))) return false;
  }
  const ts = terms(f.query);
  if (ts.length) {
    const hay = `${n.title} ${n.text}`.toLowerCase();
    if (!ts.every((t) => hay.includes(t))) return false;
  }
  return true;
}

/** 업무 → 태그 id 목록(그래프의 tag 선으로) */
export function categoryTags(g: UGraph): Map<string, string[]> {
  const m = new Map<string, string[]>();
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  for (const e of g.edges) {
    if (e.source !== "tag") continue;
    const c = byId.get(e.from);
    const t = byId.get(e.to);
    if (!c?.categoryId || !t) continue;
    m.set(c.categoryId, [...(m.get(c.categoryId) ?? []), t.refId]);
  }
  return m;
}

/** 필터 결과(선은 양 끝이 남고 출처가 켜진 것만) */
export function filterGraph(g: UGraph, f: UFilter): UGraph {
  const tags = categoryTags(g);
  const keep = new Set(g.nodes.filter((n) => passes(n, f, tags)).map((n) => n.id));
  return {
    nodes: g.nodes.filter((n) => keep.has(n.id)),
    edges: g.edges.filter((e) => f.sources.includes(e.source) && keep.has(e.from) && keep.has(e.to)),
  };
}

// ── 초점 탐색(C안): 고른 노드 + 이웃 ─────────────────────────────────
export const FOCUS_NODE_LIMIT = 150;
export const FOCUS_EDGE_LIMIT = 300;
/** 허브(업무·태그·공간)는 씨앗이 아니면 그 너머로 펼치지 않는다 — 업무 하나가 모든 항목을 끌고 오지 않게 */
const HUB: ReadonlySet<UNodeKind> = new Set(["category", "tag", "workspace"]);
/** 씨앗이 허브일 때 데려올 최근 항목 수 */
export const HUB_RECENT = 30;
/** 씨앗 옆 업무를 거쳐 데려올, 씨앗 날짜에 가까운 본 항목 수 */
export const HUB_NEAR = 8;
const dayNum = (d?: string) => (d ? Math.round(parseDate(d as DateStr).getTime() / 86_400_000) : 0);

export interface Focus extends UGraph {
  seed: string;
  /** 노드 → 단계(0 = 씨앗) */
  depth: Map<string, number>;
  truncated: boolean;
}

export function neighborhood(g: UGraph, seed: string, maxDepth: 1 | 2 = 2): Focus | null {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  if (!byId.has(seed)) return null;
  const adj = new Map<string, UEdge[]>();
  for (const e of g.edges) {
    adj.set(e.from, [...(adj.get(e.from) ?? []), e]);
    adj.set(e.to, [...(adj.get(e.to) ?? []), e]);
  }
  const depth = new Map<string, number>([[seed, 0]]);
  const seedDate = byId.get(seed)!.date ? dayNum(byId.get(seed)!.date) : 0;
  let truncated = false;
  let frontier = [seed];
  for (let d = 1; d <= maxDepth && frontier.length; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      const node = byId.get(id)!;
      const hub = HUB.has(node.kind);
      // 2단계에서는 허브를 펼치지 않되, 씨앗 바로 옆 허브(업무)는 씨앗 날짜에 가까운 항목 몇 개만 — 맥락(앞뒤 기록)이 보이게
      if (hub && d > 2) continue;
      if (hub && d === 2 && node.kind !== "category") continue;
      let around = (adj.get(id) ?? []).map((e) => (e.from === id ? e.to : e.from));
      if (hub) {
        const entries = around.map((x) => byId.get(x)!).filter((n) => n.kind === "entry" && n.depth !== 1);
        const near = seedDate
          ? entries.sort(
              (a, b) =>
                Math.abs(dayNum(a.date) - seedDate) - Math.abs(dayNum(b.date) - seedDate) ||
                (b.date ?? "").localeCompare(a.date ?? ""),
            )
          : entries.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
        const limit = d === 1 ? HUB_RECENT : HUB_NEAR;
        // 씨앗 옆 업무에서 가까운 기록만 데려오는 것은 의도한 모습 — "잘림"은 씨앗이 업무일 때만
        if (d === 1 && entries.length > limit) truncated = true;
        const keepEntries = new Set(near.slice(0, limit).map((n) => n.id));
        // 세부 항목은 그 본 항목을 거쳐서만, 허브의 다른 허브(태그·공간)는 씨앗이 허브일 때만
        around = around.filter((x) => {
          const k = byId.get(x)!;
          if (k.kind === "entry") return keepEntries.has(x);
          return d === 1 || !HUB.has(k.kind);
        });
      }
      for (const x of around) {
        if (depth.has(x)) continue;
        if (depth.size >= FOCUS_NODE_LIMIT) {
          truncated = true;
          break;
        }
        depth.set(x, d);
        next.push(x);
      }
    }
    frontier = next;
  }
  const nodes = g.nodes.filter((n) => depth.has(n.id));
  let edges = g.edges.filter((e) => depth.has(e.from) && depth.has(e.to));
  if (edges.length > FOCUS_EDGE_LIMIT) {
    truncated = true;
    edges = edges.slice(0, FOCUS_EDGE_LIMIT);
  }
  return { nodes, edges, seed, depth, truncated };
}

/** 고른 노드의 연결 목록(상세 패널 "왜 이어졌나") */
export function connectionsOf(g: UGraph, id: string): { edge: UEdge; other: UNode; out: boolean }[] {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  return g.edges
    .filter((e) => e.from === id || e.to === id)
    .map((e) => ({ edge: e, other: byId.get(e.from === id ? e.to : e.from)!, out: e.from === id }))
    .filter((x) => !!x.other);
}

// ── 배치(결정적, 새 의존성 없음 — universe-spec 8-3) ───────────────────
export type Pos = Map<string, { x: number; y: number }>;

/** 문자열 → 0~1 고정 난수(같은 id = 같은 값) */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** 초점: 씨앗 가운데, 1단계 = 안쪽 원, 2단계 = 바깥 원(부모 방향 근처) — 각도는 종류·날짜 순으로 고정 */
export function layoutFocus(f: Focus, w: number, h: number): Pos {
  const pos: Pos = new Map();
  const cx = w / 2;
  const cy = h / 2;
  pos.set(f.seed, { x: cx, y: cy });
  const rx1 = w * 0.22;
  const ry1 = h * 0.24;
  const rx2 = w * 0.38;
  const ry2 = h * 0.42;
  const order = (a: UNode, b: UNode) =>
    a.kind.localeCompare(b.kind) || (a.date ?? "").localeCompare(b.date ?? "") || a.id.localeCompare(b.id);
  const ring1 = f.nodes.filter((n) => f.depth.get(n.id) === 1).sort(order);
  // 2단계 노드를 이어진 1단계 노드 밑으로 묶는다
  const ring2 = f.nodes.filter((n) => f.depth.get(n.id) === 2).sort(order);
  const groups = new Map<string, UNode[]>();
  for (const n of ring2) {
    const via =
      f.edges
        .map((e) => (e.from === n.id ? e.to : e.to === n.id ? e.from : null))
        .find((x) => x && f.depth.get(x) === 1) ?? ring1[0]?.id;
    if (via) groups.set(via, [...(groups.get(via) ?? []), n]);
  }
  // 원 둘레를 1단계 노드마다 (1 + 딸린 2단계 수)에 비례해 나눈다 — 한쪽에 몰리지 않게
  const weight = (id: string) => 1 + (groups.get(id)?.length ?? 0);
  const total = ring1.reduce((s, n) => s + weight(n.id), 0) || 1;
  let acc = 0;
  for (const n of ring1) {
    const span = (weight(n.id) / total) * Math.PI * 2;
    const mid = -Math.PI / 2 + acc + span / 2;
    acc += span;
    pos.set(n.id, { x: cx + Math.cos(mid) * rx1, y: cy + Math.sin(mid) * ry1 });
    const kids = groups.get(n.id) ?? [];
    kids.forEach((k, i) => {
      const a = mid - span / 2 + ((i + 0.5) / kids.length) * span;
      // 많으면 두 겹으로(안쪽·바깥쪽 번갈아) — 글자가 덜 겹치게
      const ring = kids.length > 10 && i % 2 ? 0.82 : 1;
      pos.set(k.id, { x: cx + Math.cos(a) * rx2 * ring, y: cy + Math.sin(a) * ry2 * ring });
    });
  }
  return pos;
}

/**
 * 은하(A안): 공간마다 고리, 업무는 고리 안 원 둘레, 항목은 그 업무 둘레에 날짜 순 나선,
 * 메모 상자는 연결 항목 가까이(없으면 공간 가운데 근처), 태그는 연결 업무들의 무게 중심, Cabinet은 연결된 곳 근처.
 */
export function layoutGalaxy(g: UGraph, w: number, h: number): Pos {
  const pos: Pos = new Map();
  const spaces = [...new Set(g.nodes.map((n) => n.ws))];
  const out = new Map<string, string[]>();
  for (const e of g.edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  spaces.forEach((ws, si) => {
    // 공간 가운데: 첫 공간 = 화면 가운데, 나머지는 오른쪽 아래로 작게
    const main = si === 0;
    const R = main ? Math.min(w, h) * 0.44 : Math.min(w, h) * 0.18;
    const cx = main ? w / 2 : w - R - 20 - (si - 1) * (R * 2 + 20);
    const cy = main ? h / 2 : h - R - 20;
    pos.set(nid(ws, "workspace", ws), { x: cx, y: cy });
    const cats = g.nodes.filter((n) => n.ws === ws && n.kind === "category");
    const catPos = new Map<string, { x: number; y: number }>();
    cats.forEach((c, i) => {
      const a = -Math.PI / 2 + (i / Math.max(1, cats.length)) * Math.PI * 2;
      const r = cats.length === 1 ? 0 : R * 0.55;
      const p = { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
      catPos.set(c.categoryId!, p);
      pos.set(c.id, p);
    });
    const entries = g.nodes
      .filter((n) => n.ws === ws && n.kind === "entry")
      .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || a.id.localeCompare(b.id));
    const perCat = new Map<string, number>();
    const catCount = new Map<string, number>();
    for (const e of entries) catCount.set(e.categoryId!, (catCount.get(e.categoryId!) ?? 0) + 1);
    const cloud = R * (cats.length > 1 ? Math.min(0.42, 1.6 / cats.length + 0.12) : 0.8);
    for (const e of entries) {
      const c = catPos.get(e.categoryId!) ?? { x: cx, y: cy };
      const k = perCat.get(e.categoryId!) ?? 0;
      perCat.set(e.categoryId!, k + 1);
      const n = catCount.get(e.categoryId!) ?? 1;
      const a = k * 2.399963 + hash01(e.id) * 0.5; // 황금각 나선 — 오래된 기록이 안쪽, 최근이 바깥
      const r = cloud * (0.28 + 0.72 * Math.sqrt((k + 1) / n));
      pos.set(e.id, { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
    }
    const near = (id: string, spread: number) => {
      const targets = (out.get(id) ?? [])
        .map((t) => pos.get(t))
        .filter((p): p is { x: number; y: number } => !!p);
      const base = targets.length
        ? {
            x: targets.reduce((s, p) => s + p.x, 0) / targets.length,
            y: targets.reduce((s, p) => s + p.y, 0) / targets.length,
          }
        : { x: cx + (hash01(id) - 0.5) * R * 0.6, y: cy + (hash01(`${id}y`) - 0.5) * R * 0.6 };
      const a = hash01(`${id}a`) * Math.PI * 2;
      return { x: base.x + Math.cos(a) * spread, y: base.y + Math.sin(a) * spread };
    };
    for (const n of g.nodes.filter((x) => x.ws === ws && x.kind === "note")) pos.set(n.id, near(n.id, 10));
    for (const n of g.nodes.filter((x) => x.ws === ws && x.kind === "cabinet")) pos.set(n.id, near(n.id, 16));
    // 태그: 연결된 업무들의 가운데
    for (const t of g.nodes.filter((x) => x.ws === ws && x.kind === "tag")) {
      const cs = g.edges
        .filter((e) => e.source === "tag" && e.to === t.id)
        .map((e) => pos.get(e.from))
        .filter((p): p is { x: number; y: number } => !!p);
      pos.set(
        t.id,
        cs.length
          ? {
              x: cs.reduce((s, p) => s + p.x, 0) / cs.length + (hash01(t.id) - 0.5) * 30,
              y: cs.reduce((s, p) => s + p.y, 0) / cs.length + (hash01(`${t.id}y`) - 0.5) * 30,
            }
          : { x: cx, y: cy - R * 0.85 },
      );
    }
  });
  return pos;
}

// ── 시간 막대(universe-spec 4-1) ─────────────────────────────────────
export type TimeLevel = "year" | "month" | "week" | "day";

export interface TimeBucket {
  key: string;
  label: string;
  from: DateStr;
  to: DateStr;
  count: number;
}

const pad = (n: number) => String(n).padStart(2, "0");
const lastDayOfMonth = (y: number, m: number) => new Date(y, m, 0).getDate();
const DOW = ["월", "화", "수", "목", "금", "토", "일"];

/**
 * 지금 단계의 칸들: year = 그 해 12달, month = 그 달에 걸친 ISO 주, week = 그 주 7일, day = 그날 하루.
 * anchor = 그 단계의 기준 날짜. count = 칸 안 항목 수(entry 노드).
 */
export function timeBuckets(dates: DateStr[], level: TimeLevel, anchor: DateStr): TimeBucket[] {
  const d = parseDate(anchor);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const buckets: TimeBucket[] = [];
  if (level === "year") {
    for (let i = 1; i <= 12; i++)
      buckets.push({
        key: `${y}-${pad(i)}`,
        label: `${i}월`,
        from: `${y}-${pad(i)}-01` as DateStr,
        to: `${y}-${pad(i)}-${pad(lastDayOfMonth(y, i))}` as DateStr,
        count: 0,
      });
  } else if (level === "month") {
    const first = `${y}-${pad(m)}-01` as DateStr;
    const last = `${y}-${pad(m)}-${pad(lastDayOfMonth(y, m))}` as DateStr;
    let ws = weekStart(weekIdOf(first));
    while (ws <= last) {
      const we = addDays(ws, 6);
      const wk = weekIdOf(ws);
      buckets.push({ key: wk, label: `W${wk.slice(-2)}`, from: ws, to: we, count: 0 });
      ws = addDays(ws, 7);
    }
  } else if (level === "week") {
    const ws = weekStart(weekIdOf(anchor));
    for (let i = 0; i < 7; i++) {
      const day = addDays(ws, i);
      buckets.push({ key: day, label: `${DOW[i]} ${Number(day.slice(8))}`, from: day, to: day, count: 0 });
    }
  } else {
    buckets.push({ key: anchor, label: anchor, from: anchor, to: anchor, count: 0 });
  }
  for (const dt of dates) for (const b of buckets) if (dt >= b.from && dt <= b.to) b.count++;
  return buckets;
}

/** 단계 이동: 한 칸 앞·뒤(같은 단계) */
export function shiftAnchor(level: TimeLevel, anchor: DateStr, delta: number): DateStr {
  const d = parseDate(anchor);
  if (level === "year") return `${d.getFullYear() + delta}-01-01` as DateStr;
  if (level === "month") {
    const t = new Date(d.getFullYear(), d.getMonth() + delta, 1);
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-01` as DateStr;
  }
  return addDays(anchor, (level === "week" ? 7 : 1) * delta);
}

/** 단계의 범위(필터에 쓰는 from~to) */
export function levelRange(level: TimeLevel, anchor: DateStr): { from: DateStr; to: DateStr } {
  const b = timeBuckets([], level, anchor);
  return { from: b[0]!.from, to: b[b.length - 1]!.to };
}

/** 단계 이름 `2026년` · `2026년 10월` · `2026-W43` · `2026-10-22` */
export function levelLabel(level: TimeLevel, anchor: DateStr): string {
  const d = parseDate(anchor);
  if (level === "year") return `${d.getFullYear()}년`;
  if (level === "month") return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
  if (level === "week") return weekIdOf(anchor);
  return anchor;
}
