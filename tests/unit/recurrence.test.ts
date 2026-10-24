// 매주 반복 규칙(important-repeat-spec 3절) — 순수 함수
import { describe, expect, it } from "vitest";
import {
  activeOn,
  groupRange,
  isDue,
  ruleDate,
  rulesToCreate,
  ruleTiming,
  type Recurrence,
} from "../../src/domain/recurrence";
import type { CategoryPeriod } from "../../src/domain/types";

const rule = (extra: Partial<Recurrence> = {}): Recurrence => ({
  id: "r1",
  categoryId: "c",
  weekday: 4, // 목
  startWeek: "2026-W44",
  endWeek: null,
  flagOnCreate: false,
  lines: [{ depth: 0, text: "주간업무 정리 보고서 작성" }],
  ...extra,
});
const period = (startDate: string, endDate: string | null = null): CategoryPeriod => ({
  id: "p",
  categoryId: "c",
  startDate,
  endDate,
});

describe("매주 반복", () => {
  it("묶음 범위: 세부 항목에서 눌러도 본 항목부터 딸린 세부 항목까지", () => {
    const items = [{ depth: 0 }, { depth: 1 }, { depth: 1 }, { depth: 0 }, { depth: 1 }] as const;
    expect(groupRange([...items], 0)).toEqual({ start: 0, end: 2 });
    expect(groupRange([...items], 2)).toEqual({ start: 0, end: 2 });
    expect(groupRange([...items], 3)).toEqual({ start: 3, end: 4 });
  });

  it("켤 때: 요일 = 그날, 시작 = 다음 주 — 연도 경계(W53 → 다음 해 W01)", () => {
    expect(ruleTiming("2026-10-22")).toEqual({ weekday: 4, startWeek: "2026-W44", originWeek: "2026-W43" });
    expect(ruleTiming("2026-12-31")).toEqual({ weekday: 4, startWeek: "2027-W01", originWeek: "2026-W53" });
    expect(ruleDate(rule(), "2027-W01")).toBe("2027-01-07");
  });

  it("해당 주: 시작 주 ~ 끝 주", () => {
    expect(isDue(rule(), "2026-W43")).toBe(false);
    expect(isDue(rule(), "2026-W44")).toBe(true);
    expect(isDue(rule({ endWeek: "2026-W45" }), "2026-W45")).toBe(true);
    expect(isDue(rule({ endWeek: "2026-W45" }), "2026-W46")).toBe(false);
  });

  it("업무 활성: 그날이 구간 안", () => {
    expect(activeOn([period("2026-10-01")], "2026-10-29")).toBe(true);
    expect(activeOn([period("2026-10-01", "2026-10-28")], "2026-10-29")).toBe(false);
    expect(activeOn([], "2026-10-29")).toBe(false);
  });

  it("만들 대상: 해당 주 · 업무 활성 · 그 주에 아직 안 만든 것만", () => {
    const periods = new Map([["c", [period("2026-10-01")]]]);
    expect(rulesToCreate([rule()], "2026-W44", new Set(), periods).map((r) => r.id)).toEqual(["r1"]);
    expect(rulesToCreate([rule()], "2026-W44", new Set(["r1"]), periods)).toEqual([]); // 이미 만든 주(지운 주 포함)
    expect(rulesToCreate([rule()], "2026-W43", new Set(), periods)).toEqual([]); // 시작 전
    const ended = new Map([["c", [period("2026-10-01", "2026-10-28")]]]);
    expect(rulesToCreate([rule()], "2026-W44", new Set(), ended)).toEqual([]); // 종료된 업무
  });
});
