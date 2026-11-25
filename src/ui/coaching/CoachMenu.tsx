// 코칭 메뉴(coaching-spec 5절, D4) — 레일 ? · F1. 투어 목록·상태·처음부터, 제안 칩 켜기, 진행 기록 지우기, 이용 가이드.
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { COACH, type TourId } from "../../shared/coachingStrings";
import { STR } from "../../shared/strings";
import { openLink } from "../common/openLink";
import { useKanban } from "../kanban/kanbanStore";
import { useInsights } from "../insights/insightsStore";
import { useUniverse } from "../universe/universeStore";
import { useCabinet } from "../cabinet/cabinetStore";
import {
  closeMenu,
  resetProgress,
  saveFlags,
  startTour,
  tourForScreen,
  tourStatus,
  useCoaching,
  type TourStatus,
} from "./coachingStore";
import { TOURS, type CoachScreen, type TourGroup } from "./tours";
import styles from "./Coach.module.css";

const GROUPS: TourGroup[] = ["start", "board", "views", "side"];

function useHereScreen(): CoachScreen | null {
  const universe = useUniverse((s) => s.open);
  const insights = useInsights((s) => s.open);
  const kanban = useKanban((s) => s.open);
  const cabinet = useCabinet((s) => s.open);
  if (cabinet) return "cabinet";
  if (universe) return "universe";
  if (insights) return "insights";
  if (kanban) return "kanban";
  return null;
}

function Badge({ st, time }: { st: TourStatus; time: string }) {
  const M = COACH.menu;
  if (st.kind === "done") return <span className={`${styles.badge} ${styles.bDone}`}>{M.done}</span>;
  if (st.kind === "new") return <span className={`${styles.badge} ${styles.bNew}`}>{M.newSteps(st.n)}</span>;
  if (st.kind === "progress")
    return <span className={`${styles.badge} ${styles.bProg}`}>{M.progress(st.step, st.total)}</span>;
  return <span className={`${styles.badge} ${styles.bNone}`}>{time}</span>;
}

export function CoachMenu() {
  const open = useCoaching((s) => s.menuOpen);
  const flags = useCoaching((s) => s.flags);
  const here = useHereScreen();
  useEffect(() => {
    if (!open) return;
    document.querySelector<HTMLButtonElement>("[data-coach-menu] [data-testid^='coach-tour-']")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
    };
    const down = (e: PointerEvent) => {
      const t = e.target as Element;
      if (!t.closest?.("[data-coach-menu]") && !t.closest?.('[data-testid="rail-coach"]')) closeMenu();
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("pointerdown", down, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("pointerdown", down, true);
    };
  }, [open]);
  if (!open) return null;
  const M = COACH.menu;
  const hereTour = here ? tourForScreen(here) : null;
  const top = document.querySelector('[data-coach="rail"]')?.getBoundingClientRect().top ?? 97;
  const item = (id: TourId, isHere = false) => {
    const st = tourStatus(flags, id);
    const t = COACH.tours[id];
    return (
      <div key={(isHere ? "here-" : "") + id} style={{ display: "flex", alignItems: "center" }}>
        <button
          type="button"
          className={`${styles.menuItem} ${isHere ? styles.here : ""}`}
          data-testid={`coach-tour-${id}${isHere ? "-here" : ""}`}
          onClick={() => void startTour(id, st.kind === "progress" ? st.step - 1 : 0)}
        >
          <span style={{ flex: 1 }}>{t.name}</span>
          <Badge st={st} time={t.time} />
        </button>
        {st.kind !== "none" && (
          <button
            type="button"
            className={styles.restart}
            title={M.restart}
            aria-label={`${t.name} — ${M.restart}`}
            onClick={() => void startTour(id, 0)}
          >
            ↺
          </button>
        )}
      </div>
    );
  };
  return createPortal(
    <section
      className={styles.menu}
      style={{ ["--coach-menu-top" as string]: `${top}px` }}
      aria-label={M.title}
      data-coach-menu
      data-testid="coach-menu"
    >
      <header className={styles.menuHead}>
        <h2>{M.title}</h2>
        <span className={styles.menuKey}>F1</span>
        <button
          type="button"
          className={styles.restart}
          aria-label={M.close}
          title={M.close}
          onClick={closeMenu}
        >
          ✕
        </button>
      </header>
      <p className={styles.menuNote}>{M.sample}</p>
      <div className={styles.menuList}>
        {hereTour && (
          <>
            <div className={styles.menuGroup}>{M.here}</div>
            {item(hereTour, true)}
          </>
        )}
        {GROUPS.map((g) => (
          <div key={g}>
            <div className={styles.menuGroup}>{M.groups[g]}</div>
            {TOURS.filter((t) => t.group === g).map((t) => item(t.id))}
          </div>
        ))}
      </div>
      <footer className={styles.menuFoot}>
        <label>
          {M.suggest}
          <input
            type="checkbox"
            checked={flags?.suggest ?? true}
            data-testid="coach-suggest-toggle"
            onChange={(e) => void saveFlags({ suggest: e.target.checked })}
          />
        </label>
        <div className={styles.menuFootRow}>
          <button type="button" onClick={() => void openLink(STR.settings.guideUrl)}>
            {M.guide}
          </button>
          <button type="button" className={styles.quiet} onClick={() => void resetProgress()}>
            {M.reset}
          </button>
        </div>
      </footer>
    </section>,
    document.body,
  );
}
