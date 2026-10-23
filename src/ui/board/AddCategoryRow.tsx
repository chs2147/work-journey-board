import { useEffect, useRef } from "react";
import { STR } from "../../shared/strings";
import { addCategory, setAddOpen, useBoard } from "./boardStore";
import { isComposingKey } from "./helpers";
import styles from "./Board.module.css";

/** 격자 맨 아래 "+ 업무 추가" 행. Enter로 만들고 입력칸은 열어 둔다(연속 추가), Esc로 닫는다. */
export function AddCategoryRow() {
  const open = useBoard((s) => s.addOpen);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  return (
    <div className={styles.addRow}>
      {open ? (
        <input
          ref={inputRef}
          className={styles.addInput}
          placeholder={STR.board.addCategoryPlaceholder}
          aria-label={STR.board.addCategory}
          maxLength={40}
          onKeyDown={async (e) => {
            if (isComposingKey(e)) return;
            if (e.key === "Escape") {
              setAddOpen(false);
              return;
            }
            if (e.key !== "Enter") return;
            const el = e.currentTarget;
            const name = el.value;
            if (!name.trim()) return;
            if (await addCategory(name)) {
              el.value = "";
              el.focus();
            }
          }}
          onBlur={(e) => {
            if (!e.currentTarget.value.trim()) setAddOpen(false);
          }}
        />
      ) : (
        <button type="button" className={styles.addButton} onClick={() => setAddOpen(true)}>
          {STR.board.addCategory}
        </button>
      )}
    </div>
  );
}
