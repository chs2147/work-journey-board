// 중요 업무 목록 묶음·정렬(important-repeat-spec 2-3). 순수 함수 — UI·저장소와 무관.
import type { ImportantItem } from "./types";
import { weekIdOf, type DateStr } from "./week";

export type ImportantGroupKey = "late" | "today" | "thisWeek" | "later";

export interface ImportantGroup {
  key: ImportantGroupKey;
  items: ImportantItem[];
}

const ORDER: ImportantGroupKey[] = ["late", "today", "thisWeek", "later"];

/** 지난 날짜 → 오늘 → 이번 주(오늘 이후) → 다음 주 이후. 빈 묶음은 뺀다. 묶음 안은 날짜 → 업무 순서 → 칸 안 순서. */
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
    (a, b) => a.date.localeCompare(b.date) || a.categoryOrder - b.categoryOrder || a.seq - b.seq,
  );
  return ORDER.map((key) => ({ key, items: sorted.filter((it) => keyOf(it) === key) })).filter(
    (g) => g.items.length > 0,
  );
}

/** 레일 배지: 개수(99 초과는 "99+")와 지난 날짜 항목 유무 */
export function importantBadge(
  items: ImportantItem[],
  today: DateStr,
): { label: string | null; late: boolean } {
  const n = items.length;
  return { label: n === 0 ? null : n > 99 ? "99+" : String(n), late: items.some((it) => it.date < today) };
}
