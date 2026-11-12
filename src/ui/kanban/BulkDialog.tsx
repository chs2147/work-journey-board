// 일괄 완료(docs/improve-v21-spec.md 6절, 시안 ④) — 미리 보기 → 실행(한 batch) → 알림/최근 일괄 처리에서 되돌리기.
import { useEffect, useMemo, useState } from "react";
import { addDays, addWeeks, weekIdOf, weekRange, type DateStr } from "../../domain/week";
import type { BulkInfo, KanbanCard } from "../../data/kanbanRepository";
import { localDate } from "../../domain/localTime";
import { STR } from "../../shared/strings";
import { useBoard } from "../board/boardStore";
import { bulkComplete, bulkPreview, listBulk, undoBulk, useKanban } from "./kanbanStore";
import { Menu } from "./KanbanView";
import { useModal } from "./kanbanUi";
import styles from "./Kanban.module.css";

const K = STR.kanban;
const CONFIRM_OVER = 500;

export function BulkDialog({ onClose }: { onClose(): void }) {
  const today = useBoard((b) => b.today);
  const filter = useKanban((s) => s.filter);
  const ref = useModal(onClose);
  const fourWeeks = weekRange(addWeeks(weekIdOf(today), -4)).end;
  const lastMonth = addDays(`${today.slice(0, 7)}-01`, -1);
  const lastYear = `${Number(today.slice(0, 4)) - 1}-12-31`;
  const [before, setBefore] = useState<DateStr>(fourWeeks);
  const [skipFlagged, setSkipFlagged] = useState(true);
  const [skipDue, setSkipDue] = useState(true);
  const [skipSections, setSkipSections] = useState(true);
  const [mode, setMode] = useState<"record" | "now">("record");
  const [preview, setPreview] = useState<{
    cards: KanbanCard[];
    children: number;
    categories: number;
  } | null>(null);
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let alive = true;
    void bulkPreview({
      before,
      categories: filter.categories,
      includeEnded: filter.includeEnded,
      skipFlagged,
      skipFutureDue: skipDue,
      skipSections,
      today,
    }).then((p) => {
      if (alive) {
        setPreview(p);
        setExcluded({});
      }
    });
    return () => {
      alive = false;
    };
  }, [before, skipFlagged, skipDue, skipSections, filter.categories, filter.includeEnded, today]);

  const targets = useMemo(() => (preview?.cards ?? []).filter((c) => !excluded[c.id]), [preview, excluded]);
  const kids = targets.reduce((n, c) => n + c.children.filter((x) => !x.done).length, 0);
  const cats = new Set(targets.map((c) => c.categoryId)).size;
  const run = async () => {
    if (!targets.length) return;
    if (targets.length > CONFIRM_OVER && !window.confirm(K.bulkConfirm(targets.length))) return;
    onClose();
    await bulkComplete(targets, mode);
  };
  const check = (on: boolean, set: (v: boolean) => void, label: string) => (
    <label className={styles.checkRow}>
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
      {label}
    </label>
  );
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      style={{ width: 640 }}
      aria-label={K.bulkTitle}
      data-testid="kanban-bulk-dialog"
    >
      <h2>{K.bulkTitle}</h2>
      <div className={styles.row}>
        <label className={styles.label} htmlFor="kanban-bulk-before">
          {K.bulkBefore}
        </label>
        <div className={styles.inline}>
          <input
            id="kanban-bulk-before"
            type="date"
            className={styles.dateInput}
            style={{ height: 30 }}
            value={before}
            data-testid="kanban-bulk-before"
            onChange={(e) => e.target.value && setBefore(e.target.value)}
          />
          {K.bulkBeforeSuffix}
          {(
            [
              [K.bulk4w, fourWeeks],
              [K.bulkLastMonth, lastMonth],
              [K.bulkLastYear, lastYear],
            ] as const
          ).map(([l, d]) => (
            <button
              key={l}
              type="button"
              className={styles.btn}
              aria-pressed={before === d}
              onClick={() => setBefore(d)}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>{K.bulkCategories}</span>
        <span className={styles.hint}>
          {K.categories(filter.categories.length, filter.categories.length === 0)}
        </span>
      </div>
      <div className={styles.row} style={{ alignItems: "start" }}>
        <span className={styles.label}>{K.bulkExclude}</span>
        <div>
          {check(skipFlagged, setSkipFlagged, K.bulkSkipFlagged)}
          {check(skipDue, setSkipDue, K.bulkSkipDue)}
          {check(skipSections, setSkipSections, K.bulkSkipSections)}
        </div>
      </div>
      <div className={styles.row} style={{ alignItems: "start" }}>
        <span className={styles.label}>{K.bulkMode}</span>
        <div>
          <label className={styles.checkRow}>
            <input
              type="radio"
              name="kanban-bulk-mode"
              checked={mode === "record"}
              onChange={() => setMode("record")}
            />
            {K.bulkRecord}
          </label>
          <label className={styles.checkRow}>
            <input
              type="radio"
              name="kanban-bulk-mode"
              checked={mode === "now"}
              onChange={() => setMode("now")}
            />
            {K.bulkNow(today)}
          </label>
        </div>
      </div>
      <div className={styles.box} data-testid="kanban-bulk-summary">
        {!preview ? (
          "…"
        ) : targets.length === 0 ? (
          K.bulkNone
        ) : (
          <>
            <div>{K.bulkSummary(targets.length, kids, cats)}</div>
            <div className={styles.hint} style={{ marginTop: 4 }}>
              {K.bulkExamples}{" "}
              {targets
                .slice(0, 3)
                .map((c) => `${c.date} ${c.text}`)
                .join(" · ")}{" "}
              <button
                type="button"
                className={`${styles.btn} ${styles.ghost}`}
                onClick={() => setShowAll((v) => !v)}
              >
                {showAll ? "▴" : "▾"}
              </button>
            </div>
            {showAll && (
              <div style={{ maxHeight: 200, overflow: "auto", marginTop: 6 }}>
                {(preview?.cards ?? []).map((c) => (
                  <label key={c.id} className={styles.checkRow}>
                    <input
                      type="checkbox"
                      checked={!excluded[c.id]}
                      onChange={(e) => setExcluded((x) => ({ ...x, [c.id]: !e.target.checked }))}
                    />
                    <span className={styles.hint}>{c.date}</span> {c.categoryName} · {c.text}
                  </label>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      <div className={styles.acts}>
        <span className={styles.hint}>{K.bulkHint}</span>
        <button type="button" className={styles.btn} onClick={onClose}>
          {K.cancel}
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.primary}`}
          disabled={!targets.length}
          data-testid="kanban-bulk-run"
          onClick={() => void run()}
        >
          {K.bulkRun(targets.length)}
        </button>
      </div>
    </dialog>
  );
}

/** TODO ⋯ › 최근 일괄 처리 */
export function RecentBulk({ at, onClose }: { at: { x: number; y: number }; onClose(): void }) {
  const [list, setList] = useState<BulkInfo[] | null>(null);
  useEffect(() => {
    void listBulk().then(setList);
  }, []);
  return (
    <Menu at={at} onClose={onClose} label={K.bulkRecent}>
      <div className={styles.menuHead}>{K.bulkRecent}</div>
      {list && list.length === 0 && <p className={styles.note}>{K.bulkListEmpty}</p>}
      {list?.map((b) => {
        const d = new Date(b.createdAt);
        return (
          <button
            key={b.id}
            type="button"
            disabled={b.undone}
            data-testid="kanban-bulk-undo"
            onClick={() => {
              onClose();
              void undoBulk(b.id);
            }}
          >
            <span>
              {localDate(d)} {d.toTimeString().slice(0, 5)} · {b.count}
            </span>
            <span className={styles.key}>{b.undone ? K.bulkUndoneTag : K.bulkUndo}</span>
          </button>
        );
      })}
    </Menu>
  );
}
