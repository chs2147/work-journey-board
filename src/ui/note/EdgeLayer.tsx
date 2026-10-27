// 메모 관계선(note-relation-spec): 판 안 맨 아래 층의 SVG — 둥근 모서리 꺾은선·화살촉·이름표, 끌어서 잇는 중의 미리보기,
// 키보드로 잇는 중의 후보 번호. 선 도구 막대는 배율과 상관없이 100% 크기로 판 바깥(서식 막대와 같은 자리 방식).
// SVG는 속성만 쓴다(CSP: style 문자열 없음 — 위치·z는 React style 속성 = CSSOM).
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { linkCandidates, useEdgeRoutes } from "./edgeHooks";
import { boxName, edgesOf, type NoteDoc, type NoteEdge } from "../../domain/note";
import { rectOf, routeEdge } from "../../domain/noteEdge";
import { STR } from "../../shared/strings";
import {
  backToOrigin,
  cycleBoxEdges,
  redoNote,
  removeEdges,
  reverseEdge,
  selectEdge,
  setEdgeDir,
  setEdgeLabelOpen,
  undoNote,
  updateEdge,
  useNote,
} from "./noteStore";
import styles from "./Note.module.css";

const ARROW = { one: "→", both: "↔", none: "—" } as const;

export function EdgeLayer({ doc, size }: { doc: NoteDoc; size: { w: number; h: number } }) {
  const show = useNote((s) => s.showEdges);
  const edgeId = useNote((s) => s.edgeId);
  const hover = useNote((s) => s.edgeHover);
  const linking = useNote((s) => s.linking);
  const pendingId = useNote((s) => s.pendingId);
  const labelOpen = useNote((s) => s.edgeLabelOpen);
  const routes = useEdgeRoutes(doc);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const gRefs = useRef<Record<string, SVGGElement | null>>({});
  // 선은 모든 상자 뒤(상자 z는 맨 뒤로 보내기로 0 아래가 될 수 있다)
  const z = Math.min(0, ...doc.boxes.map((b) => b.z + 1)) - 1;

  // 선을 고르면 그 선에 포커스(키를 받게) — 이름표 칸이 열려 있으면 칸이 갖는다
  useEffect(() => {
    if (edgeId && !labelOpen) gRefs.current[edgeId]?.focus({ preventScroll: true });
  }, [edgeId, labelOpen]);

  if (!show && !linking) return null;

  const byId = new Map(doc.boxes.map((b) => [b.id, b]));
  const fromBox = linking ? byId.get(linking.from) : undefined;
  const targetBox = linking?.target ? byId.get(linking.target) : undefined;
  const preview =
    fromBox && targetBox
      ? routeEdge(rectOf(fromBox), rectOf(targetBox))
      : fromBox && linking?.pointer
        ? routeEdge(rectOf(fromBox), { ...linking.pointer, w: 0, h: 0 }, 4)
        : null;
  const candidates = linking?.mode === "keys" ? linkCandidates(doc, linking.from, pendingId) : [];
  const linked = new Set(
    linking
      ? edgesOf(doc)
          .filter((e) => e.from === linking.from || e.to === linking.from)
          .map((e) => (e.from === linking.from ? e.to : e.from))
      : [],
  );

  const onKey = (e: KeyboardEvent<SVGGElement>, edge: NoteEdge) => {
    if (e.nativeEvent.isComposing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeEdges([edge.id]);
    } else if (e.key === "Enter") {
      e.preventDefault();
      setEdgeLabelOpen(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      backToOrigin();
    } else if (mod && !e.altKey && e.code === "KeyZ") {
      e.preventDefault();
      if (e.shiftKey) redoNote();
      else undoNote();
    } else if (mod && !e.altKey && e.code === "KeyY") {
      e.preventDefault();
      redoNote();
    } else if (e.code === "KeyL" && e.shiftKey && !mod && !e.altKey) {
      e.preventDefault();
      const origin = useNote.getState().edgeOrigin;
      if (origin) cycleBoxEdges(origin);
    } else if (e.key.startsWith("Arrow")) e.preventDefault();
  };

  return (
    <>
      <svg
        className={styles.edgeLayer}
        width={size.w}
        height={size.h}
        style={{ zIndex: z }}
        data-testid="note-edges"
        role="group"
        aria-label={STR.note.edgeLayer}
      >
        <defs>
          {(["", "On"] as const).map((k) => (
            <marker
              key={k}
              id={`${uid}-arrow${k}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="8"
              markerHeight="8"
              markerUnits="userSpaceOnUse"
              orient="auto-start-reverse"
            >
              <path d="M0 0 L10 5 L0 10 z" className={k ? styles.edgeArrowOn : styles.edgeArrow} />
            </marker>
          ))}
        </defs>
        {show &&
          routes.map(({ edge, route, from, to }) => {
            const on = edge.id === edgeId || edge.id === hover;
            const m = `url(#${uid}-arrow${on ? "On" : ""})`;
            return (
              <g
                key={edge.id}
                ref={(el) => {
                  gRefs.current[edge.id] = el;
                }}
                className={`${styles.edge} ${on ? styles.edgeOn : ""}`}
                tabIndex={-1}
                role="button"
                aria-pressed={edge.id === edgeId}
                aria-label={STR.note.edgeAria(boxName(from), ARROW[edge.dir], boxName(to), edge.label)}
                data-testid="note-edge"
                data-edge-id={edge.id}
                data-from={edge.from}
                data-to={edge.to}
                data-dir={edge.dir}
                data-dash={edge.dash ? "" : undefined}
                data-d={route.d}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.stopPropagation();
                  e.preventDefault();
                  selectEdge(edge.id);
                }}
                onDoubleClick={() => (selectEdge(edge.id), setEdgeLabelOpen(true))}
                onKeyDown={(e) => onKey(e, edge)}
              >
                {on && <path d={route.d} className={styles.edgeGlow} />}
                <path d={route.d} className={styles.edgeHit} />
                <path
                  d={route.d}
                  className={styles.edgeLine}
                  strokeDasharray={edge.dash ? "6 4" : undefined}
                  markerEnd={edge.dir !== "none" ? m : undefined}
                  markerStart={edge.dir === "both" ? m : undefined}
                />
              </g>
            );
          })}
        {preview && (
          <path
            d={preview.d}
            className={styles.edgePreview}
            markerEnd={`url(#${uid}-arrowOn)`}
            data-testid="note-edge-preview"
          />
        )}
      </svg>
      {show &&
        routes
          .filter(({ edge }) => edge.label)
          .map(({ edge, route }) => (
            <span
              key={edge.id}
              className={`${styles.edgeLabel} ${edge.id === edgeId || edge.id === hover ? styles.edgeLabelOn : ""}`}
              style={{ left: route.mid.x, top: route.mid.y, zIndex: z }}
              data-testid="note-edge-label"
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                e.preventDefault();
                selectEdge(edge.id);
              }}
              onDoubleClick={() => (selectEdge(edge.id), setEdgeLabelOpen(true))}
            >
              {edge.label}
            </span>
          ))}
      {targetBox && (
        <span
          className={styles.linkTarget}
          style={{ left: targetBox.x, top: targetBox.y, width: targetBox.w, height: rectOf(targetBox).h }}
          data-testid="note-link-target"
        />
      )}
      {candidates.map((b, i) => (
        <span
          key={b.id}
          className={`${styles.linkBadge} ${linked.has(b.id) ? styles.linkBadgeLinked : ""}`}
          style={{ left: b.x - 10, top: b.y - 10 }}
          data-testid="note-link-badge"
        >
          {linked.has(b.id) ? `${i + 1} ${STR.note.edgeLinked}` : i + 1}
        </span>
      ))}
    </>
  );
}

/** 선 도구 막대(3절) — 선 가운데 아래, 화면 px(배율과 상관없이 100%) */
export function EdgeToolbar({ doc, zoom }: { doc: NoteDoc; zoom: number }) {
  const edgeId = useNote((s) => s.edgeId);
  const labelOpen = useNote((s) => s.edgeLabelOpen);
  const routes = useEdgeRoutes(doc);
  const hit = routes.find((r) => r.edge.id === edgeId);
  if (!hit) return null;
  const { edge, route } = hit;
  const keep = (e: { preventDefault(): void }) => e.preventDefault(); // 단추를 눌러도 선의 포커스 유지
  const tool = (label: string, on: boolean, onClick: () => void, text: string, extra = "") => (
    <button
      type="button"
      className={`${styles.tool} ${on ? styles.toolOn : ""} ${extra}`}
      aria-label={label}
      title={label}
      aria-pressed={on}
      onMouseDown={keep}
      onClick={onClick}
    >
      {text}
    </button>
  );
  return (
    <div
      className={styles.edgeBar}
      style={{ left: route.mid.x * zoom, top: route.mid.y * zoom + 14 }}
      onPointerDown={(e) => e.stopPropagation()}
      data-testid="edge-toolbar"
    >
      <div className={styles.edgeBarRow} role="toolbar" aria-label={STR.note.edgeToolbar}>
        {tool(STR.note.edgeDirOne, edge.dir === "one", () => setEdgeDir(edge.id, "one"), "→")}
        {tool(STR.note.edgeDirBoth, edge.dir === "both", () => setEdgeDir(edge.id, "both"), "↔")}
        {tool(STR.note.edgeDirNone, edge.dir === "none", () => setEdgeDir(edge.id, "none"), "—")}
        <span className={styles.sep} />
        {tool(STR.note.edgeSolid, !edge.dash, () => updateEdge(edge.id, { dash: false }), STR.note.edgeSolid)}
        {tool(STR.note.edgeDash, edge.dash, () => updateEdge(edge.id, { dash: true }), STR.note.edgeDash)}
        <span className={styles.sep} />
        {tool(STR.note.edgeLabelTitle, labelOpen, () => setEdgeLabelOpen(!labelOpen), STR.note.edgeLabel)}
        {tool(STR.note.edgeReverse, false, () => reverseEdge(edge.id), "⇄")}
        <span className={styles.sep} />
        {tool(
          STR.note.edgeRemoveTitle,
          false,
          () => removeEdges([edge.id]),
          STR.note.edgeRemove,
          styles.toolDanger,
        )}
      </div>
      {labelOpen && <LabelInput key={edge.id} edge={edge} />}
    </div>
  );
}

function LabelInput({ edge }: { edge: NoteEdge }) {
  const [v, setV] = useState(edge.label);
  const done = (save: boolean) => {
    if (save) updateEdge(edge.id, { label: v });
    setEdgeLabelOpen(false);
  };
  return (
    <label className={styles.edgeLabelRow}>
      <span>{STR.note.edgeLabel}</span>
      <input
        value={v}
        maxLength={20}
        autoFocus
        placeholder={STR.note.edgeLabelPlaceholder}
        aria-label={STR.note.edgeLabel}
        data-testid="edge-label-input"
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            done(true);
          } else if (e.key === "Escape") {
            e.preventDefault();
            done(false);
          }
        }}
        onBlur={() => useNote.getState().edgeLabelOpen && done(true)}
      />
      <span className={styles.edgeLabelHint}>{STR.note.edgeLabelHint}</span>
    </label>
  );
}
