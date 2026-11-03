import { describe, expect, it } from "vitest";
import {
  compareByTime,
  defaultStartTime,
  isStartTime,
  parseTimeInput,
  snap15,
  stepTime,
} from "../../src/domain/startTime";

describe("시작 시각(improve-1103v8-spec T1)", () => {
  it("형식: 'HH:MM', 분은 15분 단위만", () => {
    for (const ok of ["00:00", "09:15", "10:30", "23:45"]) expect(isStartTime(ok)).toBe(true);
    for (const bad of ["24:00", "9:00", "10:10", "10:00:00", "", null, 930])
      expect(isStartTime(bad)).toBe(false);
  });
  it("키보드 입력 → 15분 내림", () => {
    expect(parseTimeInput("1430")).toBe("14:30");
    expect(parseTimeInput("14:37")).toBe("14:30");
    expect(parseTimeInput("930")).toBe("09:30");
    expect(parseTimeInput("9:05")).toBe("09:00");
    expect(parseTimeInput("9")).toBe("09:00");
    expect(parseTimeInput(" 14 ")).toBe("14:00");
    for (const bad of ["2500", "24", "abc", "1:2", "12345", ""]) expect(parseTimeInput(bad)).toBeNull();
    expect(snap15(23, 59)).toBe("23:45");
  });
  it("15분씩 앞뒤(자정에서 돌아감)", () => {
    expect(stepTime("10:00", 1)).toBe("10:15");
    expect(stepTime("10:00", -1)).toBe("09:45");
    expect(stepTime("23:45", 1)).toBe("00:00");
    expect(stepTime("00:00", -1)).toBe("23:45");
  });
  it("처음 값: 오늘이면 지금 다음 15분, 아니면 09:00", () => {
    expect(defaultStartTime(false, new Date(2026, 9, 22, 13, 5))).toBe("09:00");
    expect(defaultStartTime(true, new Date(2026, 9, 22, 13, 5))).toBe("13:15");
    expect(defaultStartTime(true, new Date(2026, 9, 22, 13, 15))).toBe("13:30");
    expect(defaultStartTime(true, new Date(2026, 9, 22, 23, 50))).toBe("23:45");
  });
  it("정렬: 시각 있는 것 이른 순, 없는 것은 뒤", () => {
    const xs = [null, "14:00", undefined, "09:30"].sort(compareByTime);
    expect(xs.slice(0, 2)).toEqual(["09:30", "14:00"]);
  });
});
