// 주간 자동 집계(output-spec 2절). 항상 계산하고 저장하지 않는다. 형식은 2-2 샘플과 문자 단위 골든 테스트로 고정.
// 엑셀 주간보고 시트·AI 지시문도 같은 함수(업무 고르기·본 고르기)를 재사용한다(CLAUDE.md 4-4).
import { dayMarkLine, type DayMark } from "./dayMark";
import type { Depth } from "./types";
import { DAY_LABELS, dayIndex, weekDays, weekTitle, type DateStr, type WeekId } from "./week";

export interface SummaryItem {
  date: DateStr;
  categoryId: string;
  depth: Depth;
  text: string;
  /** 중요 표시(처리 전) — 자동 집계·주간보고에는 쓰지 않고 엑셀 원장 `중요` 열에만(i-m2-plan 6절 #4) */
  flagged?: boolean;
}

export interface SummaryInput {
  weekId: WeekId;
  /** 그 주에 보이는 업무, 보드 순서 */
  categories: { id: string; name: string }[];
  /** 칸 안 순서(seq)대로. 칸끼리의 순서는 상관없다 */
  items: SummaryItem[];
  /** 주간 메모의 글(domain/note.ts noteToText — 이미지 빼고 글만, weekly-note-spec 6절). 없으면 "" */
  memo: string;
  /** 그 주의 연차·반차 표시(improve-1026-spec 1-3). 없으면 연차 줄을 쓰지 않는다 */
  dayMarks?: DayMark[];
}

export interface SummaryOptions {
  includeMemo: boolean;
}

const MAIN = "- ";
const SUB = "  · ";
/** 항목 안 줄바꿈의 이어 쓰기 들여쓰기(2-1 규칙 5). 글꼴마다 한글 폭이 달라 머리 너비 대신 고정 칸 수 */
const MAIN_CONT = "  ";
const SUB_CONT = "    ";

/** 여러 줄 글: 첫 줄은 머리(부호)를 붙이고, 다음 줄은 이어 쓰기 들여쓰기 */
function lines(head: string, cont: string, text: string): string[] {
  return text.split("\n").map((l, i) => (i === 0 ? head : cont) + l);
}

const dayTag = (date: DateStr) => `(${DAY_LABELS[dayIndex(date)]}) `;
const isBlank = (s: string) => s.trim() === "";

/** 업무별 항목(날짜순 → seq순). 빈 글 항목은 뺀다. 보이는 업무만 */
export function itemsByCategory(input: SummaryInput): Map<string, SummaryItem[]> {
  const days = weekDays(input.weekId);
  const out = new Map<string, SummaryItem[]>(input.categories.map((c) => [c.id, []]));
  for (const day of days) {
    for (const it of input.items) {
      if (it.date === day && !isBlank(it.text)) out.get(it.categoryId)?.push(it);
    }
  }
  return out;
}

/** 본문에 넣을 업무(항목 1개 이상)와 "기록 없음" 업무 — 엑셀 주간보고 블록도 이 규칙(output-spec 3-1) */
export function splitCategories(input: SummaryInput) {
  const byCat = itemsByCategory(input);
  const withItems = input.categories.filter((c) => byCat.get(c.id)!.length > 0);
  const empty = input.categories.filter((c) => byCat.get(c.id)!.length === 0);
  return { byCat, withItems, empty };
}

export function buildWeeklySummary(input: SummaryInput, opt: SummaryOptions): string {
  const { byCat, withItems, empty } = splitCategories(input);
  const out: string[] = [`[주간 업무 요약] ${weekTitle(input.weekId)}`];

  for (const c of withItems) {
    out.push("", `■ ${c.name}`);
    for (const it of byCat.get(c.id)!) {
      out.push(
        ...(it.depth === 0
          ? lines(MAIN + dayTag(it.date), MAIN_CONT, it.text)
          : lines(SUB, SUB_CONT, it.text)),
      );
    }
  }

  // 메모: 주간 메모의 글을 그대로(예전 요일 메모는 `- (요일) 내용` 줄로 옮겨져 있어 결과가 예전과 같다)
  if (opt.includeMemo && !isBlank(input.memo)) out.push("", "[메모]", ...input.memo.trim().split("\n"));

  // 꼬리 ※ 줄: 연차·반차(있을 때) 다음 기록 없음 — 표시가 없는 주는 예전과 글자 하나 다르지 않다
  const notes = [dayMarkLine(input.dayMarks ?? [])];
  if (empty.length) notes.push(`※ 이번 주 기록 없음: ${empty.map((c) => c.name).join(", ")}`);
  const tail = notes.filter((n): n is string => n !== null);
  if (tail.length) out.push("", ...tail);
  return out.join("\n");
}

export type SummaryVersion = "edited" | "ai" | "auto";

/** 최종본 = 수정본 > AI본 > 자동 집계본(output-spec 2-3). 패널·엑셀 요약 행이 같이 쓴다 */
export function finalVersion(saved: { editedText?: string | null; aiText?: string | null }): SummaryVersion {
  if (saved.editedText != null) return "edited";
  if (saved.aiText != null) return "ai";
  return "auto";
}

/** 근거 해시의 대상 — 메모 포함 설정과 무관하게 메모까지 넣은 자동 집계본(설정만 바꿨을 때 "기록 변경"이 뜨지 않게) */
export function basisText(input: SummaryInput): string {
  return buildWeeklySummary(input, { includeMemo: true });
}
