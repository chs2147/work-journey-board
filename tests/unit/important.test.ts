// 중요 업무 목록 묶음·정렬·배지(important-repeat-spec 2-3·2-5)
import { describe, expect, it } from "vitest";
import { groupImportant, importantBadge } from "../../src/domain/important";
import type { ImportantItem } from "../../src/domain/types";

const TODAY = "2026-10-22"; // 목, 2026-W43
let n = 0;
const it_ = (date: string, extra: Partial<ImportantItem> = {}): ImportantItem => ({
  id: `i${++n}`,
  date,
  categoryId: "c",
  categoryName: "업무 가",
  categoryColor: "c1",
  categoryOrder: 1,
  categoryEnded: false,
  seq: 1,
  depth: 0,
  text: `기록 ${n}`,
  parentText: null,
  flagDoneAt: null,
  ...extra,
});

describe("중요 업무 묶음", () => {
  it("지난 날짜 → 오늘 → 이번 주 → 다음 주 이후, 빈 묶음은 없음", () => {
    const items = [it_("2026-10-26"), it_("2026-10-25"), it_(TODAY), it_("2026-10-19"), it_("2026-09-30")];
    const g = groupImportant(items, TODAY);
    expect(g.map((x) => x.key)).toEqual(["late", "today", "thisWeek", "later"]);
    expect(g[0]!.items.map((x) => x.date)).toEqual(["2026-09-30", "2026-10-19"]);
    expect(g[2]!.items.map((x) => x.date)).toEqual(["2026-10-25"]); // 이번 주 일요일까지
    expect(g[3]!.items.map((x) => x.date)).toEqual(["2026-10-26"]); // 다음 주 월요일부터
    expect(groupImportant([it_("2026-11-02")], TODAY).map((x) => x.key)).toEqual(["later"]);
    expect(groupImportant([], TODAY)).toEqual([]);
  });

  it("같은 날은 업무 순서 → 칸 안 순서", () => {
    const a = it_(TODAY, { categoryOrder: 2, seq: 1 });
    const b = it_(TODAY, { categoryOrder: 1, seq: 3 });
    const c = it_(TODAY, { categoryOrder: 1, seq: 2 });
    expect(groupImportant([a, b, c], TODAY)[0]!.items).toEqual([c, b, a]);
  });

  it("묶음 안은 업무로 묶는다 — 업무 순서 = 보드 순서, 업무 안은 날짜 → 칸 안 순서(improve-1026v2-spec 8절)", () => {
    const x1 = it_("2026-10-24", { categoryId: "b", categoryName: "업무 나", categoryOrder: 2, seq: 1 });
    const x2 = it_("2026-10-23", { categoryId: "a", categoryName: "업무 가", categoryOrder: 1, seq: 5 });
    const x3 = it_("2026-10-23", { categoryId: "b", categoryName: "업무 나", categoryOrder: 2, seq: 1 });
    const x4 = it_("2026-10-25", { categoryId: "a", categoryName: "업무 가", categoryOrder: 1, seq: 1 });
    const x5 = it_("2026-10-23", { categoryId: "a", categoryName: "업무 가", categoryOrder: 1, seq: 2 });
    const [g] = groupImportant([x1, x2, x3, x4, x5], TODAY);
    expect(g!.key).toBe("thisWeek");
    expect(g!.categories.map((c) => [c.name, c.items.length])).toEqual([
      ["업무 가", 3],
      ["업무 나", 2],
    ]);
    expect(g!.categories[0]!.items).toEqual([x5, x2, x4]);
    expect(g!.categories[1]!.items).toEqual([x3, x1]);
    // 펼친 항목 = 보이는 순서(↑↓ 이동 순서)
    expect(g!.items).toEqual([x5, x2, x4, x3, x1]);
  });

  it("업무 머리는 색·종료 여부를 함께 싣는다", () => {
    const e = it_(TODAY, {
      categoryId: "z",
      categoryName: "끝난 업무",
      categoryColor: "c4",
      categoryEnded: true,
    });
    const [g] = groupImportant([e], TODAY);
    expect(g!.categories).toEqual([{ id: "z", name: "끝난 업무", color: "c4", ended: true, items: [e] }]);
  });

  it("배지: 0건이면 숨김, 99 초과는 99+, 지난 날짜가 있으면 표시", () => {
    expect(importantBadge([], TODAY)).toEqual({ label: null, late: false });
    expect(importantBadge([it_(TODAY)], TODAY)).toEqual({ label: "1", late: false });
    expect(importantBadge([it_("2026-10-21")], TODAY).late).toBe(true);
    const many = Array.from({ length: 120 }, () => it_(TODAY));
    expect(importantBadge(many, TODAY).label).toBe("99+");
  });
});
