// 코칭 진행 상태·플래그(coaching-spec 3·5절). 일지에는 아무것도 쓰지 않는다 — 플래그는 이 PC config.json `coaching`만.
import { create } from "zustand";
import type { CoachingFlags } from "../../platform";
import { COACH, type TourId } from "../../shared/coachingStrings";
import { useAppStore } from "../common/appStore";
import { coachingSampleActive, enterCoachingSample, exitCoachingSample } from "../common/appController";
import { toast } from "../board/boardStore";
import { closeKanban, openKanban, useKanban } from "../kanban/kanbanStore";
import { openInsights, useInsights } from "../insights/insightsStore";
import { openUniverse, useUniverse } from "../universe/universeStore";
import { useCabinet } from "../cabinet/cabinetStore";
import { setExpanded, useNote } from "../note/noteStore";
import { makeCoachingSample, prepareCoachDocument } from "./coachingSample";
import { cabiCall, onCabiCoach, openCabiCoach } from "../cabinet/cabiService";
import { TOURS, tourById, type CoachScreen } from "./tours";

/** away = 메인 창이 예시 일지를 연 채, 업무노트·업무 메모보드 창 안 투어를 기다린다(coaching-spec 13절) */
type Phase = "idle" | "entering" | "running" | "away" | "leaving";
export type Intro = "welcome" | "feature" | "afterStart";
type Screen = "board" | "kanban" | "insights" | "universe";

interface CoachingState {
  phase: Phase;
  tour: TourId | null;
  step: number;
  menuOpen: boolean;
  intro: Intro | null;
  suggest: CoachScreen | null;
  flags: CoachingFlags | null;
  /** 레일 ? 단추 깜박임(건너뛰기·다음에 뒤 위치 안내) — 바뀔 때마다 숫자를 올린다 */
  blink: number;
}

export const useCoaching = create<CoachingState>(() => ({
  phase: "idle",
  tour: null,
  step: 0,
  menuOpen: false,
  intro: null,
  suggest: null,
  flags: null,
  blink: 0,
}));

const get = useCoaching.getState;
const set = useCoaching.setState;
const platform = () => useAppStore.getState().platform;
/** 이 창이 Cabi.NET 별도 창(업무노트·업무 메모보드)인가 — 그 안 투어는 끝나면 메인 창에 알리고 창을 닫는다 */
const CHILD = typeof location !== "undefined" && new URLSearchParams(location.search).get("win") === "cabi";

const EMPTY: CoachingFlags = { existingUser: false, done: {}, seenScreens: [], suggest: true };

export async function saveFlags(patch: Partial<CoachingFlags>) {
  const next = { ...(get().flags ?? EMPTY), ...patch };
  set({ flags: next });
  await platform()
    ?.saveConfig({ coaching: next })
    .catch(() => undefined);
}

// ── 처음 1회 판정(3-2·3-4) ───────────────────────────────────────────────
/** 이번 실행에서 첫 실행(또는 DEV 일지 고르기) 화면을 거쳤나 = 새 사용자 */
let sawFirstRun = false;
let flagsLoading = false;
const readyReal = () => {
  const j = useAppStore.getState().journal;
  return j.state === "ready" && !j.sample;
};

async function loadFlags() {
  if (flagsLoading || get().flags) return;
  flagsLoading = true;
  const config = await platform()
    ?.loadConfig()
    .catch(() => null);
  let flags = config?.coaching;
  if (!flags) {
    flags = { ...EMPTY, existingUser: !sawFirstRun };
    set({ flags });
    await platform()
      ?.saveConfig({ coaching: flags })
      .catch(() => undefined);
  } else set({ flags: { ...EMPTY, ...flags } });
  flagsLoading = false;
  scheduleIntro();
}

/**
 * 자동으로 뜨는 카드(처음 1회 카드·화면별 제안 칩)를 쉬게 하는가 — 자동 시험(브라우저 모드 E2E·가이드 그림)에서만.
 * 실앱(WebView2·WKWebView)은 navigator.webdriver가 false라 해당 없음. 코칭 시험은 주소에 `coach=1`을 붙여 켠다.
 */
const autoCardsOff = () =>
  typeof navigator !== "undefined" &&
  navigator.webdriver === true &&
  !new URLSearchParams(globalThis.location?.search ?? "").has("coach");

let introTimer: ReturnType<typeof setTimeout> | null = null;
/** 처음 1회 카드: 새 사용자 = 환영(V1), 기존 사용자 중 끝까지 본 투어가 없으면 = 새 ? 단추 소개(V3) */
function scheduleIntro() {
  const f = get().flags;
  if (!f || f.introShown || autoCardsOff()) return;
  const kind: Intro | null = !f.existingUser
    ? "welcome"
    : Object.keys(f.done).length === 0
      ? "feature"
      : null;
  if (!kind) {
    void saveFlags({ introShown: true });
    return;
  }
  if (introTimer) clearTimeout(introTimer);
  introTimer = setTimeout(() => {
    introTimer = null;
    if (!readyReal() || get().phase !== "idle" || useAppStore.getState().settingsOpen) return;
    set({ intro: kind, suggest: null, menuOpen: false });
  }, 1200);
}

/** 처음 1회 카드를 닫는다 — 어떤 선택이든 다시 띄우지 않는다(D12) */
export function closeIntro(then?: "start" | "menu" | "later") {
  const kind = get().intro;
  set({ intro: null });
  if (kind === "welcome" || kind === "feature") void saveFlags({ introShown: true });
  if (then === "start") void startTour("T0");
  else if (then === "menu") openMenu();
  else if (then === "later") hintRail();
}

/** 레일 ? 단추를 잠시 깜박이고 위치를 알려 준다 */
function hintRail() {
  set({ blink: get().blink + 1 });
  toast(COACH.skippedHint);
}

// ── 투어 진행 ─────────────────────────────────────────────────────────────
let returnTo: { screen: Screen; noteExpanded: boolean } | null = null;

function currentScreen(): Screen {
  if (useUniverse.getState().open) return "universe";
  if (useInsights.getState().open) return "insights";
  if (useKanban.getState().open) return "kanban";
  return "board";
}

export async function startTour(id: TourId, at = 0) {
  if (get().phase !== "idle" || !readyReal()) return;
  set({ phase: "entering", menuOpen: false, intro: null, suggest: null, tour: id, step: at });
  returnTo = { screen: currentScreen(), noteExpanded: useNote.getState().expanded };
  try {
    const ok = await enterCoachingSample(() => makeCoachingSample(platform()?.now() ?? new Date()));
    if (!ok) throw new Error("일지가 열려 있지 않습니다");
    const win = tourById(id).win;
    if (win) {
      // 업무노트·업무 메모보드: 예시 일지에 가상 문서를 만들고 그 창을 열어 창 안에서 투어(13절)
      const j = useAppStore.getState().journal;
      if (j.state !== "ready" || !j.sample) throw new Error("예시 화면이 열려 있지 않습니다");
      const docId = await prepareCoachDocument(j.repo, win);
      set({ phase: "away", step: at });
      await openCabiCoach(win, docId, at ? `${id}@${at}` : id);
      watchAway();
      return;
    }
    set({ phase: "running" });
    await goStep(at);
  } catch (e) {
    if (coachingSampleActive()) await exitCoachingSample().catch(() => undefined);
    set({ phase: "idle", tour: null, step: 0 });
    toast(COACH.failed(e instanceof Error ? e.message : String(e)));
  }
}

export async function goStep(i: number) {
  const { tour, phase } = get();
  if (!tour || phase !== "running") return;
  const def = tourById(tour);
  if (i < 0 || i >= def.steps.length) return;
  set({ step: i });
  await Promise.resolve(def.steps[i]!.before?.()).catch(() => undefined);
}

export function nextStep() {
  const { tour, step } = get();
  if (!tour) return;
  if (step >= tourById(tour).steps.length - 1) void endTour(true);
  else void goStep(step + 1);
}

export function prevStep() {
  const { step } = get();
  if (step > 0) void goStep(step - 1);
}

/** 투어를 끝낸다(done = 끝까지 봄 · false = 건너뛰기) → 내 일지·시작 전 화면으로(D9) */
/** 창 안 투어를 기다리는 동안 그 창이 닫혔는지 본다(사용자가 창 X로 닫은 경우 = 건너뛰기) */
let awayTimer: ReturnType<typeof setInterval> | null = null;
function watchAway() {
  if (awayTimer) clearInterval(awayTimer);
  const started = Date.now();
  awayTimer = setInterval(() => {
    if (get().phase !== "away") {
      if (awayTimer) clearInterval(awayTimer);
      awayTimer = null;
      return;
    }
    if (Date.now() - started < 3000) return;
    void platform()
      ?.cabi.opened()
      .then((open) => {
        if (!open.length && get().phase === "away") void endTour(false);
      })
      .catch(() => undefined);
  }, 1000);
}

/** Cabi.NET 창 안에서 투어 시작(그 창의 CoachChild가 부른다) — `T9` 또는 `T9@3`(이어서) */
export function startChildTour(spec: string) {
  const m = /^(T\d{1,2})(?:@(\d{1,2}))?$/.exec(spec);
  if (!m || !TOURS.some((t) => t.id === m[1])) return;
  const id = m[1] as TourId,
    at = Math.min(Number(m[2] ?? 0), tourById(id).steps.length - 1);
  set({ phase: "running", tour: id, step: at });
  void goStep(at);
}

export async function endTour(done: boolean) {
  const { tour, step, phase } = get();
  if (!tour || phase === "leaving" || phase === "idle") return;
  set({ phase: "leaving" });
  if (CHILD) {
    // 창 안 투어: 메인 창에 결과만 알리고(플래그 저장·내 일지 복귀는 메인 창이) 이 창을 닫는다
    await cabiCall("coach", { tour, done, step }).catch(() => undefined);
    set({ phase: "idle", tour: null, step: 0 });
    await platform()
      ?.cabi.closeSelf()
      .catch(() => undefined);
    return;
  }
  if (awayTimer) clearInterval(awayTimer);
  awayTimer = null;
  // 업무노트·업무 메모보드 투어: 예시 문서 창은 저장할 것이 없다 — 저장 확인을 기다리지 않고 먼저 닫는다(13절)
  if (tourById(tour).win)
    await platform()
      ?.cabi.closeAll()
      .catch(() => undefined);
  const f = get().flags ?? EMPTY;
  if (done) await saveFlags({ done: { ...f.done, [tour]: tourById(tour).v }, progress: null });
  else await saveFlags({ progress: { tour, step } });
  useCabinet.setState({ open: false });
  await exitCoachingSample().catch(() => undefined);
  const back = returnTo;
  returnTo = null;
  if (back) {
    if (back.screen === "kanban") void openKanban();
    else if (back.screen === "insights") void openInsights();
    else if (back.screen === "universe") void openUniverse();
    else closeKanban(); // 시작 화면이 칸반인 일지도 보던 주간 보드로
    if (!back.noteExpanded) setExpanded(false);
  }
  set({ phase: "idle", tour: null, step: 0 });
  if (done && tour === "T0") set({ intro: "afterStart" });
  else if (!done && !(get().flags ?? EMPTY).skipHinted) {
    void saveFlags({ skipHinted: true });
    hintRail();
  }
}

// ── 코칭 메뉴 ─────────────────────────────────────────────────────────────
export function openMenu() {
  if (get().phase !== "idle" || !readyReal()) return;
  set({ menuOpen: true, intro: null, suggest: null });
  if (!(get().flags ?? EMPTY).menuOpened) void saveFlags({ menuOpened: true });
}
export const closeMenu = () => set({ menuOpen: false });
export function toggleMenu() {
  if (get().menuOpen) closeMenu();
  else openMenu();
}

/** 메뉴 [진행 기록 지우기] — 다음 실행 때 처음 안내가 다시 나온다 */
export async function resetProgress() {
  const f = get().flags ?? EMPTY;
  await saveFlags({
    ...f,
    done: {},
    progress: null,
    seenScreens: [],
    introShown: false,
    menuOpened: false,
    skipHinted: false,
  });
  toast(COACH.menu.resetDone);
}

/** 설정 › 정보 [처음 설치처럼 다시 보기] — 기록을 지우고 처음 사용자 환영 카드를 지금 띄운다 */
export async function replayFirstRun() {
  await saveFlags({
    existingUser: false,
    introShown: false,
    done: {},
    progress: null,
    seenScreens: [],
    menuOpened: false,
    skipHinted: false,
  });
  if (!readyReal() || get().phase !== "idle") return;
  set({ intro: "welcome", menuOpen: false, suggest: null });
}

export type TourStatus =
  | { kind: "done" }
  | { kind: "new"; n: number }
  | { kind: "progress"; step: number; total: number }
  | { kind: "none" };

export function tourStatus(flags: CoachingFlags | null, id: TourId): TourStatus {
  const def = tourById(id);
  const seen = flags?.done[id];
  if (flags?.progress?.tour === id && seen === undefined)
    return { kind: "progress", step: flags.progress.step + 1, total: def.steps.length };
  if (seen === undefined) return { kind: "none" };
  if (seen < def.v) return { kind: "new", n: def.v - seen };
  return { kind: "done" };
}

/** 레일 ? 점: 아직 메뉴를 연 적 없고 본 투어가 없음, 또는 본 투어에 새 단계 */
export function railDot(flags: CoachingFlags | null): boolean {
  if (!flags) return false;
  if (!flags.menuOpened && Object.keys(flags.done).length === 0) return true;
  return TOURS.some((t) => flags.done[t.id] !== undefined && flags.done[t.id]! < t.v);
}

// ── 화면별 제안 칩(3-1, D3) ───────────────────────────────────────────────
const SCREEN_TOUR: Record<CoachScreen, TourId> = {
  kanban: "T4",
  insights: "T5",
  universe: "T6",
  cabinet: "T8",
};
export const tourForScreen = (s: CoachScreen) => SCREEN_TOUR[s];

function maybeSuggest(screen: CoachScreen) {
  const f = get().flags;
  if (
    !f ||
    !f.suggest ||
    !f.introShown ||
    autoCardsOff() ||
    get().phase !== "idle" ||
    get().intro ||
    !readyReal()
  )
    return;
  if (f.seenScreens.includes(screen) || f.done[SCREEN_TOUR[screen]] !== undefined) return;
  set({ suggest: screen });
  void saveFlags({ seenScreens: [...f.seenScreens, screen] });
}

export function closeSuggest(start = false) {
  const s = get().suggest;
  set({ suggest: null });
  if (start && s) void startTour(SCREEN_TOUR[s]);
}

// ── 연결: 일지가 열리면 플래그를 읽고, 화면이 처음 열리면 제안 ──────────────
let wired = false;
export function wireCoaching() {
  if (wired) return;
  wired = true;
  const st = useAppStore.getState().journal.state;
  if (st === "first-run" || st === "dev-setup") sawFirstRun = true;
  useAppStore.subscribe((s, prev) => {
    if (s.journal.state === "first-run" || s.journal.state === "dev-setup") sawFirstRun = true;
    if (s.journal !== prev.journal && readyReal()) void loadFlags();
  });
  if (readyReal()) void loadFlags();
  const watch = (open: boolean, was: boolean, screen: CoachScreen) => {
    if (open && !was) maybeSuggest(screen);
    if (!open && was && get().suggest === screen) set({ suggest: null });
  };
  useKanban.subscribe((a, b) => watch(a.open, b.open, "kanban"));
  useInsights.subscribe((a, b) => watch(a.open, b.open, "insights"));
  useUniverse.subscribe((a, b) => watch(a.open, b.open, "universe"));
  useCabinet.subscribe((a, b) => watch(a.open, b.open, "cabinet"));
  // 업무노트·업무 메모보드 창 안 투어가 끝났다(13절) — 그 단계를 기억하고 메인 창에서 마무리
  onCabiCoach((r) => {
    if (get().phase !== "away" || get().tour !== r.tour) return;
    set({ step: Math.min(r.step, tourById(r.tour as TourId).steps.length - 1) });
    void endTour(r.done);
  });
}
