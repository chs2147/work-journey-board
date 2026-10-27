// 화면 테마(improve-1027v5-spec 4절): 시스템 설정 / 라이트 / 다크.
// 화면은 <html data-theme="light|dark"> 하나로 정한다(다크 값은 tokens.css의 :root[data-theme="dark"] 한 곳).
// 정본 = 이 PC 설정(config.json `theme`), 켤 때 깜빡임을 막는 사본 = localStorage `wjb.theme`
// — public/theme-early.js가 페이지 맨 앞에서 같은 규칙으로 먼저 적용한다(tests/unit/theme.test.ts가 대조).

export type ThemePref = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_KEY = "wjb.theme";
export const THEME_PREFS: readonly ThemePref[] = ["system", "light", "dark"];
const DARK_QUERY = "(prefers-color-scheme: dark)";

export const isThemePref = (v: unknown): v is ThemePref =>
  typeof v === "string" && (THEME_PREFS as readonly string[]).includes(v);

/** 저장된 사본(없거나 읽을 수 없으면 system) */
export function readStoredTheme(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return isThemePref(v) ? v : "system";
  } catch {
    return "system";
  }
}

export function storeTheme(pref: ThemePref) {
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    // 사본은 깜빡임 방지용일 뿐 — 못 써도 config.json이 정본
  }
}

export function systemTheme(): ResolvedTheme {
  return window.matchMedia?.(DARK_QUERY).matches ? "dark" : "light";
}

export const resolveTheme = (pref: ThemePref): ResolvedTheme => (pref === "system" ? systemTheme() : pref);

let current: ThemePref = "system";
let unwatch: (() => void) | null = null;

/** data-theme을 정하고, 시스템 설정이면 윈도우 앱 모드가 바뀔 때 따라간다 */
export function applyTheme(pref: ThemePref) {
  current = pref;
  unwatch?.();
  unwatch = null;
  const root = document.documentElement;
  root.dataset.theme = resolveTheme(pref);
  if (pref !== "system") return;
  const mq = window.matchMedia?.(DARK_QUERY);
  if (!mq) return;
  const onChange = () => {
    root.dataset.theme = systemTheme();
  };
  mq.addEventListener("change", onChange);
  unwatch = () => mq.removeEventListener("change", onChange);
}

export const currentTheme = () => current;
