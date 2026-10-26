// @vitest-environment node
// 활동 히트맵 계산(m3-s2-spec 3~5·8절): 범위·◀ ▶ 경계·열·칸 값·단계·모든 업무·기간 밖·오지 않은 날·표.
import { describe, expect, it } from "vitest";
import {
  columnSpans,
  dayLevel,
  heatColumns,
  heatGrid,
  heatRange,
  heatTable,
  itemLevel,
  type ActivityRow,
} from "../../src/domain/insights";
import type { CategoryPeriod } from "../../src/domain/types";

const TODAY = "2026-10-22"; // 목, W43
const act = (categoryId: string, date: string, mains: number, subs = 0, firstText: string | null = "글") =>
  ({ categoryId, date, mains, subs, firstText }) satisfies ActivityRow;
const period = (categoryId: string, startDate: string, endDate: string | null = null): CategoryPeriod => ({
  id: `${categoryId}-${startDate}`,
  categoryId,
  startDate,
  endDate,
});

describe("범위(3절)", () => {
  it("12주·일: 끝 = 이번 주, 처음 = 11주 전 월요일, ▶는 이번 주에서 멈춤", () => {
    const r = heatRange("day", null, TODAY, "2026-01-05");
    expect(r).toMatchObject({
      anchor: "2026-W43",
      from: "2026-08-03",
      to: "2026-10-25",
      label: "2026-W32 ~ W43",
      prev: "2026-W31",
      next: null,
    });
    const back = heatRange("day", "2026-W31", TODAY, "2026-01-05");
    expect(back.label).toBe("2026-W20 ~ W31");
    expect(back.next).toBe("2026-W43");
    // 이번 주를 넘는 기준은 이번 주로
    expect(heatRange("day", "2027-W10", TODAY).anchor).toBe("2026-W43");
    // 이번 주 직전에서 ▶ = 이번 주로(12주를 다 못 가도)
    expect(heatRange("day", "2026-W40", TODAY).next).toBe("2026-W43");
  });

  it("◀는 첫 기록 주보다 1년 넘게 앞으로 가지 않는다(기록 없으면 이번 주 기준)", () => {
    expect(heatRange("day", "2025-W45", TODAY, "2026-09-01").prev).toBeNull(); // 2025-W33 < 2025-W36
    expect(heatRange("day", "2025-W50", TODAY, "2026-09-01").prev).toBe("2025-W38");
    expect(heatRange("day", "2025-W50", TODAY, null).prev).toBeNull(); // 한계 2025-W43
  });

  it("연간·주: ISO 연도 W01~W53, 해를 넘는 머리, ▶는 올해에서 멈춤", () => {
    const r = heatRange("week", null, TODAY, "2025-03-02");
    expect(r).toMatchObject({
      anchor: "2026",
      from: "2025-12-29",
      to: "2027-01-03",
      label: "2026년 (53주)",
      prev: "2025",
      next: null,
    });
    const y25 = heatRange("week", "2025", TODAY, "2025-03-02");
    expect(y25.label).toBe("2025년 (52주)");
    expect(y25.next).toBe("2026");
    expect(y25.prev).toBe("2024");
    expect(heatRange("week", "2024", TODAY, "2025-03-02").prev).toBeNull();
  });

  it("일 범위가 해를 넘으면 머리에 연도를 둘 다", () => {
    expect(heatRange("day", "2026-W05", TODAY, "2025-01-01").label).toBe("2025-W46 ~ 2026-W05");
  });
});

describe("열(4-1·5절)", () => {
  it("일: 84열, 토·일 표시, 오늘·오지 않은 날, 연차·반차, 달·주 머리", () => {
    const cols = heatColumns(heatRange("day", null, TODAY), TODAY, {
      "2026-10-21": "leave",
      "2026-10-16": "half_pm",
    });
    expect(cols).toHaveLength(84);
    expect(cols.filter((c) => c.weekend)).toHaveLength(24);
    expect(cols.find((c) => c.current)?.key).toBe(TODAY);
    expect(cols.filter((c) => c.future).map((c) => c.key)).toEqual([
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
    ]);
    expect(cols.find((c) => c.key === "2026-10-21")?.mark).toBe("leave");
    expect(cols.find((c) => c.key === "2026-10-16")?.mark).toBe("half_pm");
    expect(columnSpans(cols, (c) => c.month)).toEqual([
      { key: "2026-08", count: 29 },
      { key: "2026-09", count: 30 },
      { key: "2026-10", count: 25 },
    ]);
    const weeks = columnSpans(cols, (c) => c.week);
    expect(weeks).toHaveLength(12);
    expect(weeks.every((w) => w.count === 7)).toBe(true);
  });

  it("주: 53열, 달 = 목요일의 달, 이번 주, 오지 않은 주", () => {
    const cols = heatColumns(heatRange("week", null, TODAY), TODAY);
    expect(cols).toHaveLength(53);
    expect(cols[0]).toMatchObject({ key: "2026-W01", month: "2026-01" });
    expect(cols.find((c) => c.current)?.key).toBe("2026-W43");
    expect(cols.filter((c) => c.future)[0]?.key).toBe("2026-W44");
    expect(cols.at(-1)?.month).toBe("2026-12");
  });
});

describe("단계", () => {
  it("일 = 0·1·2~3·4~5·6+, 주 = dayLevel(경과 지도와 같음)", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 9].map(itemLevel)).toEqual([0, 1, 2, 2, 3, 3, 4, 4]);
    expect([0, 1, 2, 3, 4, 5, 7].map(dayLevel)).toEqual([0, 1, 2, 3, 3, 4, 4]);
  });
});

describe("격자(4-2·4-3·5절)", () => {
  const periods = [
    period("a", "2026-01-05"),
    period("b", "2026-10-05"),
    period("c", "2026-06-01", "2026-07-31"),
  ];
  const activity = [
    act("a", "2026-10-20", 3, 2, "배치 스케줄러 설계안"),
    act("b", "2026-10-20", 2),
    act("a", "2026-10-19", 1),
    act("a", "2026-10-06", 0, 1, null), // 세부만
    act("b", "2026-10-30", 1), // 미리 적은 기록(이번 주 뒤)
    act("x", "2026-10-20", 9), // 고르지 않은 업무
  ];

  it("일: 본 항목만 세고, 모든 업무 = 보이는 업무 합, 행 끝 기록 일수", () => {
    const cols = heatColumns(heatRange("day", null, TODAY), TODAY);
    const rows = heatGrid(activity, ["a", "b", "c"], periods, cols, "day");
    expect(rows.map((r) => r.categoryId)).toEqual([null, "a", "b", "c"]);
    const at = (r: number, d: string) => rows[r]!.cells.find((c) => c.key === d)!;
    expect(at(1, "2026-10-20")).toMatchObject({
      value: 3,
      level: 2,
      mains: 3,
      subs: 2,
      firstText: "배치 스케줄러 설계안",
    });
    expect(at(0, "2026-10-20")).toMatchObject({
      value: 5,
      level: 3,
      parts: [
        { categoryId: "a", value: 3 },
        { categoryId: "b", value: 2 },
      ],
    });
    // 세부만 있는 날 = 값 0이지만 기록한 날
    expect(at(1, "2026-10-06")).toMatchObject({ value: 0, level: 0, days: 1, outside: false });
    expect(rows[1]!.recordedDays).toBe(3);
    expect(rows[0]!.recordedDays).toBe(3);
    // 기간 밖: b는 10/5 시작, c는 7/31 종료 — 기록 없는 칸은 빗금
    expect(at(2, "2026-10-01").outside).toBe(true);
    expect(at(2, "2026-10-05").outside).toBe(false);
    expect(rows[3]!.cells.every((c) => c.outside)).toBe(true);
    // 기록이 없어도 행은 남는다
    expect(rows[3]!.recordedDays).toBe(0);
    // 오지 않은 날
    expect(at(1, "2026-10-23")).toMatchObject({ future: true, value: 0 });
    expect(at(0, "2026-10-23").future).toBe(true);
  });

  it("미리 적은 미래 기록은 값대로 칠한다", () => {
    const cols = heatColumns(heatRange("day", null, "2026-10-28"), "2026-10-28");
    const rows = heatGrid(activity, ["b"], periods, cols, "day");
    expect(rows[1]!.cells.find((c) => c.key === "2026-10-30")).toMatchObject({ value: 1, future: false });
  });

  it("주: 기록한 날 수 → dayLevel, 모든 업무 = 무엇이든 기록한 날", () => {
    const cols = heatColumns(heatRange("week", null, TODAY), TODAY);
    const rows = heatGrid(activity, ["a", "b"], periods, cols, "week");
    const w43 = (r: number) => rows[r]!.cells.find((c) => c.key === "2026-W43")!;
    expect(w43(1)).toMatchObject({ value: 2, level: 2, mains: 4, subs: 2 });
    expect(w43(2)).toMatchObject({ value: 1, mains: 2 });
    expect(w43(0)).toMatchObject({ value: 2, mains: 6 });
    expect(rows[2]!.cells.find((c) => c.key === "2026-W30")!.outside).toBe(true);
    expect(rows[2]!.cells.find((c) => c.key === "2026-W41")!.outside).toBe(false);
    expect(rows[1]!.cells.find((c) => c.key === "2026-W45")!.future).toBe(true);
    // 미리 적은 W44 기록
    expect(rows[2]!.cells.find((c) => c.key === "2026-W44")).toMatchObject({ value: 1, future: false });
  });

  it("표: 일 = 업무 × 주(본 항목·기록한 날), 주 = 업무 × 달 + 합계, 기간 밖 묶음", () => {
    const dcols = heatColumns(heatRange("day", null, TODAY), TODAY);
    const d = heatTable(heatGrid(activity, ["a", "c"], periods, dcols, "day"), dcols, "day");
    expect(d.head).toHaveLength(12);
    expect(d.head.at(-1)).toBe("2026-W43");
    expect(d.body[1]!.cells.at(-1)).toEqual({ mains: 4, days: 2, outside: false });
    expect(d.body[1]!.total).toEqual({ mains: 4, days: 3, outside: false });
    expect(d.body[2]!.cells.every((c) => c.outside)).toBe(true);
    const wcols = heatColumns(heatRange("week", null, TODAY), TODAY);
    const w = heatTable(heatGrid(activity, ["c"], periods, wcols, "week"), wcols, "week");
    expect(w.head).toHaveLength(12);
    expect(w.body[1]!.cells.map((c) => c.outside)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      true,
      true,
      true,
      true,
      true,
    ]);
  });
});
