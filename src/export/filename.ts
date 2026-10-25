// 내보내기 파일명·문서 제목(output-spec 4-2·3-3). 같은 이름이 있으면 윈도우 저장 대화상자의 덮어쓰기 확인을 따른다.
import { parseWeekId, type WeekId } from "../domain/week";

/** 범위 표기: 한 주 `2026-W43`, 같은 연도 `2026-W40~W43`, 연도를 넘김 `2025-W50~2026-W03` */
export function rangeLabel(from: WeekId, to: WeekId): string {
  if (from === to) return from;
  const a = parseWeekId(from);
  const b = parseWeekId(to);
  return a.year === b.year ? `${from}~W${String(b.week).padStart(2, "0")}` : `${from}~${to}`;
}

/** `업무일지_2026-W43.xlsx` · `업무일지_2026-W40~W43.xlsx` · `업무일지_2025-W50~2026-W03.xlsx` · `업무일지_전체_2026-W38~W43.xlsx` */
export function exportFileName(from: WeekId, to: WeekId, all = false): string {
  return `업무일지_${all ? "전체_" : ""}${rangeLabel(from, to)}.xlsx`;
}

/** 문서 속성 제목: `업무일지 2026-W42~W43` */
export function exportTitle(from: WeekId, to: WeekId): string {
  return `업무일지 ${rangeLabel(from, to)}`;
}
