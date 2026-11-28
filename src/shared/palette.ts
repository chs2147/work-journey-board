// 업무 색 팔레트 — 색약 대비가 검증된 범주형 8색, 순서 고정(viz-spec 6절). 순서를 바꾸지 않는다.
// CSS 변수(--cat-c1 …)는 이 값으로 런타임에 주입한다(값의 단일 출처).
import categoryColors from "./category-colors.json";

export const CATEGORY_COLOR_KEYS = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"] as const;
export type CategoryColorKey = (typeof CATEGORY_COLOR_KEYS)[number];

export interface CategoryColor {
  name: string;
  light: string;
  dark: string;
}

export const CATEGORY_COLORS: Record<CategoryColorKey, CategoryColor> = categoryColors;

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
