// 검색(features-1102-spec F1): 낱말(띄어쓰기로 나눔) 모두 들어간 것(AND)·대소문자 무시·부분 일치.
// 순수 함수만 — 저장소가 업무 기록을 SQL로 거르고, 메모 보드는 여기서 글을 뽑아 맞춘다.
import { blockLines, readingOrder, type NoteDoc } from "./note";
import type { DateStr, WeekId } from "./week";

export const SEARCH_MIN_CHARS = 2;
export const SEARCH_LIMIT = 300;

export type SearchArea = "item" | "memo";
export type SearchKind = "item" | "subitem" | "text" | "image" | "link" | "edge";

export interface SearchHit {
  /** 결과 고유 키(이동·강조) */
  key: string;
  area: SearchArea;
  kind: SearchKind;
  weekId: WeekId;
  /** 업무 기록만 */
  date?: DateStr;
  categoryId?: string;
  categoryName?: string;
  itemId?: string;
  /** 메모만 — 상자 id(관계선이면 시작 상자) */
  boxId?: string;
  /** 메모 상자가 연결된 첫 항목 id(목록에 "연결: …" 표시용) */
  linkedItemId?: string;
  /** 찾은 줄(앞뒤를 줄인 글) */
  text: string;
  /** 업무 기록의 마감일(improve-1104v10-spec 3절) */
  dueDate?: string | null;
}

/** 검색어 → 낱말(소문자). 2글자 미만이면 빈 배열 */
export function searchTerms(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (q.length < SEARCH_MIN_CHARS) return [];
  return [...new Set(q.split(/\s+/).filter(Boolean))];
}

export const matchesAll = (text: string, terms: string[]) => {
  if (!terms.length) return false;
  const t = text.toLowerCase();
  return terms.every((w) => t.includes(w));
};

/** 글에서 낱말 위치(형광 표시용) — 겹치면 합친다 */
export function highlightRanges(text: string, terms: string[]): [number, number][] {
  const t = text.toLowerCase();
  const out: [number, number][] = [];
  for (const w of terms) {
    let i = t.indexOf(w);
    while (w && i >= 0) {
      out.push([i, i + w.length]);
      i = t.indexOf(w, i + w.length);
    }
  }
  out.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of out) {
    const last = merged.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}

/** 긴 줄은 첫 일치 앞 24자부터 보여 준다 */
export function snippet(text: string, terms: string[], max = 120): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  const first = highlightRanges(one, terms)[0]?.[0] ?? 0;
  const start = Math.max(0, first - 24);
  const s = one.slice(start, start + max);
  return `${start > 0 ? "…" : ""}${s}${start + max < one.length ? "…" : ""}`;
}

const stripMarker = (line: string) => line.replace(/^\s*(?:[-*•]|\d+\.|\[[ x]\])\s+/, "").trim();

/** 메모 한 주에서 찾기 — 상자 읽는 순서대로, 글 상자는 줄마다(같은 상자 첫 일치 줄만), 그 뒤 관계선 이름표 */
export function searchNote(weekId: WeekId, doc: NoteDoc, terms: string[]): SearchHit[] {
  if (!terms.length) return [];
  const hits: SearchHit[] = [];
  const base = (boxId: string, linked?: string) => ({
    area: "memo" as const,
    weekId,
    boxId,
    ...(linked ? { linkedItemId: linked } : {}),
  });
  for (const b of readingOrder(doc.boxes)) {
    const linked = b.refs?.[0]?.item;
    if (b.kind === "text") {
      const line = blockLines(b.content.content, "")
        .map(stripMarker)
        .find((l) => matchesAll(l, terms));
      const whole = blockLines(b.content.content, "").map(stripMarker).join(" ");
      const text = line ?? (matchesAll(whole, terms) ? whole : null);
      if (text)
        hits.push({
          key: `m:${weekId}:${b.id}`,
          kind: "text",
          text: snippet(text, terms),
          ...base(b.id, linked),
        });
    } else if (b.kind === "image") {
      if (matchesAll(b.caption, terms))
        hits.push({
          key: `m:${weekId}:${b.id}`,
          kind: "image",
          text: snippet(b.caption, terms),
          ...base(b.id, linked),
        });
    } else {
      const all = `${b.title} ${b.note} ${b.url}`;
      if (matchesAll(all, terms)) {
        const text = [b.title, b.note, b.url].find((s) => matchesAll(s, terms)) ?? all;
        hits.push({
          key: `m:${weekId}:${b.id}`,
          kind: "link",
          text: snippet(text, terms),
          ...base(b.id, linked),
        });
      }
    }
  }
  for (const e of doc.edges ?? []) {
    if (e.label && matchesAll(e.label, terms))
      hits.push({
        key: `m:${weekId}:e:${e.id}`,
        kind: "edge",
        text: snippet(e.label, terms),
        ...base(e.from),
      });
  }
  return hits;
}

/** 결과 정렬: 최근 주 먼저, 같은 주 안에서는 업무 기록(날짜·보드 순서) → 메모 */
export function sortHits(hits: SearchHit[]): SearchHit[] {
  return [...hits].sort((a, b) => {
    if (a.weekId !== b.weekId) return a.weekId < b.weekId ? 1 : -1;
    if (a.area !== b.area) return a.area === "item" ? -1 : 1;
    if (a.area === "item" && a.date !== b.date) return (a.date ?? "") < (b.date ?? "") ? -1 : 1;
    return 0;
  });
}
