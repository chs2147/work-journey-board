// 주간 보드: 포커스 열 격자(overview 10-1). 행 = 업무, 열 = 월~일, 아래 = 업무 추가. 메모는 보드 아래 메모 도크(weekly-note-spec).
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { cellKey } from "../../data/repository";
import { DAY_LABELS, type DateStr } from "../../domain/week";
import { STR } from "../../shared/strings";
import { focusNote } from "../note/noteStore";
import { filterLabel } from "../../domain/tags";
import {
  enterCell,
  reorderVisible,
  setFocusDay,
  setTagFilter,
  shownCategories,
  useBoard,
} from "./boardStore";
import { CategoryHeader } from "./CategoryHeader";
import { DayHeader } from "./DayHeader";
import { CellEditor, type CellNav } from "./CellEditor";
import { AddCategoryRow } from "./AddCategoryRow";
import styles from "./Board.module.css";

const LABEL_WIDTH = "184px";
const NARROW = "44px";

export function BoardView() {
  const view = useBoard((s) => s.view);
  const focusDay = useBoard((s) => s.focusDay);
  const today = useBoard((s) => s.today);
  const cells = useBoard((s) => s.cells);
  const nudges = useBoard((s) => s.nudges);
  const nudgeWeeks = useBoard((s) => s.nudgeWeeks);
  const dayMarks = useBoard((s) => s.dayMarks);
  const categoryTags = useBoard((s) => s.categoryTags);
  const tagFilter = useBoard((s) => s.tagFilter);
  const tags = useBoard((s) => s.tags);
  const [dragId, setDragId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 주가 바뀌면 맨 위로
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [view?.weekId]);

  if (!view) return null;
  // 태그로 거른 보기(improve-1026-spec 6절) — 키보드 이동·순서 바꾸기도 보이는 업무만 지난다
  const cats = shownCategories({ view, categoryTags, tagFilter });
  const hidden = view.categories.length - cats.length;

  const hasRecords = (day: DateStr) =>
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
        // 마지막 업무 칸 아래 = 주간 메모(weekly-note-spec 4-6)
        setFocusDay(day);
        focusNote();
      }
      return true;
    },
  });

  return (
    <>
      {tagFilter.length > 0 && (
        <div className={styles.filterBanner} role="status" data-testid="tag-filter-banner">
          <span>
            {STR.tags.banner(filterLabel(tagFilter, tags, STR.tags.noTag), hidden)}
            {cats.length === 0 && view.categories.length > 0 && ` — ${STR.tags.allHidden}`}
          </span>
          <button type="button" onClick={() => setTagFilter([])}>
            {STR.tags.clear}
          </button>
        </div>
      )}
      <div className={styles.scroll} ref={scrollRef}>
        <div className={styles.grid} style={gridStyle} data-testid="board-grid">
          <div className={`${styles.colHeader} ${styles.corner}`}>{STR.board.categoryHeader}</div>
          {view.days.map((day, i) => (
            <DayHeader key={day} day={day} index={i} narrow={widths[i] === NARROW} />
          ))}

          {view.categories.length === 0 && <div className={styles.empty}>{STR.board.emptyBoard}</div>}

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
                    className={[
                      styles.cell,
                      day === focusDay ? styles.cellFocus : "",
                      day === today ? styles.cellToday : "",
                      dayMarks[day] === "leave" ? styles.cellLeave : "",
                      narrow ? styles.cellNarrow : "",
                      vc.state !== "active" ? styles.cellEnded : "",
                    ].join(" ")}
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
        </div>
      </div>
    </>
  );
}

/** 격자에서 한 행의 칸들을 그대로 펼친다(래퍼 요소 없이). */
function Row({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
