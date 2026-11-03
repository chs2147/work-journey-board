// 왼쪽 메뉴 레일(important-repeat-spec 1절, M1): 위쪽 = 보기, 구분선 아래 = 패널, 맨 아래 = 앱 설정(improve-1027v5-spec 1-1).
// 만들지 않은 기능은 넣지 않는다.
import { importantBadge } from "../../domain/important";
import { STR } from "../../shared/strings";
import { focusStartCell, setPanelOpen, useBoard } from "../board/boardStore";
import { closeInsights, openInsights, useInsights } from "../insights/insightsStore";
import { hasUpdate, useUpdate } from "../update/updateStore";
import { setSettingsOpen } from "./appController";
import { CabinetRailIcon } from "../cabinet/CabinetIcons";
import { toggleCabinet, useCabinet } from "../cabinet/cabinetStore";
import { useAppStore } from "./appStore";
import styles from "./Rail.module.css";
import { WorkspaceRailButton } from "./WorkspaceSwitcher";
import { closeUniverse, openUniverse, useUniverse } from "../universe/universeStore";
import { osText } from "../../shared/platformText";
import { sameDir } from "../../domain/workspace";

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

/** Universe: 가운데 별 + 이어진 별 넷(연결망) */
const UniverseIcon = () => (
  <svg
    width="19"
    height="19"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="2.6" />
    <circle cx="5" cy="6" r="1.8" />
    <circle cx="19" cy="7" r="1.8" />
    <circle cx="17" cy="18.5" r="1.8" />
    <circle cx="6" cy="17" r="1.8" />
    <path d="M10 10.5 6.4 7.2M14.3 10.9l3.2-2.6M13.8 14.1l2.2 3M10 13.6 7.3 16" />
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
  const universeOpen = useUniverse((s) => s.open) && !settingsOpen;
  const insightsOpen = useInsights((s) => s.open) && !settingsOpen && !universeOpen;
  const boardOn = !insightsOpen && !settingsOpen && !universeOpen;
  const important = useBoard((s) => s.important);
  const today = useBoard((s) => s.today);
  const panelOpen = useBoard((s) => s.panelOpen);
  const badge = importantBadge(important, today);
  const n = important.length;
  const cabinetOpen = useCabinet((s) => s.open);
  // 공간이 2개 이상이면 레일 왼쪽에 지금 공간 색 띠(multi-board-spec 3-1)
  const band = useAppStore((s) => {
    const j = s.journal;
    if (s.workspaces.length < 2 || j.state !== "ready") return null;
    return s.workspaces.find((e) => sameDir(e.dir, j.dataDir))?.color ?? null;
  });

  return (
    <nav
      className={`${styles.rail} ${band ? styles.band : ""}`}
      style={band ? ({ "--ws-band": `var(--cat-${band})` } as React.CSSProperties) : undefined}
      aria-label={STR.rail.label}
    >
      <WorkspaceRailButton />
      <span className={styles.sep} aria-hidden="true" />
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
          closeUniverse();
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
          closeUniverse();
          void openInsights();
        }}
      >
        <InsightsIcon />
      </button>
      <button
        type="button"
        className={`${styles.btn} ${universeOpen ? styles.on : ""}`}
        aria-current={universeOpen ? "page" : undefined}
        aria-label={STR.universe.rail}
        title={osText(STR.universe.rail)}
        data-testid="rail-universe"
        onClick={() => void openUniverse()}
      >
        <UniverseIcon />
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
      <button
        type="button"
        className={`${styles.btn} ${cabinetOpen ? styles.on : ""}`}
        aria-label={STR.cabinet.rail}
        aria-expanded={cabinetOpen}
        title={STR.cabinet.rail}
        data-testid="rail-cabinet"
        onClick={toggleCabinet}
      >
        <CabinetRailIcon />
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
