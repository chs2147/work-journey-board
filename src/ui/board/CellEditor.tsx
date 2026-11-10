import { openCabi } from "../cabinet/cabiService";
import { CABI } from "../../shared/cabiStrings";
// 셀 하나의 개조식 입력기. 항목마다 <textarea> 1개(자동 높이) — contenteditable의 커서·IME 문제를 피한다(i-m1-plan 4절).
// 키 동작은 overview 10-3절 표가 기준이다. 한글 조합 중(isComposing)에는 Enter·Tab 등을 처리하지 않는다.
import {
  Fragment,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { CopyDateDialog } from "./CopyDateDialog";
import { hasLink } from "../../domain/links";
import { deleteRange, indentAt, moveItem, outdentAt, parsePastedLines } from "../../domain/items";
import type { ItemDraft } from "../../domain/types";
import { STR } from "../../shared/strings";
import { DAY_LABELS, dayIndex } from "../../domain/week";
import {
  completeImportant,
  deleteItemAt,
  editCell,
  leaveCell,
  materializePreview,
  moveItemToDate,
  newDraft,
  pullLabel,
  pullPrevious,
  setFocus,
  setFocusDay,
  setDueDate,
  setStartTime,
  splitKey,
  toggleFlag,
  toast,
  toggleRepeat,
  undoImportant,
  useBoard,
} from "./boardStore";
import { doneDate, isDone } from "../../domain/important";
import { DonePopover } from "./DonePopover";
import { DueDatePopover, ItemMenu, MoveDatePopover, StartTimePopover } from "./ItemActions";
import { dueView } from "./dueView";
import { defaultStartTime } from "../../domain/startTime";
import { addLinkedBox, pasteImagesFromBoard, revealMemo, useNote } from "../note/noteStore";
import { autoSize, isComposingKey, useRemeasure } from "./helpers";
import { LinkedText } from "./LinkedText";
import {
  IconCompleteItem,
  IconUndoComplete,
  IconClock,
  IconDone,
  IconMoveDate,
  IconCopyItem,
  IconGrip,
  IconNote,
  IconRepeat,
  IconTrash,
} from "../common/icons";
import { startRowDrag, useLinkDrop, useLinkHover, useRowDrag } from "./rowDrag";
import { useCabinet, openCabinet, openItem as openCabinetItem } from "../cabinet/cabinetStore";
import { CabinetRailIcon } from "../cabinet/CabinetIcons";
import { addEntryToPack, openCard, useCardMarks } from "../universe/universeStore";
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
  const prevItems = useBoard((s) => s.prevItems[splitKey(cellKey).categoryId]);
  const prevDate = useBoard((s) => s.prevDates[splitKey(cellKey).categoryId]);
  const refs = useRef<(HTMLTextAreaElement | null)[]>([]);
  /** 입력칸에 커서가 있는 항목 — 링크가 든 항목은 이때만 입력칸, 아니면 "보기"(improve-1026-spec 9-1) */
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  /** 삭제 단추에 마우스를 올린 항목 — 지워질 묶음을 붉게 미리 보인다(improve-1026v2-spec 2절) */
  const [deleteHover, setDeleteHover] = useState<number | null>(null);
  /** 완료 뱃지 창이 열린 항목(improve-1027v4-spec 2-1) */
  const [doneOpen, setDoneOpen] = useState<number | null>(null);
  /** 항목 ⋯ 메뉴·시작 시각 창·다른 날로 옮기기 창(improve-1103v8-spec 5절) */
  const [tool, setTool] = useState<{ i: number; kind: "menu" | "time" | "move" | "due" | "copy" } | null>(
    null,
  );
  const today = useBoard((s) => s.today);
  const closeTool = (i: number) => {
    setTool(null);
    refs.current[i]?.focus();
  };
  const subsOf = (i: number) => {
    if (items[i]?.depth !== 0) return 0;
    let n = 0;
    for (let j = i + 1; j < items.length && items[j]!.depth === 1; j++) if (items[j]!.text.trim()) n++;
    return n;
  };
  const [delStart, delEnd] = deleteHover === null ? [-1, -1] : deleteRange(items, deleteHover);
  // 행 끌어서 옮기기(improve-1026v2-spec 3절): 원래 자리는 흐리게, 놓을 칸은 테두리, 놓을 틈에 파란 선
  const drag = useRowDrag((s) => s.drag);
  // 연결된 메모 수(improve-1026v2-spec 6-2) — 이 칸 항목에 걸린 것만 글자열로 골라 메모 글을 칠 때마다 다시 그리지 않게
  const linkKey = useNote((st) => {
    const ids = new Set(items.map((x) => x.id));
    let out = "";
    for (const b of st.doc.boxes) {
      if (b.id === st.pendingId) continue;
      // 한 상자가 여러 항목에 연결될 수 있다(multi-link-spec 6절) — 항목마다 셈
      for (const r of b.refs ?? []) if (ids.has(r.item)) out += `${r.item},`;
    }
    return out;
  });
  const foreignMemos = useBoard((s) =>
    s.memoLinks
      .filter((l) => l.weekId !== s.weekId && items.some((i) => i.id === l.entryId))
      .map((l) => `${l.entryId}:${l.weekId}:${l.boxId}:${l.taskCategoryId ?? ""}`)
      .join(","),
  );
  const foreignOf: Record<string, { weekId: string; boxId: string; taskCategoryId?: string }[]> = {};
  for (const value of foreignMemos.split(",")) {
    const [id, weekId, boxId, taskCategoryId] = value.split(":");
    if (id && (weekId || taskCategoryId) && boxId)
      (foreignOf[id] ??= []).push({ weekId: weekId ?? "", boxId, taskCategoryId });
  }
  // Cabinet 연결(features-1102-spec F5) — 이 칸 항목에 연결된 폴더·링크 id(글자열로 골라 다시 그리기 줄임)
  const cabKey = useCabinet((st) => {
    const ids = new Set(items.map((x) => x.id));
    return st.links
      .filter((l) => l.entryId && ids.has(l.entryId))
      .map((l) => `${l.entryId}:${l.itemId}`)
      .join(",");
  });
  const cabOf: Record<string, string[]> = {};
  for (const pair of cabKey.split(",")) {
    const [eid, cid] = pair.split(":");
    if (eid && cid) (cabOf[eid] ??= []).push(cid);
  }
  // 지식 카드 출처(UV3 ◆) — 이 칸 항목만
  const cardKey = useCardMarks((st) =>
    items
      .filter((x) => st.byEntry[x.id]?.length)
      .map((x) => `${x.id}:${st.byEntry[x.id]!.join("+")}`)
      .join(","),
  );
  const cardsOf: Record<string, string[]> = {};
  for (const pair of cardKey.split(",")) {
    const [eid, ids] = pair.split(":");
    if (eid && ids) cardsOf[eid] = ids.split("+");
  }
  const linkCount: Record<string, number> = {};
  for (const [id, links] of Object.entries(foreignOf)) linkCount[id] = links.length;
  for (const id of linkKey.split(",")) if (id) linkCount[id] = (linkCount[id] ?? 0) + 1;
  const linkTarget = useLinkDrop((st) => st.itemId);
  const linkAlready = useLinkDrop((st) => st.linked);
  const linkHover = useLinkHover((st) => st.itemId);
  const dragFrom = drag?.fromKey === cellKey ? drag : null;
  const dropGap = drag?.overKey === cellKey ? drag.gap : null;
  const dropLine = (
    <div
      className={drag?.sub ? styles.dropLineSub : styles.dropLine}
      data-testid="drop-line"
      aria-hidden="true"
    />
  );
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
    // 처리 완료한 항목이면 완료 창(처리한 때 · [되돌리기])을 연다(improve-1027v4-spec 2-1)
    if (e.code === "KeyI" && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      if (isDone(item)) setDoneOpen(i);
      else void toggleFlag(cellKey, i);
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
    // 시작 시각(improve-1103v8-spec T1) · 다른 날로 옮기기(T4) · 마감일(improve-1104v10-spec)
    if (
      (e.code === "KeyO" || e.code === "KeyD" || e.code === "KeyU") &&
      e.altKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.shiftKey
    ) {
      e.preventDefault();
      if (item.text.trim())
        setTool({ i, kind: e.code === "KeyO" ? "time" : e.code === "KeyU" ? "due" : "move" });
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
      className={[
        styles.cellBody,
        drag?.overKey === cellKey && drag.fromKey !== cellKey ? styles.dropCell : "",
      ].join(" ")}
      data-cell-editor
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
          <Fragment key={it.id}>
            {dropGap === i && dropLine}
            <div
              className={[
                it.depth === 1 ? styles.itemSub : styles.item,
                it.flagged ? styles.flagged : "",
                isDone(it) ? styles.completedItem : "",
                isRepeating ? styles.repeating : "",
                pulseId === it.id ? styles.pulse : "",
                i >= delStart && i < delEnd ? styles.deleting : "",
                dragFrom && i >= dragFrom.start && i < dragFrom.end ? styles.dragSource : "",
                linkCount[it.id] ? styles.linked : "",
                cabOf[it.id] ? styles.cab : "",
                cardsOf[it.id] ? styles.carded : "",
                linkTarget === it.id || linkHover === it.id ? styles.linkTarget : "",
                it.startTime ? styles.hasTime : "",
                it.dueDate && it.text.trim() ? styles.hasDue : "",
              ].join(" ")}
              data-item-index={i}
              onContextMenu={(e) => {
                // 오른쪽 클릭 = 항목 ⋯ 메뉴(improve-1103v8-spec 5절) — 글을 고른 채면 기본 메뉴(복사 등)
                if (!it.text.trim() || window.getSelection()?.toString()) return;
                e.preventDefault();
                refs.current[i]?.focus();
                setTool({ i, kind: "menu" });
              }}
              data-item-id={it.text.trim() ? it.id : undefined}
              data-foreign-memo={foreignOf[it.id]?.length ? "true" : undefined}
              data-done={isDone(it) ? "true" : undefined}
              data-flagged={it.flagged ? "true" : undefined}
              data-repeating={isRepeating ? "true" : undefined}
            >
              {/* 개조 부호 = 중요 표시 단추. 마우스를 올리면 ☆, 켜지면 ★. 키보드는 Alt+I(Tab 순서에서는 뺀다)
                  처리 완료한 중요 항목은 초록 완료 뱃지 — 누르면 완료 창(improve-1027v4-spec 2-1) */}
              {isDone(it) ? (
                <button
                  type="button"
                  tabIndex={-1}
                  className={`${styles.bullet} ${styles.bulletDone}`}
                  aria-label={STR.important.doneBadge(doneDate(it.flagDoneAt!))}
                  title={STR.important.doneBadge(doneDate(it.flagDoneAt!))}
                  aria-haspopup="dialog"
                  aria-expanded={doneOpen === i}
                  data-testid="done-badge"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setDoneOpen(doneOpen === i ? null : i)}
                >
                  <IconDone size={14} />
                </button>
              ) : (
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
              )}
              {doneOpen === i && isDone(it) && (
                <DonePopover
                  at={it.flagDoneAt!}
                  onUndo={() => {
                    setDoneOpen(null);
                    void undoImportant(it.id).then(() => refs.current[i]?.focus());
                  }}
                  onClose={() => {
                    setDoneOpen(null);
                    refs.current[i]?.focus();
                  }}
                />
              )}
              {it.text.trim() && (
                <button
                  type="button"
                  className={styles.completionAction}
                  aria-label={
                    isDone(it) ? STR.itemCompletion.undo(it.text) : STR.itemCompletion.complete(it.text)
                  }
                  title={isDone(it) ? STR.itemCompletion.undo(it.text) : STR.itemCompletion.complete(it.text)}
                  aria-pressed={isDone(it)}
                  data-testid="item-completion"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void (isDone(it) ? undoImportant(it.id) : completeImportant(it.id))}
                >
                  {isDone(it) ? <IconUndoComplete /> : <IconCompleteItem />}
                </button>
              )}
              {/* ⋮⋮ 끌기 손잡이(improve-1026v2-spec 3-1) — 부호 단추 다음(자리는 CSS로 왼쪽 여백) */}
              {it.text.trim() && (
                <button
                  type="button"
                  tabIndex={-1}
                  className={styles.grip}
                  aria-label={STR.board.dragRow}
                  title={STR.itemTools.gripTitle}
                  data-testid="drag-row"
                  aria-haspopup="menu"
                  aria-expanded={tool?.i === i && tool.kind === "menu"}
                  onPointerDown={(e) =>
                    // 끌면 옮기기, 누르기만 하면 항목 메뉴(improve-1103v9-spec N1 C안)
                    startRowDrag(e, cellKey, i, () => {
                      refs.current[i]?.focus();
                      setTool({ i, kind: "menu" });
                    })
                  }
                >
                  <GripDots />
                </button>
              )}
              {/* 시작 시각 꼬리표(T1) — 글 첫 줄 앞, 누르면 시각 고르기 */}
              {it.startTime && it.text.trim() && (
                <button
                  type="button"
                  tabIndex={-1}
                  className={styles.timeChip}
                  title={STR.startTime.chipTitle(it.startTime)}
                  aria-label={STR.startTime.chipTitle(it.startTime)}
                  data-testid="start-time-chip"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setTool({ i, kind: "time" })}
                >
                  {STR.startTime.chip(it.startTime)}
                </button>
              )}
              {/* 마감일 꼬리표(improve-1104v10-spec 2-1) — 글 끝(아래 오른쪽), 누르면 마감일 고르기 */}
              {it.dueDate && it.text.trim() && (
                <DueChip today={today} due={it.dueDate} onOpen={() => setTool({ i, kind: "due" })} />
              )}
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
              {/* 매주 반복 중이면 ↻를 상태로 보인다(누르면 끔). 켜기는 항목 메뉴·Alt+R(improve-1103v9-spec N1) */}
              {isRepeating && it.text.trim() && (
                <button
                  type="button"
                  tabIndex={-1}
                  className={styles.repeatOn}
                  aria-label={STR.repeat.toggleOff}
                  aria-pressed
                  title={`${STR.repeat.badge(DAY_LABELS[dayIndex(splitKey(cellKey).date)]!)} · ${STR.repeat.toggleOff}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void toggleRepeat(cellKey, i)}
                >
                  ↻
                </button>
              )}
              {/* 지식 카드 출처 ◆(UV3) — 누르면 Universe에서 그 카드 */}
              {cardsOf[it.id] && (
                <button
                  type="button"
                  tabIndex={-1}
                  className={styles.cardBadge}
                  aria-label={STR.universe.card.boardMark(cardsOf[it.id]!.length)}
                  title={STR.universe.card.boardMark(cardsOf[it.id]!.length)}
                  data-testid="card-badge"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void openCard(cardsOf[it.id]![0]!)}
                >
                  ◆
                </button>
              )}
              {/* Cabinet 표시 — 하나면 그 폴더 창·링크, 여럿이면 Cabinet에서 */}
              {cabOf[it.id] && (
                <button
                  type="button"
                  tabIndex={-1}
                  className={styles.cabBadge}
                  aria-label={STR.cabinet.entryIcon(cabOf[it.id]!.length)}
                  title={STR.cabinet.entryIcon(cabOf[it.id]!.length)}
                  data-testid="cabinet-badge"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    const ids = cabOf[it.id]!;
                    if (ids.length === 1) void openCabinetItem(ids[0]!);
                    else void openCabinet({ itemId: ids[0] });
                  }}
                >
                  <CabinetRailIcon />
                </button>
              )}
              {/* 연결된 메모 배지 — 누르면 그 메모 상자로 */}
              {linkCount[it.id] && (
                <button
                  type="button"
                  tabIndex={-1}
                  className={styles.memoBadge}
                  aria-label={STR.linked.badge(linkCount[it.id]!)}
                  title={
                    STR.linked.badge(linkCount[it.id]!) +
                    (foreignOf[it.id]?.length ? ` · 원본 주차 ${foreignOf[it.id]![0]!.weekId}` : "")
                  }
                  data-testid="memo-badge"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    const note = useNote.getState();
                    const first = note.doc.boxes.find((b) => b.refs?.some((r) => r.item === it.id));
                    const foreign = foreignOf[it.id]?.[0];
                    if (foreign?.taskCategoryId) void openCabi("board", foreign.taskCategoryId);
                    else if (foreign) void revealMemo(foreign.weekId, foreign.boxId);
                    else if (first) void revealMemo(note.weekId, first.id);
                  }}
                >
                  <IconNote />
                  {linkCount[it.id]}
                  {foreignOf[it.id]?.[0] && (
                    <span className={styles.memoWeek}>
                      {foreignOf[it.id]![0]!.taskCategoryId
                        ? CABI.name
                        : foreignOf[it.id]![0]!.weekId.slice(5)}
                    </span>
                  )}
                </button>
              )}
              {linkTarget === it.id && (
                <span
                  className={`${styles.linkTargetLabel} ${linkAlready ? styles.linkTargetLinked : ""}`}
                  aria-hidden="true"
                  data-testid="link-drop-label"
                >
                  {linkAlready ? STR.linked.dropLinked : STR.linked.dropAdd}
                </span>
              )}
              {tool?.i === i && tool.kind === "menu" && (
                <ItemMenu
                  onClose={() => {
                    setDeleteHover(null);
                    closeTool(i);
                  }}
                  entries={[
                    {
                      key: "memo",
                      icon: <IconNote />,
                      label: STR.linked.create,
                      onSelect: () => {
                        setTool(null);
                        addLinkedBox(it.id);
                      },
                    },
                    {
                      key: "pack",
                      icon: <span aria-hidden="true">＋</span>,
                      label: STR.universe.pack.add,
                      onSelect: () => {
                        setTool(null);
                        addEntryToPack(it.id);
                      },
                    },
                    ...(it.depth === 0
                      ? [
                          {
                            key: "repeat",
                            icon: <IconRepeat />,
                            label: isRepeating ? STR.itemTools.repeatOff : STR.itemTools.repeatOn,
                            shortcut: "Alt+R",
                            onSelect: () => {
                              closeTool(i);
                              void toggleRepeat(cellKey, i);
                            },
                          },
                        ]
                      : []),
                    {
                      key: "time",
                      icon: <IconClock />,
                      label: STR.itemTools.time,
                      shortcut: STR.itemTools.timeKey,
                      onSelect: () => setTool({ i, kind: "time" }),
                    },
                    {
                      key: "due",
                      icon: <span aria-hidden="true">⏳</span>,
                      label: STR.itemTools.due,
                      shortcut: STR.itemTools.dueKey,
                      onSelect: () => setTool({ i, kind: "due" }),
                    },
                    {
                      key: "move",
                      icon: <IconMoveDate />,
                      label: STR.itemTools.move,
                      shortcut: STR.itemTools.moveKey,
                      onSelect: () => setTool({ i, kind: "move" }),
                    },
                    {
                      key: "copy",
                      icon: <IconCopyItem />,
                      label: STR.copyDate.menu,
                      onSelect: () => setTool({ i, kind: "copy" }),
                    },
                    {
                      key: "delete",
                      icon: <IconTrash />,
                      label: deleteMenuLabel(items, i),
                      shortcut: "Alt+Delete",
                      danger: true,
                      separator: true,
                      onHover: (on) => setDeleteHover(on ? i : null),
                      onSelect: () => {
                        setDeleteHover(null);
                        setTool(null);
                        void deleteItemAt(cellKey, i, true);
                      },
                    },
                  ]}
                />
              )}
              {tool?.i === i && tool.kind === "time" && (
                <StartTimePopover
                  date={splitKey(cellKey).date}
                  initial={it.startTime ?? defaultStartTime(splitKey(cellKey).date === today, new Date())}
                  hasValue={!!it.startTime}
                  onSave={(t) => {
                    closeTool(i);
                    void setStartTime(cellKey, i, t);
                  }}
                  onClose={() => closeTool(i)}
                />
              )}
              {tool?.i === i && tool.kind === "due" && (
                <DueDatePopover
                  text={it.text}
                  today={today}
                  initial={it.dueDate ?? null}
                  hasValue={!!it.dueDate}
                  onSave={(d) => {
                    closeTool(i);
                    void setDueDate(cellKey, i, d);
                  }}
                  onClose={() => closeTool(i)}
                />
              )}
              {tool?.i === i && tool.kind === "copy" && (
                <CopyDateDialog cellKey={cellKey} itemId={it.id} onClose={() => closeTool(i)} />
              )}
              {tool?.i === i && tool.kind === "move" && (
                <MoveDatePopover
                  from={splitKey(cellKey).date}
                  today={today}
                  subs={subsOf(i)}
                  onMove={(d) => {
                    setTool(null);
                    void moveItemToDate(cellKey, i, d);
                  }}
                  onClose={() => closeTool(i)}
                />
              )}
            </div>
          </Fragment>
        );
      })}
      {dropGap !== null && dropGap >= items.length && dropLine}
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
          aria-label={
            prevItems?.length === 0 ? STR.itemCompletion.emptyPrevious : STR.pull.button(pullLabel(prevDate))
          }
          disabled={prevItems?.length === 0}
          title={prevItems?.length === 0 ? STR.itemCompletion.emptyPrevious : STR.pull.key}
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
function deleteMenuLabel(items: ItemDraft[], i: number) {
  const [start, end] = deleteRange(items, i);
  const subs = end - start - 1;
  return items[i]?.depth === 0 && subs > 0 ? STR.itemTools.deleteGroup(subs) : STR.itemTools.delete;
}

/** ⋮⋮ 손잡이 — 점 6개(2×3), 노션처럼 또렷하게(improve-1103v9-spec N1) · 공용 IconGrip(improve-v20-spec D5) */
const GripDots = () => <IconGrip />;

/** 마감일 꼬리표 — 남은 날·색은 오늘 기준(지남·오늘·7일 안·그 뒤) */
function DueChip({ today, due, onOpen }: { today: string; due: string; onOpen(): void }) {
  const v = dueView(today, due);
  const md = due.slice(5).replace("-", "/");
  return (
    <button
      type="button"
      tabIndex={-1}
      className={`${styles.dueChip} ${styles[`due_${v.kind}`] ?? ""}`}
      title={STR.dueDate.chipTitle(md)}
      aria-label={`${v.chip} — ${STR.dueDate.chipTitle(md)}`}
      data-testid="due-chip"
      data-due-kind={v.kind}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onOpen}
    >
      {/* 좁은 칸에서는 날짜 쪽만 줄여(…) 남은 날·지남 글은 늘 보인다 */}
      <span className={styles.dueHead}>{v.chip.slice(0, v.chip.length - v.short.length)}</span>
      <span>{v.short}</span>
    </button>
  );
}
