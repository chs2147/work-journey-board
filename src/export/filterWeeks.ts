// 업무일지 내보내기 — 고른 업무만 남기기(improve-v27 1-4). 순수 함수.
// 업무를 고르면 저장된 수정본·AI본(전체 업무 기준)은 쓰지 않고 고른 업무만으로 자동 집계한다(D5).
// 주간 메모 글·연차 표시는 업무와 상관없는 주 자료라 그대로 둔다.
import type { ExportWeek } from "./excel";

/** ids가 null이면 그대로(전체) */
export function filterExportWeeks(weeks: ExportWeek[], ids: readonly string[] | null): ExportWeek[] {
  if (!ids) return weeks;
  const keep = new Set(ids);
  return weeks.map((w) => ({
    ...w,
    input: {
      ...w.input,
      categories: w.input.categories.filter((c) => keep.has(c.id)),
      items: w.input.items.filter((it) => keep.has(it.categoryId)),
    },
    summary: { editedText: null, aiText: null },
  }));
}
