// 매주 반복(important-repeat-spec 3절) — 생성 대상 판단·묶음 범위. 순수 함수만(UI·저장소와 무관).
import type { CategoryPeriod, Depth } from "./types";
import { addWeeks, dayIndex, weekDays, weekIdOf, type DateStr, type WeekId } from "./week";

export interface RecurrenceLine {
  depth: Depth;
  text: string;
}

export interface Recurrence {
  id: string;
  categoryId: string;
  /** ISO 요일 1=월 … 7=일 */
  weekday: number;
  /** 이 주부터 들어온다(켠 항목이 있던 주의 다음 주) */
  startWeek: WeekId;
  /** 이 주까지만(null = 계속) */
  endWeek: WeekId | null;
  /** 들어올 때부터 중요 표시 */
  flagOnCreate: boolean;
  /** 본 항목 + 세부 항목 묶음 */
  lines: RecurrenceLine[];
}

/** 항목 index가 속한 묶음(본 항목 + 딸린 세부 항목)의 [시작, 끝] 위치 */
export function groupRange(items: { depth: Depth }[], index: number): { start: number; end: number } {
  let start = Math.min(index, items.length - 1);
  while (start > 0 && items[start]!.depth === 1) start--;
  let end = start;
  while (end + 1 < items.length && items[end + 1]!.depth === 1) end++;
  return { start, end };
}

/** 켤 때: 항목 날짜로 요일·시작 주를 정한다 */
export function ruleTiming(date: DateStr): { weekday: number; startWeek: WeekId; originWeek: WeekId } {
  const originWeek = weekIdOf(date);
  return { weekday: dayIndex(date) + 1, startWeek: addWeeks(originWeek, 1), originWeek };
}

/** 반복이 그 주에 해당하는가(시작 주 ~ 끝 주) */
export function isDue(rule: Recurrence, weekId: WeekId): boolean {
  return rule.startWeek <= weekId && (rule.endWeek === null || weekId <= rule.endWeek);
}

/** 그 주에서 반복 항목이 들어갈 날짜 */
export function ruleDate(rule: Recurrence, weekId: WeekId): DateStr {
  return weekDays(weekId)[rule.weekday - 1]!;
}

/** 업무가 그 날짜에 활성인가(구간 안). 종료된 업무에는 만들지 않는다(spec 3-2) */
export function activeOn(periods: CategoryPeriod[], date: DateStr): boolean {
  return periods.some((p) => p.startDate <= date && (p.endDate === null || p.endDate >= date));
}

/**
 * 주 weekId에 새로 만들 반복: 그 주에 해당하고 · 업무가 그날 활성이고 · 아직 그 주에 만든 적 없는 것.
 * "이번 주만 자동으로"와 "미래 주는 예정 미리 보기"는 부르는 쪽이 정한다.
 */
export function rulesToCreate(
  rules: Recurrence[],
  weekId: WeekId,
  madeRuleIds: ReadonlySet<string>,
  periodsByCategory: ReadonlyMap<string, CategoryPeriod[]>,
): Recurrence[] {
  return rules.filter(
    (r) =>
      isDue(r, weekId) &&
      !madeRuleIds.has(r.id) &&
      activeOn(periodsByCategory.get(r.categoryId) ?? [], ruleDate(r, weekId)),
  );
}
