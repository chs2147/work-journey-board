// 시작 스플래시(docs/splash-spec.md): index.html에 복사한 색·문구가 원본과 같은지, 사라지기 규칙.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DAY_LABELS } from "../../src/domain/week";
import { CATEGORY_COLORS } from "../../src/shared/palette";
import { STR } from "../../src/shared/strings";

const html = readFileSync("index.html", "utf8");
const tokens = readFileSync("src/shared/tokens.css", "utf8");
const tauriConf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));

/** CSS 블록 텍스트에서 `--name: #hex;` 선언만 모은다. */
function vars(block: string, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(new RegExp(`--${prefix}([\\w-]+):\\s*(#[0-9a-f]{6})`, "gi")))
    out[m[1]!] = m[2]!;
  return out;
}
const darkPart = (css: string) => css.slice(css.indexOf("@media (prefers-color-scheme: dark)"));
const lightPart = (css: string) => css.slice(0, css.indexOf("@media (prefers-color-scheme: dark)"));

const TOKEN_OF: Record<string, string> = {
  page: "surface-page",
  card: "surface-card",
  line: "line",
  "text-1": "text-1",
  "text-2": "text-2",
  "text-3": "text-3",
  today: "today-mark",
};

describe("index.html 스플래시 = 원본 값", () => {
  for (const [mode, part] of [
    ["light", lightPart],
    ["dark", darkPart],
  ] as const) {
    it(`색(${mode})이 tokens.css·palette.ts와 같다`, () => {
      const sp = vars(part(html), "sp-");
      const tk = vars(part(tokens), "");
      for (const [s, t] of Object.entries(TOKEN_OF)) expect(sp[s], s).toBe(tk[t]);
      for (const c of ["c1", "c2", "c3", "c4", "c5"] as const)
        expect(sp[c], c).toBe(CATEGORY_COLORS[c][mode]);
    });
  }

  it("문구가 strings.ts·week.ts와 같다", () => {
    document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
    const days = [...document.querySelectorAll("#splash .splash-day > span")].map((e) => e.textContent);
    expect(days).toEqual(DAY_LABELS.slice(0, 5));
    expect(document.querySelector("#splash .splash-tag")?.textContent).toBe(STR.splash.tagline);
    expect(document.querySelector("#splash .splash-sr")?.textContent).toBe(STR.status.loading);
    expect(document.querySelector("#splash .splash-ver")?.textContent).toBe("v%APP_VERSION%");
  });

  it("인라인 script·style 속성이 없다(실앱 CSP: Tauri가 <style>에 nonce를 넣으면 'unsafe-inline'이 무시됨)", () => {
    expect(html).not.toMatch(/\sstyle="/);
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/);
  });

  it("창 배경색 = 스플래시 라이트 배경(흰 번쩍임 방지)", () => {
    expect(tauriConf.app.windows[0].backgroundColor).toBe(vars(lightPart(html), "sp-").page);
  });
});

describe("스플래시 동작", () => {
  let splash: typeof import("../../src/ui/splash");

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.spyOn(performance, "now").mockReturnValue(100);
    document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
    splash = await import("../../src/ui/splash");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const present = () => document.getElementById("splash") !== null;
  const today = () =>
    [...document.querySelectorAll(".splash-day")].findIndex((d) => d.classList.contains("today"));

  it("최소 표시 시간까지 남아 있다가 흐려지며 사라진다", async () => {
    const done = splash.dismissSplash();
    expect(splash.dismissSplash()).toBe(done); // 여러 번 불러도 한 번
    await vi.advanceTimersByTimeAsync(splash.SPLASH_MIN_MS - 100 - 1);
    expect(present()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(document.getElementById("splash")?.classList.contains("leaving")).toBe(true);
    await vi.advanceTimersByTimeAsync(splash.SPLASH_FADE_MS);
    await done;
    expect(present()).toBe(false);
  });

  it("준비가 늦으면 진행 문구를 띄우고 단계에 따라 바꾼다", async () => {
    splash.watchSplash();
    const msg = () => document.getElementById("splash-msg")!;
    await vi.advanceTimersByTimeAsync(splash.SPLASH_SLOW_MS - 100 - 1);
    expect(msg().classList.contains("on")).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(msg().textContent).toBe(STR.splash.opening);
    splash.splashStage(STR.splash.backingUp);
    expect(msg().textContent).toBe(STR.splash.backingUp);
  });

  it("빨리 준비되면 진행 문구가 나오지 않는다", async () => {
    const msg = document.getElementById("splash-msg")!;
    splash.watchSplash();
    const done = splash.dismissSplash();
    await vi.advanceTimersByTimeAsync(splash.SPLASH_MIN_MS + splash.SPLASH_FADE_MS);
    await done;
    await vi.advanceTimersByTimeAsync(splash.SPLASH_SLOW_MS);
    expect(present()).toBe(false);
    expect(msg.classList.contains("on")).toBe(false);
  });

  it("오늘 요일 카드 강조 — 주말이면 없음", () => {
    splash.markSplashToday(new Date(2026, 9, 22)); // 목
    expect(today()).toBe(3);
    splash.markSplashToday(new Date(2026, 9, 19)); // 월
    expect(today()).toBe(0);
    splash.markSplashToday(new Date(2026, 9, 24)); // 토
    expect(today()).toBe(-1);
  });

  it("스플래시가 없으면(이미 사라짐) 아무 일도 하지 않는다", async () => {
    document.body.innerHTML = "";
    splash.watchSplash();
    splash.splashStage(STR.splash.backingUp);
    splash.markSplashToday(new Date(2026, 9, 22));
    await expect(splash.dismissSplash()).resolves.toBeUndefined();
  });
});
