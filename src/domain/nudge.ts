// 무기록 종료 제안 판정(data-spec 5절).
import { openPeriod } from "./categories";
import type { Category, CategoryPeriod } from "./types";
import { addDays, addWeeks, weekStart, type DateStr, type WeekId } from "./week";

export const NUDGE_LOOKBACK_WEEKS = 12;

export interface NudgeInput {
  currentWeek: WeekId;
  /** 기준 주 수 N(0 = 끔) */
  nudgeWeeks: number;
  categories: Category[];
  periodsByCategory: Map<string, CategoryPeriod[]>;
  /** 아무 기록(업무 항목 또는 메모)이라도 있는 주 — 휴가 주를 셈에서 빼기 위함 */
  weeksWithAnyRecord: ReadonlySet<WeekId>;
  /** 근무일(월~금)이 모두 연차인 주 — 기록이 있어도 셈에서 뺀다(improve-1026-spec 1-3) */
  leaveWeeks?: ReadonlySet<WeekId>;
  /** 업무별로 항목이 있는 주(이번 주 포함) */
  weeksWithItemsByCategory: Map<string, ReadonlySet<WeekId>>;
}

/** 종료를 제안할 업무 id 목록 */
export function nudgeCandidates(input: NudgeInput): string[] {
  const n = input.nudgeWeeks;
  if (n <= 0) return [];

  // 이번 주를 뺀 지난 주들 중 "뭐라도 기록한 주"를 최근부터 N개(최대 12주 거슬러).
  const counted: WeekId[] = [];
  for (let i = 1; i <= NUDGE_LOOKBACK_WEEKS && counted.length < n; i++) {
    const w = addWeeks(input.currentWeek, -i);
    if (input.weeksWithAnyRecord.has(w) && !input.leaveWeeks?.has(w)) counted.push(w);
  }
  if (counted.length < n) return [];
  const firstMonday: DateStr = weekStart(counted[counted.length - 1]!);
  const currentMonday = weekStart(input.currentWeek);

  return input.categories
    .filter((c) => {
      const open = openPeriod(input.periodsByCategory.get(c.id) ?? []);
      if (!open) return false; // 1. 진행 중
      if (open.startDate > firstMonday) return false; // 3. 유예
      const weeks = input.weeksWithItemsByCategory.get(c.id) ?? new Set<WeekId>();
      if (counted.some((w) => weeks.has(w))) return false; // 4. N개 주 모두 0개
      if (weeks.has(input.currentWeek)) return false; // 5. 이번 주에도 0개
      if (c.nudgeSnoozedUntil && currentMonday <= c.nudgeSnoozedUntil) return false; // 6. 유지 기간
      return true;
    })
    .map((c) => c.id);
}

/** '유지'를 눌렀을 때 다음 판정 시작일: 이번 주 월요일 + N주 */
export function snoozeUntil(currentWeek: WeekId, nudgeWeeks: number): DateStr {
  return addDays(weekStart(currentWeek), nudgeWeeks * 7);
}
