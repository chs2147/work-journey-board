// 패널 폭 손잡이(improve-1101 #2): 패널 안쪽 가장자리를 끌어 폭을 바꾸고, 두 번 누르면 기본 폭, 포커스 후 ←/→ = 10px씩.
import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { PANEL_W } from "../../data/settings";
import { STR } from "../../shared/strings";
import styles from "./PanelResizer.module.css";
import { commitPanelWidth, setPanelWidth, usePanelWidths, type PanelKey } from "./panelWidths";

export function PanelResizer({ panel }: { panel: PanelKey }) {
  const width = usePanelWidths((s) => s[panel]);
  const spec = PANEL_W[panel];
  // 왼쪽 패널(중요 업무)은 오른쪽 가장자리, 오른쪽 패널(주간 요약)은 왼쪽 가장자리
  const side = panel === "important" ? "right" : "left";
  const dir = side === "right" ? 1 : -1;
  const [drag, setDrag] = useState(false);

  const start = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const w0 = width;
    let last = w0;
    setDrag(true);
    const move = (ev: globalThis.PointerEvent) => {
      last = w0 + dir * (ev.clientX - x0);
      setPanelWidth(panel, last);
    };
    const up = () => {
      setDrag(false);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      commitPanelWidth(panel, last);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowLeft" ? -10 : e.key === "ArrowRight" ? 10 : 0;
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    commitPanelWidth(panel, width + dir * step);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={STR.panels.resize}
      aria-valuenow={width}
      aria-valuemin={spec.min}
      aria-valuemax={spec.max}
      tabIndex={0}
      title={STR.panels.resize}
      data-testid={`${panel}-resizer`}
      className={`${styles.handle} ${side === "right" ? styles.right : styles.left} ${drag ? styles.drag : ""}`}
      onPointerDown={start}
      onDoubleClick={() => commitPanelWidth(panel, spec.def)}
      onKeyDown={onKey}
    />
  );
}
