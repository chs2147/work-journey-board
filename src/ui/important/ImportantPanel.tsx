// 왼쪽 중요 업무 패널(important-repeat-spec 2-3~2-5): 모든 주의 중요 항목을 묶음 › 업무별로(improve-1026v2-spec 8절), 체크 = 처리 완료, 누르면 그 칸으로.
import { useEffect, useRef, type KeyboardEvent } from "react";
import { groupImportant } from "../../domain/important";
import type { ImportantItem } from "../../domain/types";
import { localDate } from "../../domain/localTime";
import { shortDateLabel, weekIdOf, weekRange, weekTitle, type DateStr } from "../../domain/week";
import { STR } from "../../shared/strings";
import { PanelResizer } from "../common/PanelResizer";
import { usePanelWidths } from "../common/panelWidths";
import {
  completeImportant,
  focusStartCell,
  revealItem,
  setPanelOpen,
  setWeekDoneOpen,
  undoImportant,
  useBoard,
} from "../board/boardStore";
import { IconDone } from "../common/icons";
import { dueView } from "../board/dueView";
import styles from "./ImportantPanel.module.css";

/** 처리한 날(내 PC 날짜)로 묶음 — 목록은 이미 최근 순 */
function doneDays(items: ImportantItem[]): [DateStr, ImportantItem[]][] {
  const out: [DateStr, ImportantItem[]][] = [];
  for (const it of items) {
    const day = it.flagDoneAt ? localDate(new Date(it.flagDoneAt)) : it.date;
    const last = out[out.length - 1];
    if (last?.[0] === day) last[1].push(it);
    else out.push([day, [it]]);
  }
  return out;
}

export function ImportantPanel({ overlay }: { overlay: boolean }) {
  const important = useBoard((s) => s.important);
  const weekDone = useBoard((s) => s.weekDone);
  const weekDoneOpen = useBoard((s) => s.weekDoneOpen);
  const weekId = useBoard((s) => s.weekId);
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

  const panelW = usePanelWidths((st) => st.important);
  return (
    <aside
      style={{ width: panelW }}
      className={`${styles.panel} ${overlay ? styles.overlay : ""}`}
      aria-label={STR.important.title}
      data-testid="important-panel"
    >
      <PanelResizer panel="important" />
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
          weekDone.length > 0 ? (
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
            <section
              key={g.key}
              aria-label={STR.important.groups[g.key]}
              className={g.key === "today" ? styles.todayArea : g.key === "due" ? styles.dueArea : undefined}
              data-testid={`important-group-${g.key}`}
            >
              <h3 className={`${styles.group} ${styles[`group_${g.key}`] ?? ""}`} data-group={g.key}>
                <span>
                  {STR.important.groups[g.key]}
                  {g.key === "today" && <span className={styles.groupWhen}> · {shortDateLabel(today)}</span>}
                  {g.key === "thisWeek" && (
                    <span className={styles.groupWhen}>
                      {" "}
                      · ~{shortDateLabel(weekRange(weekIdOf(today)).end)}
                    </span>
                  )}
                </span>
                <span>{g.items.length}</span>
              </h3>
              {/* 마감일이 있는 업무(improve-1104v10-spec 10절 v10-b): 마감일로 묶고 줄에는 항목명만 */}
              {g.key === "due" &&
                dueDays(g.items).map(([d, list]) => {
                  const v = dueView(today, d);
                  return (
                    <div
                      key={d}
                      role="group"
                      aria-label={`${v.short} ${shortDateLabel(d)}`}
                      data-testid="important-due-day"
                    >
                      <h4 className={styles.dueDay}>
                        <span
                          className={`${styles.dueBadge} ${styles[`due_${v.kind}`] ?? ""}`}
                          data-testid="important-due-badge"
                          data-due-kind={v.kind}
                        >
                          {v.short}
                        </span>
                        <span>{shortDateLabel(d)}</span>
                        <span className={styles.dueCount}>{list.length}</span>
                      </h4>
                      <ul className={styles.rows}>
                        {list.map((it) => (
                          <li key={it.id} className={styles.row} data-testid="important-due-row">
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
                              title={STR.dueDate.rowTitle(it.categoryName, shortDateLabel(it.date))}
                              onClick={() => void revealItem(it)}
                              onKeyDown={(e) => onRowKey(e, it)}
                            >
                              <span className={styles.dueLine}>
                                <span
                                  className={styles.dot}
                                  style={{ background: `var(--cat-${it.categoryColor})` }}
                                />
                                <span className={styles.dueText}>{it.text}</span>
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
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
                          {(g.key !== "today" || it.startTime) && (
                            <span className={styles.meta}>
                              <span>
                                {g.key !== "today" && shortDateLabel(it.date)}
                                {it.startTime && (
                                  <span className={styles.time} data-testid="important-time">
                                    {g.key !== "today" && " "}
                                    {STR.startTime.chip(it.startTime)}
                                  </span>
                                )}
                              </span>
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

      {/* 이 주 완료(improve-1027v4-spec 4절): 보고 있는 주에 처리한 항목만, 처리한 날로 묶어 최근 위 */}
      <details
        className={styles.done}
        open={weekDoneOpen}
        data-testid="week-done"
        onToggle={(e) => setWeekDoneOpen(e.currentTarget.open)}
      >
        <summary>
          <span>{STR.important.weekDone(weekTitle(weekId))}</span>
          <span className={weekDone.length ? styles.doneCount : styles.meta}>{weekDone.length}</span>
        </summary>
        {weekDone.length === 0 ? (
          <p className={styles.doneEmpty}>{STR.important.weekDoneEmpty}</p>
        ) : (
          <div className={styles.doneList}>
            {doneDays(weekDone).map(([day, items]) => (
              <section key={day} aria-label={STR.important.doneOn(shortDateLabel(day))}>
                <h3 className={styles.doneDay}>{STR.important.doneOn(shortDateLabel(day))}</h3>
                <ul className={styles.rows}>
                  {items.map((it) => (
                    <li key={it.id} className={styles.doneRow} data-testid="week-done-row">
                      <IconDone size={14} />
                      <button type="button" className={styles.doneText} onClick={() => void revealItem(it)}>
                        {it.text}
                      </button>
                      <span className={styles.meta}>{shortDateLabel(it.date)}</span>
                      <button
                        type="button"
                        className={styles.restore}
                        aria-label={STR.important.restoreAria(it.text)}
                        onClick={() => void undoImportant(it.id)}
                      >
                        {STR.important.restore}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </details>
    </aside>
  );
}

/** 이미 마감 임박순인 목록을 같은 마감일끼리 묶는다(순서 유지) */
function dueDays(items: ImportantItem[]): [string, ImportantItem[]][] {
  const out: [string, ImportantItem[]][] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (last && last[0] === it.dueDate) last[1].push(it);
    else out.push([it.dueDate!, [it]]);
  }
  return out;
}
