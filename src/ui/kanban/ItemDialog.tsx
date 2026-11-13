// 업무 항목 추가·편집 창(docs/improve-v21-spec.md 5절, 시안 ③). 업무 · 날짜(기본 오늘) · 섹션 + 주간 보드와 같은 키 규칙의
// 개조식 입력(Enter = 다음 항목 · Tab = 세부 · Shift+Tab = 본 항목 · Backspace로 빈 줄 지우기) + 줄마다 ★·⏳·⏰ + 매주 반복.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { DONE, TODO } from "../../domain/kanban";
import type { ItemDraft } from "../../domain/types";
import { addDays, addWeeks, shortDateLabel, weekIdOf, weekRange, type DateStr } from "../../domain/week";
import { defaultStartTime } from "../../domain/startTime";
import type { KanbanCard } from "../../data/kanbanRepository";
import { STR } from "../../shared/strings";
import { newDraft, useBoard } from "../board/boardStore";
import { DueDatePopover, StartTimePopover } from "../board/ItemActions";
import { dueView } from "../board/dueView";
import { isComposingKey } from "../board/helpers";
import {
  addItems,
  cardDrafts,
  columnIcon,
  columnKeys,
  columnName,
  replaceCard,
  useKanban,
} from "./kanbanStore";
import { SectionIconImg } from "./SectionIcon";
import { useModal } from "./kanbanUi";
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
  const [error, setError] = useState<string | null>(null);
  const [pop, setPop] = useState<{ kind: "due" | "time"; index: number; row?: boolean } | null>(null);
  // 위쪽 시작 시간·마감일 행이 적용될 본 항목 = 지금 초점 줄(세부면 그 본 항목, improve-v22-spec 6절)
  const [curLine, setCurLine] = useState(0);
  const mainIndex = (() => {
    for (let i = Math.min(curLine, lines.length - 1); i >= 0; i--) if (lines[i]!.depth === 0) return i;
    return 0;
  })();
  const main = lines[mainIndex];
  const [busy, setBusy] = useState(false);
  const refs = useRef<(HTMLTextAreaElement | null)[]>([]);
  const focusAt = useRef<number | null>(0);
  const dirty = lines.some((l) => l.text.trim());
  // 본 항목 줄 = 카드 한 장. 카드 번호(빈 줄도 셈 — 저장 때 빈 줄은 빠짐)
  const cardNo: number[] = [];
  let nCards = 0;
  for (const l of lines) cardNo.push(l.depth === 0 ? ++nCards : nCards);
  const cards = lines.filter((l) => l.depth === 0 && l.text.trim()).length;
  const multi = !edit && lines.filter((l) => l.depth === 0).length > 1;
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

  /** 이번 주(0)·다음 주(1) 금요일 */
  const fri = (n: number): DateStr => addDays(weekRange(addWeeks(weekIdOf(today), n)).start, 4);
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
      : await addItems({ categoryId, date, sectionId, drafts: lines, repeat: false });
    setBusy(false);
    if (!ok) return;
    if (more && !edit) {
      setLines([newDraft()]);
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
      <h2>
        {edit
          ? K.editTitle
          : K.addTitleIn(sectionId ? (s.sections.find((x) => x.id === sectionId)?.name ?? K.todo) : K.todo)}
      </h2>
      {!edit && (
        <>
          {/* 업무 고르기 띠(6절): 어느 업무의 카드인지 가장 먼저 보이게 — 업무 색 띠(직각)·옅은 업무 색 바탕·큰 글자 */}
          <label
            className={styles.catBand}
            style={{
              ["--band" as string]: `var(--cat-${cats.find((c) => c.id === categoryId)?.color ?? "c1"})`,
            }}
            htmlFor="kanban-item-cat"
          >
            <span className={styles.catBandDot} aria-hidden="true" />
            <select
              id="kanban-item-cat"
              className={styles.catBandSelect}
              value={categoryId}
              aria-label={K.addCategory}
              data-testid="kanban-item-category"
              onChange={(e) => setCategoryId(e.target.value)}
            >
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
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
                {/* 열 순서 그대로(DONE 제외, improve-v23-spec 2절) · 섹션 아이콘 */}
                {columnKeys(s)
                  .filter((k) => k !== DONE)
                  .map((k) => (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={sectionId === (k === TODO ? null : k)}
                      onClick={() => setSectionId(k === TODO ? null : k)}
                    >
                      <SectionIconImg id={columnIcon(k, s)} size={14} /> {columnName(k, s)}
                    </button>
                  ))}
              </div>
            </div>
          </div>
        </>
      )}
      {main && (
        <>
          {/* 시작 시간·마감일은 결이 달라 행을 따로(6절, 2026-11-12 사용자 지시) — 지금 줄의 본 항목에 적용 */}
          <div className={styles.row} style={{ position: "relative" }}>
            <span className={styles.label}>{K.startLabel}</span>
            <div className={styles.inline}>
              <button
                type="button"
                className={`${styles.fieldBtn} ${main.startTime ? styles.fieldOn : ""}`}
                data-testid="kanban-item-start"
                onClick={() => setPop({ kind: "time", index: mainIndex, row: true })}
              >
                {main.startTime ? `⏰ ${main.startTime}` : K.startSet}
              </button>
              {main.startTime && (
                <button
                  type="button"
                  className={`${styles.btn} ${styles.ghost}`}
                  aria-label={K.clearValue}
                  onClick={() => update(mainIndex, { startTime: null })}
                >
                  ×
                </button>
              )}
            </div>
            {pop?.row && pop.kind === "time" && (
              <div
                className={styles.rowPop}
                onKeyDown={(e) => (e.stopPropagation(), e.key === "Escape" && setPop(null))}
              >
                <StartTimePopover
                  date={date}
                  initial={main.startTime ?? defaultStartTime(date === today, new Date())}
                  hasValue={!!main.startTime}
                  onSave={(t) => {
                    update(mainIndex, { startTime: t });
                    setPop(null);
                  }}
                  onClose={() => setPop(null)}
                />
              </div>
            )}
          </div>
          <div className={styles.row} style={{ position: "relative" }}>
            <span className={styles.label}>{K.dueLabel}</span>
            <div className={styles.inline}>
              <button
                type="button"
                className={`${styles.fieldBtn} ${main.dueDate ? styles.fieldOn : ""}`}
                data-testid="kanban-item-due"
                onClick={() => setPop({ kind: "due", index: mainIndex, row: true })}
              >
                {main.dueDate ? dueView(today, main.dueDate).chip : K.dueSet}
              </button>
              {main.dueDate ? (
                <button
                  type="button"
                  className={`${styles.btn} ${styles.ghost}`}
                  aria-label={K.clearValue}
                  onClick={() => update(mainIndex, { dueDate: null })}
                >
                  ×
                </button>
              ) : (
                (
                  [
                    [K.dueThisFri, fri(0)],
                    [K.dueNextFri, fri(1)],
                  ] as const
                ).map(([label, d]) => (
                  <button
                    key={label}
                    type="button"
                    className={styles.btn}
                    onClick={() => update(mainIndex, { dueDate: d, flagged: true, flagDoneAt: null })}
                  >
                    {label}
                  </button>
                ))
              )}
            </div>
            {pop?.row && pop.kind === "due" && (
              <div
                className={styles.rowPop}
                onKeyDown={(e) => (e.stopPropagation(), e.key === "Escape" && setPop(null))}
              >
                <DueDatePopover
                  text={main.text}
                  today={today}
                  initial={main.dueDate ?? null}
                  hasValue={!!main.dueDate}
                  onSave={(d) => {
                    update(
                      mainIndex,
                      d ? { dueDate: d, flagged: true, flagDoneAt: null } : { dueDate: null },
                    );
                    setPop(null);
                  }}
                  onClose={() => setPop(null)}
                />
              </div>
            )}
          </div>
        </>
      )}
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
                {/* 여러 줄 = 여러 카드(improve-v23-spec 7절): 본 항목 줄에 "카드 N" */}
                {multi && (
                  <span
                    className={`${styles.lineNum} ${l.depth === 1 ? styles.lineNumSub : ""}`}
                    data-testid="kanban-item-cardnum"
                  >
                    {l.depth === 1 ? K.lineSub : K.lineCard(cardNo[i]!)}
                  </span>
                )}
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
                  onFocus={() => setCurLine(i)}
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
                {pop?.index === i && !pop.row && (
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
      {error && (
        <p className={styles.error} role="alert" data-testid="kanban-item-error">
          {error}
        </p>
      )}
      <div className={styles.acts}>
        {/* 하단은 단추만 — 단축키 안내 글 없음(2026-11-12 사용자 지시) */}
        <button type="button" className={styles.btn} data-testid="kanban-item-close" onClick={close}>
          {K.close}
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
          {edit ? K.save : cards > 1 ? K.addCards(cards) : K.add}
        </button>
      </div>
    </dialog>
  );
}
