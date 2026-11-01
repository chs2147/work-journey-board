// 대한민국 공휴일 표(features-1102-spec F3, A안 — 앱 안 표, 외부 통신 없음). 순수 데이터·함수만.
// 만든 방법: 음력 날짜(설날·부처님오신날·추석)는 한국천문연구원 음력 기준 변환 라이브러리(korean-lunar-calendar 0.3.6, 표 생성에만 사용 —
// 앱에 넣지 않음)로 계산, 대체공휴일은 「관공서의 공휴일에 관한 규정」 제3조(2023 개정: 설·추석 = 일요일·다른 공휴일과 겹칠 때,
// 삼일절·어린이날·부처님오신날·광복절·개천절·한글날·성탄절 = 토·일·다른 공휴일과 겹칠 때, 신정·현충일 제외)로 계산,
// 임기만료 선거일은 공직선거법 선거일 규정으로 계산(선거 일정이 바뀌면 다음 판에서 고친다). 임시공휴일은 발표 뒤 다음 판에 더한다.
// 표 갱신 = 이 파일 + HOLIDAY_DATA_VERSION, 단위 테스트(tests/unit/holidays.test.ts)가 개수·표본을 고정한다.
import type { DateStr } from "./week";

export const HOLIDAY_DATA_VERSION = "2026.11";
export const HOLIDAY_YEARS = [2026, 2030] as const;
/** 회사 휴일 이름·기타 휴가 사유 최대 글자 수(day_mark.label CHECK와 같음) */
export const LABEL_MAX_HOLIDAY = 40;

export type HolidayType = "holiday" | "substitute" | "election";

export interface KrHoliday {
  date: DateStr;
  name: string;
  type: HolidayType;
}

const RAW: [string, string, HolidayType][] = [
  // 2026
  ["2026-01-01", "신정", "holiday"],
  ["2026-02-16", "설날 연휴", "holiday"],
  ["2026-02-17", "설날", "holiday"],
  ["2026-02-18", "설날 연휴", "holiday"],
  ["2026-03-01", "삼일절", "holiday"],
  ["2026-03-02", "삼일절 대체공휴일", "substitute"],
  ["2026-05-05", "어린이날", "holiday"],
  ["2026-05-24", "부처님오신날", "holiday"],
  ["2026-05-25", "부처님오신날 대체공휴일", "substitute"],
  ["2026-06-03", "전국동시지방선거", "election"],
  ["2026-06-06", "현충일", "holiday"],
  ["2026-08-15", "광복절", "holiday"],
  ["2026-08-17", "광복절 대체공휴일", "substitute"],
  ["2026-09-24", "추석 연휴", "holiday"],
  ["2026-09-25", "추석", "holiday"],
  ["2026-09-26", "추석 연휴", "holiday"],
  ["2026-10-03", "개천절", "holiday"],
  ["2026-10-05", "개천절 대체공휴일", "substitute"],
  ["2026-10-09", "한글날", "holiday"],
  ["2026-12-25", "성탄절", "holiday"],
  // 2027
  ["2027-01-01", "신정", "holiday"],
  ["2027-02-06", "설날 연휴", "holiday"],
  ["2027-02-07", "설날", "holiday"],
  ["2027-02-08", "설날 연휴", "holiday"],
  ["2027-02-09", "설날 대체공휴일", "substitute"],
  ["2027-03-01", "삼일절", "holiday"],
  ["2027-05-05", "어린이날", "holiday"],
  ["2027-05-13", "부처님오신날", "holiday"],
  ["2027-06-06", "현충일", "holiday"],
  ["2027-08-15", "광복절", "holiday"],
  ["2027-08-16", "광복절 대체공휴일", "substitute"],
  ["2027-09-14", "추석 연휴", "holiday"],
  ["2027-09-15", "추석", "holiday"],
  ["2027-09-16", "추석 연휴", "holiday"],
  ["2027-10-03", "개천절", "holiday"],
  ["2027-10-04", "개천절 대체공휴일", "substitute"],
  ["2027-10-09", "한글날", "holiday"],
  ["2027-10-11", "한글날 대체공휴일", "substitute"],
  ["2027-12-25", "성탄절", "holiday"],
  ["2027-12-27", "성탄절 대체공휴일", "substitute"],
  // 2028
  ["2028-01-01", "신정", "holiday"],
  ["2028-01-26", "설날 연휴", "holiday"],
  ["2028-01-27", "설날", "holiday"],
  ["2028-01-28", "설날 연휴", "holiday"],
  ["2028-03-01", "삼일절", "holiday"],
  ["2028-04-12", "국회의원선거", "election"],
  ["2028-05-02", "부처님오신날", "holiday"],
  ["2028-05-05", "어린이날", "holiday"],
  ["2028-06-06", "현충일", "holiday"],
  ["2028-08-15", "광복절", "holiday"],
  ["2028-10-02", "추석 연휴", "holiday"],
  ["2028-10-03", "추석", "holiday"],
  ["2028-10-03", "개천절", "holiday"],
  ["2028-10-04", "추석 연휴", "holiday"],
  ["2028-10-05", "추석 대체공휴일", "substitute"],
  ["2028-10-06", "개천절 대체공휴일", "substitute"],
  ["2028-10-09", "한글날", "holiday"],
  ["2028-12-25", "성탄절", "holiday"],
  // 2029
  ["2029-01-01", "신정", "holiday"],
  ["2029-02-12", "설날 연휴", "holiday"],
  ["2029-02-13", "설날", "holiday"],
  ["2029-02-14", "설날 연휴", "holiday"],
  ["2029-03-01", "삼일절", "holiday"],
  ["2029-05-05", "어린이날", "holiday"],
  ["2029-05-07", "어린이날 대체공휴일", "substitute"],
  ["2029-05-20", "부처님오신날", "holiday"],
  ["2029-05-21", "부처님오신날 대체공휴일", "substitute"],
  ["2029-06-06", "현충일", "holiday"],
  ["2029-08-15", "광복절", "holiday"],
  ["2029-09-21", "추석 연휴", "holiday"],
  ["2029-09-22", "추석", "holiday"],
  ["2029-09-23", "추석 연휴", "holiday"],
  ["2029-09-24", "추석 대체공휴일", "substitute"],
  ["2029-10-03", "개천절", "holiday"],
  ["2029-10-09", "한글날", "holiday"],
  ["2029-12-25", "성탄절", "holiday"],
  // 2030
  ["2030-01-01", "신정", "holiday"],
  ["2030-02-02", "설날 연휴", "holiday"],
  ["2030-02-03", "설날", "holiday"],
  ["2030-02-04", "설날 연휴", "holiday"],
  ["2030-02-05", "설날 대체공휴일", "substitute"],
  ["2030-03-01", "삼일절", "holiday"],
  ["2030-03-27", "대통령선거", "election"],
  ["2030-05-05", "어린이날", "holiday"],
  ["2030-05-06", "어린이날 대체공휴일", "substitute"],
  ["2030-05-09", "부처님오신날", "holiday"],
  ["2030-06-05", "전국동시지방선거", "election"],
  ["2030-06-06", "현충일", "holiday"],
  ["2030-08-15", "광복절", "holiday"],
  ["2030-09-11", "추석 연휴", "holiday"],
  ["2030-09-12", "추석", "holiday"],
  ["2030-09-13", "추석 연휴", "holiday"],
  ["2030-10-03", "개천절", "holiday"],
  ["2030-10-09", "한글날", "holiday"],
  ["2030-12-25", "성탄절", "holiday"],
];

export const KR_HOLIDAYS: readonly KrHoliday[] = RAW.map(([date, name, type]) => ({ date, name, type }));

/** 한 날에 공휴일이 겹치면(예: 2028-10-03 추석·개천절) 이름을 이어 붙인다 */
export function krHolidaysBetween(from: DateStr, to: DateStr): Record<DateStr, KrHoliday> {
  const out: Record<DateStr, KrHoliday> = {};
  for (const h of KR_HOLIDAYS) {
    if (h.date < from || h.date > to) continue;
    const prev = out[h.date];
    out[h.date] = prev ? { ...prev, name: `${prev.name} · ${h.name}` } : h;
  }
  return out;
}

/** 회사 휴일 한 줄: 매년(MM-DD) 또는 그 해만(YYYY-MM-DD) */
export interface CompanyHoliday {
  date: string;
  name: string;
}

export const COMPANY_DATE_RE = /^(?:\d{4}-)?(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export interface HolidaySettings {
  /** 대한민국 공휴일 자동 표시 */
  krEnabled: boolean;
  /** 보드 표시를 끈 날짜(내장 공휴일·회사 휴일 중 회사가 쉬지 않는 날) */
  off: string[];
  company: CompanyHoliday[];
  /** 기타 휴가 사유 목록(F2) */
  reasons: string[];
}

export interface ResolvedHoliday {
  name: string;
  source: "builtin" | "company";
}

/** 기간 안의 표시할 휴일: 회사 휴일 > 내장 공휴일, 끈 날짜는 빼고 */
export function resolveHolidays(
  from: DateStr,
  to: DateStr,
  s: HolidaySettings,
): Record<DateStr, ResolvedHoliday> {
  const out: Record<DateStr, ResolvedHoliday> = {};
  if (s.krEnabled)
    for (const [d, h] of Object.entries(krHolidaysBetween(from, to)))
      out[d] = { name: h.name, source: "builtin" };
  const y0 = Number(from.slice(0, 4));
  const y1 = Number(to.slice(0, 4));
  for (const c of s.company) {
    if (!COMPANY_DATE_RE.test(c.date)) continue;
    const dates =
      c.date.length === 10 ? [c.date] : Array.from({ length: y1 - y0 + 1 }, (_, i) => `${y0 + i}-${c.date}`);
    for (const d of dates)
      if (d >= from && d <= to) out[d] = { name: c.name || "회사 휴일", source: "company" };
  }
  for (const d of s.off) delete out[d];
  return out;
}
