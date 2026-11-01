// 앱 안 떠 있는 창(Cabinet·브라우저 모드 폴더 창) 옮기기
import { useState, type PointerEvent } from "react";

/** 머리를 끌어 창 옮기기(화면 밖으로 나가지 않게) */
/** 앱 안 떠 있는 창 겹침 순서 — 누른 창이 맨 앞으로 */
let topZ = 60;

export function useWindowDrag(initial: { x: number; y: number }) {
  const [pos, setPos] = useState(initial);
  const [z, setZ] = useState(() => ++topZ);
  const raise = () => {
    if (z !== topZ) setZ(++topZ);
  };
  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest("button,input,select")) return;
    const sx = e.clientX - pos.x;
    const sy = e.clientY - pos.y;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: globalThis.PointerEvent) =>
      setPos({
        x: Math.min(Math.max(ev.clientX - sx, -200), window.innerWidth - 120),
        y: Math.min(Math.max(ev.clientY - sy, 0), window.innerHeight - 40),
      });
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };
  return { pos, onPointerDown, z, raise };
}
