// 코칭 투어 오버레이(coaching-spec 4절, D1) — 화면을 가리고 대상만 밝힌 뒤 말풍선. 키보드 →·Enter 다음, ← 이전, Esc 건너뛰기.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { COACH } from "../../shared/coachingStrings";
import { osText } from "../../shared/platformText";
import { endTour, nextStep, prevStep, useCoaching } from "./coachingStore";
import { findTarget, rectOf, stepText, tourById } from "./tours";
import styles from "./Coach.module.css";

const PAD = 6;
/** 대상을 기다리는 시간 — 이 뒤에는 대체 대상, 그다음엔 가운데 말풍선 */
const WAIT_MS = 900;
const FALLBACK_MS = 2200;

export function CoachOverlay() {
  const phase = useCoaching((s) => s.phase);
  const tour = useCoaching((s) => s.tour);
  const step = useCoaching((s) => s.step);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [settled, setSettled] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number; side?: "l" | "r" | "t" | "b"; tip: number } | null>(
    null,
  );
  const bubble = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const target = useRef<Element | null>(null);

  const def = tour ? tourById(tour).steps[step] : null;
  const text = tour ? stepText(tour, step) : null;
  const total = tour ? tourById(tour).steps.length : 0;
  const running = phase === "running" && !!def;

  // 대상 찾기·위치 재기(창 크기·스크롤·패널이 바뀌어도 따라가도록 매 프레임)
  useEffect(() => {
    if (!running || !def) return;
    target.current = null;
    const started = performance.now();
    let scrolled = false;
    let raf = 0;
    let first = true;
    const tick = () => {
      if (first) {
        first = false;
        setRect(null);
        setSettled(!def.target);
      }
      const age = performance.now() - started;
      let el = findTarget(def.target);
      let r = el ? rectOf(el) : null;
      if (!r && def.fallback && age > WAIT_MS) {
        el = findTarget(def.fallback);
        r = el ? rectOf(el) : null;
      }
      if (el && !scrolled && !r && age > WAIT_MS / 2) {
        el.scrollIntoView({ block: "nearest", inline: "nearest" });
        scrolled = true;
      }
      target.current = r ? el : null;
      setRect((old) =>
        old && r && old.x === r.x && old.y === r.y && old.width === r.width && old.height === r.height
          ? old
          : r,
      );
      if (r || age > FALLBACK_MS) setSettled(true);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, def]);

  // 말풍선 자리: 오른쪽 → 왼쪽 → 아래 → 위 → 가운데
  useLayoutEffect(() => {
    const b = bubble.current;
    if (!b || !running) return;
    const W = innerWidth,
      H = innerHeight,
      bw = b.offsetWidth,
      bh = b.offsetHeight,
      gap = 14;
    if (!rect) {
      setPos({ x: (W - bw) / 2, y: (H - bh) / 2, tip: 0 });
      return;
    }
    const L = rect.left - PAD,
      T = rect.top - PAD,
      R = rect.right + PAD,
      B = rect.bottom + PAD;
    const clampY = (y: number) => Math.min(Math.max(8, y), H - bh - 8);
    const clampX = (x: number) => Math.min(Math.max(8, x), W - bw - 8);
    let next: typeof pos;
    if (R + gap + bw < W - 8) {
      const y = clampY((T + B) / 2 - bh / 2);
      next = { x: R + gap, y, side: "l", tip: (T + B) / 2 - y };
    } else if (L - gap - bw > 8) {
      const y = clampY((T + B) / 2 - bh / 2);
      next = { x: L - gap - bw, y, side: "r", tip: (T + B) / 2 - y };
    } else if (B + gap + bh < H - 8) {
      const x = clampX((L + R) / 2 - bw / 2);
      next = { x, y: B + gap, side: "t", tip: (L + R) / 2 - x };
    } else if (T - gap - bh > 8) {
      const x = clampX((L + R) / 2 - bw / 2);
      next = { x, y: T - gap - bh, side: "b", tip: (L + R) / 2 - x };
    } else next = { x: (W - bw) / 2, y: (H - bh) / 2, tip: 0 };
    setPos((old) =>
      old && old.x === next.x && old.y === next.y && old.side === next.side && old.tip === next.tip
        ? old
        : next,
    );
  }, [rect, running, step, settled]);

  // 단계가 바뀌면 [다음]에 초점
  useEffect(() => {
    if (running && settled) primary.current?.focus({ preventScroll: true });
  }, [running, settled, step]);

  const tapTarget = () => {
    const el = target.current;
    if (el instanceof HTMLElement) el.click();
    nextStep();
  };

  // 코칭 중에는 앱 단축키를 쉬게 하고 코칭 키만 받는다
  const active = phase !== "idle";
  useEffect(() => {
    if (!active) return;
    const key = (e: KeyboardEvent) => {
      const st = useCoaching.getState();
      if (st.phase !== "running") {
        if (st.phase === "away" && e.key === "Escape") void endTour(false);
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const d = st.tour ? tourById(st.tour).steps[st.step] : null;
      if (e.key === "Tab") {
        // 말풍선 안 단추만 돈다
        const list = [...(bubble.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
        const skipBtn = document.querySelector<HTMLButtonElement>(`.${styles.skip}`);
        if (skipBtn) list.push(skipBtn);
        if (list.length) {
          const i = list.indexOf(document.activeElement as HTMLButtonElement);
          list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length]!.focus();
        }
      } else if (e.key === "Escape") void endTour(false);
      else if (e.key === "ArrowLeft") prevStep();
      else if (e.key === "ArrowRight") nextStep();
      else if (e.key === "Enter" || e.key === " ") {
        const focused = document.activeElement;
        if (
          focused instanceof HTMLButtonElement &&
          (bubble.current?.contains(focused) || focused.matches(`.${styles.skip}`))
        )
          focused.click();
        else if (d?.tap) tapTarget();
        else nextStep();
      }
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [active]);

  if (!active) return null;
  const busy = phase === "entering" || phase === "leaving";
  const hole = rect && running ? rect : null;
  const tap = !!def?.tap && !!hole;
  return createPortal(
    <div className={styles.layer} data-testid="coach-overlay" data-tour={tour ?? undefined} data-step={step}>
      <svg className={styles.mask} aria-hidden="true">
        <defs>
          <mask id="coach-hole">
            <rect width="100%" height="100%" fill="#fff" />
            {hole && (
              <rect
                x={hole.left - PAD}
                y={hole.top - PAD}
                width={hole.width + PAD * 2}
                height={hole.height + PAD * 2}
                rx="8"
                fill="#000"
              />
            )}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(10,14,20,.66)" mask="url(#coach-hole)" />
      </svg>
      <div className={styles.ribbon}>{COACH.ribbon}</div>
      {busy && (
        <div className={styles.wait} role="status">
          {phase === "entering" ? COACH.preparing : COACH.returning}
        </div>
      )}
      {phase === "away" && tour && (
        <div className={styles.away} role="status" data-testid="coach-away">
          <span>{tourById(tour).win === "board" ? COACH.away.board : COACH.away.note}</span>
          <button
            type="button"
            className={styles.btn}
            data-testid="coach-away-stop"
            onClick={() => void endTour(false)}
          >
            {COACH.away.stop}
          </button>
        </div>
      )}
      {hole && (
        <div
          className={`${styles.ring} ${tap ? styles.tap : ""}`}
          data-testid="coach-ring"
          style={{
            left: hole.left - PAD,
            top: hole.top - PAD,
            width: hole.width + PAD * 2,
            height: hole.height + PAD * 2,
          }}
          onClick={tap ? tapTarget : undefined}
        />
      )}
      {tap && hole && (
        <svg
          className={styles.hand}
          viewBox="0 0 24 24"
          style={{ left: hole.left + hole.width * 0.55, top: hole.top + hole.height * 0.5 }}
          aria-hidden="true"
        >
          <path
            d="M9 11V4.5a1.5 1.5 0 0 1 3 0V10m0-1.5a1.5 1.5 0 0 1 3 0V11m0-1a1.5 1.5 0 0 1 3 0v4.5c0 3.6-2.4 6.5-6 6.5-2.6 0-4.1-1.2-5.3-3.2L4.3 14a1.4 1.4 0 0 1 2.3-1.6L9 15"
            fill="#fff"
            stroke="#2c2c2a"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {running && text && settled && (
        <div
          ref={bubble}
          className={styles.bubble}
          role="dialog"
          aria-modal="true"
          aria-label={COACH.dialog}
          aria-live="polite"
          data-testid="coach-bubble"
          style={pos ? { left: pos.x, top: pos.y } : { visibility: "hidden" }}
        >
          <h2>{text.title}</h2>
          <p>{osText(text.body)}</p>
          {text.keys && <span className={styles.keys}>{osText(text.keys)}</span>}
          {tap && <p className={styles.tapHint}>{COACH.tapHint}</p>}
          <div className={styles.row}>
            <span className={styles.count} data-testid="coach-count">
              {COACH.count(step + 1, total)}
            </span>
            {step > 0 && (
              <button type="button" className={styles.btn} onClick={prevStep}>
                {COACH.prev}
              </button>
            )}
            <button
              ref={primary}
              type="button"
              className={styles.primary}
              data-testid="coach-next"
              onClick={nextStep}
            >
              {step === total - 1 ? COACH.finish : COACH.next}
            </button>
          </div>
          {pos?.side && (
            <i
              className={styles.tip}
              style={
                pos.side === "l"
                  ? { left: -6, top: clampTip(pos.tip, 14, 200) }
                  : pos.side === "r"
                    ? { right: -6, top: clampTip(pos.tip, 14, 200) }
                    : pos.side === "t"
                      ? { top: -6, left: clampTip(pos.tip, 14, 320) }
                      : { bottom: -6, left: clampTip(pos.tip, 14, 320) }
              }
            />
          )}
        </div>
      )}
      {running && (
        <button
          type="button"
          className={styles.skip}
          data-testid="coach-skip"
          onClick={() => void endTour(false)}
        >
          {COACH.skip} ✕
        </button>
      )}
    </div>,
    document.body,
  );
}

const clampTip = (v: number, min: number, max: number) => Math.min(Math.max(min, v - 6), max);
