// 화면 테마(improve-1027v5-spec 4절): 이 PC 설정(config.json) 읽기·합쳐 쓰기, 사본·해석 규칙,
// public/theme-early.js(그리기 전 적용)가 src/shared/theme.ts와 같은 답을 내는지, 설정 분류 기억 값 검사.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, mergeSettings } from "../../src/data/settings";
import { mergeConfigJson, parseConfig } from "../../src/platform";
import { applyTheme, readStoredTheme, resolveTheme, THEME_KEY, THEME_PREFS } from "../../src/shared/theme";

const early = readFileSync("public/theme-early.js", "utf8");
const runEarly = () => new Function(early)();

function stubSystem(dark: boolean) {
  const listeners = new Set<() => void>();
  const mq = {
    matches: dark,
    addEventListener: (_: string, f: () => void) => listeners.add(f),
    removeEventListener: (_: string, f: () => void) => listeners.delete(f),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => mq),
  );
  return {
    set(next: boolean) {
      mq.matches = next;
      listeners.forEach((f) => f());
    },
    listeners,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  applyTheme("light"); // 시스템 감시 해제
});

describe("config.json", () => {
  it("저장 폴더가 없거나 깨진 글이면 첫 실행(null), 모르는 테마 값은 버린다", () => {
    expect(parseConfig(null)).toBeNull();
    expect(parseConfig("{oops")).toBeNull();
    expect(parseConfig('{"theme":"dark"}')).toBeNull();
    expect(parseConfig('{"dataDir":"C:\\\\WJ","theme":"dark"}')).toEqual({
      dataDir: "C:\\WJ",
      theme: "dark",
    });
    expect(parseConfig('{"dataDir":"C:\\\\WJ","theme":"blue"}')).toEqual({ dataDir: "C:\\WJ" });
  });

  it("합쳐 쓰기: 저장 위치를 옮겨도 테마(와 모르는 키)는 남는다", () => {
    const before = JSON.stringify({ dataDir: "C:\\Old", theme: "dark", future: 1 });
    const after = JSON.parse(mergeConfigJson(before, { dataDir: "D:\\New" }));
    expect(after).toEqual({ dataDir: "D:\\New", theme: "dark", future: 1 });
    expect(JSON.parse(mergeConfigJson(after && JSON.stringify(after), { theme: "light" })).theme).toBe(
      "light",
    );
    expect(JSON.parse(mergeConfigJson("[1]", { theme: "system" }))).toEqual({ theme: "system" });
    expect(JSON.parse(mergeConfigJson(null, { dataDir: "C:\\WJ" }))).toEqual({ dataDir: "C:\\WJ" });
  });
});

describe("테마 해석", () => {
  it("사본이 없거나 이상하면 시스템 설정", () => {
    expect(readStoredTheme()).toBe("system");
    localStorage.setItem(THEME_KEY, "neon");
    expect(readStoredTheme()).toBe("system");
    localStorage.setItem(THEME_KEY, "dark");
    expect(readStoredTheme()).toBe("dark");
  });

  it("theme-early.js = readStoredTheme + resolveTheme (모든 조합)", () => {
    for (const sysDark of [false, true]) {
      stubSystem(sysDark);
      for (const stored of [...THEME_PREFS, null, "neon"]) {
        localStorage.clear();
        if (stored) localStorage.setItem(THEME_KEY, stored);
        delete document.documentElement.dataset.theme;
        runEarly();
        expect(document.documentElement.dataset.theme, `${stored} / 시스템 ${sysDark}`).toBe(
          resolveTheme(readStoredTheme()),
        );
      }
    }
  });

  it("시스템 설정이면 윈도우 앱 모드가 바뀔 때 따라가고, 고정하면 감시를 멈춘다", () => {
    const sys = stubSystem(false);
    applyTheme("system");
    expect(document.documentElement.dataset.theme).toBe("light");
    sys.set(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    applyTheme("light");
    expect(sys.listeners.size).toBe(0);
    sys.set(false);
    sys.set(true);
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});

describe("설정 분류 기억(ui.settingsCategory)", () => {
  it("기본은 화면, 모르는 값이면 화면으로", () => {
    expect(DEFAULT_SETTINGS.ui.settingsCategory).toBe("screen");
    expect(mergeSettings(DEFAULT_SETTINGS, { ui: { settingsCategory: "work" } }).ui.settingsCategory).toBe(
      "work",
    );
    expect(mergeSettings(DEFAULT_SETTINGS, { ui: { settingsCategory: "nope" } }).ui.settingsCategory).toBe(
      "screen",
    );
  });
});
