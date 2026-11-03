import { useEffect, useRef } from "react";
import { STR } from "../../shared/strings";
import { addCategory, setAddOpen, useBoard } from "./boardStore";
import { handleEnterCommit, isComposingKey } from "./helpers";
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
          onKeyDown={(e) => {
            if (e.key === "Escape" && !isComposingKey(e)) {
              setAddOpen(false);
              return;
            }
            // 맥 한글 확정 Enter도 추가로(improve-1103v8-spec T2)
            handleEnterCommit(e, (el) => {
              const name = el.value;
              if (!name.trim()) return;
              el.value = "";
              void addCategory(name).then((ok) => {
                if (ok) el.focus();
                else if (!el.value) el.value = name;
              });
            });
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
