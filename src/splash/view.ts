// 스플래시 창(splash.html) 화면 조작. 화면 자체는 HTML·CSS가 그리고, 여기서는 오늘 요일 표시와 진행 문구만 바꾼다.

/** 오늘 요일 카드(월~금) 강조. 주말이면 강조하지 않는다. */
export function markToday(today: Date, root: ParentNode = document): void {
  const index = (today.getDay() + 6) % 7; // 월=0 … 일=6
  root.querySelectorAll(".day").forEach((d, i) => d.classList.toggle("today", i === index));
}

/** 진행 문구(메인 창이 시작 단계를 알려 줄 때마다). */
export function setStatus(text: string, root: ParentNode = document): void {
  const el = root.querySelector("#status");
  if (el) el.textContent = text;
}

/** 브라우저 모드에서 날짜를 고정해 볼 수 있게 `?today=YYYY-MM-DD`를 받는다(실앱에는 주소 옵션이 없다). */
export function todayFrom(search: string, now = new Date()): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(new URLSearchParams(search).get("today") ?? "");
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : now;
}
