import { isDone } from "./important";
import type { Depth } from "./types";
export interface PreviousItem {
  id?: string;
  depth: Depth;
  text: string;
  flagged?: boolean;
  flagDoneAt?: string | null;
}
/** Evaluate structure before discarding empty parents, and reset at every root. */
export function copyablePrevious(items: PreviousItem[]) {
  let blocked = false,
    excluded = 0;
  const kept: { id?: string; depth: Depth; text: string }[] = [];
  for (const item of items) {
    if (item.depth === 0) blocked = isDone(item);
    if (blocked || isDone(item)) {
      if (item.text.trim()) excluded++;
      continue;
    }
    if (item.text.trim())
      kept.push({ ...(item.id ? { id: item.id } : {}), depth: item.depth, text: item.text });
  }
  return { items: kept, excluded };
}
