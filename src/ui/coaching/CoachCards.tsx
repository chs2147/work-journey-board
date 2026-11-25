// 처음 1회 카드(coaching-spec 3-1·3-2, D13): 새 사용자 = V1 히어로 그림 · 기존 사용자 = V3 새 ? 단추 스포트라이트.
// 첫 투어 뒤 "다음에 볼 만한 것", 화면별 제안 칩.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { COACH } from "../../shared/coachingStrings";
import { closeIntro, closeSuggest, startTour, tourForScreen, useCoaching } from "./coachingStore";
import styles from "./Coach.module.css";

const CHIP_COLORS = ["#185fa5", "#e8a33a", "#2e9e6b", "#7a5cc7", "#1f2a44", "#d69a00", "#8a6a48"];

function useEscClose(on: boolean, close: () => void) {
  useEffect(() => {
    if (!on) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [on, close]);
}

export function CoachCards() {
  const intro = useCoaching((s) => s.intro);
  const suggest = useCoaching((s) => s.suggest);
  return (
    <>
      {intro === "welcome" && <WelcomeCard />}
      {intro === "feature" && <FeatureSpot />}
      {intro === "afterStart" && <AfterStart />}
      {suggest && !intro && <SuggestChip />}
    </>
  );
}

/** V1 — 새 사용자 환영 카드(히어로 그림) */
function WelcomeCard() {
  const cta = useRef<HTMLButtonElement>(null);
  useEffect(() => cta.current?.focus(), []);
  useEscClose(true, () => closeIntro("later"));
  const W = COACH.welcome;
  return createPortal(
    <>
      <div className={styles.dim} />
      <div
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-label={W.title}
        data-testid="coach-welcome"
      >
        <div className={styles.hero}>
          <HeroArt />
          <span className={styles.new}>{W.badge}</span>
        </div>
        <div className={styles.cardBody}>
          <b className={styles.cardTitle}>{W.title}</b>
          <p className={styles.cardText}>{W.body}</p>
          <div className={styles.chips}>
            {W.chips.map((c, i) => (
              <span key={c}>
                <i style={{ background: CHIP_COLORS[i] }} />
                {c}
              </span>
            ))}
          </div>
          <button ref={cta} type="button" className={styles.cta} onClick={() => closeIntro("start")}>
            {W.start}
          </button>
          <div className={styles.subs}>
            <button
              type="button"
              className={`${styles.link} ${styles.strong}`}
              onClick={() => closeIntro("menu")}
            >
              {W.pick}
            </button>
            <button type="button" className={styles.link} onClick={() => closeIntro("later")}>
              {W.later}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

/** V3 — 기존 사용자: 화면을 가리고 새 ? 단추만 반짝, 말풍선 */
function FeatureSpot() {
  const [r, setR] = useState<DOMRect | null>(null);
  const cta = useRef<HTMLButtonElement>(null);
  useEscClose(true, () => closeIntro("later"));
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = document.querySelector('[data-testid="rail-coach"]');
      const next = el?.getBoundingClientRect() ?? null;
      setR((old) => (old && next && old.x === next.x && old.y === next.y ? old : next));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  useEffect(() => {
    if (r) cta.current?.focus();
  }, [r]);
  const F = COACH.feature;
  const pad = 6;
  const bubbleTop = r ? Math.max(12, Math.min(innerHeight - 200, r.top - 130)) : 0;
  return createPortal(
    <>
      <svg
        className={styles.dim}
        style={{ background: "none" }}
        width="100%"
        height="100%"
        aria-hidden="true"
      >
        <defs>
          <mask id="coach-feature-hole">
            <rect width="100%" height="100%" fill="#fff" />
            {r && (
              <rect
                x={r.left - pad}
                y={r.top - pad}
                width={r.width + pad * 2}
                height={r.height + pad * 2}
                rx="10"
                fill="#000"
              />
            )}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(8,12,24,.74)" mask="url(#coach-feature-hole)" />
      </svg>
      {r && (
        <>
          <div
            className={styles.spotRing}
            style={{
              left: r.left - pad,
              top: r.top - pad,
              width: r.width + pad * 2,
              height: r.height + pad * 2,
            }}
          />
          <i className={styles.spark} style={{ left: r.right + 4, top: r.top - 12 }} />
          <i
            className={styles.spark}
            style={{ left: r.right - 2, top: r.bottom + 4, animationDelay: "0.4s" }}
          />
          <i className={styles.spark} style={{ left: r.left - 4, top: r.top - 16, animationDelay: "0.8s" }} />
          <div
            className={styles.spotBubble}
            role="dialog"
            aria-modal="true"
            aria-label={COACH.dialog}
            data-testid="coach-feature"
            style={{ left: r.right + 22, top: bubbleTop }}
          >
            <span className={styles.new}>{F.badge}</span>
            <b className={styles.cardTitle}>
              {F.title.split("?")[0]}
              <span className={styles.qbox}>?</span>
              {F.title.split("?")[1]}
            </b>
            <p className={styles.cardText}>{F.body}</p>
            <div className={styles.spotRow}>
              <button ref={cta} type="button" className={styles.go} onClick={() => closeIntro("start")}>
                {F.start}
              </button>
              <button type="button" onClick={() => closeIntro("menu")}>
                {F.list}
              </button>
              <button type="button" onClick={() => closeIntro("later")}>
                {F.later}
              </button>
            </div>
          </div>
        </>
      )}
    </>,
    document.body,
  );
}

/** T0을 끝까지 본 뒤 — 이어 볼 투어 */
function AfterStart() {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  useEscClose(true, () => closeIntro());
  const go = (id: "T2" | "T3") => {
    closeIntro();
    void startTour(id);
  };
  const A = COACH.afterStart;
  return createPortal(
    <>
      <div className={styles.dim} />
      <div
        className={styles.after}
        role="dialog"
        aria-modal="true"
        aria-label={A.title}
        data-testid="coach-after"
      >
        <b className={styles.cardTitle}>{A.title}</b>
        <p className={styles.cardText} style={{ margin: 0 }}>
          {A.body}
        </p>
        <div className={styles.afterList}>
          <button ref={first} type="button" className={styles.btn} onClick={() => go("T2")}>
            ✍ {COACH.tours.T2.name} · {COACH.tours.T2.time}
          </button>
          <button type="button" className={styles.btn} onClick={() => go("T3")}>
            🗒 {COACH.tours.T3.name} · {COACH.tours.T3.time}
          </button>
        </div>
        <button type="button" className={styles.cta} onClick={() => closeIntro()}>
          {A.close}
        </button>
      </div>
    </>,
    document.body,
  );
}

/** 화면별 제안 칩 — 그 화면을 처음 열 때 한 번(자동 시작 안 함) */
function SuggestChip() {
  const screen = useCoaching((s) => s.suggest)!;
  const name = COACH.tours[tourForScreen(screen)].name.split(" — ")[0]!;
  return createPortal(
    <div className={styles.chip} role="status" data-testid="coach-suggest" data-screen={screen}>
      {COACH.suggest.label(name)}
      <button type="button" className={styles.go} onClick={() => closeSuggest(true)}>
        {COACH.suggest.go}
      </button>
      <button type="button" aria-label={COACH.suggest.close} onClick={() => closeSuggest()}>
        ✕
      </button>
    </div>,
    document.body,
  );
}

/** V1 히어로 그림 — 실제 코칭처럼 칸 하나가 밝아지고 손가락이 톡톡(시안 2-1) */
function HeroArt() {
  return (
    <svg
      width="400"
      height="150"
      viewBox="0 0 400 150"
      style={{ position: "absolute", inset: 0 }}
      aria-hidden="true"
    >
      <defs>
        <mask id="coach-hero-hole">
          <rect width="400" height="150" fill="#fff" />
          <rect x="200" y="50" width="72" height="48" rx="8" fill="#000" />
        </mask>
      </defs>
      <g opacity=".95">
        <rect x="70" y="28" width="260" height="110" rx="8" fill="#fff" />
        <rect x="70" y="28" width="260" height="18" rx="8" fill="#eef3fa" />
        <rect x="70" y="40" width="260" height="6" fill="#eef3fa" />
        <g fill="#e3e8f0">
          <rect x="80" y="56" width="50" height="8" rx="2" />
          <rect x="80" y="76" width="50" height="8" rx="2" />
          <rect x="80" y="96" width="50" height="8" rx="2" />
          <rect x="80" y="116" width="50" height="8" rx="2" />
        </g>
        <g fill="#dbe7f6">
          <rect x="142" y="56" width="38" height="6" rx="2" />
          <rect x="142" y="66" width="28" height="6" rx="2" />
          <rect x="262" y="56" width="40" height="6" rx="2" />
          <rect x="262" y="96" width="34" height="6" rx="2" />
          <rect x="142" y="96" width="30" height="6" rx="2" />
        </g>
      </g>
      <rect width="400" height="150" fill="rgba(8,20,40,.42)" mask="url(#coach-hero-hole)" />
      <rect x="200" y="50" width="72" height="48" rx="8" fill="#fff" />
      <rect x="208" y="60" width="44" height="6" rx="2" fill="#185fa5" />
      <rect x="208" y="72" width="32" height="6" rx="2" fill="#9cc1ea" />
      <rect x="208" y="84" width="38" height="6" rx="2" fill="#9cc1ea" />
      <rect
        className={styles.heroRing}
        x="196"
        y="46"
        width="80"
        height="56"
        rx="10"
        fill="none"
        stroke="#ffd98a"
        strokeWidth="3"
      />
      <g className={styles.heroHand}>
        <path
          d="M262 92 v-14 a4 4 0 0 1 8 0 v10 m0-3 a4 4 0 0 1 8 0 v4 m0-2 a4 4 0 0 1 8 0 v9 c0 9-6 15-15 15 c-7 0-11-3-14-8 l-7-11 a3.5 3.5 0 0 1 6-4 l6 7"
          fill="#fff"
          stroke="#1f2a44"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </g>
      <g fill="#ffd98a">
        <circle cx="330" cy="30" r="3" />
        <circle cx="350" cy="58" r="2" />
        <circle cx="58" cy="44" r="2.5" />
        <circle cx="40" cy="112" r="2" />
      </g>
    </svg>
  );
}
