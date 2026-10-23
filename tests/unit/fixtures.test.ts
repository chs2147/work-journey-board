import { describe, expect, it } from "vitest";
import sample from "../../fixtures/sample-weeks.json";
import { CATEGORY_COLOR_KEYS } from "../../src/shared/palette";

describe("가상 샘플 fixture", () => {
  it("항목은 셀마다 seq 1부터 연속, 첫 항목은 depth 0", () => {
    const cells = new Map<string, { seq: number; depth: number }[]>();
    for (const it of sample.items) {
      const key = `${it.date}|${it.categoryId}`;
      cells.set(key, [...(cells.get(key) ?? []), it]);
    }
    for (const list of cells.values()) {
      expect(list.map((x) => x.seq)).toEqual(list.map((_, i) => i + 1));
      expect(list[0]?.depth).toBe(0);
    }
  });

  it("업무 색은 팔레트 키", () => {
    for (const c of sample.categories) expect(CATEGORY_COLOR_KEYS).toContain(c.color);
  });
});
