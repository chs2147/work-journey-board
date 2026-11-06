import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { deleteRange } from "../../domain/items";
import { visibleCategories } from "../../domain/categories";
import { addDays, shortDateLabel, weekIdOf, weekRange } from "../../domain/week";
import { STR } from "../../shared/strings";
import { useAppStore } from "../common/appStore";
import { IconCopyItem } from "../common/icons";
import { copyItemToDate, reload, splitKey, useBoard } from "./boardStore";
import { flushNote } from "../note/noteStore";
import styles from "./AddCategoryDialog.module.css";

export function CopyDateDialog({
  cellKey,
  itemId,
  onClose,
}: {
  cellKey: string;
  itemId: string;
  onClose(): void;
}) {
  const T = STR.copyDate;
  const { date: from, categoryId } = splitKey(cellKey);
  const journal = useAppStore((s) => s.journal);
  const [date, setDate] = useState(addDays(from, 7));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState<{
    date: string;
    memos: number;
    cabinet: number;
    active: boolean;
    holiday: boolean;
  } | null>(null);
  const locked = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const [source, setSource] = useState(() => {
    const items = useBoard.getState().cells[cellKey] ?? [];
    const i = items.findIndex((x) => x.id === itemId);
    return i < 0 ? [] : items.slice(i, deleteRange(items, i)[1]);
  });
  const sourceSignature = JSON.stringify(source);
  const category = useBoard(
    (s) => s.view?.categories.find((c) => c.category.id === categoryId)?.category.name ?? "",
  );
  const scope = useBoard((s) => `${s.weekId}:${s.viewMode}`);
  const initialScope = useRef(scope);
  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    if (scope !== initialScope.current) onClose();
  }, [scope, onClose]);
  useEffect(() => {
    let alive = true;
    if (journal.state !== "ready" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)))
      return;
    const r = journal.repo;
    void (async () => {
      await flushNote();
      const [relations, categories, marks] = await Promise.all([
        r.itemRelations(source.map((i) => i.id)),
        r.listCategories(),
        r.getWeek(weekIdOf(date), { note: false }),
      ]);
      const range = weekRange(weekIdOf(date));
      if (alive)
        setInfo({
          date,
          memos: relations.notes.length,
          cabinet: relations.cabinet.length,
          active: visibleCategories(
            categories.categories,
            categories.periods,
            range.start,
            range.end,
            new Set(),
          ).some((c) => c.category.id === categoryId),
          holiday: !!marks.dayMarkInfo[date] || [0, 6].includes(new Date(`${date}T12:00:00`).getDay()),
        });
    })().catch((e) => {
      if (alive) setError(String(e));
    });
    return () => {
      alive = false;
    };
  }, [journal, date, categoryId, source]);
  const submit = async () => {
    if (locked.current || !(info?.date === date && info.active) || !source.length) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      if (await copyItemToDate(cellKey, itemId, date, sourceSignature)) onClose();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes("원본 항목이 변경") && useAppStore.getState().journal === journal) {
        await reload();
        const items = useBoard.getState().cells[cellKey] ?? [];
        const index = items.findIndex((i) => i.id === itemId);
        if (index < 0) onClose();
        else {
          setSource(items.slice(index, deleteRange(items, index)[1]));
          setError(T.sourceChanged);
        }
      } else setError(message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  return createPortal(
    <div
      className={styles.backdrop}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" && !busy && !e.nativeEvent.isComposing) {
          e.preventDefault();
          onClose();
        }
        if (e.key === "Tab") {
          const elements = [
            ...(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled)") ??
              []),
          ];
          if (e.shiftKey && document.activeElement === elements[0]) {
            e.preventDefault();
            elements.at(-1)?.focus();
          } else if (!e.shiftKey && document.activeElement === elements.at(-1)) {
            e.preventDefault();
            elements[0]?.focus();
          }
        }
      }}
    >
      <div
        ref={dialog}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="copy-date-title"
        data-testid="copy-date-dialog"
      >
        <header>
          <h2 id="copy-date-title">{T.title}</h2>
          <button type="button" disabled={busy} aria-label={T.close} onClick={onClose}>
            ×
          </button>
        </header>
        <p className={styles.context}>
          {category} · {shortDateLabel(from)}
        </p>
        <strong>{source[0]?.text}</strong>
        <fieldset disabled={busy}>
          <label className={styles.label} htmlFor="copy-target-date">
            {T.target}
          </label>
          <input
            ref={input}
            id="copy-target-date"
            type="date"
            min="1900-01-01"
            max="9999-12-31"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setError("");
            }}
          />
          <div className={styles.tags} style={{ marginTop: 12 }}>
            <button type="button" onClick={() => setDate(addDays(from, 1))}>
              {T.tomorrow}
            </button>
            <button type="button" onClick={() => setDate(addDays(from, 7))}>
              {T.nextWeek}
            </button>
          </div>
          <div className={styles.label}>{T.scope}</div>
          <p>{T.count(source.length, info?.memos ?? 0, info?.cabinet ?? 0)}</p>
          {source[0]?.depth === 1 && <p className={styles.hint}>{T.child}</p>}
          <p className={styles.hint}>{T.shared}</p>
          <p className={styles.hint}>{T.reset}</p>
          {source.some((i) => i.dueDate) && (
            <p className={styles.hint}>
              마감일: {[...new Set(source.map((i) => i.dueDate).filter(Boolean))].join(", ")}
            </p>
          )}
          {source.some((i) => i.dueDate && date > i.dueDate) && <p className={styles.hint}>{T.pastDue}</p>}
          {date === from && <p className={styles.hint}>{T.sameDay}</p>}
          {info?.holiday && <p className={styles.hint}>{T.holiday}</p>}
          {info && !info.active && <p className={styles.error}>{T.blocked}</p>}
        </fieldset>
        <div role="status" className={styles.error}>
          {error}
        </div>
        <footer>
          <button disabled={busy} type="button" onClick={onClose}>
            {T.cancel}
          </button>
          <button
            disabled={busy || !(info?.date === date && info.active) || !source.length}
            type="button"
            className={styles.primary}
            onClick={() => void submit()}
          >
            <IconCopyItem />
            {busy ? T.busy : T.confirm}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
