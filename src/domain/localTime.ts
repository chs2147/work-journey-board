// 파일명·표시용 로컬 시각(PC 시간대). 파일명에 UTC를 쓰지 않는다(overview 13-3 #3, data-spec 7-2).
const pad = (n: number) => String(n).padStart(2, "0");

/** `2026-10-23` */
export function localDate(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** `2026-10` */
export function localMonth(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

/** `2026-10-23_0831` */
export function localStamp(now: Date): string {
  return `${localDate(now)}_${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/** 감사용 타임스탬프(UTC ISO). 화면·파일명에는 쓰지 않는다. */
export function utcTimestamp(now: Date): string {
  return now.toISOString();
}
