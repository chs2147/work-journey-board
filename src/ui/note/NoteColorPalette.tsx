import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { TEXT_COLORS } from "../../domain/note";
import { STR } from "../../shared/strings";
import styles from "./Note.module.css";

const colors = ["default", ...TEXT_COLORS] as const;
export function NoteColorPalette({
  editor,
  color,
  mixed,
}: {
  editor: Editor;
  color: string;
  mixed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: globalThis.PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    wrap.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    if (mixed) wrap.current?.querySelector<HTMLButtonElement>('[role="radio"]')?.focus();
    return () => document.removeEventListener("pointerdown", close);
  }, [open, mixed]);
  return (
    <span ref={wrap} className={styles.colorWrap}>
      <button
        ref={trigger}
        type="button"
        className={styles.tool}
        aria-label={STR.note.color}
        title={mixed ? STR.notePalette.mixed : STR.note.color}
        aria-haspopup="true"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`${styles.colorA} note-c-${color}`}>A</span>{" "}
        {mixed ? STR.notePalette.mixed : STR.notePalette.title} ▾
      </button>
      {open && (
        <span
          className={styles.colorMenu}
          role="radiogroup"
          aria-label={STR.notePalette.title}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
              trigger.current?.focus();
              return;
            }
            if (["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
              e.preventDefault();
              const buttons = [...wrap.current!.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
              const next =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? buttons.length - 1
                    : (index + (["ArrowLeft", "ArrowUp"].includes(e.key) ? -1 : 1) + buttons.length) %
                      buttons.length;
              buttons[next]?.focus();
            }
            if (e.key === "Tab") setOpen(false);
          }}
        >
          {colors.map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={!mixed && color === v}
              aria-label={STR.note.colors[v]}
              title={STR.note.colors[v]}
              className={`${styles.swatch} ${styles[`swatch_${v}`]}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const c = editor.chain().focus();
                if (v === "default") c.unsetMark("textColor").run();
                else c.setMark("textColor", { color: v }).run();
                setOpen(false);
              }}
            >
              {!mixed && color === v ? "✓" : "A"}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
