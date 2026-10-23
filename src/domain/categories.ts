// 카테고리 활성 계산(data-spec 4절). 이월(R7)은 복사가 아니라 "열린 구간이 미래 주와 겹친다"는 계산이다.
import type { Category, CategoryPeriod } from "./types";
import type { DateStr } from "./week";

export type CategoryWeekState = "active" | "ended" | "records-only";

export interface VisibleCategory {
  category: Category;
  state: CategoryWeekState;
}

function overlaps(p: CategoryPeriod, mon: DateStr, sun: DateStr): boolean {
  return p.startDate <= sun && (p.endDate === null || p.endDate >= mon);
}

/**
 * 주 [mon, sun]에 보일 업무와 그 주에서의 표시 상태.
 * 보임 = 구간이 주와 하루라도 겹침 OR 그 주에 그 업무 기록이 있음(데이터가 숨지 않게 하는 안전장치).
 */
export function visibleCategories(
  categories: Category[],
  periods: CategoryPeriod[],
  mon: DateStr,
  sun: DateStr,
  categoryIdsWithItems: ReadonlySet<string>,
): VisibleCategory[] {
  const byCat = groupPeriods(periods);
  const out: VisibleCategory[] = [];
  for (const category of categories) {
    const hits = (byCat.get(category.id) ?? []).filter((p) => overlaps(p, mon, sun));
    let state: CategoryWeekState | null = null;
    if (hits.length) {
      state = hits.some((p) => p.endDate === null || p.endDate > sun) ? "active" : "ended";
    } else if (categoryIdsWithItems.has(category.id)) {
      state = "records-only";
    }
    if (state) out.push({ category, state });
  }
  return out.sort((a, b) => a.category.sortOrder - b.category.sortOrder);
}

export function groupPeriods(periods: CategoryPeriod[]): Map<string, CategoryPeriod[]> {
  const m = new Map<string, CategoryPeriod[]>();
  for (const p of periods) m.set(p.categoryId, [...(m.get(p.categoryId) ?? []), p]);
  for (const list of m.values()) list.sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  return m;
}

export function openPeriod(periods: CategoryPeriod[]): CategoryPeriod | undefined {
  return periods.find((p) => p.endDate === null);
}

/** 종료: 열린 구간의 끝을 오늘로. 구간이 오늘 이후에 시작(미래 주에서 만든 업무)이면 시작일로 맞춘다. */
export function archiveEndDate(open: CategoryPeriod, today: DateStr): DateStr {
  return today < open.startDate ? open.startDate : today;
}

export type ReactivatePlan = { kind: "reopen"; periodId: string } | { kind: "new"; startDate: DateStr };

/** 재활성: 마지막 구간이 이번 주 안에서 끝났으면 다시 열고, 아니면 이번 주 월요일부터 새 구간. */
export function reactivatePlan(periods: CategoryPeriod[], currentWeekMonday: DateStr): ReactivatePlan {
  const last = [...periods].sort((a, b) => (a.startDate < b.startDate ? -1 : 1)).at(-1);
  if (last && last.endDate !== null && last.endDate >= currentWeekMonday) {
    return { kind: "reopen", periodId: last.id };
  }
  return { kind: "new", startDate: currentWeekMonday };
}

/** 업무 이름 검증: 앞뒤 공백 제거 후 1~40자 */
export function normalizeCategoryName(name: string): string | null {
  const n = name.trim().replace(/\s+/g, " ");
  return n.length >= 1 && n.length <= 40 ? n : null;
}
