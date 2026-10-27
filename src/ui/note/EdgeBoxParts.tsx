// 상자 쪽 관계선 조각(note-relation-spec 2·4절): 연결점 2개(왼쪽 가운데·아래 가운데)와 ⋯ 메뉴의 관계선 항목.
// 텍스트·이미지·링크 카드 상자가 함께 쓴다.
import { useEffect, type PointerEvent } from "react";
import { boxEdges, boxName } from "../../domain/note";
import { STR } from "../../shared/strings";
import {
  cancelLinking,
  finishLinking,
  removeBoxEdges,
  removeEdges,
  selectBox,
  selectEdge,
  setEdgeHover,
  setLinkTarget,
  startLinking,
  useNote,
} from "./noteStore";
import styles from "./Note.module.css";

/** 연결점을 끌어 잇기(2-1): 커서 아래 상자 = 놓을 곳, 빈 곳·같은 상자에 놓으면 취소, Esc = 취소 */
function startEdgeDrag(e: PointerEvent<HTMLElement>, from: string) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const el = e.currentTarget;
  el.setPointerCapture(e.pointerId);
  const canvas = el.closest<HTMLElement>("[data-note-drop]");
  const zoom = useNote.getState().zoom;
  startLinking(from, "drag");
  const move = (ev: globalThis.PointerEvent) => {
    const r = canvas?.getBoundingClientRect();
    const hit = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-box-id]");
    setLinkTarget(
      hit?.dataset.boxId ?? null,
      r ? { x: (ev.clientX - r.left) / zoom, y: (ev.clientY - r.top) / zoom } : null,
    );
  };
  const finish = (ok: boolean) => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", key, true);
    if (ok) finishLinking();
    else cancelLinking();
  };
  const up = () => finish(true);
  const cancel = () => finish(false);
  const key = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    finish(false);
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", key, true);
}

/** 메뉴로 해제한 뒤 키(Ctrl+Z 등)가 이 상자로 이어지게 — 이미 선택돼 있어도 포커스를 되돌린다 */
function focusBox(boxId: string) {
  selectBox(boxId);
  requestAnimationFrame(() =>
    document
      .querySelector<HTMLElement>(`[data-box-id="${CSS.escape(boxId)}"]`)
      ?.focus({ preventScroll: true }),
  );
}

/** 연결점 2개 — 마우스를 올리거나 선택했을 때만(CSS), 대기 상자·[관계선 보기] 끔이면 없음 */
export function EdgeKnobs({ boxId }: { boxId: string }) {
  const on = useNote((s) => s.showEdges && s.pendingId !== boxId && s.editingId !== boxId);
  const dragging = useNote((s) => s.linking?.from === boxId);
  if (!on) return null;
  return (
    <>
      {(["left", "bottom"] as const).map((side) => (
        <button
          key={side}
          type="button"
          className={`${styles.knob} ${side === "left" ? styles.knobLeft : styles.knobBottom} ${dragging ? styles.knobActive : ""}`}
          aria-label={STR.note.edgeKnob}
          title={STR.note.edgeKnob}
          tabIndex={-1}
          data-testid="edge-knob"
          data-side={side}
          onPointerDown={(e) => startEdgeDrag(e, boxId)}
        />
      ))}
    </>
  );
}

/** 상자 ⋯ 메뉴의 관계선 항목(2-2·4절): [관계선 잇기…] · 관계선 N개 목록(✕) · [관계선 모두 해제] */
export function EdgeMenuItems({ boxId, close }: { boxId: string; close(): void }) {
  const doc = useNote((s) => s.doc);
  const pending = useNote((s) => s.pendingId === boxId);
  // 메뉴가 닫히면 목록에서 강조하던 선도 푼다
  useEffect(() => () => setEdgeHover(null), []);
  if (pending) return null;
  const list = boxEdges(doc, boxId);
  const byId = new Map(doc.boxes.map((b) => [b.id, b]));
  return (
    <>
      <div className={styles.menuSep} role="separator" />
      <button
        type="button"
        role="menuitem"
        data-testid="edge-start"
        onClick={() => {
          close();
          startLinking(boxId, "keys");
        }}
      >
        {STR.note.edgeStart}
        <span className={styles.menuKey}>L</span>
      </button>
      {list.length > 0 && (
        <>
          <div className={styles.menuHead}>{STR.note.edgeListHead(list.length)}</div>
          {list.map((e) => {
            const other = byId.get(e.from === boxId ? e.to : e.from);
            const name = other ? boxName(other) : "";
            const arrow = e.dir === "none" ? "—" : e.dir === "both" ? "↔" : e.from === boxId ? "→" : "←";
            return (
              <div
                key={e.id}
                className={styles.menuEdge}
                data-testid="edge-menu-row"
                onPointerEnter={() => setEdgeHover(e.id)}
                onPointerLeave={() => setEdgeHover(null)}
              >
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuEdgeMain}
                  onClick={() => {
                    close();
                    setEdgeHover(null);
                    selectEdge(e.id, boxId);
                  }}
                >
                  <span className={styles.menuEdgeArrow} aria-hidden="true">
                    {arrow}
                  </span>
                  <span className={styles.menuEdgeName}>
                    {name}
                    {e.label ? ` · ${e.label}` : ""}
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuEdgeX}
                  aria-label={STR.note.edgeListRemove(name)}
                  title={STR.note.edgeListRemove(name)}
                  data-testid="edge-menu-remove"
                  onClick={() => {
                    close();
                    setEdgeHover(null);
                    removeEdges([e.id]);
                    focusBox(boxId);
                  }}
                >
                  ✕
                </button>
              </div>
            );
          })}
          <button
            type="button"
            role="menuitem"
            className={styles.danger}
            data-testid="edge-remove-all"
            onClick={() => {
              close();
              setEdgeHover(null);
              removeBoxEdges(boxId);
              focusBox(boxId);
            }}
          >
            {STR.note.edgeRemoveAll}
          </button>
        </>
      )}
      <div className={styles.menuSep} role="separator" />
    </>
  );
}
