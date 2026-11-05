import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAppStore } from "../common/appStore";
import { serialize } from "../../platform";
import styles from "./Universe.module.css";

const widths = { filter: 250, detail: 300 };
type Side = keyof typeof widths;
const saveWidth = serialize(async (side: Side, width: number) => {
  const platform = useAppStore.getState().platform;
  if (!platform) return;
  const config = await platform.loadConfig();
  await platform.saveConfig({
    universePanelWidths: { ...widths, ...config?.universePanelWidths, [side]: width },
  });
});

export function ResizableUniversePanel({ side, children }: { side: Side; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(widths[side]);
  const [limit, setLimit] = useState(640);
  const touched = useRef(false);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const current = useRef(width);
  const min = Math.min(220, limit);
  const actual = Math.max(min, Math.min(width, limit));
  const dir = side === "filter" ? 1 : -1;
  const label = side === "filter" ? "필터 패널 너비 조절" : "상세 패널 너비 조절";
  const change = (value: number, commit = false) => {
    touched.current = true;
    const next = Math.round(Math.max(min, Math.min(value, limit)));
    current.current = next;
    widths[side] = next;
    setWidth(next);
    if (commit) void saveWidth(side, next).catch(() => undefined);
  };
  useEffect(() => {
    let active = true;
    void useAppStore
      .getState()
      .platform?.loadConfig()
      .then((config) => {
        const saved = config?.universePanelWidths?.[side];
        if (active && !touched.current && typeof saved === "number" && Number.isFinite(saved)) {
          widths[side] = Math.max(220, Math.min(saved, 640));
          current.current = widths[side];
          setWidth(widths[side]);
        }
      })
      .catch(() => undefined);
    const parent = ref.current?.parentElement;
    if (!parent)
      return () => {
        active = false;
      };
    const observer = new ResizeObserver(() => {
      const available = parent.clientWidth;
      setLimit(Math.max(100, Math.min(640, innerWidth <= 1050 ? available - 48 : available / 2 - 30)));
    });
    observer.observe(parent);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [side]);
  return (
    <div
      ref={ref}
      id={`u-${side}-panel`}
      className={side === "filter" ? styles.filterDrawer : styles.detailDrawer}
      style={{ width: actual }}
    >
      <div className={styles.drawerContent}>{children}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={Math.round(limit)}
        aria-valuenow={actual}
        tabIndex={0}
        data-testid={`u-${side}-resizer`}
        title={`${label} · 방향키 조절 · 두 번 누르면 기본 너비`}
        className={`${styles.drawerResizer} ${side === "filter" ? styles.resizeRight : styles.resizeLeft}`}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          e.currentTarget.focus();
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, width: actual };
          current.current = actual;
        }}
        onPointerMove={(e) => {
          if (drag.current) change(drag.current.width + dir * (e.clientX - drag.current.x));
        }}
        onPointerUp={(e) => {
          if (!drag.current) return;
          drag.current = null;
          change(current.current, true);
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onLostPointerCapture={() => {
          if (drag.current) {
            drag.current = null;
            change(current.current, true);
          }
        }}
        onPointerCancel={() => {
          if (drag.current) {
            drag.current = null;
            change(current.current, true);
          }
        }}
        onDoubleClick={() => change(side === "filter" ? 250 : 300, true)}
        onKeyDown={(e) => {
          const delta = e.key === "ArrowLeft" ? -10 : e.key === "ArrowRight" ? 10 : 0;
          if (!delta && e.key !== "Home" && e.key !== "End") return;
          e.preventDefault();
          e.stopPropagation();
          change(e.key === "Home" ? min : e.key === "End" ? limit : actual + dir * delta, true);
        }}
      />
    </div>
  );
}
