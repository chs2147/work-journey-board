// 휴일 설정·국내 공휴일(features-1102-spec F2·F3): 내장 표(개수·표본·대체공휴일), 해석 규칙(회사 휴일·끈 날짜·우선순위),
// 집계 한 줄 이름, 설정 검사, 저장소(직접 표시 > 회사 휴일 > 내장, 근무로 돌리면 끈 날짜에 추가).
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, mergeSettings } from "../../src/data/settings";
import { dayMarkLine, isOffDay, markText } from "../../src/domain/dayMark";
import { HOLIDAY_YEARS, KR_HOLIDAYS, krHolidaysBetween, resolveHolidays } from "../../src/domain/holidaysKr";
import { freshRepo } from "./helpers";

const H = DEFAULT_SETTINGS.holiday;

describe("내장 대한민국 공휴일 표", () => {
  it("연도 범위 2026~2030, 해마다 15~21일, 날짜 오름차순·형식", () => {
    expect(HOLIDAY_YEARS).toEqual([2026, 2030]);
    for (let y = 2026; y <= 2030; y++) {
      const n = KR_HOLIDAYS.filter((h) => h.date.startsWith(`${y}-`)).length;
      expect(n, String(y)).toBeGreaterThanOrEqual(15);
      expect(n, String(y)).toBeLessThanOrEqual(21);
    }
    const dates = KR_HOLIDAYS.map((h) => h.date);
    expect([...dates].sort()).toEqual(dates);
    expect(dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))).toBe(true);
  });

  it("2026 표본: 설날 연휴 2/16~18, 대체공휴일 3/2·5/25·8/17·10/5, 추석 9/24~26, 지방선거 6/3", () => {
    const y = krHolidaysBetween("2026-01-01", "2026-12-31");
    expect(["2026-02-16", "2026-02-17", "2026-02-18"].every((d) => y[d])).toBe(true);
    expect(y["2026-02-17"]!.name).toBe("설날");
    for (const d of ["2026-03-02", "2026-05-25", "2026-08-17", "2026-10-05"])
      expect(y[d]!.type, d).toBe("substitute");
    expect(["2026-09-24", "2026-09-25", "2026-09-26"].every((d) => y[d])).toBe(true);
    expect(y["2026-06-03"]).toMatchObject({ type: "election" });
    expect(y["2026-06-06"]!.name).toBe("현충일"); // 토요일 — 현충일은 대체공휴일 없음
    expect(y["2026-06-08"]).toBeUndefined();
  });

  it("겹치는 날은 이름을 잇는다(2028-10-03 추석·개천절) · 설날이 일요일과 겹치면 대체(2027-02-09)", () => {
    expect(krHolidaysBetween("2028-10-03", "2028-10-03")["2028-10-03"]!.name).toBe("추석 · 개천절");
    expect(krHolidaysBetween("2027-02-09", "2027-02-09")["2027-02-09"]!.type).toBe("substitute");
  });
});

describe("휴일 해석·표시 이름", () => {
  it("켜기/끄기·끈 날짜·회사 휴일(매년·그 해만)·회사 휴일이 내장보다 우선", () => {
    const wk = (s: typeof H) => resolveHolidays("2026-10-05", "2026-10-11", s);
    expect(Object.keys(wk(H))).toEqual(["2026-10-05", "2026-10-09"]);
    expect(wk({ ...H, krEnabled: false })).toEqual({});
    expect(Object.keys(wk({ ...H, off: ["2026-10-09"] }))).toEqual(["2026-10-05"]);
    const c = wk({
      ...H,
      company: [
        { date: "10-07", name: "창립기념일" },
        { date: "2026-10-09", name: "종무" },
      ],
    });
    expect(c["2026-10-07"]).toEqual({ name: "창립기념일", source: "company" });
    expect(c["2026-10-09"]).toEqual({ name: "종무", source: "company" });
    expect(
      resolveHolidays("2027-10-07", "2027-10-07", { ...H, company: [{ date: "10-07", name: "창립기념일" }] }),
    ).toHaveProperty("2027-10-07");
  });

  it("집계 한 줄: 연차·반차 → 공휴일(이름) → 기타 휴가(사유), 같은 이름끼리 묶음 · 쉬는 날 판정", () => {
    expect(
      dayMarkLine([
        { date: "2026-10-07", kind: "other", label: "야유회" },
        { date: "2026-10-09", kind: "holiday", label: "한글날" },
        { date: "2026-10-05", kind: "holiday", label: null },
        { date: "2026-10-06", kind: "leave" },
      ]),
    ).toBe("※ 연차: 화(10/6) · 공휴일: 월(10/5) · 한글날: 금(10/9) · 야유회: 수(10/7)");
    expect(markText("other", "  ")).toBe("휴가");
    expect(markText("leave", "무시")).toBe("연차");
    expect([isOffDay("holiday"), isOffDay("other"), isOffDay("half_am"), isOffDay(null)]).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it("설정 검사: 잘못된 회사 휴일 날짜·빈 사유·중복은 버림, 끈 날짜는 날짜 형식만", () => {
    const s = mergeSettings(DEFAULT_SETTINGS, {
      holiday: {
        krEnabled: "yes",
        off: ["2026-10-09", "bad"],
        company: [{ date: "13-01", name: "x" }, { date: "04-01", name: " 창립 " }, { date: 3 }],
        reasons: ["공가", " ", "공가", "교육"],
      },
    });
    expect(s.holiday).toEqual({
      krEnabled: true,
      off: ["2026-10-09"],
      company: [{ date: "04-01", name: "창립" }],
      reasons: ["공가", "교육"],
    });
  });
});

describe("저장소 — 휴일 표시", () => {
  it("직접 표시 > 회사 휴일 > 내장 · 내장 공휴일을 근무로 = 끈 날짜 · 라벨 저장", async () => {
    const { repo } = await freshRepo();
    let info = await repo.getDayMarkInfo("2026-10-05", "2026-10-11");
    expect(info["2026-10-09"]).toEqual({ kind: "holiday", label: "한글날", source: "builtin" });
    await repo.setDayMark("2026-10-07", "other", "야유회");
    await repo.setDayMark("2026-10-09", null); // 회사가 쉬지 않는 공휴일
    info = await repo.getDayMarkInfo("2026-10-05", "2026-10-11");
    expect(info["2026-10-07"]).toEqual({ kind: "other", label: "야유회", source: "user" });
    expect(info["2026-10-09"]).toBeUndefined();
    expect((await repo.getSettings()).holiday.off).toEqual(["2026-10-09"]);
    await repo.setDayMark("2026-10-05", "leave", "버림");
    expect((await repo.getDayMarkInfo("2026-10-05", "2026-10-05"))["2026-10-05"]).toEqual({
      kind: "leave",
      label: null,
      source: "user",
    });
    const week = await repo.getWeek("2026-W41");
    expect(week.dayMarks).toMatchObject({ "2026-10-05": "leave", "2026-10-07": "other" });
  });
});
