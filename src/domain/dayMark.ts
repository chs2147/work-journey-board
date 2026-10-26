// 날짜 표시 — 연차·반차(docs/improve-1026-spec.md 1절). 순수 함수만.
// 자동 집계의 연차 줄·엑셀 머리·무기록 판정·직전 기록일 찾기가 같은 규칙을 쓴다(CLAUDE.md 4-4).
import { DAY_LABELS, dayIndex, weekDays, type DateStr, type WeekId } from "./week";

export const DAY_MARK_KINDS = ["leave", "half_am", "half_pm"] as const;
export type DayMarkKind = (typeof DAY_MARK_KINDS)[number];

export const DAY_MARK_LABEL: Record<DayMarkKind, string> = {
  leave: "연차",
  half_am: "오전 반차",
  half_pm: "오후 반차",
};

export interface DayMark {
  date: DateStr;
  kind: DayMarkKind;
}

export const isDayMarkKind = (v: unknown): v is DayMarkKind => DAY_MARK_KINDS.includes(v as DayMarkKind);

/** `화(10/27)` */
const dayTag = (date: DateStr) => {
  const [, m, d] = date.split("-");
  return `${DAY_LABELS[dayIndex(date)]}(${Number(m)}/${Number(d)})`;
};

/** 자동 집계 끝 한 줄(spec 1-3): `※ 연차: 화(10/27), 수(10/28) · 오전 반차: 목(10/29)`. 표시가 없으면 null */
export function dayMarkLine(marks: readonly DayMark[]): string | null {
  const parts = DAY_MARK_KINDS.flatMap((k) => {
    const dates = marks
      .filter((m) => m.kind === k)
      .map((m) => m.date)
      .sort();
    return dates.length ? [`${DAY_MARK_LABEL[k]}: ${dates.map(dayTag).join(", ")}`] : [];
  });
  return parts.length ? `※ ${parts.join(" · ")}` : null;
}

/** 그 주 근무일(월~금)이 모두 연차(종일)인가 — 무기록 판정에서 그 주를 뺀다(spec 1-3) */
export function isLeaveWeek(weekId: WeekId, leaveDates: ReadonlySet<DateStr>): boolean {
  return weekDays(weekId)
    .slice(0, 5)
    .every((d) => leaveDates.has(d));
}
