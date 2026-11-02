// 열 머리 오른쪽 끝 폭 손잡이(improve-1102v7 K1): 끌기·`←`/`→`(16px)·두 번 누르면 자동.
import type { KeyboardEvent, PointerEvent } from "react";
import { STR } from "../../shared/strings";
import { commitColWidth, setColWidth, useColWidths, type ColKey } from "./colWidths";
import styles from "./Board.module.css";

export function ColResizer({ col, label }: { col: ColKey; label: string }) {
  const custom = useColWidths((s) => (col === "label" ? s.label : s.days[col]) !== null);
  const widthNow = (el: HTMLElement) => el.parentElement!.getBoundingClientRect().width;
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const w0 = widthNow(el);
    let last = w0;
    const move = (ev: globalThis.PointerEvent) => {
      last = w0 + (ev.clientX - x0);
      setColWidth(col, last);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      if (Math.abs(last - w0) >= 1) commitColWidth(col, last);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    commitColWidth(col, widthNow(e.currentTarget) + (e.key === "ArrowLeft" ? -16 : 16));
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={STR.board.colResize(label)}
      title={STR.board.colResize(label)}
      tabIndex={0}
      className={`${styles.colResizer} ${custom ? styles.colResizerCustom : ""}`}
      data-testid={`col-resizer-${col}`}
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        commitColWidth(col, null);
      }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
    />
  );
}
