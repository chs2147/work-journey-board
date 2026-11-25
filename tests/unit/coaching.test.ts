// 앱 안 코칭(coaching-spec 11절): 예시 일지 날짜 이동·투어 정의·메뉴 상태·레일 점. 가상 샘플만.
import { describe, expect, it } from "vitest";
import {
  SAMPLE_ANCHOR,
  sampleWeekShift,
  shiftDateText,
  shiftSampleDates,
} from "../../src/domain/coachingSample";
import { COACH, type TourId } from "../../src/shared/coachingStrings";
import { TOURS, tourById } from "../../src/ui/coaching/tours";
import { railDot, tourStatus } from "../../src/ui/coaching/coachingStore";
import type { CoachingFlags } from "../../src/platform";

const at = (s: string) => new Date(`${s}T09:00:00`);
const dow = (d: string) => new Date(`${d}T00:00:00`).getDay();

describe("예시 일지 날짜 이동", () => {
  it("기준 주(2026-W43)면 0, 다음 주면 1", () => {
    expect(sampleWeekShift(at(SAMPLE_ANCHOR))).toBe(0);
    expect(sampleWeekShift(at("2026-10-19"))).toBe(0);
    expect(sampleWeekShift(at("2026-10-25"))).toBe(0);
    expect(sampleWeekShift(at("2026-10-26"))).toBe(1);
    expect(sampleWeekShift(at("2026-11-25"))).toBe(5);
  });

  it("요일을 지키며 주 단위로 옮긴다 — 연도 경계 포함", () => {
    const w = sampleWeekShift(at("2027-01-06")); // 2027-W01 수요일
    const moved = shiftDateText(SAMPLE_ANCHOR, w);
    expect(dow(moved)).toBe(dow(SAMPLE_ANCHOR));
    expect(moved).toBe("2027-01-07");
    expect(shiftDateText("2026-W43", w)).toBe("2027-W01");
    expect(shiftDateText("2026-W52", 1)).toBe("2026-W53");
    expect(shiftDateText("2026-W53", 1)).toBe("2027-W01");
  });

  it("날짜·시각 문자열은 날짜 부분만, 다른 글은 그대로", () => {
    expect(shiftDateText("2026-10-22T08:30:00.000Z", 2)).toBe("2026-11-05T08:30:00.000Z");
    expect(shiftDateText("2026-10-22 09:15", 1)).toBe("2026-10-29 09:15");
    expect(shiftDateText("회의 2026-10-22 정리", 3)).toBe("회의 2026-10-22 정리");
    expect(shiftDateText("2026-13-45", 1)).toBe("2026-13-45");
    expect(shiftDateText("2026-10-22", 0)).toBe("2026-10-22");
  });

  it("자료 전체에서 값만 옮기고 키·숫자·원본은 그대로", () => {
    const src = { "2026-10-22": { date: "2026-10-22", n: 3, list: ["2026-W43", "글"] } };
    const out = shiftSampleDates(src, 1);
    expect(out).toEqual({ "2026-10-22": { date: "2026-10-29", n: 3, list: ["2026-W44", "글"] } });
    expect(src["2026-10-22"].date).toBe("2026-10-22");
  });
});

describe("투어 정의", () => {
  const ids = Object.keys(COACH.tours) as TourId[];

  it("T0~T8이 한 번씩, 정의와 글의 단계 수가 같다", () => {
    expect(TOURS.map((t) => t.id)).toEqual([
      "T0",
      "T1",
      "T2",
      "T3",
      "T4",
      "T5",
      "T6",
      "T7",
      "T8",
      "T9",
      "T10",
    ]);
    expect(ids.sort()).toEqual(TOURS.map((t) => t.id).sort());
    for (const t of TOURS) {
      expect(COACH.tours[t.id].steps.length, t.id).toBe(t.steps.length);
      expect(t.v, t.id).toBeGreaterThanOrEqual(1);
    }
  });

  it("글은 짧게 — 제목 20자·본문 90자 안, 빈 글 없음", () => {
    for (const id of ids)
      for (const [i, s] of COACH.tours[id].steps.entries()) {
        expect(s.title.trim().length, `${id}-${i + 1}`).toBeGreaterThan(0);
        expect(s.title.length, `${id}-${i + 1}`).toBeLessThanOrEqual(20);
        expect(s.body.length, `${id}-${i + 1}`).toBeLessThanOrEqual(90);
      }
  });

  it("직접 눌러 보기 단계는 대상이 있다", () => {
    for (const t of TOURS) for (const s of t.steps) if (s.tap) expect(s.target, t.id).not.toBeNull();
  });

  it("화면 투어는 화면별 제안 칩과 짝이 맞는다", () => {
    expect(tourById("T4").screen).toBe("kanban");
    expect(tourById("T5").screen).toBe("insights");
    expect(tourById("T6").screen).toBe("universe");
    expect(tourById("T8").screen).toBe("cabinet");
  });

  it("업무노트·업무 메모보드 투어는 그 별도 창 안에서(coaching-spec 13절)", () => {
    expect(tourById("T9").win).toBe("note");
    expect(tourById("T10").win).toBe("board");
    expect(TOURS.filter((t) => t.win).map((t) => t.id)).toEqual(["T9", "T10"]);
    // 창 안 투어는 메인 창 화면을 바꾸지 않는다(before 없이 시작)
    expect(tourById("T9").steps[0]!.before).toBeUndefined();
    expect(tourById("T10").steps[0]!.before).toBeUndefined();
  });
});

describe("메뉴 상태·레일 점", () => {
  const base: CoachingFlags = { existingUser: true, done: {}, seenScreens: [], suggest: true };

  it("본 적 없음 → 이어서 → 완료 → 새 단계", () => {
    expect(tourStatus(base, "T2")).toEqual({ kind: "none" });
    expect(tourStatus({ ...base, progress: { tour: "T2", step: 3 } }, "T2")).toEqual({
      kind: "progress",
      step: 4,
      total: tourById("T2").steps.length,
    });
    expect(tourStatus({ ...base, done: { T2: tourById("T2").v } }, "T2")).toEqual({ kind: "done" });
    expect(tourStatus({ ...base, done: { T2: 0 } }, "T2")).toEqual({ kind: "new", n: tourById("T2").v });
  });

  it("레일 점: 메뉴를 연 적 없고 본 투어가 없을 때, 또는 본 투어에 새 단계", () => {
    expect(railDot(null)).toBe(false);
    expect(railDot(base)).toBe(true);
    expect(railDot({ ...base, menuOpened: true })).toBe(false);
    expect(railDot({ ...base, done: { T0: tourById("T0").v } })).toBe(false);
    expect(railDot({ ...base, menuOpened: true, done: { T0: 0 } })).toBe(true);
  });
});
