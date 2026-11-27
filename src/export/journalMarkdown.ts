// 업무일지 마크다운 내보내기(improve-v27 1-6). 순수 함수 — 골든 시험으로 모양을 고정한다.
// 주(오래된 주부터, D6) → 업무(보드 순서) → 날짜 → 항목(세부는 한 단계 더 들여쓰기). 그림은 넣지 않는다.
import { buildWeeklySummary, finalVersion } from "../domain/aggregate";
import { markText } from "../domain/dayMark";
import { shortDateLabel, weekRange, type WeekId } from "../domain/week";
import type { ExportWeek } from "./excel";
import { rangeLabel } from "./filename";

export interface JournalMarkdownOptions {
  from: WeekId;
  to: WeekId;
  /** 업무 기록 · 주간 요약 · 주간 메모(글) */
  records: boolean;
  summary: boolean;
  memo: boolean;
  /** 주간 요약 자동 집계에 메모 넣기(설정 summary.includeMemo) */
  includeMemo: boolean;
  /** 머리 줄 "업무: …" — 전체면 "전체" */
  categoryLabel: string;
  /** 내보낸 날 'YYYY-MM-DD' */
  exportedOn: string;
}

const short = (date: string) => {
  const [, m, d] = date.split("-");
  return `${m}/${d}`;
};

/** 여러 줄 글: 첫 줄 `- `, 다음 줄은 같은 깊이로 이어 쓰기 */
function bullet(indent: string, text: string): string[] {
  return text.split("\n").map((l, i) => (i === 0 ? `${indent}- ${l}` : `${indent}  ${l}`));
}

function weekRecords(w: ExportWeek): string[] {
  const out: string[] = [];
  const marks = new Map((w.input.dayMarks ?? []).map((m) => [m.date, markText(m.kind, m.label)]));
  for (const c of w.input.categories) {
    const items = w.input.items.filter((it) => it.categoryId === c.id && it.text.trim());
    if (!items.length) continue;
    out.push("", `### ${c.name}`);
    const dates = [...new Set(items.map((it) => it.date))].sort();
    for (const date of dates) {
      const mark = marks.get(date);
      out.push(`- ${shortDateLabel(date)}${mark ? ` · ${mark}` : ""}`);
      for (const it of items.filter((x) => x.date === date)) {
        const text = it.text.replace(/\s+$/, "") + (it.flagDoneAt ? " ✓" : "");
        out.push(...bullet(it.depth === 0 ? "  " : "    ", text));
      }
    }
  }
  return out;
}

function weekSummary(w: ExportWeek, includeMemo: boolean): string {
  const v = finalVersion(w.summary);
  if (v === "edited") return w.summary.editedText!.trim();
  if (v === "ai") return w.summary.aiText!.trim();
  const empty = !w.input.items.some((it) => it.text.trim()) && !(includeMemo && w.input.memo.trim());
  return empty ? "" : buildWeeklySummary(w.input, { includeMemo }).trim();
}

/** 마크다운 문서(끝 줄바꿈 하나) */
export function buildJournalMarkdown(weeks: ExportWeek[], o: JournalMarkdownOptions): string {
  const lines = [
    `# 업무일지 ${rangeLabel(o.from, o.to)}`,
    `업무: ${o.categoryLabel} · 내보낸 날 ${o.exportedOn}`,
  ];
  const sorted = [...weeks].sort((a, b) => a.input.weekId.localeCompare(b.input.weekId));
  for (const w of sorted) {
    const { start, end } = weekRange(w.input.weekId);
    lines.push("", `## ${w.input.weekId} (${short(start)} ~ ${short(end)})`);
    const body: string[] = [];
    if (o.records) body.push(...weekRecords(w));
    if (o.summary) {
      const s = weekSummary(w, o.includeMemo);
      if (s) body.push("", "### 주간 요약", s);
    }
    if (o.memo && w.input.memo.trim()) body.push("", "### 주간 메모", w.input.memo.trim());
    if (body.length) lines.push(...body);
    else lines.push("", "기록 없음");
  }
  return lines.join("\n") + "\n";
}
