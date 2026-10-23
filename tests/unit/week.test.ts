import { describe, expect, it } from "vitest";
import {
  addDays,
  addWeeks,
  dayIndex,
  weekDays,
  weekIdOf,
  weekStart,
  weekTitle,
  weeksInIsoYear,
  weeksOfIsoYear,
} from "../../src/domain/week";

describe("ISO 주차 경계 (data-spec 1-3)", () => {
  it.each([
    ["2025-12-29", "2026-W01"],
    ["2026-01-01", "2026-W01"],
    ["2026-01-04", "2026-W01"],
    ["2026-01-05", "2026-W02"],
    ["2026-12-27", "2026-W52"],
    ["2026-12-28", "2026-W53"],
    ["2027-01-03", "2026-W53"],
    ["2027-01-04", "2027-W01"],
    ["2028-02-29", "2028-W09"],
    ["2032-12-31", "2032-W53"],
  ])("%s → %s", (date, week) => {
    expect(weekIdOf(date)).toBe(week);
  });

  it("53주 연도: 2026·2032, 52주: 2027", () => {
    expect(weeksInIsoYear(2026)).toBe(53);
    expect(weeksInIsoYear(2032)).toBe(53);
    expect(weeksInIsoYear(2027)).toBe(52);
  });

  it("주의 월요일과 7일", () => {
    expect(weekStart("2026-W43")).toBe("2026-10-19");
    expect(weekStart("2026-W01")).toBe("2025-12-29");
    expect(weekDays("2026-W53")).toEqual([
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ]);
  });

  it("주 이동은 해를 넘나든다", () => {
    expect(addWeeks("2026-W53", 1)).toBe("2027-W01");
    expect(addWeeks("2026-W01", -1)).toBe("2025-W52");
    expect(addWeeks("2026-W43", -12)).toBe("2026-W31");
  });

  it("보드 제목 (data-spec 1-2)", () => {
    expect(weekTitle("2026-W43")).toBe("2026-W43 (10/19~10/25)");
    expect(weekTitle("2026-W44")).toBe("2026-W44 (10/26~11/01)");
    expect(weekTitle("2026-W53")).toBe("2026-W53 (2026/12/28~2027/01/03)");
  });

  it("요일 인덱스와 날짜 더하기", () => {
    expect(dayIndex("2026-10-19")).toBe(0);
    expect(dayIndex("2026-10-25")).toBe(6);
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("연간 미니맵: 주는 목요일이 속한 달에", () => {
    const weeks = weeksOfIsoYear(2026);
    expect(weeks).toHaveLength(53);
    expect(weeks[0]).toEqual({ weekId: "2026-W01", month: 1 }); // 목요일 2026-01-01
    expect(weeks[52]).toEqual({ weekId: "2026-W53", month: 12 }); // 목요일 2026-12-31
  });
});
