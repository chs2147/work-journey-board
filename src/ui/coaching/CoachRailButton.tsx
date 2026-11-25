// 레일 ? 단추(coaching-spec 5-1, D4) — 설정 바로 위. 아직 안 본 둘러보기·새 단계가 있으면 점.
import { COACH } from "../../shared/coachingStrings";
import { railDot, toggleMenu, useCoaching } from "./coachingStore";
import styles from "./Coach.module.css";

export function CoachRailButton({ className, onClass }: { className: string; onClass: string }) {
  const open = useCoaching((s) => s.menuOpen);
  const dot = useCoaching((s) => railDot(s.flags));
  const blink = useCoaching((s) => s.blink);
  const label = dot ? COACH.railNew : COACH.rail;
  return (
    <button
      key={blink}
      type="button"
      className={`${className} ${styles.railBtn} ${open ? onClass : ""} ${blink ? styles.railBlink : ""}`}
      aria-label={label}
      title={label}
      aria-expanded={open}
      data-testid="rail-coach"
      onClick={toggleMenu}
    >
      ?{dot && <span className={styles.railDot} data-testid="rail-coach-dot" />}
    </button>
  );
}
