// 중요 업무 처리 완료 뱃지의 작은 창(improve-1027v4-spec 2-1): 처리한 때 + [되돌리기 — 다시 중요 업무로].
// 뱃지를 누르거나 완료 항목에서 Alt+I로 연다. Esc·바깥 누르기 = 닫기(커서는 그 항목으로).
import { useEffect, useRef } from "react";
import { doneDate } from "../../domain/important";
import { STR } from "../../shared/strings";
import styles from "./Board.module.css";

const doneTime = (at: string) => {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export function DonePopover({ at, onUndo, onClose }: { at: string; onUndo(): void; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    ref.current?.querySelector("button")?.focus();
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close.current();
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, []);
  return (
    <div
      ref={ref}
      className={styles.donePop}
      role="dialog"
      aria-label={STR.important.doneTitle}
      data-testid="done-popover"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <strong className={styles.donePopTitle}>{STR.important.doneTitle}</strong>
      <span className={styles.donePopWhen}>{STR.important.doneWhen(doneDate(at), doneTime(at))}</span>
      <button type="button" className={styles.donePopUndo} onClick={onUndo}>
        {STR.important.doneUndo}
      </button>
    </div>
  );
}
