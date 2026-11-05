// 도메인 공용 타입. 저장 형식(data-spec 3-2)과 1:1이지만 UI·도메인은 camelCase로 다룬다.
import type { CategoryColorKey } from "../shared/palette";
import type { DateStr } from "./week";

export interface Category {
  id: string;
  name: string;
  color: CategoryColorKey;
  sortOrder: number;
  /** 종료 제안 '유지' 시 재판정 시작 주의 월요일 */
  nudgeSnoozedUntil: DateStr | null;
}

export interface CategoryPeriod {
  id: string;
  categoryId: string;
  startDate: DateStr;
  /** null = 진행 중 */
  endDate: DateStr | null;
}

export type Depth = 0 | 1;

/** 항목의 중요 표시·매주 반복 연결(important-repeat-spec 2·3절). 없으면 표시 없음·반복 없음. */
export interface ItemMarks {
  /** 중요 표시 — 아직 챙겨야 하는 일 */
  flagged?: boolean;
  /** 항목 처리 완료 시각(UTC). 중요 업무에서 완료한 항목도 같은 상태를 사용한다 */
  flagDoneAt?: string | null;
  completionWasFlagged?: boolean;
  /** 매주 반복 규칙 id */
  recurrenceId?: string | null;
  /** 그날 시작 시각 'HH:MM'(15분 단위, improve-1103v8-spec T1) — 없으면 null */
  startTime?: string | null;
  /** 마감일 'YYYY-MM-DD'(improve-1104v10-spec) — 없으면 null */
  dueDate?: string | null;
}

export interface EntryItem extends ItemMarks {
  id: string;
  date: DateStr;
  categoryId: string;
  seq: number;
  depth: Depth;
  text: string;
}

/** 셀 편집 결과(저장 전). seq는 저장 시 목록 순서로 다시 매긴다.
 *  표시(ItemMarks)를 함께 실어야 실행 취소로 되살린 항목의 중요 표시가 그대로 돌아온다(spec 4-2). */
export interface ItemDraft extends ItemMarks {
  id: string;
  depth: Depth;
  text: string;
}

/** 중요 업무 목록 한 줄(important-repeat-spec 2-3) */
export interface ImportantItem {
  id: string;
  date: DateStr;
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  /** 보드 순서 */
  categoryOrder: number;
  /** 업무가 종료됨 */
  categoryEnded: boolean;
  seq: number;
  depth: Depth;
  text: string;
  /** 세부 항목이면 그 본 항목 글 */
  parentText: string | null;
  flagDoneAt: string | null;
  /** 시작 시각(improve-1103v8-spec T1) */
  startTime?: string | null;
  /** 마감일(improve-1104v10-spec) */
  dueDate?: string | null;
}
