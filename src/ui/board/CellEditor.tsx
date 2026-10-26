// 셀 하나의 개조식 입력기. 항목마다 <textarea> 1개(자동 높이) — contenteditable의 커서·IME 문제를 피한다(i-m1-plan 4절).
// 키 동작은 overview 10-3절 표가 기준이다. 한글 조합 중(isComposing)에는 Enter·Tab 등을 처리하지 않는다.
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { hasLink } from "../../domain/links";
import { deleteRange, indentAt, moveItem, outdentAt, parsePastedLines } from "../../domain/items";
import type { ItemDraft } from "../../domain/types";
import { STR } from "../../shared/strings";
import { DAY_LABELS, dayIndex } from "../../domain/week";
import {
  deleteItemAt,
  editCell,
  leaveCell,
  materializePreview,
  newDraft,
  pullLabel,
  pullPrevious,
  setFocus,
  setFocusDay,
  splitKey,
  toggleFlag,
  toast,
  toggleRepeat,
  useBoard,
} from "./boardStore";
import { pasteImagesFromBoard } from "../note/noteStore";
import { autoSize, isComposingKey, useRemeasure } from "./helpers";
import { LinkedText } from "./LinkedText";
import { IconTrash } from "../common/icons";
import styles from "./Board.module.css";

export interface CellNav {
  /** 위·아래 칸으로 이동(없으면 false) */
  up(): boolean;
  down(): boolean;
}

interface Props {
  cellKey: string;
  ariaLabel: string;
  showPlaceholder: boolean;
  nav: CellNav;
  /** 빈 칸의 [직전 기록일 내역 가져오기] 단추 — 오늘 뷰는 카드 아래 미리보기 줄이 대신한다 */
  pullButton?: boolean;
}

export function CellEditor({ cellKey, ariaLabel, showPlaceholder, nav, pullButton = true }: Props) {
  const items = useBoard((s) => s.cells[cellKey]) ?? [];
  const focus = useBoard((s) => s.focus);
  const pulseId = useBoard((s) => s.pulseId);
  const repeating = useBoard((s) => s.repeating);
  const previews = useBoard((s) => s.previews[cellKey]);
  const prevDate = useBoard((s) => s.prevDates[splitKey(cellKey).categoryId]);
  const refs = useRef<(HTMLTextAreaElement | null)[]>([]);
  /** 입력칸에 커서가 있는 항목 — 링크가 든 항목은 이때만 입력칸, 아니면 "보기"(improve-1026-spec 9-1) */
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  /** 삭제 단추에 마우스를 올린 항목 — 지워질 묶음을 붉게 미리 보인다(improve-1026v2-spec 2절) */
  const [deleteHover, setDeleteHover] = useState<number | null>(null);
  const [delStart, delEnd] = deleteHover === null ? [-1, -1] : deleteRange(items, deleteHover);
  const containerRef = useRef<HTMLDivElement>(null);
  const measureAll = useCallback(() => refs.current.forEach(autoSize), []);
  useRemeasure(containerRef, measureAll);

  // 스토어가 요청한 위치로 커서를 옮긴다(항목 추가·이동·칸 이동 후).
  useLayoutEffect(() => {
    if (focus?.kind !== "item" || focus.key !== cellKey) return;
    const el = refs.current[focus.index];
    if (!el) return;
    el.focus();
    const pos = focus.caret === "start" ? 0 : focus.caret === "end" ? el.value.length : focus.caret;
    el.setSelectionRange(pos, pos);
    setFocus(null);
  }, [focus, cellKey, items.length]);

  useLayoutEffect(() => {
    refs.current.length = items.length;
    refs.current.forEach(autoSize);
  });

  const update = (next: ItemDraft[], index: number, caret: "start" | "end" | number) =>
    editCell(cellKey, next, { kind: "item", key: cellKey, index, caret });

  const startEditing = () => {
    setFocusDay(splitKey(cellKey).date);
    if (items.length === 0) update([newDraft()], 0, "end");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>, i: number) => {
    if (isComposingKey(e)) return;
    const ta = e.currentTarget;
    const { selectionStart: s, selectionEnd: t, value } = ta;
    const item = items[i]!;
    const plain = !e.altKey && !e.ctrlKey && !e.metaKey;

    // 중요 표시 켜기/끄기(important-repeat-spec 2-2). 한국어 자판에서도 되도록 e.code로 본다.
    if (e.code === "KeyI" && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      void toggleFlag(cellKey, i);
      return;
    }
    // 직전 기록 가져오기(improve-1026-spec 3-2) — 그 업무의 직전 기록일 내역을 이 칸 끝에
    if (e.code === "KeyP" && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      void pullPrevious(cellKey);
      return;
    }
    // 행 삭제(improve-1026v2-spec 1-1) — 본 항목이면 딸린 세부 항목까지
    if (e.key === "Delete" && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      void deleteItemAt(cellKey, i, true);
      return;
    }
    // 매주 반복 켜기/끄기(spec 3-1) — 세부 항목에서 눌러도 본 항목 묶음에 적용
    if (e.code === "KeyR" && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      void toggleRepeat(cellKey, i);
      return;
    }

    if (e.key === "Enter" && plain && !e.shiftKey) {
      e.preventDefault();
      const next = [...items];
      next[i] = { ...item, text: value.slice(0, s) };
      // 본 항목 끝에서 Enter인데 세부 항목이 딸려 있으면 첫 세부 항목으로 넣는다(세부 항목의 소속이 바뀌지 않게).
      const depth = item.depth === 0 && items[i + 1]?.depth === 1 && t === value.length ? 1 : item.depth;
      next.splice(i + 1, 0, newDraft(value.slice(t), depth));
      update(next, i + 1, "start");
      return;
    }
    if (e.key === "Tab" && plain) {
      e.preventDefault();
      update(e.shiftKey ? outdentAt(items, i) : indentAt(items, i), i, s);
      return;
    }
    if (e.key === "Backspace" && plain && s === 0 && t === 0) {
      if (value === "") {
        if (items.length === 1) return;
        e.preventDefault();
        const next = items.filter((_, j) => j !== i);
        if (next[0]?.depth === 1) next[0] = { ...next[0], depth: 0 };
        if (i > 0) update(next, i - 1, "end");
        else update(next, 0, "start");
        return;
      }
      if (item.depth === 1) {
        e.preventDefault();
        update(outdentAt(items, i), i, 0);
      }
      return;
    }
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const moved = moveItem(items, i, e.key === "ArrowUp" ? -1 : 1);
      update(moved.items, moved.index, s);
      return;
    }
    if (e.key === "ArrowUp" && plain && !e.shiftKey && s === t && !value.slice(0, s).includes("\n")) {
      if (i > 0) {
        e.preventDefault();
        setFocus({ kind: "item", key: cellKey, index: i - 1, caret: "end" });
      } else if (nav.up()) e.preventDefault();
      return;
    }
    if (e.key === "ArrowDown" && plain && !e.shiftKey && s === t && !value.slice(t).includes("\n")) {
      if (i < items.length - 1) {
        e.preventDefault();
        setFocus({ kind: "item", key: cellKey, index: i + 1, caret: "start" });
      } else if (nav.down()) e.preventDefault();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      ta.blur();
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>, i: number) => {
    // 글 없이 그림만(캡처) — 보드 칸은 글만 받으므로 메모에 붙일 길을 안내(weekly-note-spec 14절 F3)
    const images = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
    if (images.length && !e.clipboardData.getData("text/plain").trim()) {
      e.preventDefault();
      toast(STR.note.pasteToNote, {
        label: STR.note.pasteToNoteAction,
        run: () => pasteImagesFromBoard(images),
      });
      return;
    }
    const parsed = parsePastedLines(e.clipboardData.getData("text/plain"));
    if (!parsed) return; // 한 줄은 기본 붙여넣기
    e.preventDefault();
    const drafts = parsed.map((p) => newDraft(p.text, p.depth));
    const next = [...items];
    const current = items[i]!;
    if (current.text.trim() === "") {
      next.splice(i, 1, ...drafts);
      if (i === 0) next[0] = { ...next[0]!, depth: 0 };
      update(next, i + drafts.length - 1, "end");
    } else {
      next.splice(i + 1, 0, ...drafts);
      update(next, i + drafts.length, "end");
    }
  };

  const onChange = (i: number, text: string) => {
    const next = [...items];
    next[i] = { ...items[i]!, text };
    editCell(cellKey, next);
  };

  return (
    <div
      ref={containerRef}
      className={styles.cellBody}
      onFocus={() => setFocusDay(splitKey(cellKey).date)}
      onBlur={(e) => {
        if (!containerRef.current?.contains(e.relatedTarget as Node | null)) void leaveCell(cellKey);
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && items.length === 0) {
          e.preventDefault();
          startEditing();
        }
      }}
    >
      {items.map((it, i) => {
        const isRepeating = it.depth === 0 && !!it.recurrenceId && repeating.includes(it.recurrenceId);
        // 링크가 든 항목은 편집 중(커서가 있거나 막 커서를 넣으려는 중)이 아니면 링크로 그린다
        const viewing =
          activeIndex !== i &&
          !(focus?.kind === "item" && focus.key === cellKey && focus.index === i) &&
          hasLink(it.text);
        return (
          <div
            key={it.id}
            className={[
              it.depth === 1 ? styles.itemSub : styles.item,
              it.flagged ? styles.flagged : "",
              isRepeating ? styles.repeating : "",
              pulseId === it.id ? styles.pulse : "",
              i >= delStart && i < delEnd ? styles.deleting : "",
            ].join(" ")}
            data-flagged={it.flagged ? "true" : undefined}
            data-repeating={isRepeating ? "true" : undefined}
          >
            {/* 개조 부호 = 중요 표시 단추. 마우스를 올리면 ☆, 켜지면 ★. 키보드는 Alt+I(Tab 순서에서는 뺀다) */}
            <button
              type="button"
              tabIndex={-1}
              className={styles.bullet}
              aria-label={it.flagged ? STR.important.flagOff : STR.important.flagOn}
              aria-pressed={Boolean(it.flagged)}
              title={it.flagged ? STR.important.flagOff : STR.important.flagOn}
              disabled={!it.text.trim()}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void toggleFlag(cellKey, i)}
            />
            {viewing ? (
              <LinkedText
                text={it.text}
                ariaLabel={ariaLabel}
                onEdit={(caret) => {
                  setFocusDay(splitKey(cellKey).date);
                  setFocus({ kind: "item", key: cellKey, index: i, caret });
                }}
              />
            ) : (
              <textarea
                ref={(el) => {
                  refs.current[i] = el;
                }}
                className={styles.itemInput}
                rows={1}
                value={it.text}
                aria-label={ariaLabel}
                spellCheck={false}
                onFocus={() => setActiveIndex(i)}
                onBlur={() => setActiveIndex((a) => (a === i ? null : a))}
                onChange={(e) => onChange(i, e.target.value)}
                onKeyDown={(e) => onKeyDown(e, i)}
                onPaste={(e) => onPaste(e, i)}
              />
            )}
            {/* 매주 반복: 반복 중이면 ↻를 늘 보이고(누르면 끔), 아니면 마우스를 올릴 때만 ↻(누르면 켬) */}
            {it.depth === 0 && it.text.trim() && (
              <button
                type="button"
                tabIndex={-1}
                className={isRepeating ? styles.repeatOn : styles.repeatHover}
                aria-label={isRepeating ? STR.repeat.toggleOff : STR.repeat.toggleOn}
                aria-pressed={isRepeating}
                title={
                  isRepeating
                    ? `${STR.repeat.badge(DAY_LABELS[dayIndex(splitKey(cellKey).date)]!)} · ${STR.repeat.toggleOff}`
                    : STR.repeat.toggleOn
                }
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void toggleRepeat(cellKey, i)}
              >
                ↻
              </button>
            )}
            {(it.text.trim() || items.length > 1) && (
              <button
                type="button"
                tabIndex={-1}
                className={styles.deleteRow}
                aria-label={deleteLabel(items, i)}
                title={deleteLabel(items, i)}
                data-testid="delete-row"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setDeleteHover(i)}
                onMouseLeave={() => setDeleteHover(null)}
                onClick={() => {
                  setDeleteHover(null);
                  void deleteItemAt(cellKey, i);
                }}
              >
                <IconTrash />
              </button>
            )}
          </div>
        );
      })}
      {previews?.map((p) => (
        <button
          key={p.rule.id}
          type="button"
          className={styles.preview}
          aria-label={STR.repeat.previewAria(p.rule.lines[0]?.text ?? "")}
          data-testid="repeat-preview"
          onClick={() => void materializePreview(cellKey, p.rule.id)}
        >
          <span className={styles.previewText}>{p.rule.lines[0]?.text}</span>
          {p.rule.lines.length > 1 && (
            <span className={styles.previewNote}>{STR.repeat.subCount(p.rule.lines.length - 1)}</span>
          )}
          <span className={styles.previewNote}>{STR.repeat.preview}</span>
        </button>
      ))}
      {items.length === 0 && !previews?.length && showPlaceholder && (
        <button type="button" className={styles.addRecord} onClick={startEditing}>
          {STR.board.addRecord}
        </button>
      )}
      {items.length === 0 && showPlaceholder && pullButton && prevDate && (
        <button
          type="button"
          className={styles.pullButton}
          data-testid="pull-previous"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void pullPrevious(cellKey)}
        >
          {STR.pull.button(pullLabel(prevDate))}
          <span className={styles.menuKey}>{STR.pull.key}</span>
        </button>
      )}
    </div>
  );
}

/** 본 항목에 세부 항목이 딸려 있으면 함께 지워진다는 것을 이름에 */
function deleteLabel(items: ItemDraft[], i: number) {
  const [start, end] = deleteRange(items, i);
  const subs = end - start - 1;
  return items[i]?.depth === 0 && subs > 0 ? STR.board.deleteGroup(subs) : STR.board.deleteRow;
}
