// 코칭 예시 일지(coaching-spec 4-5): 가상 샘플의 날짜를 이번 주로 주 단위 이동한다(요일 유지). 순수 함수.
import { addDays, addWeeks, parseDate, today as todayOf, weekIdOf, weekStart, type DateStr } from "./week";

/** 샘플(fixtures/sample-showcase.json)의 "오늘" — 2026-W43 목요일 */
export const SAMPLE_ANCHOR: DateStr = "2026-10-22";

const DATE_HEAD = /^(\d{4}-\d{2}-\d{2})(.*)$/s;
const WEEK_ID = /^\d{4}-W\d{2}$/;

/** 샘플 기준 주에서 오늘이 든 주까지 몇 주 차이인가 */
export function sampleWeekShift(now: Date): number {
  const from = parseDate(weekStart(weekIdOf(SAMPLE_ANCHOR))).getTime();
  const to = parseDate(weekStart(weekIdOf(todayOf(now)))).getTime();
  return Math.round((to - from) / (7 * 86_400_000));
}

/** 문자열 하나: `YYYY-MM-DD…`(날짜·시각)과 `YYYY-Www`만 옮기고 나머지는 그대로 */
export function shiftDateText(value: string, weeks: number): string {
  if (!weeks) return value;
  if (WEEK_ID.test(value)) return addWeeks(value, weeks);
  const m = DATE_HEAD.exec(value);
  // 달력에 없는 날짜(2026-13-45 등)는 날짜가 아닌 글로 보고 그대로 둔다
  if (!m || Number.isNaN(parseDate(m[1]!).getTime()) || addDays(m[1]!, 0) !== m[1]) return value;
  return addDays(m[1]!, weeks * 7) + m[2]!;
}

/** 샘플 자료 전체(깊은 사본)에서 날짜 값만 weeks주 옮긴다 — 키·글 속 날짜·그림 데이터는 그대로 */
export function shiftSampleDates<T>(data: T, weeks: number): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return shiftDateText(v, weeks);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object")
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(data) as T;
}
