// 주차 규칙의 단일 출처(data-spec 1절, CLAUDE.md 4-4). ISO 8601: 월요일 시작, 1월 4일이 든 주 = 1주차.
// 날짜는 로컬 날짜 문자열 `YYYY-MM-DD`(시간대 없음)로만 주고받는다.
import { getISOWeek, getISOWeekYear, getISOWeeksInYear, setISOWeek, startOfISOWeek } from "date-fns";

export type DateStr = string;
/** `YYYY-Www` (ISO 연도 기준) */
export type WeekId = string;

export const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"] as const;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEK_RE = /^(\d{4})-W(\d{2})$/;

const pad = (n: number) => String(n).padStart(2, "0");

export function parseDate(s: DateStr): Date {
  const m = DATE_RE.exec(s);
  if (!m) throw new Error(`날짜 형식이 아닙니다: ${s}`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function formatDate(d: Date): DateStr {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function today(now: Date = new Date()): DateStr {
  return formatDate(now);
}

export function addDays(s: DateStr, n: number): DateStr {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return formatDate(d);
}

/** 월=0 … 일=6 */
export function dayIndex(s: DateStr): number {
  return (parseDate(s).getDay() + 6) % 7;
}

export function weekIdOf(s: DateStr): WeekId {
  const d = parseDate(s);
  return `${getISOWeekYear(d)}-W${pad(getISOWeek(d))}`;
}

export function parseWeekId(id: WeekId): { year: number; week: number } {
  const m = WEEK_RE.exec(id);
  if (!m) throw new Error(`주차 형식이 아닙니다: ${id}`);
  return { year: Number(m[1]), week: Number(m[2]) };
}

/** 주의 월요일 */
export function weekStart(id: WeekId): DateStr {
  const { year, week } = parseWeekId(id);
  // 1월 4일은 항상 그 ISO 연도의 1주차에 있다.
  return formatDate(startOfISOWeek(setISOWeek(new Date(year, 0, 4), week)));
}

export function weekDays(id: WeekId): DateStr[] {
  const mon = weekStart(id);
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
}

export function weekRange(id: WeekId): { start: DateStr; end: DateStr } {
  const start = weekStart(id);
  return { start, end: addDays(start, 6) };
}

export function addWeeks(id: WeekId, n: number): WeekId {
  return weekIdOf(addDays(weekStart(id), n * 7));
}

export function compareWeekId(a: WeekId, b: WeekId): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function weeksInIsoYear(year: number): number {
  return getISOWeeksInYear(new Date(year, 0, 4));
}

/** 보드 제목: `2026-W43 (10/19~10/25)`, 해를 넘기면 `2026-W53 (2026/12/28~2027/01/03)` */
export function weekTitle(id: WeekId): string {
  const { start, end } = weekRange(id);
  const [sy, sm, sd] = start.split("-");
  const [ey, em, ed] = end.split("-");
  return sy === ey ? `${id} (${sm}/${sd}~${em}/${ed})` : `${id} (${sy}/${sm}/${sd}~${ey}/${em}/${ed})`;
}

/** 목록용 짧은 날짜: `10/22 (목)` */
export function shortDateLabel(date: DateStr): string {
  const [, m, d] = date.split("-");
  return `${m}/${d} (${DAY_LABELS[dayIndex(date)]})`;
}

/** 연간 보기(미니맵)용 주 목록. 주는 그 주 목요일이 속한 달에 배치한다. */
export function weeksOfIsoYear(year: number): { weekId: WeekId; month: number }[] {
  return Array.from({ length: weeksInIsoYear(year) }, (_, i) => {
    const weekId = `${year}-W${pad(i + 1)}`;
    const thursday = parseDate(addDays(weekStart(weekId), 3));
    return { weekId, month: thursday.getMonth() + 1 };
  });
}
