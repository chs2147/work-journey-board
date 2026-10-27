// 중요 업무 목록 묶음·정렬(important-repeat-spec 2-3). 순수 함수 — UI·저장소와 무관.
import { localDate } from "./localTime";
import type { ImportantItem } from "./types";
import { shortDateLabel, weekIdOf, type DateStr } from "./week";

/** 처리 완료한 중요 항목(완료 기록이 있고 다시 중요로 켜지 않은 것) — improve-1027v4-spec 2절 */
export const isDone = (it: { flagged?: boolean; flagDoneAt?: string | null }) =>
  !it.flagged && !!it.flagDoneAt;

/** 완료 시각(UTC ISO) → 내 PC 날짜 `10/24 (토)` */
export const doneDate = (at: string) => shortDateLabel(localDate(new Date(at)));

/**
 * 메모 상자 오른쪽 위 ✓(improve-1027v4-spec 2-2): 연결된 항목 중 중요 표시였던 것(처리 전 + 완료)이 1개 이상이고 모두 완료.
 * 중요 표시가 아닌 항목은 셈에서 뺀다.
 */
export function allImportantDone(items: { flagged: boolean; done: boolean }[]): boolean {
  const imp = items.filter((x) => x.flagged || x.done);
  return imp.length > 0 && imp.every((x) => x.done);
}

export type ImportantGroupKey = "late" | "today" | "thisWeek" | "later";

/** 묶음 안 업무 하나(improve-1026v2-spec 8절) — 업무 색 점 + 이름 + 수 머리 아래 그 업무의 중요 항목 */
export interface ImportantCategoryGroup {
  id: string;
  name: string;
  color: string;
  ended: boolean;
  items: ImportantItem[];
}

export interface ImportantGroup {
  key: ImportantGroupKey;
  /** 보이는 순서(업무 순서 → 날짜 → 칸 안 순서)로 펼친 항목 = categories의 items를 이어 붙인 것 */
  items: ImportantItem[];
  categories: ImportantCategoryGroup[];
}

const ORDER: ImportantGroupKey[] = ["late", "today", "thisWeek", "later"];

/**
 * 지난 날짜 → 오늘 → 이번 주(오늘 이후) → 다음 주 이후. 빈 묶음은 뺀다.
 * 묶음 안은 업무로 한 번 더 묶는다(업무 순서 = 보드 순서), 업무 안은 날짜 → 칸 안 순서.
 */
export function groupImportant(items: ImportantItem[], today: DateStr): ImportantGroup[] {
  const thisWeek = weekIdOf(today);
  const keyOf = (it: ImportantItem): ImportantGroupKey =>
    it.date < today
      ? "late"
      : it.date === today
        ? "today"
        : weekIdOf(it.date) === thisWeek
          ? "thisWeek"
          : "later";
  const sorted = [...items].sort(
    (a, b) =>
      a.categoryOrder - b.categoryOrder ||
      a.categoryId.localeCompare(b.categoryId) ||
      a.date.localeCompare(b.date) ||
      a.seq - b.seq,
  );
  return ORDER.map((key) => {
    const inGroup = sorted.filter((it) => keyOf(it) === key);
    const categories: ImportantCategoryGroup[] = [];
    for (const it of inGroup) {
      const last = categories[categories.length - 1];
      if (last?.id === it.categoryId) last.items.push(it);
      else
        categories.push({
          id: it.categoryId,
          name: it.categoryName,
          color: it.categoryColor,
          ended: it.categoryEnded,
          items: [it],
        });
    }
    return { key, items: inGroup, categories };
  }).filter((g) => g.items.length > 0);
}

/** 레일 배지: 개수(99 초과는 "99+")와 지난 날짜 항목 유무 */
export function importantBadge(
  items: ImportantItem[],
  today: DateStr,
): { label: string | null; late: boolean } {
  const n = items.length;
  return { label: n === 0 ? null : n > 99 ? "99+" : String(n), late: items.some((it) => it.date < today) };
}
