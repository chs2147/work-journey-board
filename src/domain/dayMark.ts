// 날짜 표시 — 연차·반차(docs/improve-1026-spec.md 1절) + 공휴일·기타 휴가(features-1102-spec F2). 순수 함수만.
// 자동 집계의 연차 줄·엑셀 머리·무기록 판정·직전 기록일 찾기가 같은 규칙을 쓴다(CLAUDE.md 4-4).
import { DAY_LABELS, dayIndex, weekDays, type DateStr, type WeekId } from "./week";

export const DAY_MARK_KINDS = ["leave", "half_am", "half_pm", "holiday", "other"] as const;
export type DayMarkKind = (typeof DAY_MARK_KINDS)[number];

/** 이름·사유가 없을 때의 표시 */
export const DAY_MARK_LABEL: Record<DayMarkKind, string> = {
  leave: "연차",
  half_am: "오전 반차",
  half_pm: "오후 반차",
  holiday: "공휴일",
  other: "휴가",
};

export const LABEL_MAX = 40;

export interface DayMark {
  date: DateStr;
  kind: DayMarkKind;
  /** 공휴일 이름·기타 휴가 사유(없으면 DAY_MARK_LABEL) */
  label?: string | null;
}

/** 화면·집계에 쓰는 이름: 공휴일·기타 휴가는 이름·사유가 있으면 그것 */
export const markText = (kind: DayMarkKind, label?: string | null) =>
  (kind === "holiday" || kind === "other") && label?.trim() ? label.trim() : DAY_MARK_LABEL[kind];

/** 좁은 자리(요일 머리 배지)용: `개천절 대체공휴일` → `대체휴일`, 겹친 이름은 앞의 것 */
export const markShort = (kind: DayMarkKind, label?: string | null) => {
  const t = markText(kind, label);
  if (kind !== "holiday") return t;
  return /대체공휴일$/.test(t) ? "대체휴일" : t.split(" · ")[0]!;
};

/** 하루 종일 쉬는 날(연차·공휴일·기타 휴가) — 무기록 판정·근무일 셈에서 뺀다. 반차는 근무일 */
export const isOffDay = (kind: DayMarkKind | null | undefined) =>
  kind === "leave" || kind === "holiday" || kind === "other";

export const isDayMarkKind = (v: unknown): v is DayMarkKind => DAY_MARK_KINDS.includes(v as DayMarkKind);

/** `화(10/27)` */
const dayTag = (date: DateStr) => {
  const [, m, d] = date.split("-");
  return `${DAY_LABELS[dayIndex(date)]}(${Number(m)}/${Number(d)})`;
};

/**
 * 자동 집계 끝 한 줄(spec 1-3): `※ 연차: 화(10/27), 수(10/28) · 오전 반차: 목(10/29) · 한글날: 금(10/9) · 야유회: 수(10/7)`.
 * 종류 순서(연차·반차·공휴일·기타 휴가), 같은 이름끼리 묶음. 표시가 없으면 null
 */
export function dayMarkLine(marks: readonly DayMark[]): string | null {
  const groups = new Map<string, DateStr[]>();
  for (const k of DAY_MARK_KINDS)
    for (const m of [...marks].filter((x) => x.kind === k).sort((a, b) => (a.date < b.date ? -1 : 1))) {
      const name = markText(m.kind, m.label);
      groups.set(name, [...(groups.get(name) ?? []), m.date]);
    }
  const parts = [...groups].map(([name, dates]) => `${name}: ${dates.map(dayTag).join(", ")}`);
  return parts.length ? `※ ${parts.join(" · ")}` : null;
}

/** 그 주 근무일(월~금)이 모두 쉬는 날(연차·공휴일·기타 휴가)인가 — 무기록 판정에서 그 주를 뺀다(spec 1-3) */
export function isLeaveWeek(weekId: WeekId, leaveDates: ReadonlySet<DateStr>): boolean {
  return weekDays(weekId)
    .slice(0, 5)
    .every((d) => leaveDates.has(d));
}
