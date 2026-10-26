// 왼쪽 메뉴 레일(important-repeat-spec 1절, M1): 위쪽 = 보기, 구분선 아래 = 패널. 만들지 않은 기능은 넣지 않는다.
import { importantBadge } from "../../domain/important";
import { STR } from "../../shared/strings";
import { focusStartCell, setPanelOpen, useBoard } from "../board/boardStore";
import { closeInsights, openInsights, useInsights } from "../insights/insightsStore";
import styles from "./Rail.module.css";

const BoardIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <rect x="2" y="3" width="14" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M2 7h14M7 7v8M12 7v8" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

const StarIcon = ({ filled }: { filled: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <path
      d="M9 2.2l2.1 4.3 4.7.7-3.4 3.3.8 4.7L9 13l-4.2 2.2.8-4.7-3.4-3.3 4.7-.7z"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  </svg>
);

/** 인사이트: 세로 시간축 + 점 + 줄(흐름, m3-s1-spec 1-1) */
const InsightsIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 18 18"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M5 2.5v13" />
    <circle cx="5" cy="5" r="1.6" fill="currentColor" />
    <circle cx="5" cy="10" r="1.6" fill="currentColor" />
    <path d="M8.5 5h7M8.5 10h5M8.5 14h6" />
  </svg>
);

export function Rail() {
  const insightsOpen = useInsights((s) => s.open);
  const important = useBoard((s) => s.important);
  const today = useBoard((s) => s.today);
  const panelOpen = useBoard((s) => s.panelOpen);
  const badge = importantBadge(important, today);
  const n = important.length;

  return (
    <nav className={styles.rail} aria-label={STR.rail.label}>
      <button
        type="button"
        className={`${styles.btn} ${insightsOpen ? "" : styles.on}`}
        aria-current={insightsOpen ? undefined : "page"}
        aria-label={STR.rail.board}
        title={STR.rail.board}
        data-testid="rail-board"
        onClick={() => {
          closeInsights();
          focusStartCell();
        }}
      >
        <BoardIcon />
      </button>
      <button
        type="button"
        className={`${styles.btn} ${insightsOpen ? styles.on : ""}`}
        aria-current={insightsOpen ? "page" : undefined}
        aria-label={STR.insights.rail}
        title={STR.insights.rail}
        data-testid="rail-insights"
        onClick={() => void openInsights()}
      >
        <InsightsIcon />
      </button>
      <span className={styles.sep} aria-hidden="true" />
      <button
        type="button"
        className={`${styles.btn} ${n ? styles.has : ""} ${panelOpen ? styles.on : ""}`}
        aria-label={STR.rail.important(n)}
        aria-expanded={panelOpen}
        title={STR.rail.important(n)}
        data-testid="rail-important"
        onClick={() => setPanelOpen(!panelOpen, !panelOpen)}
      >
        <StarIcon filled={n > 0} />
        {badge.label && (
          <span className={styles.badge} data-testid="important-badge">
            {badge.label}
          </span>
        )}
        {badge.late && <span className={styles.late} title={STR.rail.late} data-testid="important-late" />}
      </button>
    </nav>
  );
}
