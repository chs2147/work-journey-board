// 종료 신호에서도 React 렌더를 기다리지 않고 바로 띄우는 공통 작업 대기 화면.
import styles from "./closingOverlay.module.css";

let active: { dialog: HTMLDialogElement; label: HTMLElement; release: () => void } | null = null;

export function showClosingOverlay(text: string) {
  if (typeof document === "undefined" || active) return;
  const previous = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.id = "wjb-closing";
  dialog.dataset.testid = "online-closing";
  dialog.className = styles.overlay!;
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "wjb-closing-label");
  dialog.tabIndex = -1;

  const box = document.createElement("div");
  box.className = styles.card!;
  const spinner = document.createElement("span");
  spinner.className = styles.spinner!;
  spinner.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.id = "wjb-closing-label";
  label.setAttribute("role", "status");
  label.textContent = text;
  box.append(spinner, label);
  dialog.append(box);

  const block = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const keys = ["keydown", "keyup", "keypress"];
  for (const key of keys) window.addEventListener(key, block, true);
  for (const name of ["cancel", "pointerdown", "click"]) dialog.addEventListener(name, block, true);
  dialog.addEventListener("wheel", block, { passive: false });
  document.body.append(dialog);
  const inert = Array.from(document.body.children).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el !== dialog && !el.inert,
  );
  for (const el of inert) el.inert = true;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.open = true;
  dialog.focus({ preventScroll: true });
  active = {
    dialog,
    label,
    release() {
      for (const key of keys) window.removeEventListener(key, block, true);
      for (const el of inert) el.inert = false;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    },
  };
}

export function setClosingText(text: string) {
  if (active) active.label.textContent = text;
}

export function hideClosingOverlay() {
  const current = active;
  if (!current) return;
  active = null;
  current.dialog.remove();
  current.release();
}
