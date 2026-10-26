// @vitest-environment node
// 연차·반차 표시(improve-1026-spec 1절): 자동 집계 줄·무기록 판정 예외·저장소 저장/해제.
import { describe, expect, it } from "vitest";
import { buildWeeklySummary, type SummaryInput } from "../../src/domain/aggregate";
import { dayMarkLine, isLeaveWeek } from "../../src/domain/dayMark";
import { nudgeCandidates } from "../../src/domain/nudge";
import { uuidv7 } from "../../src/data/ids";
import { ValidationError } from "../../src/data/repository";
import { freshRepo } from "./helpers";

describe("자동 집계 연차 줄", () => {
  it("종류 순서(연차 → 오전 → 오후), 날짜순, 같은 종류는 쉼표", () => {
    expect(
      dayMarkLine([
        { date: "2026-10-29", kind: "half_pm" },
        { date: "2026-10-28", kind: "leave" },
        { date: "2026-10-27", kind: "leave" },
        { date: "2026-10-30", kind: "half_am" },
      ]),
    ).toBe("※ 연차: 화(10/27), 수(10/28) · 오전 반차: 금(10/30) · 오후 반차: 목(10/29)");
    expect(dayMarkLine([])).toBeNull();
  });

  const input = (over: Partial<SummaryInput> = {}): SummaryInput => ({
    weekId: "2026-W44",
    categories: [
      { id: "a", name: "가상 업무 A" },
      { id: "b", name: "가상 업무 B" },
    ],
    items: [{ date: "2026-10-26", categoryId: "a", depth: 0, text: "가상 기록" }],
    memo: "",
    ...over,
  });

  it("표시가 없으면 예전과 글자 하나 다르지 않고, 있으면 기록 없음 줄 바로 위", () => {
    expect(buildWeeklySummary(input(), { includeMemo: true })).toBe(
      buildWeeklySummary(input({ dayMarks: [] }), { includeMemo: true }),
    );
    expect(
      buildWeeklySummary(input({ dayMarks: [{ date: "2026-10-27", kind: "leave" }] }), { includeMemo: true }),
    ).toBe(
      [
        "[주간 업무 요약] 2026-W44 (10/26~11/01)",
        "",
        "■ 가상 업무 A",
        "- (월) 가상 기록",
        "",
        "※ 연차: 화(10/27)",
        "※ 이번 주 기록 없음: 가상 업무 B",
      ].join("\n"),
    );
  });
});

describe("무기록 판정: 근무일이 모두 연차인 주는 셈에서 뺀다", () => {
  const leave = new Set(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);

  it("월~금 모두 연차여야 휴가 주", () => {
    expect(isLeaveWeek("2026-W42", leave)).toBe(true);
    expect(isLeaveWeek("2026-W42", new Set([...leave].slice(1)))).toBe(false);
  });

  it("휴가 주에 메모 등 기록이 있어도 셈 대상이 아니다", () => {
    const base = {
      currentWeek: "2026-W43",
      nudgeWeeks: 3,
      categories: [{ id: "a", name: "a", color: "c1" as const, sortOrder: 1, nudgeSnoozedUntil: null }],
      periodsByCategory: new Map([
        ["a", [{ id: "p", categoryId: "a", startDate: "2026-08-03", endDate: null }]],
      ]),
      // W42(휴가 주)에도 메모가 있어 "기록한 주"로 잡히지만, W39에 업무 기록이 있다
      weeksWithAnyRecord: new Set(["2026-W39", "2026-W40", "2026-W41", "2026-W42"]),
      weeksWithItemsByCategory: new Map([["a", new Set(["2026-W39"])]]),
    };
    expect(nudgeCandidates(base)).toEqual(["a"]); // 셈 = W42·W41·W40 → 제안
    expect(nudgeCandidates({ ...base, leaveWeeks: new Set(["2026-W42"]) })).toEqual([]); // 셈 = W41·W40·W39
  });
});

describe("저장소: 날짜 표시", () => {
  it("저장·바꾸기·근무로(행 삭제), 주 보기에 실린다", async () => {
    const { repo, db } = await freshRepo();
    await repo.setDayMark("2026-10-27", "leave");
    await repo.setDayMark("2026-10-28", "half_am");
    await repo.setDayMark("2026-10-28", "half_pm");
    expect((await repo.getWeek("2026-W44")).dayMarks).toEqual({
      "2026-10-27": "leave",
      "2026-10-28": "half_pm",
    });
    await repo.setDayMark("2026-10-27", null);
    expect(await db.select("SELECT date, kind FROM day_mark")).toEqual([
      { date: "2026-10-28", kind: "half_pm" },
    ]);
    await expect(repo.setDayMark("10/27", "leave")).rejects.toBeInstanceOf(ValidationError);
    // @ts-expect-error 알 수 없는 종류
    await expect(repo.setDayMark("2026-10-27", "sick")).rejects.toBeInstanceOf(ValidationError);
  });

  it("주간 요약 입력에 연차 줄이 들어간다", async () => {
    const { repo } = await freshRepo();
    const c = await repo.createCategory("가상 업무", "2026-W44");
    await repo.saveCell("2026-10-26", c.id, [{ id: uuidv7(), depth: 0, text: "가상 기록" }]);
    await repo.setDayMark("2026-10-30", "leave");
    const input = await repo.getSummaryInput("2026-W44");
    expect(buildWeeklySummary(input, { includeMemo: true })).toContain("※ 연차: 금(10/30)");
  });

  it("무기록 판정: 휴가 주는 셈에서 빠진다", async () => {
    const { repo, clock } = await freshRepo();
    clock.set(2026, 10, 28); // W44
    const a = await repo.createCategory("가상 A", "2026-W36");
    const b = await repo.createCategory("가상 B", "2026-W36");
    // A: W40에만 기록, B: W41~W43 매주 기록 → 지난 3주(W41~W43) A는 0개 → 제안
    await repo.saveCell("2026-09-29", a.id, [{ id: uuidv7(), depth: 0, text: "가상 A 기록" }]);
    for (const d of ["2026-10-06", "2026-10-13", "2026-10-20"])
      await repo.saveCell(d, b.id, [{ id: uuidv7(), depth: 0, text: "가상 B 기록" }]);
    expect(await repo.getNudges("2026-W44")).toEqual([a.id]);
    // W42 전체 연차 → 셈 = W43·W41·W40 → A는 W40에 기록이 있어 제안 안 함
    for (const d of ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"])
      await repo.setDayMark(d, "leave");
    expect(await repo.getNudges("2026-W44")).toEqual([]);
  });
});
