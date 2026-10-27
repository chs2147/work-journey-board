// 행 끌어서 옮기기(improve-1026v2-spec 3절): ⋮⋮에서 포인터로 직접 끈다(HTML5 DnD는 입력칸 글자 끌기와 섞여서 쓰지 않음).
// 놓을 칸 = 포인터 아래의 [data-cell-key](주간 보드 칸·오늘 뷰 카드 — 보고 있는 주 안), 놓을 틈 = 그 칸 [data-item-index] 행의 가운데 기준.
// Esc = 취소. 실앱은 dragDropEnabled:false라 화면 안 끌기가 그대로 동작한다.
import type { PointerEvent as ReactPointerEvent } from "react";
import { create } from "zustand";
import { deleteRange, moveRows, snapGap } from "../../domain/items";
import { addLinkedBox, linkBox, useNote } from "../note/noteStore";
import { flushAll, moveRowsTo, setFocusDay, splitKey, useBoard } from "./boardStore";
import styles from "./Board.module.css";

export interface RowDrag {
  fromKey: string;
  fromIndex: number;
  /** 옮기는 줄 범위 [start, end) — 원래 자리를 흐리게 */
  start: number;
  end: number;
  /** 놓을 칸·틈(없으면 놓아도 아무 일 없음) */
  overKey: string | null;
  gap: number | null;
  /** 놓이면 세부 항목이 되는가(파란 선 들여쓰기) */
  sub: boolean;
  /** 메모 판 위(문서 좌표) — 놓으면 이 항목과 연결된 메모(improve-1026v2-spec 4절) */
  note: { x: number; y: number } | null;
  /** 메모 상자 위 — 놓으면 그 상자에 이 항목 연결 더하기(multi-link-spec 2-2) */
  box: string | null;
}

export const useRowDrag = create<{ drag: RowDrag | null }>(() => ({ drag: null }));

/** 메모 상자를 보드 항목 위로 끌고 있을 때 그 항목 — linked = 이미 연결된 항목("연결됨", multi-link-spec 2-1) */
export const useLinkDrop = create<{ itemId: string | null; linked: boolean }>(() => ({
  itemId: null,
  linked: false,
}));

/** 메모 띠의 줄에 마우스를 올린 항목 — 보드에서 그 항목에 테두리(multi-link-spec 1절) */
export const useLinkHover = create<{ itemId: string | null }>(() => ({ itemId: null }));

/** 화면 좌표 아래의 보드 항목 id(메모 상자 끌기 — 상자 자신이 위에 있어 겹친 요소를 모두 본다) */
export function itemAtPoint(x: number, y: number): string | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const row = el.closest<HTMLElement>("[data-cell-key] [data-item-id]");
    if (row) return row.dataset.itemId ?? null;
  }
  return null;
}

const THRESHOLD = 4;
const EDGE = 40;
const SCROLL_STEP = 14;

function gapAt(cellEl: Element, y: number): number {
  const rows = [...cellEl.querySelectorAll<HTMLElement>("[data-item-index]")];
  for (const row of rows) {
    const r = row.getBoundingClientRect();
    if (y < r.top + r.height / 2) return Number(row.dataset.itemIndex);
  }
  return rows.length;
}

function autoScroll(from: Element, y: number) {
  const scroller = from.closest<HTMLElement>("[data-drag-scroll]");
  if (!scroller) return;
  const r = scroller.getBoundingClientRect();
  if (y < r.top + EDGE) scroller.scrollBy(0, -SCROLL_STEP);
  else if (y > r.bottom - EDGE) scroller.scrollBy(0, SCROLL_STEP);
}

/** ⋮⋮의 onPointerDown */
export function startRowDrag(e: ReactPointerEvent<HTMLElement>, fromKey: string, fromIndex: number) {
  if (e.button !== 0) return;
  e.preventDefault();
  const grip = e.currentTarget;
  const pointerId = e.pointerId;
  grip.setPointerCapture(pointerId);
  const x0 = e.clientX;
  const y0 = e.clientY;
  let active = false;
  let ghost: HTMLDivElement | null = null;

  const items = useBoard.getState().cells[fromKey] ?? [];
  const [start, end] = deleteRange(items, fromIndex);
  const movingParent = items[fromIndex]?.depth === 0;

  const activate = () => {
    active = true;
    void flushAll();
    ghost = document.createElement("div");
    ghost.className = styles.dragGhost!;
    ghost.dataset.testid = "drag-ghost";
    for (const it of items.slice(start, end)) {
      const line = document.createElement("div");
      line.className = it.depth === 1 ? styles.dragGhostSub! : styles.dragGhostLine!;
      line.textContent = it.text;
      ghost.append(line);
    }
    document.body.append(ghost);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";
    useRowDrag.setState({
      drag: { fromKey, fromIndex, start, end, overKey: null, gap: null, sub: false, note: null, box: null },
    });
  };

  const target = (x: number, y: number): Pick<RowDrag, "overKey" | "gap" | "sub" | "note" | "box"> => {
    const none = { overKey: null, gap: null, sub: false, note: null, box: null };
    const under = document.elementFromPoint(x, y);
    // 메모 상자 위 = 그 상자에 연결 더하기(대기 상자는 빼고)
    const boxId = under?.closest<HTMLElement>("[data-note-drop] [data-box-id]")?.dataset.boxId;
    if (boxId && boxId !== useNote.getState().pendingId) return { ...none, box: boxId };
    const canvas = under?.closest<HTMLElement>("[data-note-drop]");
    if (canvas) {
      // 메모 판: 화면 px → 문서 px(배율), 놓을 자리 = 커서 조금 왼쪽 위
      const r = canvas.getBoundingClientRect();
      const zoom = Number(canvas.dataset.zoom) || 1;
      const note = { x: Math.max(0, (x - r.left) / zoom - 16), y: Math.max(0, (y - r.top) / zoom - 12) };
      return { ...none, note };
    }
    const cellEl = under?.closest<HTMLElement>("[data-cell-key]");
    const key = cellEl?.dataset.cellKey;
    if (!cellEl || !key) return none;
    // 좁은 토·일 열 = 편집기가 없음 → 그 열을 넓힌다(포커스 열)
    if (!cellEl.querySelector("[data-cell-editor]")) {
      setFocusDay(splitKey(key).date);
      return { ...none, overKey: key };
    }
    const raw = gapAt(cellEl, y);
    const cells = useBoard.getState().cells;
    if (key === fromKey && !moveRows(cells[key] ?? [], fromIndex, null, raw)) {
      return { ...none, overKey: key }; // 제자리
    }
    const gap = snapGap(cells[key] ?? [], raw, movingParent);
    return { ...none, overKey: key, gap, sub: !movingParent && gap > 0 };
  };

  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    if (!active) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < THRESHOLD) return;
      activate();
    }
    ghost?.style.setProperty("transform", `translate(${ev.clientX + 12}px, ${ev.clientY + 8}px)`);
    autoScroll(grip, ev.clientY);
    const next = target(ev.clientX, ev.clientY);
    const cur = useRowDrag.getState().drag;
    const noteMoved = cur?.note?.x !== next.note?.x || cur?.note?.y !== next.note?.y;
    if (
      cur &&
      (cur.overKey !== next.overKey ||
        cur.gap !== next.gap ||
        cur.sub !== next.sub ||
        cur.box !== next.box ||
        noteMoved)
    ) {
      useRowDrag.setState({ drag: { ...cur, ...next } });
    }
  };

  const finish = (commit: boolean) => {
    grip.removeEventListener("pointermove", move);
    grip.removeEventListener("pointerup", up);
    grip.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", key, true);
    if (grip.hasPointerCapture(pointerId)) grip.releasePointerCapture(pointerId);
    ghost?.remove();
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    const drag = useRowDrag.getState().drag;
    useRowDrag.setState({ drag: null });
    const itemId = items[fromIndex]?.id;
    if (commit && drag?.box && itemId) linkBox(drag.box, itemId);
    else if (commit && drag?.note && itemId) addLinkedBox(itemId, drag.note);
    else if (commit && drag?.overKey && drag.gap !== null)
      void moveRowsTo(fromKey, fromIndex, drag.overKey, drag.gap);
  };
  const up = (ev: PointerEvent) => {
    if (ev.pointerId === pointerId) finish(active);
  };
  const cancel = () => finish(false);
  const key = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    finish(false);
  };

  grip.addEventListener("pointermove", move);
  grip.addEventListener("pointerup", up);
  grip.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", key, true);
}
