// 행 끌어서 옮기기(improve-1026v2-spec 3절): ⋮⋮에서 포인터로 직접 끈다(HTML5 DnD는 입력칸 글자 끌기와 섞여서 쓰지 않음).
// 놓을 칸 = 포인터 아래의 [data-cell-key](주간 보드 칸·오늘 뷰 카드 — 보고 있는 주 안), 놓을 틈 = 그 칸 [data-item-index] 행의 가운데 기준.
// Esc = 취소. 실앱은 dragDropEnabled:false라 화면 안 끌기가 그대로 동작한다.
import type { PointerEvent as ReactPointerEvent } from "react";
import { create } from "zustand";
import { deleteRange, moveRows, snapGap } from "../../domain/items";
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
}

export const useRowDrag = create<{ drag: RowDrag | null }>(() => ({ drag: null }));

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
    useRowDrag.setState({ drag: { fromKey, fromIndex, start, end, overKey: null, gap: null, sub: false } });
  };

  const target = (x: number, y: number): Pick<RowDrag, "overKey" | "gap" | "sub"> => {
    const cellEl = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-cell-key]");
    const key = cellEl?.dataset.cellKey;
    if (!cellEl || !key) return { overKey: null, gap: null, sub: false };
    // 좁은 토·일 열 = 편집기가 없음 → 그 열을 넓힌다(포커스 열)
    if (!cellEl.querySelector("[data-cell-editor]")) {
      setFocusDay(splitKey(key).date);
      return { overKey: key, gap: null, sub: false };
    }
    const raw = gapAt(cellEl, y);
    const cells = useBoard.getState().cells;
    if (key === fromKey && !moveRows(cells[key] ?? [], fromIndex, null, raw)) {
      return { overKey: key, gap: null, sub: false }; // 제자리
    }
    const gap = snapGap(cells[key] ?? [], raw, movingParent);
    return { overKey: key, gap, sub: !movingParent && gap > 0 };
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
    if (cur && (cur.overKey !== next.overKey || cur.gap !== next.gap || cur.sub !== next.sub)) {
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
    if (commit && drag?.overKey && drag.gap !== null)
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
