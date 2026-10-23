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

export interface EntryItem {
  id: string;
  date: DateStr;
  categoryId: string;
  seq: number;
  depth: Depth;
  text: string;
}

/** 셀 편집 결과(저장 전). seq는 저장 시 목록 순서로 다시 매긴다. */
export interface ItemDraft {
  id: string;
  depth: Depth;
  text: string;
}
