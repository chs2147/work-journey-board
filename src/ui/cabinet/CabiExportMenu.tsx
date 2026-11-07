import { useEffect, useId, useRef, useState } from "react";
import { CABI } from "../../shared/cabiStrings";
import { IconExportFile } from "../common/icons";
import { reportError } from "../board/boardStore";
import styles from "./Cabi.module.css";

export function CabiExportMenu({ items }: { items: { label: string; run(): Promise<unknown> }[] }) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const lock = useRef(false),
    id = useId();
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", outside, true);
    return () => window.removeEventListener("pointerdown", outside, true);
  }, [open]);
  return (
    <span
      ref={wrap}
      className={styles.exportWrap}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.preventDefault();
          e.stopPropagation();
          close();
        } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          e.stopPropagation();
          if (!open) {
            setOpen(true);
            return;
          }
          const els = [...wrap.current!.querySelectorAll<HTMLButtonElement>("[role=menuitem]")];
          const i = els.indexOf(document.activeElement as HTMLButtonElement);
          els[
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? els.length - 1
                : (i + (e.key === "ArrowUp" ? -1 : 1) + els.length) % els.length
          ]?.focus();
        } else if (e.key === "Tab") setOpen(false);
      }}
    >
      <button
        ref={trigger}
        className={styles.button}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
      >
        <IconExportFile />
        {CABI.export}
      </button>
      {open && (
        <div id={id} className={`${styles.menu} ${styles.exportMenu}`} role="menu" aria-label={CABI.export}>
          {items.map((item, i) => (
            <button
              key={item.label}
              role="menuitem"
              className={styles.button}
              autoFocus={i === 0}
              onClick={() => {
                if (lock.current) return;
                lock.current = true;
                setBusy(true);
                close();
                void item
                  .run()
                  .catch(reportError)
                  .finally(() => {
                    lock.current = false;
                    setBusy(false);
                  });
              }}
            >
              <IconExportFile />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
