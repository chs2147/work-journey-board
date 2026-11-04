// 업무 항목 마감일(improve-1104v10-spec 1·2절): 남은 날·상태·빠른 단추·입력 해석 — 순수 함수만.
import { addDays, dayIndex, type DateStr } from "./week";

/** 실제로 있는 날짜인가(YYYY-MM-DD, 2/30 같은 날은 거부) */
export function isDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export type DueKind = "late" | "today" | "soon" | "later";
/** 7일 안 = 임박 */
export const DUE_SOON_DAYS = 7;

const dayNum = (d: DateStr) =>
  Math.round(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000);

/** 오늘 기준 남은 날(음수 = 지남) */
export const daysLeft = (today: DateStr, due: DateStr) => dayNum(due) - dayNum(today);

export function dueKind(today: DateStr, due: DateStr): DueKind {
  const n = daysLeft(today, due);
  return n < 0 ? "late" : n === 0 ? "today" : n <= DUE_SOON_DAYS ? "soon" : "later";
}

export const isDueDate = (v: unknown): v is DateStr => typeof v === "string" && isDate(v);

/** 마감 임박순: 마감일 오름차순(없는 것은 뒤) */
export function compareDue(a: DateStr | null | undefined, b: DateStr | null | undefined): number {
  if (a && b) return a < b ? -1 : a > b ? 1 : 0;
  return a ? -1 : b ? 1 : 0;
}

/** 빠른 단추: 오늘·내일·이번 주 금(지났으면 빼기)·다음 주 월·다음 주 금·+2주 */
export function quickDues(today: DateStr): { key: string; date: DateStr }[] {
  const wd = dayIndex(today); // 0 = 월
  const mon = addDays(today, -wd);
  const out: { key: string; date: DateStr }[] = [
    { key: "today", date: today },
    { key: "tomorrow", date: addDays(today, 1) },
  ];
  if (wd < 4) out.push({ key: "thisFri", date: addDays(mon, 4) });
  out.push({ key: "nextMon", date: addDays(mon, 7) }, { key: "nextFri", date: addDays(mon, 11) });
  out.push({ key: "twoWeeks", date: addDays(today, 14) });
  return out;
}

/** 새로 열 때 기본 선택: 이번 주 금요일(지났거나 오늘이 금 뒤면 다음 주 금) */
export function defaultDue(today: DateStr): DateStr {
  const wd = dayIndex(today);
  const mon = addDays(today, -wd);
  return wd <= 4 ? addDays(mon, 4) : addDays(mon, 11);
}

/** 숫자 바로 입력: "1026" → 올해(오늘이 속한 해) 10/26, "20261026" → 2026-10-26. 없는 날짜면 null */
export function parseDueInput(raw: string, today: DateStr): DateStr | null {
  const d = raw.replace(/\D/g, "");
  let y: string;
  let md: string;
  if (d.length === 8) {
    y = d.slice(0, 4);
    md = d.slice(4);
  } else if (d.length === 4 || d.length === 3) {
    y = today.slice(0, 4);
    md = d.padStart(4, "0");
  } else return null;
  const s = `${y}-${md.slice(0, 2)}-${md.slice(2)}`;
  return isDate(s) ? (s as DateStr) : null;
}
