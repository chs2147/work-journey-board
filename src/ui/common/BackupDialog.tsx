import { useEffect, useRef, type ReactNode } from "react";
import { STR } from "../../shared/strings";
import styles from "./BackupDialog.module.css";
export function BackupDialog({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null),
    close = useRef(onClose),
    busyRef = useRef(busy);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (!busyRef.current) close.current();
      }
      if (e.key === "Tab" && !ref.current?.contains(document.activeElement)) {
        e.preventDefault();
        ref.current
          ?.querySelector<HTMLElement>("button:not(:disabled),select:not(:disabled),input:not(:disabled)")
          ?.focus();
      }
    };
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("keydown", key, true);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div className={styles.backdrop} role="presentation">
      <div
        ref={ref}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            if (!busy) close.current();
          }
          if (e.key === "Tab") {
            const controls = [
              ...ref.current!.querySelectorAll<HTMLElement>(
                'button:not(:disabled),select:not(:disabled),input:not(:disabled),[tabindex="0"]',
              ),
            ].filter((el) => el.getClientRects().length);
            const first = controls[0],
              last = controls.at(-1);
            if (!first) {
              e.preventDefault();
              return;
            }
            if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
              e.preventDefault();
              last?.focus();
            } else if (
              !e.shiftKey &&
              (document.activeElement === last || document.activeElement === ref.current)
            ) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <h2>{title}</h2>
        {children}
        <div className={styles.footer}>
          <button type="button" disabled={busy} onClick={onClose}>
            {STR.backupV13.close}
          </button>
        </div>
      </div>
    </div>
  );
}
