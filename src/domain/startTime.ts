// 항목 시작 시각(improve-1103v8-spec T1) — 그날 몇 시 몇 분에 시작하는지(예: 오전 10시 회의). 'HH:MM', 분은 15분 단위.
// 순수 함수만(UI·저장소 import 금지). 지났는지는 보지 않는다(2026-11-03 사용자 결정).

const RE = /^([01]\d|2[0-3]):(00|15|30|45)$/;
export const QUARTERS = ["00", "15", "30", "45"] as const;
const DAY = 24 * 60;

export function isStartTime(v: unknown): v is string {
  return typeof v === "string" && RE.test(v);
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fromMin = (m: number) => {
  const x = ((m % DAY) + DAY) % DAY;
  return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
};

/** 분을 15분 단위로 내림 */
export function snap15(h: number, m: number): string | null {
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return fromMin(h * 60 + Math.floor(m / 15) * 15);
}

/**
 * 키보드로 친 시각 → 'HH:MM'(15분 내림). '1430'·'14:30'·'930'·'9:30'·'9'(→09:00)·'14'(→14:00).
 * 알아볼 수 없으면 null
 */
export function parseTimeInput(raw: string): string | null {
  const s = raw.trim().replace(/\s+/g, "");
  let m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (m) return snap15(Number(m[1]), Number(m[2]));
  m = /^(\d{1,2})(\d{2})$/.exec(s);
  if (m) return snap15(Number(m[1]), Number(m[2]));
  m = /^(\d{1,2})$/.exec(s);
  if (m) return snap15(Number(m[1]), 0);
  return null;
}

/** 15분씩 앞뒤로(자정을 넘으면 돌아감) */
export function stepTime(t: string, delta: number): string {
  return fromMin(toMin(t) + delta * 15);
}

/** 시각 고르기 창을 처음 열 때: 오늘 칸이면 지금 다음 15분, 아니면 09:00 */
export function defaultStartTime(isToday: boolean, now: Date): string {
  if (!isToday) return "09:00";
  const m = now.getHours() * 60 + now.getMinutes();
  return fromMin(Math.min(Math.ceil((m + 1) / 15) * 15, DAY - 15));
}

/** 정렬: 시각 있는 것 먼저(이른 순), 없는 것은 뒤 — 같으면 0 */
export function compareByTime(a: string | null | undefined, b: string | null | undefined): number {
  if (a && b) return a < b ? -1 : a > b ? 1 : 0;
  if (a) return -1;
  if (b) return 1;
  return 0;
}
