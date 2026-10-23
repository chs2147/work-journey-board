import { describe, expect, it } from "vitest";
import {
  CATEGORY_COLOR_KEYS,
  CATEGORY_COLORS,
  applyPaletteCssVars,
  nextColorKey,
} from "../../src/shared/palette";

describe("업무 색 팔레트 (viz-spec 6절)", () => {
  it("8색이 c1~c8 고정 순서", () => {
    expect(CATEGORY_COLOR_KEYS).toEqual(["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"]);
    expect(CATEGORY_COLORS.c1.light).toBe("#2a78d6");
    expect(CATEGORY_COLORS.c8.dark).toBe("#e66767");
  });

  it("새 업무 색은 순서대로, 9번째부터 다시 c1", () => {
    expect(nextColorKey(0)).toBe("c1");
    expect(nextColorKey(7)).toBe("c8");
    expect(nextColorKey(8)).toBe("c1");
  });

  it("CSS 변수로 라이트·다크 값을 주입", () => {
    const el = document.createElement("div");
    applyPaletteCssVars(el);
    expect(el.style.getPropertyValue("--cat-c3-light")).toBe("#1baf7a");
    expect(el.style.getPropertyValue("--cat-c3-dark")).toBe("#199e70");
  });
});
