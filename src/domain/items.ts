// 셀 안 개조식 항목 목록 조작(순수 함수). UI 입력기와 저장 경로가 같은 규칙을 쓴다(overview 10-3, data-spec 2절).
import type { Depth, ItemDraft } from "./types";

/** 저장 직전 정리: 빈 항목 제거, 첫 항목은 본 항목(depth 0) */
export function normalizeCell(items: ItemDraft[]): ItemDraft[] {
  const kept = items.filter((i) => i.text.trim().length > 0);
  return kept.map((i, idx) => (idx === 0 && i.depth !== 0 ? { ...i, depth: 0 } : i));
}

const BULLET_RE = /^(?:[-•*·○▪◦‣]|\d{1,3}[.)])\s+/;

/**
 * 붙여넣기 텍스트를 항목으로 분해. 한 줄이면 null(그대로 붙여넣기).
 * 앞머리 기호(- • * · ○ 1. 1))를 떼고, 들여쓴 줄(탭 또는 공백 2칸 이상)은 세부 항목으로.
 */
export function parsePastedLines(text: string): { depth: Depth; text: string }[] | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length <= 1) return null;
  const out = nonEmpty.map((line) => {
    const indent = /^(\t| {2,})/.test(line);
    const body = line.trim().replace(BULLET_RE, "").trim();
    return { depth: (indent ? 1 : 0) as Depth, text: body };
  });
  return out.filter((x) => x.text.length > 0).map((x, i) => (i === 0 ? { ...x, depth: 0 as Depth } : x));
}

/** Tab: 세부로(첫 항목은 불가) */
export function indentAt(items: ItemDraft[], index: number): ItemDraft[] {
  if (index <= 0 || items[index]?.depth === 1) return items;
  return items.map((it, i) => (i === index ? { ...it, depth: 1 } : it));
}

/** Shift+Tab: 본 항목으로 */
export function outdentAt(items: ItemDraft[], index: number): ItemDraft[] {
  if (items[index]?.depth !== 1) return items;
  return items.map((it, i) => (i === index ? { ...it, depth: 0 } : it));
}

/**
 * 행 삭제(improve-1026v2-spec 1·2절)가 지우는 범위 [start, end).
 * 본 항목 = 그 항목 + 바로 아래 이어지는 세부 항목 전부(Alt+↑/↓ 묶음과 같은 범위), 세부 항목 = 그 항목만.
 */
export function deleteRange(items: ItemDraft[], index: number): [number, number] {
  if (index < 0 || index >= items.length) return [index, index];
  return items[index]!.depth === 1 ? [index, index + 1] : blockRange(items, index);
}

/** 범위를 지운 결과. 첫 항목이 세부 항목으로 남으면 본 항목으로 올린다 */
export function deleteAt(
  items: ItemDraft[],
  index: number,
): { items: ItemDraft[]; removed: ItemDraft[]; start: number } {
  const [start, end] = deleteRange(items, index);
  const next = [...items.slice(0, start), ...items.slice(end)];
  if (next[0]?.depth === 1) next[0] = { ...next[0], depth: 0 };
  return { items: next, removed: items.slice(start, end), start };
}

/** 본 항목 + 딸린 세부 항목의 범위 [start, end) */
function blockRange(items: ItemDraft[], start: number): [number, number] {
  let end = start + 1;
  while (end < items.length && items[end]!.depth === 1) end++;
  return [start, end];
}

function blockStartBefore(items: ItemDraft[], index: number): number {
  let i = index - 1;
  while (i > 0 && items[i]!.depth === 1) i--;
  return i;
}

/**
 * Alt+↑/↓. 본 항목은 딸린 세부 항목과 함께 이웃 블록과 자리를 바꾼다.
 * 세부 항목은 한 칸씩 움직이되 첫 자리로는 갈 수 없다. 이동 후 그 항목의 새 위치를 함께 돌려준다.
 */
export function moveItem(
  items: ItemDraft[],
  index: number,
  dir: -1 | 1,
): { items: ItemDraft[]; index: number } {
  const item = items[index];
  if (!item) return { items, index };

  if (item.depth === 1) {
    const target = index + dir;
    if (target < 1 || target >= items.length) return { items, index };
    const next = [...items];
    [next[index], next[target]] = [next[target]!, next[index]!];
    return { items: next, index: target };
  }

  const [s, e] = blockRange(items, index);
  if (dir === -1) {
    if (s === 0) return { items, index };
    const ps = blockStartBefore(items, s);
    const next = [...items.slice(0, ps), ...items.slice(s, e), ...items.slice(ps, s), ...items.slice(e)];
    return { items: next, index: ps };
  }
  if (e >= items.length) return { items, index };
  const [, ne] = blockRange(items, e);
  const next = [...items.slice(0, s), ...items.slice(e, ne), ...items.slice(s, e), ...items.slice(ne)];
  return { items: next, index: s + (ne - e) };
}

/**
 * 직전 기록 가져오기(improve-1026-spec 3-2): source(본·세부 항목, 순서대로)를 target 끝에 덧붙인다.
 * - 같은 글의 본 항목이 이미 있으면 그 묶음에 세부 항목만 보탠다(같은 세부 항목은 건너뜀).
 * - 중요 표시·반복 연결은 싣지 않는다(새 기록으로 시작). 빈 항목은 버린다.
 * 돌려주는 added = 새로 생긴 항목 수.
 */
export function appendCopies(
  target: ItemDraft[],
  source: readonly { depth: Depth; text: string }[],
  newId: () => string,
): { items: ItemDraft[]; added: number } {
  const items = normalizeCell(target).map((i) => ({ ...i }));
  const same = (a: string, b: string) => a.trim() === b.trim();
  let added = 0;
  /** 지금 세부 항목을 붙일 묶음의 끝 다음 자리(-1 = 세부 항목을 붙일 본 항목 없음) */
  let insertAt = -1;
  for (const s of source) {
    if (!s.text.trim()) continue;
    if (s.depth === 0 || insertAt < 0) {
      const at = items.findIndex((i) => i.depth === 0 && same(i.text, s.text));
      if (at >= 0) {
        insertAt = blockRange(items, at)[1];
        continue;
      }
      items.push({ id: newId(), depth: 0, text: s.text });
      added++;
      insertAt = items.length;
      continue;
    }
    // 세부 항목: 붙일 묶음 안에 같은 글이 있으면 건너뜀
    let start = insertAt - 1;
    while (start > 0 && items[start]!.depth === 1) start--;
    if (items.slice(start + 1, insertAt).some((i) => same(i.text, s.text))) continue;
    items.splice(insertAt, 0, { id: newId(), depth: 1, text: s.text });
    insertAt++;
    added++;
  }
  return { items, added };
}
