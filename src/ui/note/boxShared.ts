import { V18 } from "../../shared/v18Strings";
// 텍스트·이미지 상자가 함께 쓰는 동작: 끌어 옮기기·폭 조절, 선택 상태의 키(방향키·Delete·Ctrl+Z·Esc), 높이 재기.
import { useEffect, useLayoutEffect, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import {
  boxName,
  isLinkedTo,
  clampWidth,
  clampImageWidth,
  clampLinkWidth,
  type NoteBox,
} from "../../domain/note";
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
  resizeFrameLive,
  selectBox,
  startLinking,
  undoNote,
  useNote,
  clearMulti,
  moveBoxesLive,
  toggleMulti,
  noteGestureGeneration,
  registerNoteGesture,
  captureNoteScope,
  cancelNoteGesture,
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
  // Shift+누르기 = 함께 고르기에 더하기/빼기(improve-1102v7 K7)
  if (kind === "move" && e.shiftKey) {
    toggleMulti(box.id);
    return;
  }
  const multi = useNote.getState().multi;
  if (kind === "move" && multi.length > 1 && multi.includes(box.id)) return startGroupDrag(e, multi);
  if (multi.length) clearMulti();
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

/** 함께 고른 상자들을 한꺼번에 끌기(improve-1102v7 K7) — 되돌리기 한 번, 항목 연결 끌기는 하지 않는다 */
export function startGroupDrag(e: PointerEvent<HTMLElement>, ids: string[]) {
  if (e.button !== 0) return;
  cancelNoteGesture();
  e.preventDefault();
  e.stopPropagation();
  const el = e.currentTarget;
  const before = beginGesture();
  const generation = noteGestureGeneration();
  const zoom = useNote.getState().zoom;
  const origins = before.boxes.filter((b) => ids.includes(b.id)).map((b) => ({ id: b.id, x: b.x, y: b.y }));
  const [sx, sy] = [e.clientX, e.clientY];
  let moved = false;
  let lastClick: Event | null = null;
  const valid = () =>
    generation === noteGestureGeneration() &&
    origins.every((o) => useNote.getState().doc.boxes.some((b) => b.id === o.id));
  const swallowClick = (ev: Event) => {
    lastClick = ev;
    ev.preventDefault();
    ev.stopImmediatePropagation();
  };
  const move = (ev: globalThis.PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    if (!valid()) return done();
    if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_SLOP) return;
    if (!moved) {
      moved = true;
      el.setPointerCapture(e.pointerId);
      el.classList.add(styles.groupDragging!);
    }
    moveBoxesLive(origins, (ev.clientX - sx) / zoom, (ev.clientY - sy) / zoom);
  };
  const cancel = () => {
    const same = valid();
    done();
    if (same && moved) cancelGesture(before);
  };
  const key = (ev: globalThis.KeyboardEvent) => {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    cancel();
  };
  const done = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", key, true);
    window.removeEventListener("blur", cancel);
    unsubscribe();
    unregister();
    el.classList.remove(styles.groupDragging!);
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  };
  const up = (ev: globalThis.PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    const same = valid();
    done();
    if (same && moved) endGesture(before);
    // pointerup 뒤 합성 click이 링크/편집을 열지 않게 한다. 단순 클릭/더블클릭은 그대로.
    if (moved) {
      el.addEventListener("click", swallowClick, { capture: true, once: true });
      window.setTimeout(() => {
        if (!lastClick) el.removeEventListener("click", swallowClick, true);
      }, 0);
    }
  };
  const unsubscribe = useNote.subscribe(() => {
    if (!valid()) done();
  });
  const unregister = registerNoteGesture(cancel);
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  // 캔버스의 다중 선택 키 처리보다 먼저 Esc를 소비한다.
  window.addEventListener("keydown", key, true);
  window.addEventListener("blur", cancel);
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
  } else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
    // ⋯ 메뉴 열기(improve-1103v8-spec T3) — 상자 안 ⋯ 단추를 누른 것과 같다
    e.preventDefault();
    e.currentTarget.querySelector<HTMLButtonElement>(":scope > button[aria-expanded]")?.click();
  } else if (e.code === "KeyL" && !mod && !e.altKey) {
    // 관계선(note-relation-spec 2-2·4절): L = 잇기 시작, Shift+L = 이 상자의 선 차례로
    e.preventDefault();
    if (e.shiftKey) cycleBoxEdges(id);
    else startLinking(id, "keys");
  } else if (e.key.startsWith("Arrow") && !e.altKey && !mod) {
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

  const frameH = useNote((s) => s.doc.boxes.find((b) => b.id === id)?.frameH);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (frameH) {
      el.style.height = frameH + "px";
      el.style.overflow = "visible";
      el.dataset.fixedFrame = "true";
    } else {
      const b = useNote.getState().doc.boxes.find((b) => b.id === id);
      if (b?.kind === "text" && b.widget) el.style.height = (b.h ?? 250) + "px";
      else el.style.removeProperty("height");
      el.style.removeProperty("overflow");
      delete el.dataset.fixedFrame;
    }
  }, [frameH, ref, id]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cleanups: (() => void)[] = [];
    const cancels = new Set<() => void>();
    for (const side of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) {
      const grip = document.createElement("button");
      grip.type = "button";
      grip.className = "note-frame-grip note-frame-" + side;
      grip.setAttribute("aria-label", V18.frame(side));
      grip.title = V18.frameHint;
      grip.dataset.frameGrip = side;
      const down = (e: globalThis.PointerEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const box = useNote.getState().doc.boxes.find((b) => b.id === id);
        if (!box) return;
        selectBox(id);
        el.focus({ preventScroll: true });
        let active = true;
        const current = captureNoteScope();
        const before = beginGesture(),
          zoom = useNote.getState().zoom,
          ox = e.clientX,
          oy = e.clientY,
          h = box.frameH ?? el.offsetHeight;
        grip.setPointerCapture(e.pointerId);
        const move = (ev: globalThis.PointerEvent) => {
          if (!active || !current()) return;
          const dx = (ev.clientX - ox) / zoom,
            dy = (ev.clientY - oy) / zoom;
          const clamp =
            box.kind === "image" ? clampImageWidth : box.kind === "link" ? clampLinkWidth : clampWidth;
          let w = clamp(box.w + (side.includes("w") ? -dx : side.includes("e") ? dx : 0)),
            nh = Math.max(80, Math.min(1200, h + (side.includes("n") ? -dy : side.includes("s") ? dy : 0)));
          if (ev.shiftKey && side.length === 2) nh = Math.max(80, Math.min(1200, (h * w) / box.w));
          if (side === "s" || side === "n") w = box.w;
          resizeFrameLive(
            id,
            side.includes("w") ? box.x + box.w - w : box.x,
            side.includes("n") ? box.y + h - nh : box.y,
            w,
            nh,
          );
        };
        const done = () => {
          if (!active) return;
          active = false;
          grip.removeEventListener("pointermove", move);
          grip.removeEventListener("pointerup", done);
          grip.removeEventListener("pointercancel", cancel);
          window.removeEventListener("keydown", key, true);
          unregister();
          cancels.delete(cancel);
          if (current()) endGesture(before);
        };
        const cancel = () => {
          if (!active) return;
          if (current()) cancelGesture(before);
          done();
        };
        const key = (ev: globalThis.KeyboardEvent) => {
          if (ev.key === "Escape") {
            ev.preventDefault();
            ev.stopPropagation();
            cancel();
          }
        };
        const unregister = registerNoteGesture(cancel);
        cancels.add(cancel);
        grip.addEventListener("pointermove", move);
        grip.addEventListener("pointerup", done);
        grip.addEventListener("pointercancel", cancel);
        window.addEventListener("keydown", key, true);
      };
      const resizeKey = (ev: globalThis.KeyboardEvent) => {
        if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(ev.key)) return;
        ev.preventDefault();
        ev.stopPropagation();
        const b = useNote.getState().doc.boxes.find((b) => b.id === id);
        if (!b) return;
        const step = ev.shiftKey ? 32 : 8,
          before = beginGesture(),
          h = b.frameH ?? el.offsetHeight;
        resizeFrameLive(
          id,
          b.x,
          b.y,
          b.w + (ev.key === "ArrowRight" ? step : ev.key === "ArrowLeft" ? -step : 0),
          h + (ev.key === "ArrowDown" ? step : ev.key === "ArrowUp" ? -step : 0),
        );
        endGesture(before);
      };
      grip.addEventListener("keydown", resizeKey);
      grip.addEventListener("pointerdown", down);
      el.append(grip);
      cleanups.push(() => {
        grip.removeEventListener("keydown", resizeKey);
        grip.removeEventListener("pointerdown", down);
        grip.remove();
      });
    }
    return () => {
      for (const cancel of cancels) cancel();
      cleanups.forEach((f) => f());
    };
  }, [id, ref]);

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
