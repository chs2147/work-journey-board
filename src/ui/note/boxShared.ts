// 텍스트·이미지 상자가 함께 쓰는 동작: 끌어 옮기기·폭 조절, 선택 상태의 키(방향키·Delete·Ctrl+Z·Esc), 높이 재기.
import { useEffect, useLayoutEffect, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { boxName, isLinkedTo, type NoteBox } from "../../domain/note";
import { STR } from "../../shared/strings";
import { itemAtPoint, useLinkDrop } from "../board/rowDrag";
import {
  beginGesture,
  cancelGesture,
  cycleBoxEdges,
  deleteBox,
  endGesture,
  leaveNote,
  linkBox,
  measureBox,
  moveBoxLive,
  nudgeBox,
  redoNote,
  resizeBoxLive,
  startLinking,
  undoNote,
  useNote,
} from "./noteStore";
import styles from "./Note.module.css";

/** 이만큼 움직여야 끌기로 본다(그보다 작으면 클릭) */
const DRAG_SLOP = 3;

/** 연결 꼬리표(improve-1027v3-spec 2절): 상자 대신 커서를 따라가는 `⛓ 상자 이름` */
function makeLinkTag(box: NoteBox): HTMLDivElement {
  const tag = document.createElement("div");
  tag.className = styles.linkTag!;
  tag.dataset.testid = "link-tag";
  tag.setAttribute("role", "status");
  tag.setAttribute("aria-live", "polite");
  tag.textContent = `⛓ ${boxName(box)}`;
  tag.title = STR.note.linkTagHint;
  document.body.append(tag);
  return tag;
}

/**
 * 끌기·폭 조절: 포인터를 잡고 움직이는 동안 바로 반영, 놓으면 메모 기록 한 번.
 * 옮기다가 포인터가 메모 판 밖으로 나가면 "연결 모드" — 상자는 제자리(점선), 꼬리표만 따라가고
 * 보드 항목에 놓으면 연결 더하기(improve-1027v3-spec 2절). 판 안으로 돌아오면 다시 옮기기, Esc = 취소.
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
  // 판이 배율로 그려지므로 화면 px를 문서 px로(improve-1026-spec 11-2)
  const zoom = useNote.getState().zoom;
  const view = el.closest<HTMLElement>("[data-note-view]");
  const boxEl = el.closest<HTMLElement>("[data-box-id]");
  let moved = false;
  let tag: HTMLDivElement | null = null; // 있으면 연결 모드
  const setLinking = (on: boolean) => {
    if (on === !!tag) return;
    if (on) {
      cancelGesture(before); // 상자는 끌기 전 자리로
      tag = makeLinkTag(box);
    } else {
      tag?.remove();
      tag = null;
    }
    boxEl?.classList.toggle(styles.linkingBox!, on);
  };
  const outside = (x: number, y: number) => {
    const r = view?.getBoundingClientRect();
    return !!r && (x < r.left || x > r.right || y < r.top || y > r.bottom);
  };
  const move = (ev: globalThis.PointerEvent) => {
    if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_SLOP) return;
    const [dx, dy] = [(ev.clientX - sx) / zoom, (ev.clientY - sy) / zoom];
    moved = true;
    if (kind === "move") {
      setLinking(outside(ev.clientX, ev.clientY));
      if (tag) tag.style.setProperty("transform", `translate(${ev.clientX + 12}px, ${ev.clientY + 8}px)`);
      else moveBoxLive(box.id, x0 + dx, y0 + dy);
      // 보드의 항목 위로 가져가면 "여기에 연결"(improve-1026v2-spec 5절)
      const itemId = itemAtPoint(ev.clientX, ev.clientY);
      if (useLinkDrop.getState().itemId !== itemId)
        useLinkDrop.setState({ itemId, linked: !!itemId && isLinkedTo(box, itemId) });
    } else resizeBoxLive(box.id, w0 + dx);
  };
  const cleanup = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
    window.removeEventListener("keydown", key, true);
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    const linking = !!tag;
    setLinking(false);
    return linking;
  };
  const up = () => {
    const linking = cleanup();
    const target = useLinkDrop.getState().itemId;
    if (target) {
      // 항목에 놓음 = 상자는 원래 자리로, 연결만(메모 기록 1단계)
      useLinkDrop.setState({ itemId: null, linked: false });
      linkBox(box.id, target, before);
      return;
    }
    if (linking) return cancelGesture(before); // 판 밖 아무 데나 = 아무 일 없음
    endGesture(before);
    if (!moved) onClick?.();
  };
  const key = (ev: globalThis.KeyboardEvent) => {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    cleanup();
    useLinkDrop.setState({ itemId: null, linked: false });
    cancelGesture(before);
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  window.addEventListener("keydown", key, true);
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
  } else if (e.code === "KeyL" && !mod && !e.altKey) {
    // 관계선(note-relation-spec 2-2·4절): L = 잇기 시작, Shift+L = 이 상자의 선 차례로
    e.preventDefault();
    if (e.shiftKey) cycleBoxEdges(id);
    else startLinking(id, "keys");
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

  // 보드 배지로 찾아옴(improve-1026v2-spec 6-2) — 이미 선택돼 있어도 포커스·화면 안으로
  const reveal = useNote((s) => (s.revealRequest?.id === id ? s.revealRequest.n : 0));
  useEffect(() => {
    if (!reveal) return;
    ref.current?.focus();
    ref.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [reveal, ref]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measureBox(id, el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [id, ref]);
}
