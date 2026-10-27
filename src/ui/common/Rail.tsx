// 왼쪽 메뉴 레일(important-repeat-spec 1절, M1): 위쪽 = 보기, 구분선 아래 = 패널, 맨 아래 = 앱 설정(improve-1027v5-spec 1-1).
// 만들지 않은 기능은 넣지 않는다.
import { importantBadge } from "../../domain/important";
import { STR } from "../../shared/strings";
import { focusStartCell, setPanelOpen, useBoard } from "../board/boardStore";
import { closeInsights, openInsights, useInsights } from "../insights/insightsStore";
import { hasUpdate, useUpdate } from "../update/updateStore";
import { setSettingsOpen } from "./appController";
import { useAppStore } from "./appStore";
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

/** 설정: 톱니(바깥 원 + 살 8개 + 가운데 원) */
const GearIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 18 18"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <circle cx="9" cy="9" r="2.4" />
    <circle cx="9" cy="9" r="5" strokeWidth="1.4" />
    <path d="M9 1.8v2M9 14.2v2M1.8 9h2M14.2 9h2M3.9 3.9l1.4 1.4M12.7 12.7l1.4 1.4M3.9 14.1l1.4-1.4M12.7 5.3l1.4-1.4" />
  </svg>
);

export function Rail() {
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const updateDot = useUpdate(hasUpdate);
  // 설정이 열려 있으면 그 화면이 "지금 보기"(보드·인사이트는 숨겨 둔 채)
  const insightsOpen = useInsights((s) => s.open) && !settingsOpen;
  const boardOn = !insightsOpen && !settingsOpen;
  const important = useBoard((s) => s.important);
  const today = useBoard((s) => s.today);
  const panelOpen = useBoard((s) => s.panelOpen);
  const badge = importantBadge(important, today);
  const n = important.length;

  return (
    <nav className={styles.rail} aria-label={STR.rail.label}>
      <button
        type="button"
        className={`${styles.btn} ${boardOn ? styles.on : ""}`}
        aria-current={boardOn ? "page" : undefined}
        aria-label={STR.rail.board}
        title={STR.rail.board}
        data-testid="rail-board"
        onClick={() => {
          setSettingsOpen(false);
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
        onClick={() => {
          setSettingsOpen(false);
          void openInsights();
        }}
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
        onClick={() => {
          // 설정에서 누르면 보드로 돌아가며 패널을 연다(spec 1-2)
          if (settingsOpen) {
            setSettingsOpen(false);
            return setPanelOpen(true, true);
          }
          setPanelOpen(!panelOpen, !panelOpen);
        }}
      >
        <StarIcon filled={n > 0} />
        {badge.label && (
          <span className={styles.badge} data-testid="important-badge">
            {badge.label}
          </span>
        )}
        {badge.late && <span className={styles.late} title={STR.rail.late} data-testid="important-late" />}
      </button>
      <span className={styles.fill} aria-hidden="true" />
      <span className={styles.sep} aria-hidden="true" />
      <button
        type="button"
        className={`${styles.btn} ${settingsOpen ? styles.on : ""}`}
        aria-current={settingsOpen ? "page" : undefined}
        aria-label={updateDot ? STR.rail.settingsUpdate : STR.rail.settings}
        title={updateDot ? STR.rail.settingsUpdate : STR.rail.settings}
        data-testid="rail-settings"
        onClick={() => setSettingsOpen(!settingsOpen)}
      >
        <GearIcon />
        {/* 새 판이 있으면 파란 점(improve-1027v4-spec 1-2 → v5 1-1에서 레일로) */}
        {updateDot && <span className={styles.updateDot} data-testid="update-dot" />}
      </button>
    </nav>
  );
}
