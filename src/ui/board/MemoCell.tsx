import { useCallback, useLayoutEffect, useRef } from "react";
import type { DateStr } from "../../domain/week";
import { STR } from "../../shared/strings";
import { editMemo, leaveMemo, setFocus, setFocusDay, useBoard } from "./boardStore";
import { autoSize, isComposingKey, useRemeasure } from "./helpers";
import styles from "./Board.module.css";

/** 일일 메모(하루 1개, 여러 줄). 첫 줄에서 ↑ 이면 위 업무 칸으로. */
export function MemoCell({
  date,
  label,
  showPlaceholder,
  onUp,
}: {
  date: DateStr;
  label: string;
  showPlaceholder: boolean;
  onUp(): boolean;
}) {
  const text = useBoard((s) => s.memos[date] ?? "");
  const focus = useBoard((s) => s.focus);
  const ref = useRef<HTMLTextAreaElement>(null);
  const measure = useCallback(() => autoSize(ref.current), []);
  useRemeasure(ref, measure);

  useLayoutEffect(() => {
    autoSize(ref.current);
  });

  useLayoutEffect(() => {
    if (focus?.kind === "memo" && focus.date === date && ref.current) {
      ref.current.focus();
      ref.current.setSelectionRange(ref.current.value.length, ref.current.value.length);
      setFocus(null);
    }
  }, [focus, date]);

  return (
    <textarea
      ref={ref}
      className={styles.memoInput}
      rows={1}
      value={text}
      placeholder={showPlaceholder ? STR.board.memoPlaceholder : undefined}
      aria-label={STR.board.memoAria(label)}
      spellCheck={false}
      onFocus={() => setFocusDay(date)}
      onChange={(e) => editMemo(date, e.target.value)}
      onBlur={() => void leaveMemo(date)}
      onKeyDown={(e) => {
        if (isComposingKey(e)) return;
        const { selectionStart: s, selectionEnd: t, value } = e.currentTarget;
        if (e.key === "ArrowUp" && !e.altKey && !e.ctrlKey && s === t && !value.slice(0, s).includes("\n")) {
          if (onUp()) e.preventDefault();
        } else if (e.key === "Escape") {
          e.currentTarget.blur();
        }
      }}
    />
  );
}
