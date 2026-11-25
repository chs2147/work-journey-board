// 투어 정의(coaching-spec 6절) — 단계마다 밝힐 대상·그 전에 맞출 화면. 글은 shared/coachingStrings.ts.
// 대상은 data-testid·data-coach 표식만 쓴다(화면 동작은 바꾸지 않음). 화면 이동은 기존 함수만(새 길 없음).
import { COACH, type TourId } from "../../shared/coachingStrings";
import { closeKanban, openKanban } from "../kanban/kanbanStore";
import { closeInsights, openInsights } from "../insights/insightsStore";
import { openUniverse, useUniverse } from "../universe/universeStore";
import { closeCabinet, openCabinet, useCabinet } from "../cabinet/cabinetStore";
import { setPanelOpen, setViewMode, useBoard } from "../board/boardStore";
import { setCollapsed, setExpanded } from "../note/noteStore";
import { setSummaryOpen } from "../summary/summaryStore";

/** 대상: CSS 선택자, 또는 찾은 요소에서 up단계 위 부모. null = 가운데 카드 */
export type Target = string | { sel: string; up: number } | null;

export interface StepDef {
  target: Target;
  /** 대상이 없을 때 대신 밝힐 곳(그 영역 전체) */
  fallback?: Target;
  /** 이 단계를 보여 주기 전에 맞출 화면 */
  before?: () => void | Promise<void>;
  /** 직접 눌러 보기 — 밝힌 곳을 누르면 그 동작이 실행되고 다음 단계로(데이터를 바꾸지 않는 화면 이동만) */
  tap?: boolean;
}

export type TourGroup = "start" | "board" | "views" | "side";
/** 처음 열 때 제안 칩을 띄우는 화면 */
export type CoachScreen = "kanban" | "insights" | "universe" | "cabinet";

export interface TourDef {
  id: TourId;
  /** 콘텐츠 판 — 본 뒤에 단계가 바뀌면 올린다(코칭 메뉴 "새 단계", CLAUDE.md 신기능 코칭 동반) */
  v: number;
  group: TourGroup;
  screen?: CoachScreen;
  steps: StepDef[];
}

const tid = (id: string) => `[data-testid="${id}"]`;
const coach = (id: string) => `[data-coach="${id}"]`;

/** 주간 보드 기본 모습으로(다른 화면·패널을 닫는다) */
export function toBoard() {
  closeKanban();
  closeInsights();
  if (useUniverse.getState().open) useUniverse.setState({ open: false });
  if (useCabinet.getState().open) closeCabinet();
  setExpanded(false);
  setSummaryOpen(false);
  if (useBoard.getState().viewMode !== "week") setViewMode("week");
}

const S = (target: Target, more: Omit<StepDef, "target"> = {}): StepDef => ({ target, ...more });

export const TOURS: TourDef[] = [
  {
    id: "T0",
    v: 1,
    group: "start",
    steps: [
      S(null, { before: toBoard }),
      S(coach("rail")),
      S(tid("category-header")),
      S(coach("today-cell"), { fallback: tid("board-grid") }),
      S(tid("category-add")),
      S(coach("view-seg")),
      S(coach("year")),
      S(tid("summary-toggle")),
      S(tid("export-open")),
      S(tid("rail-coach")),
    ],
  },
  {
    id: "T1",
    v: 1,
    group: "start",
    steps: [
      S(`${coach("rail")} > :first-child`, { before: toBoard }),
      S(tid("rail-board")),
      S(tid("rail-kanban")),
      S(tid("rail-insights")),
      S(tid("rail-universe")),
      S(tid("rail-important")),
      S(tid("rail-cabinet")),
      S(tid("rail-settings")),
      S(tid("rail-coach")),
    ],
  },
  {
    id: "T2",
    v: 1,
    group: "board",
    steps: [
      S(coach("week-nav"), { before: toBoard }),
      S(coach("today-cell"), { fallback: tid("board-grid") }),
      S(`${coach("today-cell")} ${tid("item-view")}`, { fallback: coach("today-cell") }),
      S(tid("search-input")),
      S(tid("tag-filter")),
      S(coach("view-seg")),
      S(coach("year")),
      S(tid("summary-toggle")),
      S(tid("export-open")),
    ],
  },
  {
    id: "T3",
    v: 1,
    group: "board",
    steps: [
      S(tid("note-canvas"), {
        before: () => {
          toBoard();
          setCollapsed(false);
          setExpanded(true);
        },
        fallback: tid("note-dock"),
      }),
      S(coach("note-palette")),
      S(tid("link-strip"), { fallback: tid("note-box") }),
      S(tid("note-edge-label"), { fallback: tid("note-canvas") }),
      S(tid("note-zoom")),
      S(tid("snapshot-button")),
    ],
  },
  {
    id: "T4",
    v: 1,
    group: "views",
    screen: "kanban",
    steps: [
      S(tid("rail-kanban"), { before: toBoard, tap: true }),
      S(tid("kanban-board"), { before: () => void openKanban() }),
      S(tid("kanban-card"), { fallback: tid("kanban-board") }),
      S(tid("kanban-add-card")),
      S(tid("kanban-add-section")),
      S(tid("kanban-period")),
      S(tid("kanban-layout")),
    ],
  },
  {
    id: "T5",
    v: 1,
    group: "views",
    screen: "insights",
    steps: [
      S(tid("rail-insights"), { before: toBoard, tap: true }),
      S(`${tid("insights")} [role="tablist"]`, {
        before: () => void openInsights(),
        fallback: tid("insights"),
      }),
      S(tid("insight-list")),
      S(tid("journey-map"), { fallback: tid("insights") }),
      S(tid("timeline"), { fallback: tid("insights") }),
      S(tid("insight-period")),
      S(tid("insight-copy")),
    ],
  },
  {
    id: "T6",
    v: 1,
    group: "views",
    screen: "universe",
    steps: [
      S(null, { before: toBoard }),
      S(tid("rail-universe"), { tap: true }),
      S(tid("universe-map"), { before: () => void openUniverse(), fallback: tid("universe-view") }),
      S({ sel: tid("u-dynamic"), up: 1 }),
      S({ sel: tid("u-mode-focus"), up: 1 }),
      S({ sel: tid("u-view-map"), up: 1 }),
      S(tid("u-toggle-filter")),
      S(tid("timebar")),
      S(coach("u-motion")),
      S(tid("pack-toggle")),
    ],
  },
  {
    id: "T7",
    v: 1,
    group: "side",
    steps: [
      S(tid("rail-important"), {
        before: () => {
          toBoard();
          setPanelOpen(false);
        },
        tap: true,
      }),
      S(tid("important-panel"), { before: () => setPanelOpen(true) }),
      S(tid("important-due-row"), { fallback: tid("important-panel") }),
      S(tid("important-row"), { fallback: tid("important-panel") }),
      S(tid("week-done"), { fallback: tid("important-panel") }),
      S(`${coach("today-cell")} ${tid("item-view")}`, { fallback: coach("today-cell") }),
    ],
  },
  {
    id: "T8",
    v: 1,
    group: "side",
    screen: "cabinet",
    steps: [
      S(tid("rail-cabinet"), { before: toBoard, tap: true }),
      S(tid("cabi-hub"), { before: () => void openCabinet(), fallback: tid("cabinet") }),
      S(coach("cabi-groups"), { fallback: tid("cabi-hub") }),
      S(tid("cabi-items"), { fallback: tid("cabinet-list") }),
      S(tid("cabinet-add-folder")),
      S(tid("cabi-new-note")),
      S(tid("cabi-open-board")),
    ],
  },
];

export const tourById = (id: TourId) => TOURS.find((t) => t.id === id)!;
export const stepText = (id: TourId, i: number) => COACH.tours[id].steps[i]!;

/** 대상 요소 찾기 — 없거나 크기가 0이면 null(display: contents 묶음은 자식들의 합으로 잰다) */
export function findTarget(t: Target): Element | null {
  if (!t) return null;
  const sel = typeof t === "string" ? t : t.sel;
  let el = document.querySelector(sel);
  if (el && typeof t !== "string") for (let i = 0; i < t.up && el; i++) el = el.parentElement;
  return el;
}

export function rectOf(el: Element): DOMRect | null {
  let r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0 && el.children.length) {
    const rs = [...el.children].map((c) => c.getBoundingClientRect()).filter((x) => x.width || x.height);
    if (!rs.length) return null;
    const left = Math.min(...rs.map((x) => x.left)),
      top = Math.min(...rs.map((x) => x.top)),
      right = Math.max(...rs.map((x) => x.right)),
      bottom = Math.max(...rs.map((x) => x.bottom));
    r = new DOMRect(left, top, right - left, bottom - top);
  }
  if (r.width === 0 && r.height === 0) return null;
  if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return null;
  return r;
}
