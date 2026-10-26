// @vitest-environment node
// 인사이트 계산(m3-s1-spec 2·4·5·7절, 4-0 경과 지도): 기간 범위·타임라인 줄·접기·구간·검색·경과 복사 골든·지도.
import { describe, expect, it } from "vitest";
import {
  buildTimeline,
  dayLevel,
  defaultMapUnit,
  foldBefore,
  journeyMap,
  journeySpan,
  mapNeedsYearRows,
  monthLevel,
  monthOf,
  monthSpans,
  periodRange,
  searchTimeline,
  splitMatches,
  timelineCounts,
  timelineText,
  type TimelineRow,
} from "../../src/domain/insights";
import type { NoteDoc } from "../../src/domain/note";
import type { CategoryPeriod, EntryItem } from "../../src/domain/types";

const TODAY = "2026-10-22"; // 목, W43
let n = 0;
const item = (date: string, text: string, extra: Partial<EntryItem> = {}): EntryItem => ({
  id: `i${++n}`,
  date,
  categoryId: "c",
  seq: n,
  depth: 0,
  text,
  ...extra,
});
const period = (startDate: string, endDate: string | null = null, id = `p${++n}`): CategoryPeriod => ({
  id,
  categoryId: "c",
  startDate,
  endDate,
});
const kinds = (rows: TimelineRow[]) =>
  rows.map((r) =>
    r.kind === "week"
      ? `${r.weekId}:${r.items.length}`
      : r.kind === "month"
        ? `[${r.month} ${r.weeks}w ${r.items}i]`
        : r.kind === "boundary"
          ? `${r.type}@${r.date}`
          : `${r.kind}:${r.fromWeek}..${r.toWeek}(${r.count})`,
  );

describe("기간 범위(2절)", () => {
  it("최근 4·12주·올해는 이번 주까지, 전체는 첫 구간·첫 기록 중 이른 주부터", () => {
    expect(periodRange({ kind: "12w" }, TODAY)).toEqual({ fromWeek: "2026-W32", toWeek: "2026-W43" });
    expect(periodRange({ kind: "4w" }, TODAY)).toEqual({ fromWeek: "2026-W40", toWeek: "2026-W43" });
    expect(periodRange({ kind: "year" }, TODAY)).toEqual({ fromWeek: "2026-W01", toWeek: "2026-W43" });
    expect(
      periodRange({ kind: "all" }, TODAY, { firstRecord: "2025-12-30", categoryStart: "2026-01-05" }),
    ).toEqual({ fromWeek: "2026-W01", toWeek: "2026-W43" }); // 2025-12-30(화)은 2026-W01
    expect(periodRange({ kind: "all" }, TODAY, { categoryStart: "2025-06-02" }).fromWeek).toBe("2025-W23");
  });

  it("이번 주 뒤에 미리 적은 기록이 있으면 그 주까지, 직접 지정은 그대로(순서 바로잡음)", () => {
    expect(periodRange({ kind: "12w" }, TODAY, { lastRecord: "2026-11-03" }).toWeek).toBe("2026-W45");
    expect(periodRange({ kind: "custom", from: "2026-W40", to: "2026-W30" }, TODAY)).toEqual({
      fromWeek: "2026-W30",
      toWeek: "2026-W40",
    });
  });
});

describe("달·접기 기준(4-2·4-6)", () => {
  it("주는 목요일이 속한 달, 연말 W01도 목요일 기준", () => {
    expect(monthOf("2026-W40")).toBe("2026-10"); // 9/28~10/4, 목 10/1
    expect(monthOf("2026-W31")).toBe("2026-07"); // 7/27~8/2, 목 7/30
    expect(monthOf("2026-W01")).toBe("2026-01"); // 2025-12-29~2026-01-04, 목 1/1
    expect(monthOf("2026-W53")).toBe("2026-12");
  });
  it("오늘이 든 달 포함 3개 달 — 그 앞을 접는다", () => {
    expect(foldBefore(TODAY)).toBe("2026-08");
    expect(foldBefore("2026-02-10")).toBe("2025-12");
  });
});

describe("타임라인 줄(4절)", () => {
  it("주 행·무기록 접힘(달을 넘지 않게)·달 머리 수, 시작 전 빈 주는 그리지 않음", () => {
    const rows = buildTimeline({
      items: [
        item("2026-08-25", "가"),
        item("2026-08-27", "나"),
        item("2026-09-01", "다"),
        item("2026-09-23", "라"),
        item("2026-10-20", "마"),
      ],
      periods: [period("2026-08-03")],
      span: { fromWeek: "2026-W30", toWeek: "2026-W43" },
      today: TODAY,
    });
    expect(kinds(rows)).toEqual([
      "[2026-08 4w 2i]",
      "start@2026-08-03",
      "gap:2026-W32..2026-W34(3)",
      "2026-W35:2",
      "[2026-09 4w 2i]",
      "2026-W36:1",
      "gap:2026-W37..2026-W38(2)",
      "2026-W39:1",
      "[2026-10 4w 1i]",
      "gap:2026-W40..2026-W42(3)",
      "2026-W43:1",
    ]);
    const cur = rows.at(-1)!;
    expect(cur.kind === "week" && cur.current).toBe(true);
    expect(timelineCounts(rows)).toEqual({ recordedWeeks: 4, activeWeeks: 12, items: 5 });
  });

  it("종료·재개: 구분선과 쉬는 구간, 마지막 종료 뒤 빈 주는 그리지 않음", () => {
    const rows = buildTimeline({
      items: [item("2026-03-02", "착수"), item("2026-03-24", "중간"), item("2026-10-05", "재개 작업")],
      periods: [period("2026-03-02", "2026-03-27"), period("2026-10-05", "2026-10-16")],
      span: { fromWeek: "2026-W10", toWeek: "2026-W43" },
      today: TODAY,
    });
    const k = kinds(rows);
    expect(k.slice(0, 6)).toEqual([
      "[2026-03 4w 2i]",
      "start@2026-03-02",
      "2026-W10:1",
      "gap:2026-W11..2026-W12(2)",
      "2026-W13:1",
      "end@2026-03-27",
    ]);
    expect(k[6]).toBe("rest:2026-W14..2026-W40(27)"); // 쉬는 구간은 달을 넘어 한 줄, 달 머리 없음
    expect(k).toHaveLength(12);
    expect(k.slice(-5)).toEqual([
      "[2026-10 2w 1i]",
      "resume@2026-10-05",
      "2026-W41:1",
      "gap:2026-W42..2026-W42(1)",
      "end@2026-10-16",
    ]);
  });

  it("★·↻·연차 칩·연결 메모를 싣는다", () => {
    const a = item("2026-10-20", "설계안 리뷰", { flagged: true });
    const b = item("2026-10-21", "반복 점검", { recurrenceId: "r1" });
    const notes: Record<string, NoteDoc> = {
      "2026-W43": {
        v: 1,
        boxes: [
          {
            id: "x",
            kind: "text",
            x: 0,
            y: 50,
            w: 300,
            z: 1,
            bg: null,
            ref: { item: a.id },
            content: {
              type: "doc",
              content: [{ type: "paragraph", content: [{ type: "text", text: "둘째" }] }],
            },
          },
          {
            id: "y",
            kind: "image",
            x: 0,
            y: 0,
            w: 200,
            z: 1,
            asset: "as",
            caption: "화면",
            ref: { item: a.id },
          },
          {
            id: "z",
            kind: "link",
            x: 0,
            y: 99,
            w: 200,
            z: 1,
            url: "https://a.example.local",
            title: "위키",
            note: "",
          },
        ],
      },
    };
    const rows = buildTimeline({
      items: [a, b],
      periods: [period("2026-10-01")],
      span: { fromWeek: "2026-W43", toWeek: "2026-W43" },
      today: TODAY,
      dayMarks: { "2026-10-23": "half_pm", "2026-10-19": "leave", "2026-10-26": "leave" },
      notes,
    });
    const week = rows[1]!;
    expect(week.kind).toBe("week");
    if (week.kind !== "week") return;
    expect(week.items.map((i) => [i.flagged, i.repeat, i.memos])).toEqual([
      [true, false, ["(이미지) 화면", "둘째"]],
      [false, true, []],
    ]);
    expect(week.marks).toEqual([
      { date: "2026-10-19", kind: "leave" },
      { date: "2026-10-23", kind: "half_pm" },
    ]);
  });
});

describe("검색(5절)", () => {
  const rows = buildTimeline({
    items: [
      item("2026-07-08", "현행 배포 절차"),
      item("2026-09-01", "요구사항"),
      item("2026-10-20", "Deploy 배포"),
    ],
    periods: [period("2026-07-06")],
    span: { fromWeek: "2026-W28", toWeek: "2026-W43" },
    today: TODAY,
  });
  it("부분 일치·대소문자·전각 무시, 일치한 주·달", () => {
    const r = searchTimeline(rows, "배포");
    expect(r.ids).toHaveLength(2);
    expect([...r.months]).toEqual(["2026-07", "2026-10"]);
    expect(searchTimeline(rows, "ＤＥＰＬＯＹ").ids).toHaveLength(1);
    expect(searchTimeline(rows, "  ").ids).toEqual([]);
  });
  it("강조용 나누기", () => {
    expect(splitMatches("현행 배포 절차, 배포", "배포")).toEqual([
      { text: "현행 ", hit: false },
      { text: "배포", hit: true },
      { text: " 절차, ", hit: false },
      { text: "배포", hit: true },
    ]);
    expect(splitMatches("Deploy", "deploy")).toEqual([{ text: "Deploy", hit: true }]);
  });
});

describe("경과 복사(7절) — 골든", () => {
  it("자동 집계와 같은 항목 표기, 무기록·쉬는 구간·구분선, 연결 메모 [메모]", () => {
    const a = item("2026-10-13", "배치 스케줄러 설계안 작성");
    const rows = buildTimeline({
      items: [
        item("2026-03-03", "이관 대상 목록 작성"),
        item("2026-03-03", "테이블 120개", { depth: 1 }),
        item("2026-10-12", "요구사항 2차 리뷰", { flagged: true }),
        a,
      ],
      periods: [period("2026-03-02", "2026-03-13"), period("2026-10-05")],
      span: { fromWeek: "2026-W10", toWeek: "2026-W43" },
      today: TODAY,
      notes: {
        "2026-W42": {
          v: 1,
          boxes: [
            {
              id: "m",
              kind: "text",
              x: 0,
              y: 0,
              w: 300,
              z: 1,
              bg: null,
              ref: { item: a.id },
              content: {
                type: "doc",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "후보 02~04시" }] },
                  { type: "paragraph", content: [{ type: "text", text: "운영팀 확인" }] },
                ],
              },
            },
          ],
        },
      },
    });
    const text = timelineText(rows, {
      name: "가상 정산 구축",
      span: { fromWeek: "2026-W10", toWeek: "2026-W43" },
      startDate: "2026-03-02",
      endDate: null,
    });
    expect(text).toBe(
      [
        "[업무 경과] 가상 정산 구축",
        "기간 2026-W10 ~ 2026-W43 (기록한 주 2 · 항목 4) · 2026-03-02 시작 · 진행 중",
        "",
        "── 시작 2026-03-02 ──",
        "",
        "■ 2026-W10 (3/2~3/8)",
        "- (화) 이관 대상 목록 작성",
        "  · 테이블 120개",
        "",
        "(2026-W11 기록 없음)",
        "",
        "── 종료 2026-03-13 ──",
        "",
        "(쉬는 구간 29주: 2026-W12~W40)",
        "",
        "── 재개 2026-10-05 ──",
        "",
        "(2026-W41 기록 없음)",
        "",
        "■ 2026-W42 (10/12~10/18)",
        "- (월) 요구사항 2차 리뷰",
        "- (화) 배치 스케줄러 설계안 작성",
        "  [메모] 후보 02~04시",
        "         운영팀 확인",
        "",
        "(2026-W43 기록 없음)",
      ].join("\n"),
    );
  });
});

describe("업무 경과 지도(4-0)", () => {
  const days = [
    { date: "2026-07-06", items: 2 },
    { date: "2026-07-07", items: 1 },
    { date: "2026-07-09", items: 3 },
    { date: "2026-10-20", items: 1 },
    { date: "2026-10-21", items: 4 },
  ];

  it("범위: 진행 중 = 시작 → 이번 주(뒤 기록이면 그 주), 종료 = 마지막 종료·기록 중 늦은 주", () => {
    expect(journeySpan([period("2026-07-06")], days, TODAY)).toEqual({
      fromWeek: "2026-W28",
      toWeek: "2026-W43",
    });
    expect(journeySpan([period("2026-07-06")], [...days, { date: "2026-11-10" }], TODAY)!.toWeek).toBe(
      "2026-W46",
    );
    expect(journeySpan([period("2026-03-02", "2026-05-29")], [{ date: "2026-03-03" }], TODAY)).toEqual({
      fromWeek: "2026-W10",
      toWeek: "2026-W22",
    });
    expect(journeySpan([], [], TODAY)).toBeNull();
  });

  it("단계 경계(주·달)", () => {
    expect([0, 1, 2, 3, 4, 5, 7].map(dayLevel)).toEqual([0, 1, 2, 3, 3, 4, 4]);
    expect([0, 1, 3, 4, 7, 8, 12, 13].map(monthLevel)).toEqual([0, 1, 1, 2, 2, 3, 3, 4]);
  });

  it("주 칸: 기록한 날 수·항목 수·쉼·이번 주, 달 머리 묶음", () => {
    const span = { fromWeek: "2026-W28", toWeek: "2026-W43" };
    const cells = journeyMap(
      days,
      [period("2026-07-06", "2026-07-31"), period("2026-10-05")],
      span,
      TODAY,
      "week",
    );
    expect(cells).toHaveLength(16);
    expect(cells[0]).toMatchObject({
      key: "2026-W28",
      days: 3,
      items: 6,
      level: 3,
      rest: false,
      current: false,
    });
    expect(cells[5]).toMatchObject({ key: "2026-W33", days: 0, rest: true });
    expect(cells[14]).toMatchObject({ key: "2026-W42", days: 0, rest: false });
    expect(cells[15]).toMatchObject({ key: "2026-W43", days: 2, items: 5, current: true });
    expect(monthSpans(cells).map((m) => `${m.month}:${m.count}`)).toEqual([
      "2026-07:4",
      "2026-08:4",
      "2026-09:4",
      "2026-10:4",
    ]);
    expect(defaultMapUnit(span)).toBe("week");
    expect(mapNeedsYearRows(cells)).toBe(false);
  });

  it("달 칸: 날짜의 달, 끝 날짜, 쉰 달", () => {
    const cells = journeyMap(
      days,
      [period("2026-07-06", "2026-07-31"), period("2026-10-05")],
      { fromWeek: "2026-W28", toWeek: "2026-W43" },
      TODAY,
      "month",
    );
    expect(cells.map((c) => [c.key, c.days, c.rest, c.to])).toEqual([
      ["2026-07", 3, false, "2026-07-31"],
      ["2026-08", 0, true, "2026-08-31"],
      ["2026-09", 0, true, "2026-09-30"],
      ["2026-10", 2, false, "2026-10-31"],
    ]);
    expect(cells.at(-1)!.current).toBe(true);
  });

  it("긴 업무: 27주부터 기본 = 월, 53주 넘으면 연도 줄", () => {
    const span = { fromWeek: "2025-W30", toWeek: "2026-W43" };
    expect(defaultMapUnit({ fromWeek: "2026-W17", toWeek: "2026-W43" })).toBe("month");
    expect(defaultMapUnit({ fromWeek: "2026-W18", toWeek: "2026-W43" })).toBe("week");
    const cells = journeyMap([], [period("2025-07-21")], span, TODAY, "week");
    expect(mapNeedsYearRows(cells)).toBe(true);
    expect(cells[0]).toMatchObject({ year: 2025, index: 30 });
    expect(cells.at(-1)).toMatchObject({ year: 2026, index: 43 });
  });
});
