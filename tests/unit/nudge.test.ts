import { describe, expect, it } from "vitest";
import { nudgeCandidates, snoozeUntil, type NudgeInput } from "../../src/domain/nudge";
import type { Category, CategoryPeriod } from "../../src/domain/types";

const C = "2026-W43"; // 이번 주

function input(
  over: Partial<NudgeInput> & { periods?: CategoryPeriod[]; items?: Record<string, string[]> } = {},
): NudgeInput {
  const cats: Category[] = over.categories ?? [
    { id: "a", name: "a", color: "c1", sortOrder: 1, nudgeSnoozedUntil: null },
  ];
  const periods = over.periods ?? [{ id: "p", categoryId: "a", startDate: "2026-08-03", endDate: null }];
  const items = over.items ?? {};
  return {
    currentWeek: C,
    nudgeWeeks: over.nudgeWeeks ?? 3,
    categories: cats,
    periodsByCategory: new Map(cats.map((c) => [c.id, periods.filter((p) => p.categoryId === c.id)])),
    weeksWithAnyRecord: over.weeksWithAnyRecord ?? new Set(["2026-W40", "2026-W41", "2026-W42", "2026-W43"]),
    weeksWithItemsByCategory: new Map(Object.entries(items).map(([k, v]) => [k, new Set(v)])),
  };
}

describe("무기록 종료 제안 (data-spec 5절)", () => {
  it("지난 3주 기록 없음 → 제안", () => {
    expect(nudgeCandidates(input({ items: { a: ["2026-W39"] } }))).toEqual(["a"]);
  });

  it("지난 3주 중 하나라도 기록 → 제안 안 함", () => {
    expect(nudgeCandidates(input({ items: { a: ["2026-W41"] } }))).toEqual([]);
  });

  it("이번 주에 기록하면 제안 안 함", () => {
    expect(nudgeCandidates(input({ items: { a: ["2026-W43"] } }))).toEqual([]);
  });

  it("휴가 주(아무 기록 없는 주)는 셈에서 빠진다", () => {
    // W41·W42 휴가 → 셈 대상은 W40·W39·W38. W39에 기록이 있으면 제안 안 함.
    const any = new Set(["2026-W38", "2026-W39", "2026-W40", "2026-W43"]);
    expect(nudgeCandidates(input({ weeksWithAnyRecord: any, items: { a: ["2026-W39"] } }))).toEqual([]);
    expect(nudgeCandidates(input({ weeksWithAnyRecord: any, items: { a: ["2026-W36"] } }))).toEqual(["a"]);
  });

  it("셀 수 있는 주가 N개 미만이면 제안 안 함(12주 안)", () => {
    expect(nudgeCandidates(input({ weeksWithAnyRecord: new Set(["2026-W42", "2026-W43"]) }))).toEqual([]);
  });

  it("생성 직후 유예: 구간 시작이 셈 첫 주 월요일보다 늦으면 제안 안 함", () => {
    // 셈 주 W40~W42, W40 월요일 = 2026-09-28
    expect(
      nudgeCandidates(
        input({ periods: [{ id: "p", categoryId: "a", startDate: "2026-09-28", endDate: null }] }),
      ),
    ).toEqual(["a"]);
    expect(
      nudgeCandidates(
        input({ periods: [{ id: "p", categoryId: "a", startDate: "2026-10-05", endDate: null }] }),
      ),
    ).toEqual([]);
  });

  it("종료된 업무는 제안 안 함", () => {
    expect(
      nudgeCandidates(
        input({ periods: [{ id: "p", categoryId: "a", startDate: "2026-08-03", endDate: "2026-09-01" }] }),
      ),
    ).toEqual([]);
  });

  it("'유지' 후 N주 동안 침묵, 그 다음 주부터 다시", () => {
    const until = snoozeUntil("2026-W40", 3); // 2026-09-28 + 21일
    expect(until).toBe("2026-10-19");
    const snoozed = (d: string): Category[] => [
      { id: "a", name: "a", color: "c1", sortOrder: 1, nudgeSnoozedUntil: d },
    ];
    expect(nudgeCandidates(input({ categories: snoozed(until) }))).toEqual([]); // W43 월요일 = until → 아직 침묵
    expect(
      nudgeCandidates({
        ...input({ categories: snoozed(until) }),
        currentWeek: "2026-W44",
        weeksWithAnyRecord: new Set(["2026-W41", "2026-W42", "2026-W43"]),
      }),
    ).toEqual(["a"]);
  });

  it("nudgeWeeks = 0이면 끔", () => {
    expect(nudgeCandidates(input({ nudgeWeeks: 0 }))).toEqual([]);
  });
});
