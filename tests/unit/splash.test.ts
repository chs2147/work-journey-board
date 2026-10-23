// 시작 스플래시(docs/splash-spec.md): splash.html에 복사한 색·문구가 원본과 같은지, 창 설정, 메인 창 쪽 넘어가기 규칙.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DAY_LABELS } from "../../src/domain/week";
import type { Platform } from "../../src/platform";
import { CATEGORY_COLORS } from "../../src/shared/palette";
import { STR } from "../../src/shared/strings";
import { markToday, setStatus, todayFrom } from "../../src/splash/view";

const read = (p: string) => readFileSync(p, "utf8");
const splashHtml = read("splash.html");
const indexHtml = read("index.html");
const tokens = read("src/shared/tokens.css");
const conf = JSON.parse(read("src-tauri/tauri.conf.json"));
const splashCap = JSON.parse(read("src-tauri/capabilities/splash.json"));
const win = (label: string) => conf.app.windows.find((w: { label: string }) => w.label === label);

/** CSS 텍스트에서 `--name: #hex` 선언만 모은다. */
function vars(css: string, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of css.matchAll(new RegExp(`--${prefix}([\\w-]+):\\s*(#[0-9a-f]{6})`, "gi")))
    out[m[1]!] = m[2]!;
  return out;
}
const DARK = "@media (prefers-color-scheme: dark)";
const lightPart = (css: string) => css.slice(0, css.indexOf(DARK));
const darkPart = (css: string) => css.slice(css.indexOf(DARK));
const body = (html: string) => html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));

const TOKEN_OF: Record<string, string> = {
  page: "surface-page",
  card: "surface-card",
  line: "line",
  "text-1": "text-1",
  "text-2": "text-2",
  "text-3": "text-3",
  accent: "accent",
  today: "today-mark",
};

describe("splash.html = 원본 값", () => {
  for (const [mode, part] of [
    ["light", lightPart],
    ["dark", darkPart],
  ] as const) {
    it(`색(${mode})이 tokens.css·palette.ts와 같다`, () => {
      const sp = vars(part(splashHtml), "sp-");
      const tk = vars(part(tokens), "");
      for (const [s, t] of Object.entries(TOKEN_OF)) expect(sp[s], s).toBe(tk[t]);
      for (const c of ["c1", "c2", "c3", "c4", "c5"] as const)
        expect(sp[c], c).toBe(CATEGORY_COLORS[c][mode]);
    });
  }

  it("문구가 strings.ts·week.ts와 같다", () => {
    document.body.innerHTML = body(splashHtml);
    const days = [...document.querySelectorAll(".day > span")].map((e) => e.textContent);
    expect(days).toEqual(DAY_LABELS.slice(0, 5));
    expect(document.querySelector(".tag")?.textContent).toBe(STR.splash.tagline);
    expect(document.querySelector("#status")?.textContent).toBe(STR.splash.starting);
    expect(document.querySelector(".ver")?.textContent).toBe("v%APP_VERSION%");
  });

  it("인라인 script·style 속성이 없다(실앱 CSP: Tauri가 <style>에 nonce를 넣으면 'unsafe-inline'이 무시됨)", () => {
    for (const html of [splashHtml, indexHtml]) {
      expect(html).not.toMatch(/\sstyle="/);
      expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/);
    }
  });
});

describe("창 설정(tauri.conf.json)", () => {
  it("스플래시 창: 메인보다 작고, 테두리 없이 가운데, 닫기·크기 조절 없음", () => {
    const s = win("splash");
    const m = win("main");
    expect(conf.app.windows[0].label).toBe("splash"); // 먼저 뜬다
    expect(s.url).toBe("splash.html");
    expect(s.width).toBeLessThan(m.minWidth);
    expect(s.height).toBeLessThan(m.minHeight);
    expect(s).toMatchObject({ decorations: false, center: true, resizable: false, closable: false });
    expect(s.backgroundColor).toBe(vars(lightPart(splashHtml), "sp-").card);
  });

  it("메인 창은 숨긴 채 시작한다(스플래시가 끝날 때 보임)", () => {
    expect(win("main").visible).toBe(false);
  });

  it("스플래시 창 권한은 이벤트 받기뿐", () => {
    expect(splashCap.windows).toEqual(["splash"]);
    expect(splashCap.permissions).toEqual(["core:event:allow-listen", "core:event:allow-unlisten"]);
  });
});

describe("스플래시 창 화면", () => {
  beforeEach(() => {
    document.body.innerHTML = body(splashHtml);
  });
  const today = () => [...document.querySelectorAll(".day")].findIndex((d) => d.classList.contains("today"));

  it("오늘 요일 카드 강조 — 주말이면 없음", () => {
    markToday(new Date(2026, 9, 22)); // 목
    expect(today()).toBe(3);
    markToday(new Date(2026, 9, 19)); // 월
    expect(today()).toBe(0);
    markToday(new Date(2026, 9, 24)); // 토
    expect(today()).toBe(-1);
  });

  it("진행 문구 바꾸기", () => {
    setStatus(STR.splash.backingUp);
    expect(document.querySelector("#status")?.textContent).toBe(STR.splash.backingUp);
  });

  it("?today= 로 날짜 고정(브라우저 모드), 없거나 형식이 틀리면 지금", () => {
    const now = new Date(2026, 0, 1);
    expect(todayFrom("?today=2026-10-22", now)).toEqual(new Date(2026, 9, 22));
    expect(todayFrom("", now)).toBe(now);
    expect(todayFrom("?today=10/22", now)).toBe(now);
  });
});

describe("메인 창 → 스플래시 끝내기", () => {
  let mod: typeof import("../../src/ui/splash");
  const make = () => ({ status: vi.fn(), finish: vi.fn(async () => undefined) });

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.spyOn(performance, "now").mockReturnValue(300);
    mod = await import("../../src/ui/splash");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("준비가 빨라도 최소 표시 시간을 채운 뒤 넘어간다", async () => {
    const splash = make();
    const p = { splash } as unknown as Platform;
    const done = mod.finishSplash(p);
    expect(mod.finishSplash(p)).toBe(done); // 여러 번 불러도 한 번
    expect(splash.status).toHaveBeenCalledWith(STR.splash.ready);
    await vi.advanceTimersByTimeAsync(mod.SPLASH_MIN_MS - 300 - 1);
    expect(splash.finish).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(splash.finish).toHaveBeenCalledTimes(1);
  });

  it("준비가 최소 시간보다 늦으면 바로 넘어간다", async () => {
    vi.spyOn(performance, "now").mockReturnValue(mod.SPLASH_MIN_MS + 1000);
    const splash = make();
    const done = mod.finishSplash({ splash } as unknown as Platform);
    await vi.advanceTimersByTimeAsync(0);
    await done;
    expect(splash.finish).toHaveBeenCalledTimes(1);
  });

  it("스플래시가 없는 환경(브라우저 모드)·플랫폼 없음은 바로 끝", async () => {
    await expect(mod.finishSplash({} as Platform)).resolves.toBeUndefined();
  });
});
