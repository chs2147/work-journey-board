// 텍스트·이미지 상자가 함께 쓰는 동작: 끌어 옮기기·폭 조절, 선택 상태의 키(방향키·Delete·Ctrl+Z·Esc), 높이 재기.
import { useEffect, useLayoutEffect, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import type { NoteBox } from "../../domain/note";
import {
  beginGesture,
  deleteBox,
  endGesture,
  leaveNote,
  measureBox,
  moveBoxLive,
  nudgeBox,
  redoNote,
  resizeBoxLive,
  undoNote,
} from "./noteStore";

/** 이만큼 움직여야 끌기로 본다(그보다 작으면 클릭) */
const DRAG_SLOP = 3;

/**
 * 끌기·폭 조절: 포인터를 잡고 움직이는 동안 바로 반영, 놓으면 메모 기록 한 번.
 * onClick = 거의 움직이지 않고 놓았을 때(이미지 클릭 → 선택·크게 보기)
 */
export function startBoxDrag(
  e: PointerEvent<HTMLElement>,
  box: NoteBox,
  kind: "move" | "resize",
  onClick?: () => void,
) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const el = e.currentTarget;
  el.setPointerCapture(e.pointerId);
  const before = beginGesture();
  const [sx, sy, x0, y0, w0] = [e.clientX, e.clientY, box.x, box.y, box.w];
  let moved = false;
  const move = (ev: globalThis.PointerEvent) => {
    const [dx, dy] = [ev.clientX - sx, ev.clientY - sy];
    if (!moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
    moved = true;
    if (kind === "move") moveBoxLive(box.id, x0 + dx, y0 + dy);
    else resizeBoxLive(box.id, w0 + dx);
  };
  const up = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
    endGesture(before);
    if (!moved) onClick?.();
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
}

/** 선택된 상자의 키. Enter는 상자마다 다르다(글 편집 / 설명 달기) */
export function onSelectedBoxKey(e: KeyboardEvent<HTMLDivElement>, id: string, onEnter: () => void) {
  if (e.target !== e.currentTarget || e.nativeEvent.isComposing) return;
  const step = e.shiftKey ? 32 : 8;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.altKey && e.code === "KeyZ") {
    e.preventDefault();
    if (e.shiftKey) redoNote();
    else undoNote();
  } else if (mod && !e.altKey && e.code === "KeyY") {
    e.preventDefault();
    redoNote();
  } else if (e.key.startsWith("Arrow")) {
    e.preventDefault();
    const [dx, dy] = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[e.key] ?? [0, 0];
    nudgeBox(id, dx!, dy!);
  } else if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    deleteBox(id);
  } else if (e.key === "Enter") {
    e.preventDefault();
    onEnter();
  } else if (e.key === "Escape") {
    e.preventDefault();
    leaveNote();
  }
}

/** 선택되면 상자에 포커스(키를 받게), 높이는 재서 문서에 반영(새 상자 자리·판 높이) */
export function useBoxFrame(ref: RefObject<HTMLDivElement | null>, id: string, selected: boolean) {
  useEffect(() => {
    if (selected) ref.current?.focus();
  }, [selected, ref]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measureBox(id, el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [id, ref]);
}
