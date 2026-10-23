// 시작 스플래시(docs/splash-spec.md). 화면은 index.html의 HTML·CSS가 JS 번들 전에 그리고,
// 여기서는 오늘 요일 표시 · 늦을 때 진행 문구 · 사라지기만 맡는다. 콜드 스타트 1회용 — 사라지면 DOM에서 지운다.
import { STR } from "../shared/strings";

/** 깜빡임 방지 최소 표시 시간(페이지 시작 기준). 이보다 길게 붙잡지 않는다. */
export const SPLASH_MIN_MS = 400;
export const SPLASH_FADE_MS = 160;
/** 이 시간이 지나도 남아 있으면 진행 문구를 보인다. */
export const SPLASH_SLOW_MS = 3000;
/** 글꼴 로딩이 실패·지연돼도 스플래시를 이 이상 붙잡지 않는다. */
const FONT_WAIT_MS = 1500;

let message: string = STR.splash.opening;
let slowTimer: ReturnType<typeof setTimeout> | undefined;
let dismissing: Promise<void> | null = null;

const splash = () => document.getElementById("splash");
const msgEl = () => document.getElementById("splash-msg");
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

/** 시작 직후 1회: 준비가 늦어지면 진행 문구를 띄운다. */
export function watchSplash(): void {
  if (!splash() || slowTimer !== undefined) return;
  slowTimer = setTimeout(
    () => {
      const m = msgEl();
      if (!m) return;
      m.textContent = message;
      m.classList.add("on");
    },
    Math.max(0, SPLASH_SLOW_MS - performance.now()),
  );
}

/** 시작 단계 문구. 아직 안 보이면 다음 표시 때 쓰고, 보이는 중이면 바로 바꾼다. */
export function splashStage(text: string): void {
  message = text;
  const m = msgEl();
  if (m?.classList.contains("on")) m.textContent = text;
}

/** 오늘 요일 카드(월~금) 강조. 주말이면 강조하지 않는다. */
export function markSplashToday(today: Date): void {
  const index = (today.getDay() + 6) % 7; // 월=0 … 일=6
  document
    .querySelectorAll("#splash .splash-day")
    .forEach((d, i) => d.classList.toggle("today", i === index));
}

/** 최소 표시 시간·글꼴 로딩을 기다린 뒤 흐려지며 사라진다. 여러 번 불러도 한 번만 동작한다. */
export function dismissSplash(): Promise<void> {
  dismissing ??= run();
  return dismissing;
}

async function run() {
  const el = splash();
  if (!el) return;
  await Promise.all([wait(SPLASH_MIN_MS - performance.now()), fontsReady()]);
  clearTimeout(slowTimer);
  if (!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    el.classList.add("leaving");
    await wait(SPLASH_FADE_MS);
  }
  el.remove();
}

/** 보드 글꼴을 미리 받아 둔다 — 스플래시가 사라진 뒤 글꼴 교체·입력칸 재측정이 보이지 않게. */
function fontsReady(): Promise<void> {
  const fonts = document.fonts as FontFaceSet | undefined;
  if (!fonts?.load) return Promise.resolve();
  return Promise.race([
    fonts.load('14px "Pretendard Variable"').then(
      () => undefined,
      () => undefined,
    ),
    wait(FONT_WAIT_MS),
  ]);
}
