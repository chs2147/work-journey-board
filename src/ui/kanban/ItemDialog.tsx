// 업무 항목 추가·편집 창(docs/improve-v21-spec.md 5절, 시안 ③). 업무 · 날짜(기본 오늘) · 섹션 + 주간 보드와 같은 키 규칙의
// 개조식 입력(Enter = 다음 항목 · Tab = 세부 · Shift+Tab = 본 항목 · Backspace로 빈 줄 지우기) + 줄마다 ★·⏳·⏰ + 매주 반복.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { TODO } from "../../domain/kanban";
import type { ItemDraft } from "../../domain/types";
import { addDays, addWeeks, shortDateLabel, weekIdOf, weekRange, type DateStr } from "../../domain/week";
import { defaultStartTime } from "../../domain/startTime";
import type { KanbanCard } from "../../data/kanbanRepository";
import { STR } from "../../shared/strings";
import { newDraft, useBoard } from "../board/boardStore";
import { DueDatePopover, StartTimePopover } from "../board/ItemActions";
import { dueView } from "../board/dueView";
import { isComposingKey } from "../board/helpers";
import { addItems, cardDrafts, replaceCard, useKanban } from "./kanbanStore";
import { useModal } from "./KanbanView";
import styles from "./Kanban.module.css";

const K = STR.kanban;

export type ItemDialogTarget = { mode: "add"; sectionId: string | null } | { mode: "edit"; card: KanbanCard };

export function ItemDialog({ target, onClose }: { target: ItemDialogTarget; onClose(): void }) {
  const today = useBoard((b) => b.today);
  const s = useKanban();
  const cats = useMemo(() => s.categories.filter((c) => !c.ended), [s.categories]);
  const edit = target.mode === "edit" ? target.card : null;
  const defaultCat =
    edit?.categoryId ?? (s.filter.categories.length === 1 ? s.filter.categories[0]! : (cats[0]?.id ?? ""));
  const [categoryId, setCategoryId] = useState(defaultCat);
  const [date, setDate] = useState<DateStr>(edit?.date ?? today);
  const [sectionId, setSectionId] = useState<string | null>(target.mode === "add" ? target.sectionId : null);
  const [lines, setLines] = useState<ItemDraft[]>(() => [newDraft()]);
  const [repeat, setRepeat] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pop, setPop] = useState<{ kind: "due" | "time"; index: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const refs = useRef<(HTMLTextAreaElement | null)[]>([]);
  const focusAt = useRef<number | null>(0);
  const dirty = lines.some((l) => l.text.trim());
  const close = () => {
    if (!edit && dirty && !window.confirm(K.addDiscard)) return;
    onClose();
  };
  const ref = useModal(close);

  // 편집: 그 칸의 저장본(표시 포함)을 그대로 불러온다
  useEffect(() => {
    if (!edit) return;
    let alive = true;
    void cardDrafts(edit).then((d) => {
      if (alive && d.length) {
        setLines(d);
        focusAt.current = 0;
      }
    });
    return () => {
      alive = false;
    };
  }, [edit]);

  useEffect(() => {
    if (focusAt.current === null) return;
    const el = refs.current[focusAt.current];
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      focusAt.current = null;
    }
  });

  const update = (i: number, patch: Partial<ItemDraft>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>, i: number) => {
    if (isComposingKey(e)) return;
    const l = lines[i]!;
    if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const el = e.currentTarget;
      const head = l.text.slice(0, el.selectionStart),
        tail = l.text.slice(el.selectionEnd);
      setLines((ls) => [
        ...ls.slice(0, i),
        { ...l, text: head },
        newDraft(tail, l.depth),
        ...ls.slice(i + 1),
      ]);
      focusAt.current = i + 1;
    } else if (e.key === "Tab" && !e.altKey) {
      e.preventDefault();
      if (e.shiftKey) update(i, { depth: 0 });
      else if (i > 0) update(i, { depth: 1 });
    } else if (e.key === "Backspace" && !l.text && lines.length > 1) {
      e.preventDefault();
      if (l.depth === 1) {
        update(i, { depth: 0 });
        return;
      }
      setLines((ls) => ls.filter((_, j) => j !== i));
      focusAt.current = Math.max(0, i - 1);
    } else if (e.key === "ArrowUp" && i > 0 && e.currentTarget.selectionStart === 0) {
      e.preventDefault();
      refs.current[i - 1]?.focus();
    } else if (
      e.key === "ArrowDown" &&
      i < lines.length - 1 &&
      e.currentTarget.selectionEnd === l.text.length
    ) {
      e.preventDefault();
      refs.current[i + 1]?.focus();
    } else if (e.altKey && (e.code === "KeyI" || e.key === "i")) {
      e.preventDefault();
      update(i, { flagged: !l.flagged, flagDoneAt: null });
    } else if (e.altKey && (e.code === "KeyU" || e.key === "u")) {
      e.preventDefault();
      setPop({ kind: "due", index: i });
    } else if (e.altKey && (e.code === "KeyO" || e.key === "o")) {
      e.preventDefault();
      setPop({ kind: "time", index: i });
    } else if (e.altKey && (e.code === "KeyR" || e.key === "r")) {
      e.preventDefault();
      setRepeat((r) => !r);
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void save(false);
    }
  };

  const save = async (more: boolean) => {
    if (!categoryId) return setError(K.addNoCategory);
    if (!lines.some((l) => l.text.trim())) return setError(K.addEmpty);
    setBusy(true);
    const ok = edit
      ? await replaceCard(edit, lines)
      : await addItems({ categoryId, date, sectionId, drafts: lines, repeat });
    setBusy(false);
    if (!ok) return;
    if (more && !edit) {
      setLines([newDraft()]);
      setRepeat(false);
      focusAt.current = 0;
    } else onClose();
  };

  const wk = weekIdOf(today);
  const nextMon = weekRange(addWeeks(wk, 1)).start;
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-label={edit ? K.editTitle : K.addTitle}
      data-testid="kanban-item-dialog"
    >
      <h2>{edit ? K.editTitle : K.addTitle}</h2>
      {!edit && (
        <>
          <div className={styles.row}>
            <label className={styles.label} htmlFor="kanban-item-cat">
              {K.addCategory}
            </label>
            <select
              id="kanban-item-cat"
              className={styles.select}
              style={{ height: 30 }}
              value={categoryId}
              data-testid="kanban-item-category"
              onChange={(e) => setCategoryId(e.target.value)}
            >
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.row}>
            <label className={styles.label} htmlFor="kanban-item-date">
              {K.addDate}
            </label>
            <div className={styles.inline}>
              <input
                id="kanban-item-date"
                type="date"
                className={styles.dateInput}
                style={{ height: 30 }}
                value={date}
                data-testid="kanban-item-date"
                onChange={(e) => e.target.value && setDate(e.target.value)}
              />
              <span className={styles.hint}>{shortDateLabel(date)}</span>
              {(
                [
                  [K.addToday, today],
                  [K.addTomorrow, addDays(today, 1)],
                  [K.addNextMon, nextMon],
                ] as const
              ).map(([label, d]) => (
                <button
                  key={label}
                  type="button"
                  className={styles.btn}
                  aria-pressed={date === d}
                  onClick={() => setDate(d)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>{K.addSectionLabel}</span>
            <div className={styles.inline}>
              <div className={styles.seg} role="group" aria-label={K.addSectionLabel}>
                {[
                  { id: null as string | null, name: K.todo },
                  ...s.sections.map((x) => ({ id: x.id, name: x.name })),
                ].map((x) => (
                  <button
                    key={x.id ?? TODO}
                    type="button"
                    aria-pressed={sectionId === x.id}
                    onClick={() => setSectionId(x.id)}
                  >
                    {x.name}
                  </button>
                ))}
              </div>
              <span className={styles.hint}>{K.addNoDone}</span>
            </div>
          </div>
        </>
      )}
      {edit && <p className={styles.hint}>{K.editHint}</p>}
      <div className={styles.row} style={{ alignItems: "start" }}>
        <span className={styles.label} style={{ paddingTop: 8 }}>
          {K.addContent}
        </span>
        <div className={styles.editor} data-testid="kanban-item-editor">
          {lines.map((l, i) => {
            const due = l.dueDate ? dueView(today, l.dueDate) : null;
            return (
              <div
                key={l.id}
                className={`${styles.line} ${l.depth === 1 ? styles.lineSub : ""}`}
                style={{ position: "relative" }}
              >
                <span className={styles.bullet}>{l.depth === 1 ? "·" : "•"}</span>
                <textarea
                  ref={(el) => {
                    refs.current[i] = el;
                    if (el) {
                      el.style.height = "auto";
                      el.style.height = `${el.scrollHeight}px`;
                    }
                  }}
                  className={styles.lineText}
                  rows={1}
                  value={l.text}
                  aria-label={K.addContent}
                  data-testid="kanban-item-line"
                  onChange={(e) => {
                    const text = e.target.value;
                    if (text.includes("\n")) {
                      const parts = text.split("\n");
                      setLines((ls) => [
                        ...ls.slice(0, i),
                        { ...l, text: parts[0]! },
                        ...parts
                          .slice(1)
                          .map((p) => newDraft(p.replace(/^\s+/, ""), /^\s/.test(p) ? 1 : l.depth)),
                        ...ls.slice(i + 1),
                      ]);
                      focusAt.current = i + parts.length - 1;
                    } else update(i, { text });
                    setError(null);
                  }}
                  onKeyDown={(e) => onKey(e, i)}
                />
                <button
                  type="button"
                  className={`${styles.lineTool} ${styles.lineStar}`}
                  aria-pressed={!!l.flagged}
                  aria-label={STR.kanban.flagOn}
                  title={`${STR.kanban.flagOn} (Alt+I)`}
                  onClick={() => update(i, { flagged: !l.flagged, flagDoneAt: null })}
                >
                  ★
                </button>
                <button
                  type="button"
                  className={styles.lineTool}
                  aria-pressed={!!l.dueDate}
                  title={`${STR.kanban.dueMenu} (Alt+U)`}
                  onClick={() => setPop({ kind: "due", index: i })}
                >
                  {due ? due.chip : "⏳"}
                </button>
                <button
                  type="button"
                  className={styles.lineTool}
                  aria-pressed={!!l.startTime}
                  title={`${STR.kanban.timeMenu} (Alt+O)`}
                  onClick={() => setPop({ kind: "time", index: i })}
                >
                  {l.startTime ? `⏰ ${l.startTime}` : "⏰"}
                </button>
                {pop?.index === i && (
                  <div
                    style={{ position: "absolute", right: 0, top: "100%", zIndex: 5 }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Escape") setPop(null);
                    }}
                  >
                    {pop.kind === "due" ? (
                      <DueDatePopover
                        text={l.text}
                        today={today}
                        initial={l.dueDate ?? null}
                        hasValue={!!l.dueDate}
                        onSave={(d) => {
                          update(i, d ? { dueDate: d, flagged: true, flagDoneAt: null } : { dueDate: null });
                          setPop(null);
                          refs.current[i]?.focus();
                        }}
                        onClose={() => setPop(null)}
                      />
                    ) : (
                      <StartTimePopover
                        date={date}
                        initial={l.startTime ?? defaultStartTime(date === today, new Date())}
                        hasValue={!!l.startTime}
                        onSave={(t) => {
                          update(i, { startTime: t });
                          setPop(null);
                          refs.current[i]?.focus();
                        }}
                        onClose={() => setPop(null)}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {!edit && (
        <div className={styles.row}>
          <span />
          <label className={styles.checkRow}>
            <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />↻{" "}
            {STR.repeat.toggleOn}
          </label>
        </div>
      )}
      <p className={styles.hint} style={{ marginLeft: 96 }}>
        {K.addHint}
      </p>
      {error && (
        <p className={styles.error} role="alert" data-testid="kanban-item-error">
          {error}
        </p>
      )}
      <div className={styles.acts}>
        {!edit && <span className={styles.hint}>{K.addWhere}</span>}
        <button type="button" className={styles.btn} onClick={close}>
          {K.cancel}
        </button>
        {!edit && (
          <button
            type="button"
            className={styles.btn}
            disabled={busy}
            data-testid="kanban-item-more"
            onClick={() => void save(true)}
          >
            {K.addMore}
          </button>
        )}
        <button
          type="button"
          className={`${styles.btn} ${styles.primary}`}
          disabled={busy}
          data-testid="kanban-item-save"
          onClick={() => void save(false)}
        >
          {edit ? K.save : K.add}
        </button>
      </div>
    </dialog>
  );
}
