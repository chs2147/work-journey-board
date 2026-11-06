import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { reportError } from "../board/boardStore";
import { useAppStore } from "../common/appStore";
import styles from "./Insights.module.css";

/** Workspace-owned preference; layout constraints never overwrite the saved preference. */
export function useInsightWidth(kind: "timeline" | "activity") {
  const journal = useAppStore((s) => s.journal);
  const key = kind === "timeline" ? "insightListWidth" : "activityNameWidth";
  const spec =
    kind === "timeline"
      ? { def: 272, min: 200, max: 480, reserve: 440 }
      : { def: 196, min: 160, max: 420, reserve: 290 };
  const [preferred, setPreferred] = useState(spec.def);
  const [available, setAvailable] = useState(1200);
  const observer = useRef<ResizeObserver | null>(null);
  const generation = useRef(0);
  useLayoutEffect(() => {
    const seq = ++generation.current;
    if (journal.state === "ready")
      void journal.repo.getSettings().then((s) => {
        if (seq === generation.current) setPreferred(s.ui[key]);
      });
    return () => {
      if (generation.current === seq) generation.current = seq + 1;
    };
  }, [journal, key, spec.def]);
  const observe = useCallback((el: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    const update = () => setAvailable(el.clientWidth);
    observer.current = new ResizeObserver(update);
    observer.current.observe(el);
    update();
  }, []);
  const min = Math.min(spec.min, Math.max(80, available - spec.reserve));
  const max = Math.max(min, Math.min(spec.max, available - spec.reserve));
  const width = Math.round(Math.max(min, Math.min(max, preferred)));
  const clamp = (v: number) => Math.round(Math.max(min, Math.min(max, v)));
  const save = (v: number) => {
    const w = clamp(v);
    setPreferred(w);
    if (journal.state === "ready") void journal.repo.updateSettings({ ui: { [key]: w } }).catch(reportError);
  };
  const label = kind === "timeline" ? "업무 목록 너비 조절" : "활동 업무 이름 열 너비 조절";
  const separator = (
    <div
      className={styles.widthHandle}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      title={`${label} · 두 번 누르면 기본 너비`}
      data-testid={`${kind}-width-resizer`}
      onDoubleClick={() => save(spec.def)}
      onKeyDown={(e) => {
        if (!["ArrowLeft", "ArrowRight", "Home"].includes(e.key)) return;
        e.preventDefault();
        e.stopPropagation();
        save(e.key === "Home" ? spec.def : width + (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 32 : 16));
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const el = e.currentTarget,
          x = e.clientX,
          pointer = e.pointerId;
        const seq = generation.current;
        let last = width;
        el.setPointerCapture(pointer);
        const move = (ev: PointerEvent) => {
          if (seq !== generation.current) return;
          last = clamp(width + ev.clientX - x);
          setPreferred(last);
        };
        const finish = () => {
          el.removeEventListener("pointermove", move);
          el.removeEventListener("lostpointercapture", finish);
          if (seq === generation.current) save(last);
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("lostpointercapture", finish);
      }}
    />
  );
  return { observe, width, separator };
}
