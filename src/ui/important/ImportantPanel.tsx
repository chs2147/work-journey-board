// 왼쪽 중요 업무 패널(important-repeat-spec 2-3~2-5): 모든 주의 중요 항목을 묶음 › 업무별로(improve-1026v2-spec 8절), 체크 = 처리 완료, 누르면 그 칸으로.
import { useEffect, useRef, type KeyboardEvent } from "react";
import { groupImportant } from "../../domain/important";
import type { ImportantItem } from "../../domain/types";
import { shortDateLabel } from "../../domain/week";
import { STR } from "../../shared/strings";
import {
  completeImportant,
  focusStartCell,
  revealItem,
  setPanelOpen,
  undoImportant,
  useBoard,
} from "../board/boardStore";
import styles from "./ImportantPanel.module.css";

export function ImportantPanel({ overlay }: { overlay: boolean }) {
  const important = useBoard((s) => s.important);
  const recentDone = useBoard((s) => s.recentDone);
  const today = useBoard((s) => s.today);
  const panelFocus = useBoard((s) => s.panelFocus);
  const listRef = useRef<HTMLDivElement>(null);
  const groups = groupImportant(important, today);

  // Alt+2로 열면 목록 첫 항목으로(없으면 패널 자체로)
  useEffect(() => {
    if (!panelFocus) return;
    const first = listRef.current?.querySelector<HTMLButtonElement>("[data-row]");
    (first ?? listRef.current)?.focus();
    useBoard.setState({ panelFocus: false });
  }, [panelFocus]);

  const onRowKey = (e: KeyboardEvent<HTMLButtonElement>, it: ImportantItem) => {
    const rows = [...(listRef.current?.querySelectorAll<HTMLButtonElement>("[data-row]") ?? [])];
    const i = rows.indexOf(e.currentTarget);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
    } else if (e.key === " ") {
      e.preventDefault();
      (rows[i + 1] ?? rows[i - 1])?.focus();
      void completeImportant(it.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      focusStartCell();
    }
  };

  return (
    <aside
      className={`${styles.panel} ${overlay ? styles.overlay : ""}`}
      aria-label={STR.important.title}
      data-testid="important-panel"
    >
      <header className={styles.head}>
        <h2 className={styles.title}>
          <span className={styles.star} aria-hidden="true">
            ★
          </span>
          {STR.important.title}
          {important.length > 0 && <span className={styles.count}>{important.length}</span>}
        </h2>
        <button
          type="button"
          className={styles.close}
          aria-label={STR.important.close}
          title={STR.important.close}
          onClick={() => setPanelOpen(false)}
        >
          «
        </button>
      </header>

      <div className={styles.list} ref={listRef} tabIndex={-1}>
        {groups.length === 0 ? (
          recentDone.length > 0 ? (
            <div className={`${styles.empty} ${styles.cleared}`} data-testid="important-empty">
              <span className={styles.emptyIcon} aria-hidden="true">
                ✓
              </span>
              <strong>{STR.important.clearedTitle}</strong>
              <p>{STR.important.clearedBody}</p>
            </div>
          ) : (
            <div className={styles.empty} data-testid="important-empty">
              <span className={styles.emptyIcon} aria-hidden="true">
                ☆
              </span>
              <strong>{STR.important.emptyTitle}</strong>
              <p>{STR.important.emptyBody}</p>
            </div>
          )
        ) : (
          groups.map((g) => (
            <section key={g.key} aria-label={STR.important.groups[g.key]}>
              <h3 className={`${styles.group} ${g.key === "late" ? styles.lateGroup : ""}`}>
                <span>{STR.important.groups[g.key]}</span>
                <span>{g.items.length}</span>
              </h3>
              {g.categories.map((c) => (
                <div key={c.id} role="group" aria-label={c.name} data-testid="important-category">
                  <h4 className={styles.cat}>
                    <span className={styles.dot} style={{ background: `var(--cat-${c.color})` }} />
                    <span className={styles.catName}>{c.name}</span>
                    {c.ended && <span className={styles.catEnded}>{STR.important.ended}</span>}
                    <span className={styles.catCount}>{c.items.length}</span>
                  </h4>
                  <ul className={styles.rows}>
                    {c.items.map((it) => (
                      <li key={it.id} className={styles.row}>
                        <button
                          type="button"
                          className={styles.check}
                          aria-label={STR.important.complete(it.text)}
                          title={STR.important.completeTitle}
                          onClick={() => void completeImportant(it.id)}
                        >
                          ✓
                        </button>
                        <button
                          type="button"
                          className={styles.main}
                          data-row
                          data-testid="important-row"
                          onClick={() => void revealItem(it)}
                          onKeyDown={(e) => onRowKey(e, it)}
                        >
                          {it.parentText && <span className={styles.parent}>{it.parentText} ›</span>}
                          <span className={styles.text}>{it.text}</span>
                          {/* 업무명은 머리에 있으니 빼고, 날짜는 "오늘" 묶음이면 생략(8절) */}
                          {g.key !== "today" && (
                            <span className={styles.meta}>
                              <span>{shortDateLabel(it.date)}</span>
                              {g.key === "late" && (
                                <span className={styles.lateTag}>{STR.important.lateTag}</span>
                              )}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))
        )}
      </div>

      {recentDone.length > 0 && (
        <details className={styles.done}>
          <summary>{STR.important.recent(recentDone.length)}</summary>
          <ul className={styles.rows}>
            {recentDone.map((it) => (
              <li key={it.id} className={styles.doneRow}>
                <span className={styles.doneText}>{it.text}</span>
                <span className={styles.meta}>
                  {shortDateLabel(it.date)} ·{" "}
                  <button
                    type="button"
                    className={styles.restore}
                    aria-label={STR.important.restoreAria(it.text)}
                    onClick={() => void undoImportant(it.id)}
                  >
                    {STR.important.restore}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </aside>
  );
}
