// 업무 색 팔레트 — 색약 대비가 검증된 범주형 8색, 순서 고정(viz-spec 6절). 순서를 바꾸지 않는다.
// CSS 변수(--cat-c1 …)는 이 값으로 런타임에 주입한다(값의 단일 출처).

export const CATEGORY_COLOR_KEYS = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"] as const;
export type CategoryColorKey = (typeof CATEGORY_COLOR_KEYS)[number];

export interface CategoryColor {
  name: string;
  light: string;
  dark: string;
}

export const CATEGORY_COLORS: Record<CategoryColorKey, CategoryColor> = {
  c1: { name: "파랑", light: "#2a78d6", dark: "#3987e5" },
  c2: { name: "주황", light: "#eb6834", dark: "#d95926" },
  c3: { name: "청록", light: "#1baf7a", dark: "#199e70" },
  c4: { name: "노랑", light: "#eda100", dark: "#c98500" },
  c5: { name: "분홍", light: "#e87ba4", dark: "#d55181" },
  c6: { name: "초록", light: "#008300", dark: "#008300" },
  c7: { name: "보라", light: "#6250d6", dark: "#9085e9" },
  c8: { name: "빨강", light: "#e34948", dark: "#e66767" },
};

/** 새 업무에 배정할 색: 이미 만든 업무 수 기준으로 팔레트 순서대로, 9번째부터 다시 1번. */
export function nextColorKey(existingCount: number): CategoryColorKey {
  return CATEGORY_COLOR_KEYS[existingCount % CATEGORY_COLOR_KEYS.length]!;
}

export function applyPaletteCssVars(root: HTMLElement = document.documentElement): void {
  for (const key of CATEGORY_COLOR_KEYS) {
    root.style.setProperty(`--cat-${key}-light`, CATEGORY_COLORS[key].light);
    root.style.setProperty(`--cat-${key}-dark`, CATEGORY_COLORS[key].dark);
  }
}
