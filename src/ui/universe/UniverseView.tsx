// Universe 화면(universe-spec 4절, UV1): 왼쪽 필터 · 가운데 지도(초점 = SVG, 은하 = canvas)/목록 · 오른쪽 상세 · 바닥 시간 막대.
// 읽기만 한다 — 원문 편집기 없음, 고치기는 [원본 열기]로 보드·메모·Cabinet에서(첨부 디자인 7절).
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as RPointerEvent,
} from "react";
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
  CARD_LIMITS,
  CARD_STATUSES,
  CARD_TYPES,
  sourceKey,
  type CardStatus,
  type SourceState,
} from "../../domain/knowledgeCard";
import { PACK_MAX_CHARS, PACK_MAX_ITEMS, PACK_QUESTION_MAX } from "../../domain/contextPack";
import {
  addCardSource,
  addToPack,
  closePackDrawer,
  copyPack,
  emptyPack,
  movePackItem,
  packFrom,
  removeFromPack,
  savePackMarkdown,
  setPackField,
  togglePackDrawer,
  usePack,
  addRelation,
  closeCardEditor,
  deleteCard,
  editCard,
  openCardEditor,
  patchCardDraft,
  recheckCardSource,
  removeCardSource,
  resolveDraftPrompt,
  saveCard,
  setCardStatus,
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
import { IconSpace3d, IconSpace2d, IconFocus, IconGalaxy, IconMap, IconList } from "../common/icons";
import { ResizableUniversePanel } from "./ResizableUniversePanel";
import { V19 } from "../../shared/v19Strings";
import { V19Icon } from "../common/v19Icons";
import { useAutoMotion } from "./useAutoMotion";
import styles from "./Universe.module.css";

const UniverseScene = lazy(() => import("./UniverseScene"));
const panelSession = { filter: false, detail: false };
const NOTE_FILL = "#e3c87a";

export function UniverseView() {
  const s = useUniverse();
  const autoMotion = useAutoMotion();
  const all = useMemo(() => combined(s), [s.graphs, s.wsOn]); // eslint-disable-line react-hooks/exhaustive-deps
  const filter = useMemo(() => effectiveFilter(s), [s.filter, s.time]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => filterGraph(all, filter), [all, filter]);
  const byId = useMemo(() => new Map(all.nodes.map((n) => [n.id, n])), [all]);
  const selected = s.selected ? (byId.get(s.selected) ?? null) : null;
  const activeFilters =
    Number(!!s.filter.query.trim()) +
    s.filter.categoryIds.length +
    s.filter.tagIds.length +
    Number(s.filter.kinds.length !== ALL_KINDS.length) +
    Number(s.filter.sources.length !== ALL_SOURCES.length) +
    Number(!!s.filter.range) +
    Number(!s.filter.includeEnded);

  const packOpen = usePack((p) => p.open);
  const [filterOpen, setFilterOpen] = useState(panelSession.filter);
  const [detailOpen, setDetailOpen] = useState(panelSession.detail);
  useEffect(() => {
    const sync = () => {
      document.documentElement.dataset.universeHidden = String(document.hidden);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      delete document.documentElement.dataset.universeHidden;
    };
  }, []);
  const [dynamic, setDynamic] = useState(() => !matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [failed, setFailed] = useState(false);
  const motionTouched = useRef(false);
  useEffect(() => {
    let active = true;
    void useAppStore
      .getState()
      .platform?.loadConfig()
      .then((config) => {
        if (
          active &&
          !motionTouched.current &&
          !matchMedia("(prefers-reduced-motion: reduce)").matches &&
          config?.universeMotion
        )
          setDynamic(config.universeMotion === "dynamic");
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  const chooseMotion = (value: boolean) => {
    motionTouched.current = true;
    setFailed(false);
    setDynamic(value);
    void useAppStore
      .getState()
      .platform?.saveConfig({ universeMotion: value ? "dynamic" : "static" })
      .catch(() => toast("지도 표현 설정을 저장하지 못했습니다."));
  };
  useEffect(() => {
    panelSession.filter = filterOpen;
    panelSession.detail = detailOpen;
  }, [filterOpen, detailOpen]);
  useEffect(() => {
    const resize = () => {
      if (innerWidth <= 1050 && filterOpen && detailOpen) setFilterOpen(false);
    };
    window.addEventListener("resize", resize);
    resize();
    return () => window.removeEventListener("resize", resize);
  }, [filterOpen, detailOpen]);

  const filterButton = useRef<HTMLButtonElement>(null);
  const detailButton = useRef<HTMLButtonElement>(null);
  const failScene = useCallback(() => {
    setFailed(true);
    setDynamic(false);
  }, []);
  const lastPanel = useRef<"filter" | "detail">("detail");
  const togglePanel = (panel: "filter" | "detail") => {
    lastPanel.current = panel;
    if (panel === "filter") {
      setFilterOpen(!filterOpen);
      if (innerWidth <= 1050) setDetailOpen(false);
    } else {
      setDetailOpen(!detailOpen);
      if (innerWidth <= 1050) setFilterOpen(false);
    }
  };
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => {
      if (media.matches) setDynamic(false);
    };
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || s.linkDialog || s.cardEditor || s.draftPrompt || packOpen) return;
      if (detailOpen && (!filterOpen || lastPanel.current === "detail")) {
        setDetailOpen(false);
        detailButton.current?.focus();
      } else if (filterOpen) {
        setFilterOpen(false);
        filterButton.current?.focus();
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [filterOpen, detailOpen, s.linkDialog, s.cardEditor, s.draftPrompt, packOpen]);

  return (
    <section className={styles.view} aria-label={STR.universe.title} data-testid="universe-view">
      <div className={styles.toolbar}>
        <button
          type="button"
          ref={filterButton}
          data-testid="u-toggle-filter"
          aria-expanded={filterOpen}
          aria-controls="u-filter-panel"
          onClick={() => togglePanel("filter")}
        >
          ☷ 필터 {activeFilters > 0 && `(${activeFilters})`}
        </button>
        <button
          type="button"
          ref={detailButton}
          data-testid="u-toggle-detail"
          aria-expanded={detailOpen}
          aria-controls="u-detail-panel"
          onClick={() => togglePanel("detail")}
        >
          ▤ 상세
        </button>
        <div className={`${styles.seg} ${styles.iconSeg}`} role="group" aria-label="지도 표현">
          <button
            type="button"
            aria-pressed={dynamic}
            aria-label="다이나믹 3D"
            title="다이나믹 3D"
            data-testid="u-dynamic"
            onClick={() => {
              chooseMotion(true);
            }}
          >
            <IconSpace3d />
          </button>
          <button
            type="button"
            aria-pressed={!dynamic}
            aria-label="정적 2D"
            title="정적 2D"
            data-testid="u-static"
            onClick={() => chooseMotion(false)}
          >
            <IconSpace2d />
          </button>
        </div>
        {failed && <span role="status">3D를 사용할 수 없어 정적 지도로 전환했습니다.</span>}

        <div className={`${styles.seg} ${styles.iconSeg}`} role="group" aria-label={STR.universe.modeLabel}>
          {(["focus", "galaxy"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={s.mode === m}
              className={s.mode === m ? styles.segOn : ""}
              aria-label={m === "focus" ? STR.universe.modeFocus : STR.universe.modeGalaxy}
              title={m === "focus" ? STR.universe.modeFocus : STR.universe.modeGalaxy}
              data-testid={`u-mode-${m}`}
              onClick={() => setMode(m)}
            >
              {m === "focus" ? <IconFocus /> : <IconGalaxy />}
            </button>
          ))}
        </div>
        <div className={`${styles.seg} ${styles.iconSeg}`} role="group" aria-label={STR.universe.viewLabel}>
          {(["map", "list"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={s.view === v}
              className={s.view === v ? styles.segOn : ""}
              aria-label={v === "map" ? STR.universe.viewMap : STR.universe.viewList}
              title={v === "map" ? STR.universe.viewMap : STR.universe.viewList}
              data-testid={`u-view-${v}`}
              onClick={() => setView(v)}
            >
              {v === "map" ? <IconMap /> : <IconList />}
            </button>
          ))}
        </div>
        {activeFilters > 0 && (
          <button type="button" onClick={resetFilter}>
            필터 초기화
          </button>
        )}
        <PackButton />
        <div
          className={`${styles.seg} ${styles.iconSeg} ${styles.motionControls}`}
          role="group"
          aria-label={V19.motion}
        >
          {(["drift", "orbit"] as const).map((style) => (
            <button
              key={style}
              type="button"
              aria-label={style === "drift" ? V19.drift : V19.orbit}
              title={style === "drift" ? V19.drift : V19.orbit}
              aria-pressed={autoMotion.style === style}
              disabled={!dynamic || s.view !== "map"}
              onClick={() => autoMotion.choose(style)}
            >
              <V19Icon kind={style} />
            </button>
          ))}
          <button
            type="button"
            aria-label={autoMotion.enabled ? V19.pause : V19.play}
            title={
              autoMotion.reduced
                ? V19.reduced
                : !dynamic || s.view !== "map"
                  ? V19.unavailable
                  : autoMotion.enabled
                    ? V19.pause
                    : V19.play
            }
            aria-pressed={autoMotion.enabled}
            disabled={!dynamic || s.view !== "map" || autoMotion.reduced}
            onClick={autoMotion.toggle}
          >
            <V19Icon kind={autoMotion.enabled ? "pause" : "play"} />
          </button>
        </div>
        {s.loading && <span className={styles.muted}>{STR.universe.loading}</span>}
        {s.notices.map((n) => (
          <span key={n} className={styles.notice} role="status">
            {n}
          </span>
        ))}
      </div>
      <div className={styles.body}>
        {filterOpen && (
          <ResizableUniversePanel side="filter">
            <button
              type="button"
              aria-label="필터 접기"
              onClick={() => {
                setFilterOpen(false);
                filterButton.current?.focus();
              }}
            >
              ×
            </button>
            <FilterPanel all={all} />
          </ResizableUniversePanel>
        )}
        <div
          data-dynamic={dynamic}
          data-auto-motion={autoMotion.enabled && !autoMotion.reduced}
          className={`${styles.center} ${s.view === "map" ? styles.space : ""}`}
        >
          {all.nodes.length <= 1 && !s.loading ? (
            <p className={styles.empty}>{STR.universe.empty}</p>
          ) : s.view === "list" ? (
            <ListView graph={shown} selected={s.selected} />
          ) : dynamic ? (
            <Suspense fallback={<p className={styles.empty}>3D 지도 준비 중…</p>}>
              <UniverseScene
                graph={shown}
                onFailure={failScene}
                autoMotion={{
                  enabled:
                    autoMotion.enabled &&
                    !autoMotion.reduced &&
                    !s.linkDialog &&
                    !s.cardEditor &&
                    !s.draftPrompt &&
                    !packOpen,
                  style: autoMotion.style,
                }}
              />
            </Suspense>
          ) : s.mode === "focus" ? (
            <FocusMap all={all} shown={shown} />
          ) : (
            <GalaxyMap graph={shown} selected={s.selected} />
          )}
        </div>
        {detailOpen && (
          <ResizableUniversePanel side="detail">
            <button
              type="button"
              aria-label="상세 접기"
              onClick={() => {
                setDetailOpen(false);
                detailButton.current?.focus();
              }}
            >
              ×
            </button>
            <DetailPanel node={selected} all={all} />
          </ResizableUniversePanel>
        )}
      </div>
      <TimeBar all={all} />
      {packOpen && <PackDrawer all={all} />}
      {s.linkDialog && <LinkDialog all={all} />}
      {s.cardEditor && <CardEditor all={all} />}
      {s.draftPrompt && <DraftPrompt />}
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
      {kind === "card" && <path d="M0-6l6 6-6 6-6-6z" fill="var(--card-fill, #8a6fd1)" />}
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
    case "card-source":
      return { stroke: "#8a6fd1", width: 1.2, dash: "6 2 1 2", opacity: 0.95 };
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
      {n.kind === "card" && (
        <path
          d={`M0 ${-r - 3}L${r + 3} 0 0 ${r + 3}${-r - 3} 0z`}
          fill={n.card?.status === "archived" ? "var(--surface-sub)" : "var(--card-fill, #8a6fd1)"}
          stroke={n.card?.status === "reviewed" ? "var(--accent)" : "#6b52b3"}
          strokeWidth={n.card?.status === "reviewed" ? 2.2 : 1.2}
        />
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
      } else if (n.kind === "card") {
        ctx.fillStyle = "#8a6fd1";
        ctx.beginPath();
        ctx.moveTo(X, Y - 4);
        ctx.lineTo(X + 4, Y);
        ctx.lineTo(X, Y + 4);
        ctx.lineTo(X - 4, Y);
        ctx.closePath();
        ctx.fill();
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
  if (node.kind === "card") return <CardDetail node={node} all={all} />;
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
        {node.dueDate && ` · ${STR.universe.due(shortDateLabel(node.dueDate))}`}
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
            data-testid="u-pack-add"
            title={STR.universe.pack.addHint}
            onClick={() => addToPack(node.id)}
          >
            {STR.universe.pack.add}
          </button>
        )}
        {!other && node.kind !== "workspace" && (
          <button
            type="button"
            data-testid="u-make-card"
            title={STR.universe.card.makeHint}
            onClick={() => void openCardEditor(node.id)}
          >
            {STR.universe.card.make}
          </button>
        )}
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
    const own = all.nodes.filter(
      (n) => n.ws === from.ws && n.kind !== "workspace" && n.kind !== "card" && n.id !== from.id,
    );
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

// ── 지식 카드(UV3, spec 5-2) ─────────────────────────────────────────
const STATE_CLASS: Record<SourceState, string> = {
  ok: "stOk",
  changed: "stChanged",
  moved: "stMoved",
  missing: "stMissing",
};

/** 대상 찾기 목록 — 같은 업무·최근 기록, 두 글자 이상이면 검색(직접 연결·카드 출처가 함께 쓴다) */
function useCandidates(all: UGraph, from: UNode | undefined, q: string, exclude: (n: UNode) => boolean) {
  return useMemo(() => {
    if (!from) return [];
    const own = all.nodes.filter(
      (n) => n.ws === from.ws && n.kind !== "workspace" && n.kind !== "card" && !exclude(n),
    );
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (q.trim().length >= 2)
      return own
        .filter((n) => words.every((w) => `${n.title} ${n.text}`.toLowerCase().includes(w)))
        .slice(0, 40);
    const entries = own
      .filter((n) => n.kind === "entry")
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
    const same = from.categoryId ? entries.filter((n) => n.categoryId === from.categoryId).slice(0, 12) : [];
    const recent = entries.filter((n) => !same.includes(n)).slice(0, 12);
    return [...same, ...recent];
  }, [all, from, q, exclude]);
}

function CardDetail({ node, all }: { node: UNode; all: UGraph }) {
  const view = useUniverse((s) => (s.cardView?.cardId === node.refId ? s.cardView : null));
  const cur = useAppStore((s) => (s.journal.state === "ready" ? s.journal.dataDir : null));
  const own = !!cur && sameDir(node.ws, cur);
  const [open, setOpen] = useState<string | null>(null);
  const byId = useMemo(() => new Map(all.nodes.map((n) => [n.id, n])), [all]);
  const c = view?.card;
  const C = STR.universe.card;
  const status = (c?.status ?? node.card?.status ?? "draft") as CardStatus;
  return (
    <aside className={styles.detail} data-testid="universe-detail">
      <span className={styles.badge}>
        {STR.universe.kindName.card}
        {node.card && ` · ${C.typeName[node.card.type]}`}
      </span>
      <h3 className={styles.title} data-testid="u-detail-title">
        {c?.title ?? node.title}
      </h3>
      <div className={styles.meta}>
        <span className={`${styles.status} ${styles[`status_${status}`] ?? ""}`} data-testid="u-card-status">
          {C.statusName[status]}
        </span>
        {c && ` · ${c.updatedAt.slice(0, 10)}`}
      </div>
      {!c ? (
        <p className={styles.muted}>{STR.universe.loading}</p>
      ) : (
        <>
          {c.summary && <p className={styles.cardSummary}>{c.summary}</p>}
          {c.conditions && (
            <>
              <div className={styles.label}>{C.conditions.split("(")[0]}</div>
              <div className={styles.orig}>{c.conditions}</div>
            </>
          )}
          {c.body && (
            <>
              <div className={styles.label}>{C.body.split("(")[0]}</div>
              <div className={styles.orig} data-testid="u-card-body">
                {c.body}
              </div>
            </>
          )}
          <div className={styles.label}>{C.sources(c.sources.length)}</div>
          <ul className={styles.why} data-testid="u-card-sources">
            {c.sources.map((src) => {
              const st = view!.states[src.id];
              const state = st?.state ?? "missing";
              const target = byId.get(
                src.kind === "note"
                  ? `${node.ws}/note/${src.week ?? ""}/${src.sourceId}`
                  : `${node.ws}/${src.kind}/${src.sourceId}`,
              );
              return (
                <li key={src.id} data-testid="u-card-source" data-state={state}>
                  <div className={styles.srcRow}>
                    <span
                      className={`${styles.srcState} ${styles[STATE_CLASS[state]]}`}
                      title={C.stateHint[state]}
                    >
                      {C.state[state]}
                    </span>
                    <span className={styles.srcText}>{st?.now?.text ?? src.excerpt}</span>
                  </div>
                  <div className={styles.relRow}>
                    <span className={styles.muted}>{st?.now?.locator ?? src.locator}</span>
                    <span className={styles.relActs}>
                      {state !== "ok" && (
                        <button
                          type="button"
                          data-testid="u-card-compare"
                          aria-expanded={open === src.id}
                          onClick={() => setOpen(open === src.id ? null : src.id)}
                        >
                          {C.compare}
                        </button>
                      )}
                      {own && (state === "changed" || state === "moved") && (
                        <button
                          type="button"
                          data-testid="u-card-recheck"
                          onClick={() => void recheckCardSource(c.id, src.id).then((m) => m && toastMsg(m))}
                        >
                          {C.recheck}
                        </button>
                      )}
                      {target && (
                        <button type="button" onClick={() => void revealNode(target)}>
                          {C.openSource}
                        </button>
                      )}
                    </span>
                  </div>
                  {open === src.id && (
                    <div className={styles.compare} data-testid="u-card-diff">
                      <div>
                        <div className={styles.label}>{C.excerpt}</div>
                        <div className={styles.orig}>{src.excerpt || "—"}</div>
                      </div>
                      <div>
                        <div className={styles.label}>{C.now}</div>
                        <div className={styles.orig}>{st?.now?.text ?? C.state.missing}</div>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {own && c && (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            data-testid="u-card-edit"
            onClick={() => void editCard(c.id)}
          >
            {C.edit}
          </button>
          {status !== "reviewed" && (
            <button
              type="button"
              data-testid="u-card-review"
              title={C.statusHint}
              onClick={() => void setCardStatus(c.id, "reviewed").then((m) => m && toastMsg(m))}
            >
              {C.markReviewed}
            </button>
          )}
          {status !== "archived" && (
            <button
              type="button"
              data-testid="u-card-archive"
              onClick={() => void setCardStatus(c.id, "archived")}
            >
              {C.archive}
            </button>
          )}
          {status !== "draft" && (
            <button type="button" onClick={() => void setCardStatus(c.id, "draft")}>
              {C.backToDraft}
            </button>
          )}
          <button type="button" data-testid="u-pack-add" onClick={() => addToPack(node.id)}>
            {STR.universe.pack.add}
          </button>
          <button type="button" data-testid="u-card-delete" onClick={() => void deleteCard(c.id)}>
            {C.remove}
          </button>
        </div>
      )}
    </aside>
  );
}

function DraftPrompt() {
  const C = STR.universe.card;
  return (
    <div className={styles.dialogBack}>
      <div
        className={styles.dialog}
        role="alertdialog"
        aria-label={C.draftFound}
        data-testid="u-card-draft-prompt"
      >
        <h3>{C.draftFound}</h3>
        <p className={styles.muted}>{C.draftKept}</p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            data-testid="u-card-draft-resume"
            onClick={() => resolveDraftPrompt(true)}
          >
            {C.draftResume}
          </button>
          <button type="button" data-testid="u-card-draft-discard" onClick={() => resolveDraftPrompt(false)}>
            {C.draftDiscard}
          </button>
        </div>
      </div>
    </div>
  );
}

function Counted({ value, max }: { value: string; max: number }) {
  const n = [...value].length;
  return <span className={n > max ? styles.over : styles.muted}>{STR.universe.card.count(n, max)}</span>;
}

function CardEditor({ all }: { all: UGraph }) {
  const ed = useUniverse((s) => s.cardEditor)!;
  const cur = useAppStore((s) => (s.journal.state === "ready" ? s.journal.dataDir : null));
  const d = ed.draft;
  const C = STR.universe.card;
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const byKey = useMemo(() => {
    const m = new Map<string, UNode>();
    for (const n of all.nodes) {
      if (!cur || !sameDir(n.ws, cur)) continue;
      if (n.kind === "workspace" || n.kind === "card") continue;
      const k =
        n.kind === "note"
          ? sourceKey({ kind: "note", sourceId: n.refId, week: n.weekId ?? null })
          : sourceKey({ kind: n.kind, sourceId: n.refId });
      m.set(k, n);
    }
    return m;
  }, [all, cur]);
  const first = d.sources[0] ? byKey.get(sourceKey(d.sources[0])) : undefined;
  const chosen = useMemo(() => new Set(d.sources.map(sourceKey)), [d.sources]);
  const exclude = useMemo(
    () => (n: UNode) =>
      chosen.has(
        n.kind === "note"
          ? sourceKey({ kind: "note", sourceId: n.refId, week: n.weekId ?? null })
          : sourceKey({ kind: n.kind as "entry", sourceId: n.refId }),
      ),
    [chosen],
  );
  const candidates = useCandidates(
    all,
    first ?? all.nodes.find((n) => cur && sameDir(n.ws, cur)),
    q,
    exclude,
  );
  const categories = useMemo(
    () => all.nodes.filter((n) => n.kind === "category" && cur && sameDir(n.ws, cur)),
    [all, cur],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      closeCardEditor();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  const save = async () => {
    setBusy(true);
    await saveCard();
    setBusy(false);
  };
  return (
    <div className={styles.dialogBack}>
      <div
        className={`${styles.dialog} ${styles.cardDialog}`}
        role="dialog"
        aria-modal="true"
        aria-label={d.id ? C.editTitle : C.newTitle}
        data-testid="u-card-editor"
      >
        <h3>{d.id ? C.editTitle : C.newTitle}</h3>
        <div className={styles.cardGrid}>
          <div>
            <div className={styles.label}>{C.typeLabel}</div>
            <div className={styles.relTypes} role="radiogroup" aria-label={C.typeLabel}>
              {CARD_TYPES.map((t) => (
                <label key={t}>
                  <input
                    type="radio"
                    name="u-card-type"
                    checked={d.type === t}
                    data-testid={`u-card-type-${t}`}
                    onChange={() => patchCardDraft({ type: t })}
                  />
                  {C.typeName[t]}
                </label>
              ))}
            </div>
            <div className={styles.label}>{C.statusLabel}</div>
            <div className={styles.relTypes} role="radiogroup" aria-label={C.statusLabel}>
              {CARD_STATUSES.map((t) => (
                <label key={t} title={t === "reviewed" ? C.statusHint : undefined}>
                  <input
                    type="radio"
                    name="u-card-status"
                    checked={d.status === t}
                    data-testid={`u-card-status-${t}`}
                    onChange={() => patchCardDraft({ status: t })}
                  />
                  {C.statusName[t]}
                </label>
              ))}
            </div>
            <label className={styles.field}>
              <span className={styles.label}>
                {C.title} <Counted value={d.title} max={CARD_LIMITS.title} />
              </span>
              <input
                className={styles.input}
                data-testid="u-card-title"
                value={d.title}
                maxLength={CARD_LIMITS.title}
                onChange={(e) => patchCardDraft({ title: e.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>
                {C.summary} <Counted value={d.summary} max={CARD_LIMITS.summary} />
              </span>
              <textarea
                className={styles.relNote}
                rows={2}
                data-testid="u-card-summary"
                value={d.summary}
                maxLength={CARD_LIMITS.summary}
                onChange={(e) => patchCardDraft({ summary: e.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>
                {C.conditions} <Counted value={d.conditions} max={CARD_LIMITS.conditions} />
              </span>
              <textarea
                className={styles.relNote}
                rows={2}
                data-testid="u-card-conditions"
                value={d.conditions}
                maxLength={CARD_LIMITS.conditions}
                onChange={(e) => patchCardDraft({ conditions: e.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>
                {C.body} <Counted value={d.body} max={CARD_LIMITS.body} />
              </span>
              <textarea
                className={styles.relNote}
                rows={5}
                data-testid="u-card-body-input"
                value={d.body}
                maxLength={CARD_LIMITS.body}
                onChange={(e) => patchCardDraft({ body: e.target.value })}
              />
            </label>
          </div>
          <div>
            <div className={styles.label}>{C.sources(d.sources.length)}</div>
            <p className={styles.muted}>{C.noExcerptCopy}</p>
            <ul className={styles.relList} data-testid="u-card-chosen">
              {d.sources.map((src) => {
                const k = sourceKey(src);
                const n = byKey.get(k);
                return (
                  <li key={k} className={styles.chosenRow}>
                    {n && <KindGlyph kind={n.kind} color={n.color ? `var(--cat-${n.color})` : undefined} />}
                    <span>{n?.title ?? C.state.missing}</span>
                    <button
                      type="button"
                      aria-label={C.removeSource}
                      title={C.removeSource}
                      data-testid="u-card-source-remove"
                      onClick={() => removeCardSource(k)}
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className={styles.label}>{C.addSource}</div>
            <input
              type="search"
              className={styles.input}
              placeholder={C.addSourceSearch}
              aria-label={C.addSourceSearch}
              data-testid="u-card-source-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <ul className={styles.relList} aria-label={C.addSource}>
              {candidates.length === 0 && <li className={styles.muted}>{STR.universe.rel.targetNone}</li>}
              {candidates.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    data-testid="u-card-source-candidate"
                    onClick={() => addCardSource(n.id)}
                  >
                    <KindGlyph kind={n.kind} color={n.color ? `var(--cat-${n.color})` : undefined} />
                    <span>{n.title}</span>
                    {n.date && <span className={styles.muted}>{shortDateLabel(n.date)}</span>}
                  </button>
                </li>
              ))}
            </ul>
            <div className={styles.label}>{C.categories}</div>
            <div className={styles.chips}>
              {categories.map((c) => {
                const on = d.categoryIds.includes(c.refId);
                return (
                  <label key={c.id} className={styles.check}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        patchCardDraft({
                          categoryIds: on
                            ? d.categoryIds.filter((x) => x !== c.refId)
                            : [...d.categoryIds, c.refId],
                        })
                      }
                    />
                    <span className={styles.dot} style={{ background: `var(--cat-${c.color})` }} />
                    {c.title}
                  </label>
                );
              })}
            </div>
          </div>
        </div>
        {!d.id && <p className={styles.muted}>{C.draftKept}</p>}
        {ed.error && (
          <p className={styles.notice} role="alert" data-testid="u-card-error">
            {ed.error}
          </p>
        )}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            data-testid="u-card-save"
            disabled={busy}
            onClick={() => void save()}
          >
            {C.save}
          </button>
          <button type="button" data-testid="u-card-cancel" onClick={closeCardEditor}>
            {C.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}

function PackButton() {
  const n = usePack((p) => p.items.length);
  const open = usePack((p) => p.open);
  return (
    <button
      type="button"
      className={`${styles.packBtn} ${open ? styles.segOn : ""}`}
      aria-pressed={open}
      data-testid="pack-toggle"
      onClick={togglePackDrawer}
    >
      {STR.universe.pack.drawer(n)}
    </button>
  );
}

// ── 근거 묶음 서랍(UV4, spec 5-3) ─────────────────────────────────────
function PackDrawer({ all }: { all: UGraph }) {
  const pack = usePack();
  const P = STR.universe.pack;
  const r = useMemo(() => packFrom(all, pack), [all, pack]);
  const byId = useMemo(() => new Map(all.nodes.map((n) => [n.id, n])), [all]);
  return (
    <aside className={styles.drawer} aria-label={P.title} data-testid="pack-drawer">
      <div className={styles.drawerHead}>
        <h3>{P.title}</h3>
        <button type="button" aria-label={STR.universe.card.cancel} onClick={closePackDrawer}>
          ✕
        </button>
      </div>
      <p className={styles.muted}>{P.boundary}</p>
      <label className={styles.field}>
        <span className={styles.label}>{P.question}</span>
        <textarea
          className={styles.relNote}
          rows={2}
          maxLength={PACK_QUESTION_MAX}
          placeholder={P.questionPlaceholder}
          data-testid="pack-question"
          value={pack.question}
          onChange={(e) => setPackField({ question: e.target.value })}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>{P.purpose}</span>
        <input
          className={styles.input}
          placeholder={P.purposePlaceholder}
          data-testid="pack-purpose"
          value={pack.purpose}
          onChange={(e) => setPackField({ purpose: e.target.value })}
        />
      </label>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={pack.includePaths}
          data-testid="pack-paths"
          onChange={(e) => setPackField({ includePaths: e.target.checked })}
        />
        {P.includePaths}
      </label>
      <div className={styles.label}>
        {P.items(r.included.length, PACK_MAX_ITEMS)} · {P.chars(r.chars, PACK_MAX_CHARS)}
      </div>
      {pack.items.length === 0 ? (
        <p className={styles.muted}>{P.empty}</p>
      ) : (
        <ul className={styles.relList} data-testid="pack-items">
          {pack.items.map((id, i) => {
            const n = byId.get(id);
            const inc = r.included.find((x) => x.item.key === id);
            const exc = r.excluded.find((x) => x.item.key === id);
            return (
              <li key={id} className={styles.chosenRow} data-testid="pack-item">
                {inc && <b className={styles.ref}>{inc.ref}</b>}
                {n && <KindGlyph kind={n.kind} color={n.color ? `var(--cat-${n.color})` : undefined} />}
                <span>
                  {n?.title ?? STR.universe.card.state.missing}
                  {exc && <em className={styles.over}> · {P.reason[exc.reason]}</em>}
                </span>
                <button
                  type="button"
                  aria-label={P.up}
                  disabled={i === 0}
                  onClick={() => movePackItem(id, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={P.down}
                  disabled={i === pack.items.length - 1}
                  onClick={() => movePackItem(id, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={P.remove}
                  title={P.remove}
                  data-testid="pack-remove"
                  onClick={() => removeFromPack(id)}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {r.excluded.some((x) => x.reason !== "empty") && (
        <p className={styles.notice} data-testid="pack-excluded">
          {P.excluded(r.excluded.filter((x) => x.reason !== "empty").length)}
        </p>
      )}
      {r.missing.length > 0 && <p className={styles.notice}>{P.missing(r.missing.length)}</p>}
      <div className={styles.label}>{P.preview}</div>
      <pre className={styles.packPreview} data-testid="pack-preview">
        {r.text}
      </pre>
      {pack.notice && (
        <p className={styles.notice} role="alert" data-testid="pack-notice">
          {pack.notice}
        </p>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primary}
          data-testid="pack-copy"
          disabled={!pack.items.length}
          onClick={() => void copyPack()}
        >
          {P.copy}
        </button>
        <button
          type="button"
          data-testid="pack-save"
          disabled={!pack.items.length}
          onClick={() => void savePackMarkdown()}
        >
          {P.save}
        </button>
        <button type="button" disabled={!pack.items.length} onClick={emptyPack}>
          {P.clear}
        </button>
      </div>
    </aside>
  );
}
