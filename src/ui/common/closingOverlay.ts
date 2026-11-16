// 닫는 중 덮개(1.40.1) — React를 거치지 않고 바로 DOM에 그린다.
// 닫기를 누른 순간 "저장하고 종료하는 중…"이 보이고, 그동안 클릭·키 입력이 뒤 화면에 닿지 않는다.
/**
 * 닫는 중 덮개 — React를 거치지 않고 바로 DOM에(신호를 받은 순간 그려지게). 클릭·입력을 막는다.
 */
export function showClosingOverlay(text: string) {
  if (typeof document === "undefined" || document.getElementById("wjb-closing")) return;
  const el = document.createElement("div");
  el.id = "wjb-closing";
  el.setAttribute("role", "alertdialog");
  el.setAttribute("aria-busy", "true");
  el.dataset.testid = "online-closing";
  el.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;" +
    "background:rgb(0 0 0 / 28%);cursor:progress";
  const box = document.createElement("div");
  box.style.cssText =
    "padding:16px 24px;background:var(--surface-card,#fff);color:var(--text-1,#222);" +
    "border:1px solid var(--line,#ccc);border-radius:var(--radius-md,8px);font-size:var(--fs-md,14px)";
  box.textContent = text;
  el.appendChild(box);
  const stop = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  for (const t of ["keydown", "keyup", "keypress", "mousedown", "click", "wheel"])
    el.addEventListener(t, stop, true);
  document.body.appendChild(el);
  (document.activeElement as HTMLElement | null)?.blur?.();
}

/** 덮개 글 바꾸기(종료가 늦어질 때) */
export function setClosingText(text: string) {
  const box = document.getElementById("wjb-closing")?.firstElementChild;
  if (box) box.textContent = text;
}
/** 덮개 걷기(저장 실패로 창을 남길 때) */
export function hideClosingOverlay() {
  document.getElementById("wjb-closing")?.remove();
}
