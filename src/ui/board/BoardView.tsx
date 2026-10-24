// 주간 보드: 포커스 열 격자(overview 10-1). 행 = 업무, 열 = 월~일, 아래 = 업무 추가 → 메모.
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { cellKey } from "../../data/repository";
import { DAY_LABELS, type DateStr } from "../../domain/week";
import { STR } from "../../shared/strings";
import { enterCell, reorderVisible, setFocus, setFocusDay, useBoard } from "./boardStore";
import { CategoryHeader } from "./CategoryHeader";
import { CellEditor, type CellNav } from "./CellEditor";
import { AddCategoryRow } from "./AddCategoryRow";
import { MemoCell } from "./MemoCell";
import styles from "./Board.module.css";

const LABEL_WIDTH = "184px";
const NARROW = "44px";

export function BoardView() {
  const view = useBoard((s) => s.view);
  const focusDay = useBoard((s) => s.focusDay);
  const today = useBoard((s) => s.today);
  const cells = useBoard((s) => s.cells);
  const memos = useBoard((s) => s.memos);
  const nudges = useBoard((s) => s.nudges);
  const nudgeWeeks = useBoard((s) => s.nudgeWeeks);
  const [dragId, setDragId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 주가 바뀌면 맨 위로
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [view?.weekId]);

  if (!view) return null;
  const cats = view.categories;

  const hasRecords = (day: DateStr) =>
    Boolean(memos[day]?.trim()) ||
    cats.some((c) => (cells[cellKey(day, c.category.id)] ?? []).some((i) => i.text.trim()));

  const widths = view.days.map((day, i) => {
    if (day === focusDay) return "minmax(0, 2fr)";
    if (i >= 5 && !hasRecords(day)) return NARROW;
    return "minmax(0, 1fr)";
  });
  const gridStyle = { gridTemplateColumns: [LABEL_WIDTH, ...widths].join(" ") } as CSSProperties;

  const navFor = (row: number, day: DateStr): CellNav => ({
    up() {
      if (row <= 0) return false;
      enterCell(cellKey(day, cats[row - 1]!.category.id), "below");
      return true;
    },
    down() {
      if (row < cats.length - 1) {
        enterCell(cellKey(day, cats[row + 1]!.category.id), "above");
      } else {
        setFocusDay(day);
        setFocus({ kind: "memo", date: day });
      }
      return true;
    },
  });

  const memoUp = (day: DateStr) => {
    const last = cats.at(-1);
    if (!last) return false;
    enterCell(cellKey(day, last.category.id), "below");
    return true;
  };

  return (
    <div className={styles.scroll} ref={scrollRef}>
      <div className={styles.grid} style={gridStyle} data-testid="board-grid">
        <div className={`${styles.colHeader} ${styles.corner}`}>{STR.board.categoryHeader}</div>
        {view.days.map((day, i) => {
          const narrow = widths[i] === NARROW;
          const isFocus = day === focusDay;
          const [, m, d] = day.split("-");
          return (
            <button
              type="button"
              key={day}
              className={`${styles.colHeader} ${isFocus ? styles.colFocus : ""} ${day === today ? styles.colToday : ""} ${narrow ? styles.colNarrow : ""}`}
              data-testid={`day-${day}`}
              onClick={() => setFocusDay(day)}
            >
              {narrow ? (
                <>
                  <span>{DAY_LABELS[i]}</span>
                  <span className={styles.colNarrowDate}>{Number(d)}</span>
                </>
              ) : (
                <span>
                  {DAY_LABELS[i]} {Number(m)}/{Number(d)}
                  {day === today ? ` · ${STR.board.todaySuffix}` : ""}
                </span>
              )}
            </button>
          );
        })}

        {cats.length === 0 && <div className={styles.empty}>{STR.board.emptyBoard}</div>}

        {cats.map((vc, row) => (
          <Row key={vc.category.id}>
            <CategoryHeader
              vc={vc}
              index={row}
              total={cats.length}
              nudge={nudges.includes(vc.category.id)}
              nudgeWeeks={nudgeWeeks}
              draggingId={dragId}
              onDragStart={setDragId}
              onDragEnd={() => setDragId(null)}
              onDrop={(targetId, place) => {
                setDragId(null);
                if (!dragId || dragId === targetId) return;
                const before = cats.map((c) => c.category.id);
                const ids = before.filter((id) => id !== dragId);
                ids.splice(ids.indexOf(targetId) + (place === "after" ? 1 : 0), 0, dragId);
                if (ids.join() !== before.join()) void reorderVisible(ids);
              }}
            />
            {view.days.map((day, i) => {
              const key = cellKey(day, vc.category.id);
              const narrow = widths[i] === NARROW;
              return (
                <div
                  key={day}
                  className={`${styles.cell} ${day === focusDay ? styles.cellFocus : ""} ${narrow ? styles.cellNarrow : ""} ${vc.state !== "active" ? styles.cellEnded : ""}`}
                  data-testid={`cell-${vc.category.name}-${day}`}
                  onMouseDown={(e) => {
                    if (narrow && e.target === e.currentTarget) {
                      e.preventDefault();
                      enterCell(key, "below");
                    }
                  }}
                >
                  {!narrow && (
                    <CellEditor
                      cellKey={key}
                      ariaLabel={STR.board.itemAria(vc.category.name, `${DAY_LABELS[i]} ${day}`)}
                      showPlaceholder={day === focusDay}
                      nav={navFor(row, day)}
                    />
                  )}
                </div>
              );
            })}
          </Row>
        ))}

        <AddCategoryRow />

        <div className={`${styles.rowHeader} ${styles.memoHeader}`}>
          <span className={styles.name}>{STR.board.memo}</span>
          <span className={styles.memoHint}>{STR.board.memoHint}</span>
        </div>
        {view.days.map((day, i) => {
          const narrow = widths[i] === NARROW;
          return (
            <div
              key={day}
              className={`${styles.cell} ${styles.memoCell} ${day === focusDay ? styles.cellFocus : ""} ${narrow ? styles.cellNarrow : ""}`}
              onMouseDown={(e) => {
                if (narrow && e.target === e.currentTarget) {
                  e.preventDefault();
                  setFocusDay(day);
                  setFocus({ kind: "memo", date: day });
                }
              }}
            >
              {!narrow && (
                <MemoCell
                  date={day}
                  label={`${DAY_LABELS[i]} ${day}`}
                  showPlaceholder={day === focusDay}
                  onUp={() => memoUp(day)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 격자에서 한 행의 칸들을 그대로 펼친다(래퍼 요소 없이). */
function Row({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
