// Universe 화면(universe-spec 4절, UV1): 왼쪽 필터 · 가운데 지도(초점 = SVG, 은하 = canvas)/목록 · 오른쪽 상세 · 바닥 시간 막대.
// 읽기만 한다 — 원문 편집기 없음, 고치기는 [원본 열기]로 보드·메모·Cabinet에서(첨부 디자인 7절).
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import {
  ALL_KINDS,
  ALL_SOURCES,
  connectionsOf,
  filterGraph,
  inRange,
  layoutFocus,
  layoutGalaxy,
  levelLabel,
  neighborhood,
  RELATION_NOTE_MAX,
  RELATION_TYPES,
  isDirected,
  shiftAnchor,
  timeBuckets,
  type TimeLevel,
  type UEdge,
  type UGraph,
  type UNode,
  type UNodeKind,
  type URelationType,
} from "../../domain/universe";
import { sameDir } from "../../domain/workspace";
import { shortDateLabel } from "../../domain/week";
import { STR } from "../../shared/strings";
import { useAppStore } from "../common/appStore";
import { toast } from "../board/boardStore";
import { WorkspaceMark } from "../common/workspaceIcons";
import {
  addRelation,
  clearTime,
  closeLinkDialog,
  combined,
  openLinkDialog,
  removeRelation,
  updateRelation,
  drillTime,
  effectiveFilter,
  focusOn,
  resetFilter,
  revealNode,
  select,
  setFilter,
  setMode,
  setTimeAnchor,
  setTimeLevel,
  setView,
  toggleWorkspace,
  useUniverse,
} from "./universeStore";
import styles from "./Universe.module.css";

const NOTE_FILL = "#e3c87a";

export function UniverseView() {
  const s = useUniverse();
  const all = useMemo(() => combined(s), [s.graphs, s.wsOn]); // eslint-disable-line react-hooks/exhaustive-deps
  const filter = useMemo(() => effectiveFilter(s), [s.filter, s.time]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => filterGraph(all, filter), [all, filter]);
  const byId = useMemo(() => new Map(all.nodes.map((n) => [n.id, n])), [all]);
  const selected = s.selected ? (byId.get(s.selected) ?? null) : null;

  return (
    <section className={styles.view} aria-label={STR.universe.title} data-testid="universe-view">
      <div className={styles.toolbar}>
        <div className={styles.seg} role="group" aria-label={STR.universe.modeLabel}>
          {(["focus", "galaxy"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={s.mode === m}
              className={s.mode === m ? styles.segOn : ""}
              data-testid={`u-mode-${m}`}
              onClick={() => setMode(m)}
            >
              {m === "focus" ? STR.universe.modeFocus : STR.universe.modeGalaxy}
            </button>
          ))}
        </div>
        <div className={styles.seg} role="group" aria-label={STR.universe.viewLabel}>
          {(["map", "list"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={s.view === v}
              className={s.view === v ? styles.segOn : ""}
              data-testid={`u-view-${v}`}
              onClick={() => setView(v)}
            >
              {v === "map" ? STR.universe.viewMap : STR.universe.viewList}
            </button>
          ))}
        </div>
        {s.loading && <span className={styles.muted}>{STR.universe.loading}</span>}
        {s.notices.map((n) => (
          <span key={n} className={styles.notice} role="status">
            {n}
          </span>
        ))}
      </div>
      <div className={styles.body}>
        <FilterPanel all={all} />
        <div className={styles.center}>
          {all.nodes.length <= 1 && !s.loading ? (
            <p className={styles.empty}>{STR.universe.empty}</p>
          ) : s.view === "list" ? (
            <ListView graph={shown} selected={s.selected} />
          ) : s.mode === "focus" ? (
            <FocusMap all={all} shown={shown} />
          ) : (
            <GalaxyMap graph={shown} selected={s.selected} />
          )}
        </div>
        <DetailPanel node={selected} all={all} />
      </div>
      <TimeBar all={all} />
      {s.linkDialog && <LinkDialog all={all} />}
    </section>
  );
}

// ── 필터 ──────────────────────────────────────────────────────────────
function FilterPanel({ all }: { all: UGraph }) {
  const f = useUniverse((s) => s.filter);
  const wsOn = useUniverse((s) => s.wsOn);
  const list = useAppStore((s) => s.workspaces);
  const cur = useAppStore((s) => (s.journal.state === "ready" ? s.journal.dataDir : null));
  const cats = all.nodes.filter((n) => n.kind === "category");
  const tags = all.nodes.filter((n) => n.kind === "tag");
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  return (
    <aside className={styles.filters} aria-label={STR.universe.filters} data-testid="universe-filters">
      <label className={styles.group}>
        <span className={styles.label}>{STR.universe.search}</span>
        <input
          className={styles.input}
          value={f.query}
          placeholder={STR.universe.searchPlaceholder}
          data-testid="u-search"
          onChange={(e) => setFilter({ query: e.target.value })}
        />
      </label>
      {list.length > 1 && (
        <div className={styles.group}>
          <span className={styles.label}>{STR.universe.workspaces}</span>
          {list.map((w) => {
            const isCur = !!cur && sameDir(w.dir, cur);
            const on = isCur || wsOn.some((d) => sameDir(d, w.dir));
            return (
              <label key={w.dir} className={styles.check}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={isCur}
                  data-testid="u-ws-toggle"
                  onChange={() => void toggleWorkspace(w.dir)}
                />
                <WorkspaceMark icon={w.icon} color={w.color} size={16} />
                <span>{w.name}</span>
                <span className={styles.muted}>{isCur ? STR.universe.nowTag : STR.universe.readOnly}</span>
              </label>
            );
          })}
        </div>
      )}
      <div className={styles.group}>
        <span className={styles.label}>{STR.universe.categories}</span>
        {cats.map((c) => (
          <label key={c.id} className={styles.check}>
            <input
              type="checkbox"
              checked={!f.categoryIds.length || f.categoryIds.includes(c.categoryId!)}
              onChange={() => {
                const allIds = cats.map((x) => x.categoryId!);
                const base = f.categoryIds.length ? f.categoryIds : allIds;
                const next = toggle(base, c.categoryId!);
                setFilter({ categoryIds: next.length === allIds.length ? [] : next });
              }}
            />
            <span className={styles.dot} style={{ background: `var(--cat-${c.color})` }} />
            <span className={c.ended ? styles.muted : ""}>{c.title}</span>
          </label>
        ))}
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={f.includeEnded}
            onChange={(e) => setFilter({ includeEnded: e.target.checked })}
          />
          <span>{STR.universe.includeEnded}</span>
        </label>
      </div>
      {tags.length > 0 && (
        <div className={styles.group}>
          <span className={styles.label}>{STR.universe.tags}</span>
          <div className={styles.chips}>
            {tags.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={f.tagIds.includes(t.refId)}
                className={`${styles.chip} ${f.tagIds.includes(t.refId) ? styles.chipOn : ""}`}
                onClick={() => setFilter({ tagIds: toggle(f.tagIds, t.refId) })}
              >
                {t.title}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className={styles.group}>
        <span className={styles.label}>{STR.universe.kinds}</span>
        {ALL_KINDS.filter((k) => k !== "workspace").map((k) => (
          <label key={k} className={styles.check}>
            <input
              type="checkbox"
              checked={f.kinds.includes(k)}
              data-testid={`u-kind-${k}`}
              onChange={() => setFilter({ kinds: toggle(f.kinds, k) })}
            />
            <KindGlyph kind={k} />
            <span>{STR.universe.kindName[k]}</span>
          </label>
        ))}
      </div>
      <div className={styles.group}>
        <span className={styles.label}>{STR.universe.sources}</span>
        {ALL_SOURCES.map((src) => (
          <label key={src} className={styles.check}>
            <input
              type="checkbox"
              checked={f.sources.includes(src)}
              onChange={() => setFilter({ sources: toggle(f.sources, src) })}
            />
            <span>{STR.universe.sourceName[src]}</span>
            <span className={styles.muted}>{STR.universe.sourceHint[src]}</span>
          </label>
        ))}
      </div>
      <button type="button" className={styles.link} onClick={resetFilter}>
        {STR.universe.resetFilter}
      </button>
    </aside>
  );
}

function KindGlyph({ kind, color }: { kind: UNodeKind; color?: string }) {
  const c = color ?? "var(--text-3)";
  return (
    <svg width="14" height="14" viewBox="-7 -7 14 14" aria-hidden="true" className={styles.glyph}>
      {kind === "entry" && <circle r="4.5" fill={c} />}
      {kind === "category" && (
        <rect x="-6" y="-4" width="12" height="8" rx="2.5" fill="none" stroke={c} strokeWidth="1.6" />
      )}
      {kind === "tag" && <path d="M-6 0l3-5h6l3 5-3 5h-6z" fill="none" stroke={c} strokeWidth="1.4" />}
      {kind === "note" && <rect x="-4.5" y="-4.5" width="9" height="9" fill={NOTE_FILL} />}
      {kind === "cabinet" && <path d="M-6-3h4l1.5 1.5H6v6.5H-6z" fill="none" stroke={c} strokeWidth="1.4" />}
      {kind === "workspace" && (
        <circle r="5" fill="none" stroke={c} strokeWidth="1.6" strokeDasharray="2 2" />
      )}
    </svg>
  );
}

// ── 선 모양(출처별, spec 3-2) ─────────────────────────────────────────
function edgeStyle(e: UEdge): { stroke: string; width: number; dash?: string; opacity: number } {
  switch (e.source) {
    case "membership":
      return { stroke: "var(--line-strong)", width: 1, opacity: 0.9 };
    case "tag":
      return { stroke: "var(--text-3)", width: 1, dash: "2 4", opacity: 0.7 };
    case "note-ref":
      return { stroke: "var(--text-3)", width: 1.3, dash: "5 4", opacity: 0.9 };
    case "note-edge":
      return { stroke: "var(--accent)", width: 1.6, dash: e.dash ? "5 4" : undefined, opacity: 0.9 };
    case "cabinet-link":
      return { stroke: "var(--text-3)", width: 1.2, dash: "2 3", opacity: 0.9 };
    case "relation":
      return { stroke: "var(--accent)", width: 2.8, opacity: 1 };
  }
}

/** 화살표가 별에 가리지 않게 끝을 별 둘레에서 멈춘다 */
function trimEnd(a: { x: number; y: number }, b: { x: number; y: number }, by: number) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d <= by * 2) return b;
  return { x: b.x - (dx / d) * by, y: b.y - (dy / d) * by };
}

// ── 지도 크기 = 실제 자리 크기(글자가 줄어 보이지 않게) ─────────────────
function useBoxSize(min = { w: 260, h: 220 }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(min);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const r = e!.contentRect;
      setSize({ w: Math.max(min.w, Math.round(r.width)), h: Math.max(min.h, Math.round(r.height)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [min.w, min.h]);
  return [ref, size] as const;
}

// ── 초점 지도(C안, SVG) ───────────────────────────────────────────────

function FocusMap({ all, shown }: { all: UGraph; shown: UGraph }) {
  const seed = useUniverse((s) => s.seed);
  const selected = useUniverse((s) => s.selected);
  const time = useUniverse((s) => s.time);
  const filter = effectiveFilter({ filter: useUniverse((s) => s.filter), time });
  // 씨앗은 필터에 걸려도 가운데에 둔다
  const g = useMemo<UGraph>(() => {
    if (!seed || shown.nodes.some((n) => n.id === seed)) return shown;
    const sn = all.nodes.find((n) => n.id === seed);
    if (!sn) return shown;
    const keep = new Set([...shown.nodes.map((n) => n.id), seed]);
    return {
      nodes: [...shown.nodes, sn],
      edges: all.edges.filter((e) => filter.sources.includes(e.source) && keep.has(e.from) && keep.has(e.to)),
    };
  }, [all, shown, seed, filter.sources]);
  const focus = useMemo(() => (seed ? neighborhood(g, seed) : null), [g, seed]);
  const [boxRef, box] = useBoxSize();
  const pos = useMemo(() => (focus ? layoutFocus(focus, box.w, box.h) : new Map()), [focus, box.w, box.h]);
  const { view, bind, zoom } = usePanZoom(box.w, box.h, seed);
  const seedNode = focus?.nodes.find((n) => n.id === focus.seed);
  return (
    <div className={styles.map} data-testid="universe-map">
      <div className={styles.mapInfo}>
        {seedNode && STR.universe.focusInfo(seedNode.title, focus!.nodes.length)}
        {focus?.truncated && <span className={styles.warn}> · {STR.universe.truncated}</span>}
      </div>
      <div ref={boxRef} className={styles.stage}>
        {!focus || !seedNode ? (
          <p className={styles.empty}>{STR.universe.noMatch}</p>
        ) : (
          <svg
            className={styles.svg}
            viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
            role="img"
            aria-label={STR.universe.focusInfo(seedNode.title, focus.nodes.length)}
            {...bind}
          >
            <defs>
              <marker id="u-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0 0L8 4 0 8z" fill="var(--accent)" />
              </marker>
              <marker
                id="u-arrow-rel"
                markerWidth="5"
                markerHeight="5"
                refX="4.2"
                refY="2.5"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path d="M0 0L5 2.5 0 5z" fill="var(--accent)" />
              </marker>
            </defs>
            {focus.edges.map((e) => {
              const a = pos.get(e.from);
              const b = pos.get(e.to);
              if (!a || !b) return null;
              const st = edgeStyle(e);
              const rel = e.source === "relation";
              const end = rel && e.dir === "one" ? trimEnd(a, b, 16) : b;
              return (
                <line
                  key={e.id}
                  x1={a.x}
                  y1={a.y}
                  x2={end.x}
                  y2={end.y}
                  stroke={st.stroke}
                  strokeWidth={st.width}
                  strokeDasharray={st.dash}
                  opacity={st.opacity}
                  data-testid={rel ? "u-rel-line" : undefined}
                  data-rel={rel ? e.rel?.type : undefined}
                  markerEnd={
                    rel
                      ? e.dir === "one"
                        ? "url(#u-arrow-rel)"
                        : undefined
                      : e.source === "note-edge" && e.dir !== "none"
                        ? "url(#u-arrow)"
                        : undefined
                  }
                />
              );
            })}
            {focus.nodes.map((n) => {
              const p = pos.get(n.id);
              if (!p) return null;
              const dim = !inRange(n, filter.range);
              return (
                <NodeShape
                  key={n.id}
                  n={n}
                  x={p.x}
                  y={p.y}
                  seed={n.id === focus.seed}
                  selected={n.id === selected}
                  dim={dim}
                  far={(focus.depth.get(n.id) ?? 0) >= 2}
                />
              );
            })}
          </svg>
        )}
      </div>
      <ZoomButtons zoom={zoom} />
    </div>
  );
}

function NodeShape({
  n,
  x,
  y,
  seed,
  selected,
  dim,
  far,
}: {
  n: UNode;
  x: number;
  y: number;
  seed: boolean;
  selected: boolean;
  dim: boolean;
  far: boolean;
}) {
  const color = n.color ? `var(--cat-${n.color})` : "var(--text-3)";
  const r = seed ? 11 : n.kind === "entry" ? (n.depth === 1 ? 5 : 7) : 7;
  const label = n.title.length > 22 ? `${n.title.slice(0, 21)}…` : n.title;
  return (
    <g
      className={styles.node}
      transform={`translate(${x} ${y})`}
      opacity={dim ? 0.28 : 1}
      data-testid="u-node"
      data-id={n.id}
      data-kind={n.kind}
      onClick={(e) => {
        e.stopPropagation();
        select(n.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        focusOn(n.id);
      }}
    >
      <title>{`${STR.universe.kindName[n.kind]} · ${n.title}`}</title>
      <circle r={r + 10} fill="transparent" />
      {(seed || selected) && (
        <circle r={r + 5} fill="none" stroke="var(--accent)" strokeWidth={seed ? 2.2 : 1.6} />
      )}
      {n.kind === "entry" && (
        <circle r={r} fill={color} stroke={n.flagged ? "var(--star)" : "none"} strokeWidth="2" />
      )}
      {n.kind === "category" && (
        <rect
          x={-Math.max(36, label.length * 6.5) / 2 - 8}
          y="-11"
          width={Math.max(36, label.length * 6.5) + 16}
          height="22"
          rx="7"
          fill="var(--surface-card)"
          stroke={color}
          strokeWidth="1.8"
        />
      )}
      {n.kind === "tag" && (
        <path d="M-22 0l7-10h30l7 10-7 10h-30z" fill="var(--surface-sub)" stroke="var(--text-3)" />
      )}
      {n.kind === "note" && (
        <rect x={-r} y={-r} width={2 * r} height={2 * r} fill={NOTE_FILL} stroke="#c4a46a" />
      )}
      {n.kind === "cabinet" && (
        <path
          d={`M${-r - 2} ${-r + 1}h6l2 2h${2 * r - 4}v${2 * r - 3}h${-2 * r - 4}z`}
          fill="var(--surface-sub)"
          stroke="var(--text-3)"
        />
      )}
      {n.kind === "workspace" && (
        <circle r={r + 2} fill="none" stroke={color} strokeWidth="2" strokeDasharray="3 3" />
      )}
      <text
        y={n.kind === "category" || n.kind === "tag" ? 4 : r + 14}
        textAnchor="middle"
        className={far ? styles.labelFar : styles.label2}
      >
        {label}
      </text>
    </g>
  );
}

// ── 은하(A안, canvas) ─────────────────────────────────────────────────
function GalaxyMap({ graph, selected }: { graph: UGraph; selected: string | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const time = useUniverse((s) => s.time);
  const range = effectiveFilter({ filter: useUniverse((s) => s.filter), time }).range;
  const [boxRef, box] = useBoxSize();
  const pos = useMemo(() => layoutGalaxy(graph, box.w, box.h), [graph, box.w, box.h]);
  const { view, bind, zoom } = usePanZoom(box.w, box.h, null);
  const [hover, setHover] = useState<string | null>(null);
  const theme = useAppStore((s) => s.theme);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    cv.width = w * dpr;
    cv.height = h * dpr;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const css = getComputedStyle(cv);
    const v = (name: string) => css.getPropertyValue(name).trim() || "#888";
    const sx = w / view.w;
    const sy = h / view.h;
    const k = Math.min(sx, sy);
    const ox = (w - view.w * k) / 2;
    const oy = (h - view.h * k) / 2;
    const tx = (x: number) => ox + (x - view.x) * k;
    const ty = (y: number) => oy + (y - view.y) * k;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    for (const e of graph.edges) {
      const a = pos.get(e.from);
      const b = pos.get(e.to);
      if (!a || !b) continue;
      const rel = e.source === "relation";
      const strong =
        rel || e.source === "note-edge" || e.source === "note-ref" || e.source === "cabinet-link";
      ctx.strokeStyle = strong ? v("--accent") : v("--line-strong");
      ctx.globalAlpha = rel ? 0.95 : strong ? 0.55 : 0.35;
      ctx.lineWidth = rel ? 2.4 : strong ? 1.1 : 0.6;
      ctx.setLineDash(e.source === "tag" || e.source === "note-ref" ? [3, 3] : []);
      ctx.beginPath();
      ctx.moveTo(tx(a.x), ty(a.y));
      ctx.lineTo(tx(b.x), ty(b.y));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    const catColor = (n: UNode) => (n.color ? v(`--cat-${n.color}`) : v("--text-3"));
    const labels: UNode[] = [];
    for (const n of graph.nodes) {
      const p = pos.get(n.id);
      if (!p) continue;
      const X = tx(p.x);
      const Y = ty(p.y);
      ctx.globalAlpha = inRange(n, range) ? 0.9 : 0.18;
      if (n.kind === "entry") {
        ctx.fillStyle = catColor(n);
        ctx.beginPath();
        ctx.arc(X, Y, Math.max(1.6, (n.depth === 1 ? 1.8 : 2.6) * Math.sqrt(k)), 0, Math.PI * 2);
        ctx.fill();
      } else if (n.kind === "note") {
        ctx.fillStyle = NOTE_FILL;
        ctx.fillRect(X - 2.5, Y - 2.5, 5, 5);
      } else if (n.kind === "cabinet") {
        ctx.strokeStyle = v("--text-3");
        ctx.strokeRect(X - 3.5, Y - 2.5, 7, 5);
      } else if (n.kind === "workspace") {
        ctx.strokeStyle = catColor(n);
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.arc(X, Y, 14, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        labels.push(n);
      } else labels.push(n);
    }
    ctx.globalAlpha = 1;
    ctx.font = `12px ${css.fontFamily}`;
    ctx.textAlign = "center";
    const ids = new Set([selected, hover].filter(Boolean) as string[]);
    for (const n of [...labels, ...[...ids].map((i) => byId.get(i)).filter((x): x is UNode => !!x)]) {
      const p = pos.get(n.id);
      if (!p) continue;
      const X = tx(p.x);
      const Y = ty(p.y);
      const text = n.title.length > 20 ? `${n.title.slice(0, 19)}…` : n.title;
      const tw = ctx.measureText(text).width;
      if (n.kind === "category" || n.kind === "tag" || n.kind === "workspace") {
        ctx.fillStyle = v("--surface-card");
        ctx.strokeStyle = n.kind === "category" ? catColor(n) : v("--text-3");
        ctx.lineWidth = 1.5;
        const bx = X - tw / 2 - 7;
        const by = Y - (n.kind === "workspace" ? 30 : 10);
        ctx.beginPath();
        ctx.roundRect(bx, by, tw + 14, 20, 7);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = v("--text-1");
        ctx.fillText(text, X, by + 14);
      } else {
        ctx.fillStyle = v("--text-1");
        ctx.fillText(text, X, Y - 9);
      }
      if (ids.has(n.id)) {
        ctx.strokeStyle = v("--accent");
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(X, Y, 7, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }, [graph, pos, view, selected, hover, range, theme]);

  /** 화면 좌표 → 가장 가까운 노드(10px 안) */
  const hit = (ev: { clientX: number; clientY: number }): string | null => {
    const cv = ref.current;
    if (!cv) return null;
    const rect = cv.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const k = Math.min(w / view.w, h / view.h);
    const ox = (w - view.w * k) / 2;
    const oy = (h - view.h * k) / 2;
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    let best: string | null = null;
    let bd = 10 * 10;
    for (const [id, p] of pos) {
      const dx = ox + (p.x - view.x) * k - mx;
      const dy = oy + (p.y - view.y) * k - my;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    return best;
  };

  return (
    <div className={styles.map} data-testid="universe-map">
      <div className={styles.mapInfo}>{STR.universe.galaxyInfo(graph.nodes.length, graph.edges.length)}</div>
      <div ref={boxRef} className={styles.stage}>
        <canvas
          ref={ref}
          className={styles.canvas}
          data-testid="galaxy-canvas"
          role="img"
          aria-label={STR.universe.galaxyInfo(graph.nodes.length, graph.edges.length)}
          {...bind}
          onMouseMove={(e) => setHover(hit(e))}
          onClick={(e) => {
            const id = hit(e);
            if (id) select(id);
          }}
          onDoubleClick={(e) => {
            const id = hit(e);
            if (id) focusOn(id);
          }}
        />
      </div>
      <ZoomButtons zoom={zoom} />
    </div>
  );
}

// ── 확대·이동(휠·끌기·단추) ───────────────────────────────────────────
function usePanZoom(w: number, h: number, resetKey: string | null) {
  // 씨앗이 바뀌면 처음 배율로(키가 다르면 기본값 — 효과 안 setState 없이)
  const key = `${resetKey}|${w}|${h}`;
  const [st, setSt] = useState({ key, v: { x: 0, y: 0, w, h } });
  const view = st.key === key ? st.v : { x: 0, y: 0, w, h };
  const setView2 = (f: (v: typeof view) => typeof view) =>
    setSt((cur) => ({ key, v: f(cur.key === key ? cur.v : { x: 0, y: 0, w, h }) }));
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const zoom = (f: number | "fit") =>
    setView2((v) => {
      if (f === "fit") return { x: 0, y: 0, w, h };
      const nw = Math.min(w * 4, Math.max(w / 6, v.w / f));
      const nh = (nw / v.w) * v.h;
      return { x: v.x + (v.w - nw) / 2, y: v.y + (v.h - nh) / 2, w: nw, h: nh };
    });
  const bind = {
    onWheel: (e: React.WheelEvent) => zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15),
    onPointerDown: (e: RPointerEvent) => {
      drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
    },
    onPointerMove: (e: RPointerEvent) => {
      const d = drag.current;
      if (!d || !(e.buttons & 1)) return;
      const el = e.currentTarget as Element;
      const k = view.w / el.clientWidth;
      const dx = (e.clientX - d.x) * k;
      const dy = (e.clientY - d.y) * k;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      setView2((v) => ({ ...v, x: d.vx - dx, y: d.vy - dy }));
    },
    onPointerUp: () => {
      drag.current = null;
    },
  };
  return { view, bind, zoom };
}

function ZoomButtons({ zoom }: { zoom: (f: number | "fit") => void }) {
  return (
    <div className={styles.zoom}>
      <button
        type="button"
        aria-label={STR.universe.zoomOut}
        title={STR.universe.zoomOut}
        onClick={() => zoom(1 / 1.25)}
      >
        −
      </button>
      <button
        type="button"
        aria-label={STR.universe.zoomIn}
        title={STR.universe.zoomIn}
        onClick={() => zoom(1.25)}
      >
        +
      </button>
      <button type="button" onClick={() => zoom("fit")}>
        {STR.universe.fit}
      </button>
    </div>
  );
}

// ── 목록 보기(지도 대체, 첨부 N6) ────────────────────────────────────
const LIST_MAX = 500;

function ListView({ graph, selected }: { graph: UGraph; selected: string | null }) {
  const spaces = useAppStore((s) => s.workspaces);
  const rows = useMemo(
    () =>
      graph.nodes
        .filter((n) => n.kind !== "workspace")
        .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.kind.localeCompare(b.kind)),
    [graph],
  );
  const cats = useMemo(
    () => new Map(graph.nodes.filter((n) => n.kind === "category").map((n) => [n.id, n])),
    [graph],
  );
  if (!rows.length) return <p className={styles.empty}>{STR.universe.noMatch}</p>;
  return (
    <div className={styles.list} data-testid="universe-list">
      <div className={styles.mapInfo}>{STR.universe.listCount(rows.length)}</div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>{STR.universe.colKind}</th>
            <th>{STR.universe.colTitle}</th>
            <th>{STR.universe.colWhen}</th>
            <th>{STR.universe.colWhere}</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, LIST_MAX).map((n) => {
            const cat = n.categoryId ? cats.get(`${n.ws}/category/${n.categoryId}`) : undefined;
            const ws = spaces.find((e) => sameDir(e.dir, n.ws));
            return (
              <tr
                key={n.id}
                tabIndex={0}
                aria-selected={n.id === selected}
                className={n.id === selected ? styles.rowOn : ""}
                data-testid="u-row"
                data-id={n.id}
                onClick={() => select(n.id)}
                onDoubleClick={() => void revealNode(n)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    // 이 Enter가 열린 보드 입력칸에 줄바꿈으로 들어가지 않게
                    e.preventDefault();
                    void revealNode(n);
                  } else if (e.key === " ") {
                    e.preventDefault();
                    select(n.id);
                  }
                }}
              >
                <td>
                  <KindGlyph kind={n.kind} color={n.color ? `var(--cat-${n.color})` : undefined} />{" "}
                  {STR.universe.kindName[n.kind]}
                </td>
                <td className={styles.cellText}>{n.title}</td>
                <td>{n.date ? shortDateLabel(n.date) : ""}</td>
                <td className={styles.muted}>
                  {cat?.title ?? ""}
                  {ws && spaces.length > 1 ? ` · ${ws.name}` : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── 상세(spec 4-3) ───────────────────────────────────────────────────
function DetailPanel({ node, all }: { node: UNode | null; all: UGraph }) {
  const cur = useAppStore((s) => (s.journal.state === "ready" ? s.journal.dataDir : null));
  const spaces = useAppStore((s) => s.workspaces);
  const conns = useMemo(() => (node ? connectionsOf(all, node.id) : []), [all, node]);
  // 직접 연결을 맨 위에(사용자가 만든 의미 관계가 주인공, spec 10 R7)
  const sortedConns = useMemo(
    () => [...conns.filter((c) => c.edge.rel), ...conns.filter((c) => !c.edge.rel)],
    [conns],
  );
  if (!node)
    return (
      <aside className={styles.detail} data-testid="universe-detail">
        <p className={styles.muted}>{STR.universe.noSelection}</p>
      </aside>
    );
  const other = !!cur && !sameDir(node.ws, cur);
  const ws = spaces.find((e) => sameDir(e.dir, node.ws));
  const cat = node.categoryId
    ? all.nodes.find((n) => n.id === `${node.ws}/category/${node.categoryId}`)
    : null;
  return (
    <aside className={styles.detail} data-testid="universe-detail">
      <span className={styles.badge}>
        {STR.universe.kindName[node.kind]}
        {node.kind === "entry" && node.depth === 1 ? ` · ${STR.universe.subItem}` : ""}
        {node.kind === "note" && node.noteKind === "image" ? ` · ${STR.universe.imageNote}` : ""}
        {node.kind === "note" && node.noteKind === "link" ? ` · ${STR.universe.linkNote}` : ""}
        {node.refId.startsWith("legacy-") ? ` · ${STR.universe.legacyNote}` : ""}
      </span>
      <h3 className={styles.title} data-testid="u-detail-title">
        {node.title}
      </h3>
      <div className={styles.meta}>
        {cat && (
          <>
            <span className={styles.dot} style={{ background: `var(--cat-${cat.color})` }} /> {cat.title}
          </>
        )}
        {node.date && ` · ${node.date}`}
        {node.weekId && node.kind === "note" && ` · ${node.weekId}`}
        {ws && spaces.length > 1 && ` · ${ws.name}`}
        {node.flagged && ` · ${STR.universe.flagged}`}
        {node.ended && ` · ${STR.universe.ended}`}
      </div>
      {other && ws && <p className={styles.notice}>{STR.universe.otherSpace(ws.name)}</p>}
      {(node.kind === "entry" || node.kind === "note") && (
        <>
          <div className={styles.orig} data-testid="u-original">
            {node.text}
          </div>
          <p className={styles.muted}>{STR.universe.readOnlyNote}</p>
        </>
      )}
      <div className={styles.label}>{STR.universe.why(conns.length)}</div>
      <ul className={styles.why} data-testid="u-connections">
        {sortedConns.slice(0, 40).map(({ edge, other: o, out }) => (
          <li key={edge.id} data-testid={edge.rel ? "u-rel-row" : undefined}>
            <button
              type="button"
              className={styles.whyBtn}
              onClick={() => select(o.id)}
              onDoubleClick={() => focusOn(o.id)}
            >
              <span className={edge.rel ? styles.whyRel : styles.whyKind}>
                {edge.rel
                  ? STR.universe.rel.typeName[edge.rel.type]
                  : (edge.label ?? STR.universe.whyText[edge.source])}
              </span>
              <KindGlyph kind={o.kind} color={o.color ? `var(--cat-${o.color})` : undefined} />
              <span>{o.title}</span>
              {o.date && <span className={styles.muted}>{shortDateLabel(o.date)}</span>}
            </button>
            {edge.rel && (
              <div className={styles.relRow}>
                <span className={styles.relPhrase} data-testid="u-rel-phrase">
                  {relPhrase(edge.rel.type, out ? node.title : o.title, out ? o.title : node.title)}
                  {edge.rel.note && ` — ${edge.rel.note}`}
                </span>
                {!other && (
                  <span className={styles.relActs}>
                    <button
                      type="button"
                      data-testid="u-rel-edit"
                      onClick={() =>
                        openLinkDialog(out ? node.id : o.id, {
                          relId: edge.rel!.id,
                          toId: out ? o.id : node.id,
                          type: edge.rel!.type,
                          note: edge.rel!.note,
                        })
                      }
                    >
                      {STR.universe.rel.edit}
                    </button>
                    <button
                      type="button"
                      data-testid="u-rel-remove"
                      onClick={() => void removeRelation(edge.rel!.id).then((m) => m && toastMsg(m))}
                    >
                      {STR.universe.rel.remove}
                    </button>
                  </span>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className={styles.actions}>
        {node.kind !== "workspace" && (
          <button
            type="button"
            className={styles.primary}
            data-testid="u-open"
            onClick={() => void revealNode(node)}
          >
            {other && ws ? STR.universe.openInSpace(ws.name) : STR.universe.open}
          </button>
        )}
        <button type="button" data-testid="u-focus" onClick={() => focusOn(node.id)}>
          {STR.universe.focusHere}
        </button>
        {!other && node.kind !== "workspace" && (
          <button
            type="button"
            data-testid="u-connect"
            title={STR.universe.rel.connectHint}
            onClick={() => openLinkDialog(node.id)}
          >
            {STR.universe.rel.connect}
          </button>
        )}
      </div>
    </aside>
  );
}

const relPhrase = (t: URelationType, a: string, b: string) => {
  const cut = (x: string) => (x.length > 24 ? `${x.slice(0, 23)}…` : x);
  return STR.universe.rel.phrase[t](`「${cut(a)}」`, `「${cut(b)}」`);
};
const toastMsg = (m: string) => toast(m);

// ── 직접 연결 대화상자(UV2, spec 5-1) — 대상 찾기(검색·최근·같은 업무) → 종류 → 설명 → 저장 ──
function LinkDialog({ all }: { all: UGraph }) {
  const dlg = useUniverse((s) => s.linkDialog)!;
  const byId = useMemo(() => new Map(all.nodes.map((n) => [n.id, n])), [all]);
  const from = byId.get(dlg.fromId);
  const edit = dlg.edit;
  const [q, setQ] = useState("");
  const [toId, setToId] = useState<string | null>(edit?.toId ?? null);
  const [type, setType] = useState<URelationType>(edit?.type ?? "related");
  const [note, setNote] = useState(edit?.note ?? "");
  const [swap, setSwap] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!edit) searchRef.current?.focus();
  }, [edit]);
  // Esc = 닫기 — 저장 중 단추가 잠겨 포커스가 대화상자 밖으로 나가도 닫히게 창에서 받는다
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      closeLinkDialog();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  const candidates = useMemo(() => {
    if (!from) return [];
    const own = all.nodes.filter((n) => n.ws === from.ws && n.kind !== "workspace" && n.id !== from.id);
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (q.trim().length >= 2)
      return own
        .filter((n) => words.every((w) => `${n.title} ${n.text}`.toLowerCase().includes(w)))
        .slice(0, 40);
    // 같은 업무의 가까운 기록 + 최근 기록(spec 5-1)
    const entries = own
      .filter((n) => n.kind === "entry")
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
    const same = from.categoryId ? entries.filter((n) => n.categoryId === from.categoryId).slice(0, 12) : [];
    const recent = entries.filter((n) => !same.includes(n)).slice(0, 12);
    return [...same, ...recent];
  }, [all, from, q]);
  if (!from) return null;
  const to = toId ? byId.get(toId) : undefined;
  const [a, b] = swap ? [to, from] : [from, to];
  const save = async () => {
    if (!to) return;
    setBusy(true);
    const err = edit
      ? await updateRelation(edit.relId, { type, note, swap })
      : await addRelation(a!.id, b!.id, type, note);
    setBusy(false);
    if (err) setError(err);
    else closeLinkDialog();
  };
  return (
    <div
      className={styles.dialogBack}
      onPointerDown={(e) => e.target === e.currentTarget && closeLinkDialog()}
    >
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={edit ? STR.universe.rel.editTitle : STR.universe.rel.dialogTitle}
        data-testid="u-link-dialog"
      >
        <h3>{edit ? STR.universe.rel.editTitle : STR.universe.rel.dialogTitle}</h3>
        <div className={styles.label}>{STR.universe.rel.from}</div>
        <div className={styles.relEnd}>
          <KindGlyph kind={from.kind} color={from.color ? `var(--cat-${from.color})` : undefined} />
          <span>{from.title}</span>
        </div>
        <div className={styles.label}>{STR.universe.rel.target}</div>
        {edit ? (
          <div className={styles.relEnd} data-testid="u-link-chosen">
            {to && <KindGlyph kind={to.kind} color={to.color ? `var(--cat-${to.color})` : undefined} />}
            <span>{to?.title}</span>
          </div>
        ) : (
          <>
            <input
              ref={searchRef}
              type="search"
              className={styles.input}
              placeholder={STR.universe.rel.targetSearch}
              aria-label={STR.universe.rel.targetSearch}
              data-testid="u-link-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className={styles.muted}>
              {q.trim().length >= 2
                ? STR.universe.rel.targetFound(candidates.length)
                : `${STR.universe.rel.targetSameCat} · ${STR.universe.rel.targetRecent}`}
            </div>
            <ul className={styles.relList} role="listbox" aria-label={STR.universe.rel.target}>
              {candidates.length === 0 && <li className={styles.muted}>{STR.universe.rel.targetNone}</li>}
              {candidates.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={toId === n.id}
                    className={toId === n.id ? styles.relPicked : ""}
                    data-testid="u-link-candidate"
                    onClick={() => setToId(n.id)}
                  >
                    <KindGlyph kind={n.kind} color={n.color ? `var(--cat-${n.color})` : undefined} />
                    <span>{n.title}</span>
                    {n.date && <span className={styles.muted}>{shortDateLabel(n.date)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className={styles.label}>{STR.universe.rel.type}</div>
        <div className={styles.relTypes} role="radiogroup" aria-label={STR.universe.rel.type}>
          {RELATION_TYPES.map((t) => (
            <label key={t} title={STR.universe.rel.typeHint[t]}>
              <input
                type="radio"
                name="u-rel-type"
                value={t}
                checked={type === t}
                data-testid={`u-link-type-${t}`}
                onChange={() => setType(t)}
              />
              {STR.universe.rel.typeName[t]}
            </label>
          ))}
        </div>
        <p className={styles.muted} data-testid="u-link-preview">
          {a && b ? relPhrase(type, a.title, b.title) : STR.universe.rel.typeHint[type]}
        </p>
        {edit && isDirected(type) && (
          <label className={styles.check}>
            <input type="checkbox" checked={swap} onChange={(e) => setSwap(e.target.checked)} />
            {STR.universe.rel.swap}
          </label>
        )}
        <div className={styles.label}>{STR.universe.rel.note}</div>
        <textarea
          className={styles.relNote}
          maxLength={RELATION_NOTE_MAX}
          rows={2}
          placeholder={STR.universe.rel.notePlaceholder}
          data-testid="u-link-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className={styles.muted}>{STR.universe.rel.noteCount([...note].length)}</div>
        {error && (
          <p className={styles.notice} role="alert" data-testid="u-link-error">
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            data-testid="u-link-save"
            disabled={!to || busy}
            onClick={() => void save()}
          >
            {STR.universe.rel.save}
          </button>
          <button type="button" onClick={closeLinkDialog}>
            {STR.universe.rel.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 시간 막대(spec 4-1) ──────────────────────────────────────────────
function TimeBar({ all }: { all: UGraph }) {
  const time = useUniverse((s) => s.time);
  const dates = useMemo(
    () => all.nodes.filter((n) => n.kind === "entry" && n.date).map((n) => n.date!),
    [all],
  );
  const buckets = useMemo(
    () => timeBuckets(dates, time.level, time.anchor),
    [dates, time.level, time.anchor],
  );
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const levels: TimeLevel[] = ["year", "month", "week", "day"];
  return (
    <div className={styles.timebar} data-testid="timebar">
      <div className={styles.tbHead}>
        <span className={styles.label}>{STR.universe.time}</span>
        <button
          type="button"
          aria-label={STR.universe.timePrev}
          onClick={() => setTimeAnchor(shiftAnchor(time.level, time.anchor, -1))}
        >
          ◀
        </button>
        <b data-testid="tb-label">{levelLabel(time.level, time.anchor)}</b>
        <button
          type="button"
          aria-label={STR.universe.timeNext}
          onClick={() => setTimeAnchor(shiftAnchor(time.level, time.anchor, 1))}
        >
          ▶
        </button>
        <span className={styles.seg} role="group">
          {levels.map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={time.level === l}
              className={time.level === l ? styles.segOn : ""}
              data-testid={`tb-level-${l}`}
              onClick={() => setTimeLevel(l)}
            >
              {STR.universe.timeLevels[l]}
            </button>
          ))}
        </span>
        <button
          type="button"
          aria-pressed={!time.active}
          className={!time.active ? styles.segOn : ""}
          data-testid="tb-all"
          onClick={clearTime}
        >
          {STR.universe.timeAll}
        </button>
        {time.active && (
          <span className={styles.muted}>{STR.universe.timeRange(levelLabel(time.level, time.anchor))}</span>
        )}
      </div>
      <div className={styles.tbBars}>
        {buckets.map((b) => (
          <button
            key={b.key}
            type="button"
            className={`${styles.tbBucket} ${time.active ? styles.tbActive : ""}`}
            title={STR.universe.timeBucket(b.label, b.count)}
            aria-label={STR.universe.timeBucket(b.label, b.count)}
            data-testid="tb-bucket"
            onClick={() => drillTime(b.from)}
          >
            <span className={styles.tbBar} style={{ height: `${Math.round((b.count / max) * 100)}%` }} />
            <span className={styles.tbLabel}>{b.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
