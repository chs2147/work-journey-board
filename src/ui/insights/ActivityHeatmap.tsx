// 활동 히트맵(m3-s2-spec 4~9절): 행 = 업무(맨 위 모든 업무), 칸 = 하루(최근 12주) 또는 한 주(연간).
// 칸은 HTML 단추 격자(SVG 없음) — 색은 단계 클래스, 폭·위치는 React style(CSSOM, CSP 인라인 style 문자열 없음).
// 격자 하나 = Tab 한 번(roving tabindex), 방향키 이동, 툴팁은 자체 상자(브라우저 title 아님).
// 칸 사이 2px는 투명 테두리 — 눌리는 영역이 칸 사이 간격까지(viz-spec 2-4).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { DAY_MARK_LABEL } from "../../domain/dayMark";
import {
  columnSpans,
  heatColumns,
  heatGrid,
  heatTable,
  monthLabel,
  type HeatCell,
  type HeatColumn,
  type HeatRange,
  type HeatRow,
} from "../../domain/insights";
import type { Category, CategoryPeriod } from "../../domain/types";
import { DAY_LABELS, dayIndex, parseWeekId, type DateStr } from "../../domain/week";
import { STR } from "../../shared/strings";
import { moveHeat, openTimelineOf, revealHeatCell, setHeatUnit, type HeatData } from "./insightsStore";
import styles from "./Insights.module.css";

const LEVEL = [styles.l0, styles.l1, styles.l2, styles.l3, styles.l4];
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const dayLabel = (d: DateStr) => `${md(d)}(${DAY_LABELS[dayIndex(d)]})`;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);
const NAME_W = 196;
const COUNT_W = 64;
const TIP_DELAY = 300;

interface Props {
  range: HeatRange;
  heat: HeatData | null;
  /** 보이는 업무(보드 순서 + 종료 업무), 종료 여부 */
  rows: { category: Category; ended: boolean }[];
  periods: CategoryPeriod[];
  today: DateStr;
}

interface Tip {
  lines: { text: string; kind: "title" | "body" | "sub" | "go" }[];
  x: number;
  y: number;
}

export function ActivityHeatmap({ range, heat, rows, periods, today }: Props) {
  const unit = range.unit;
  const [table, setTable] = useState(false);
  const [cursor, setCursor] = useState<{ r: number; c: number } | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const ready = heat && heat.unit === unit && heat.from === range.from;

  const columns = useMemo(
    () => heatColumns(range, today, ready ? heat.dayMarks : {}),
    [range, today, ready, heat],
  );
  const idKey = rows.map((r) => r.category.id).join("|");
  const ids = useMemo(() => (idKey ? idKey.split("|") : []), [idKey]);
  const grid: HeatRow[] = useMemo(
    () => heatGrid(ready ? heat.activity : [], ids, periods, columns, unit),
    [ready, heat, ids, periods, columns, unit],
  );
  const nameOf = (id: string | null) =>
    id === null ? STR.insights.heatAll : (rows.find((r) => r.category.id === id)?.category.name ?? "");

  // 칸 폭(보이는 폭 + 투명 테두리 2px): 일 = 평일 12px · 토·일 6px, 주 = 18px
  const template = useMemo(
    () =>
      [
        `${NAME_W}px`,
        ...columns.map((c) => (unit === "week" ? "20px" : c.weekend ? "8px" : "14px")),
        `${COUNT_W}px`,
      ].join(" "),
    [columns, unit],
  );
  const nowCol = columns.findIndex((c) => c.current);
  const startCol = nowCol >= 0 ? nowCol : columns.length - 1;
  const cur = cursor ?? { r: grid.length > 1 ? 1 : 0, c: startCol };
  const curR = Math.min(cur.r, grid.length - 1);
  const curC = Math.max(-1, Math.min(cur.c, columns.length - 1));

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // 칸이 카드보다 넓으면(중요 업무 패널을 편 창 등) 끝(오늘·이번 주 쪽)이 보이게 맨 오른쪽으로
  const hasRows = rows.length > 0;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [range.from, unit, hasRows]);

  // 툴팁이 화면 밖으로 나가지 않게(칸 아래 → 넘치면 위, 좌우는 화면 안으로)
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!el || !tip) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(tip.x, window.innerWidth - r.width - 8));
    let top = tip.y;
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, tip.y - r.height - 28);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [tip]);

  const tipLines = (row: HeatRow, cell: HeatCell, col: HeatColumn): Tip["lines"] => {
    const name = nameOf(row.categoryId);
    const title =
      unit === "day"
        ? STR.insights.tipDay(name, dayLabel(col.key))
        : STR.insights.tipWeek(name, col.key, `${md(col.from)}~${md(col.to)}`);
    if (cell.outside)
      return [
        { text: title, kind: "title" },
        { text: STR.insights.tipOutside, kind: "body" },
      ];
    if (cell.future)
      return [
        { text: title, kind: "title" },
        { text: STR.insights.tipFuture(unit), kind: "body" },
      ];
    const go = { text: unit === "day" ? STR.insights.tipGoDay : STR.insights.tipGoWeek, kind: "go" as const };
    if (row.categoryId === null) {
      const parts = (cell.parts ?? []).map((p) => `${clip(nameOf(p.categoryId), 10)} ${p.value}`).join(" · ");
      return [
        { text: title, kind: "title" },
        {
          text:
            unit === "day"
              ? STR.insights.tipAllItems(cell.mains, cell.parts?.length ?? 0)
              : STR.insights.tipAllWeek(cell.days, cell.parts?.length ?? 0),
          kind: "body",
        },
        ...(parts ? [{ text: parts, kind: "sub" as const }] : []),
        go,
      ];
    }
    if (unit === "week")
      return [
        { text: title, kind: "title" },
        { text: STR.insights.tipWeekItems(cell.days, cell.mains), kind: "body" },
        go,
      ];
    if (!cell.days) {
      const mark = col.mark ? ` · ${DAY_MARK_LABEL[col.mark]}` : "";
      return [{ text: title, kind: "title" }, { text: STR.insights.tipNone + mark, kind: "body" }, go];
    }
    return [
      { text: title, kind: "title" },
      { text: STR.insights.tipItems(cell.mains, cell.subs), kind: "body" },
      ...(cell.firstText
        ? [{ text: STR.insights.tipFirst(clip(cell.firstText, 40), cell.mains - 1), kind: "sub" as const }]
        : []),
      go,
    ];
  };

  const showTip = (el: HTMLElement, r: number, c: number) => {
    const row = grid[r];
    const col = columns[c];
    if (!row || !col) return;
    const rect = el.getBoundingClientRect();
    setTip({ lines: tipLines(row, row.cells[c]!, col), x: rect.left - 8, y: rect.bottom + 6 });
  };
  const hideTip = () => {
    window.clearTimeout(timer.current);
    setTip(null);
  };

  /** 칸 → 보드(7절). 기간 밖·오지 않은 칸은 아무 일 없음 */
  const activate = (r: number, c: number) => {
    const row = grid[r];
    const col = columns[c];
    const cell = row?.cells[c];
    if (!row || !col || !cell || cell.outside || cell.future) return;
    hideTip();
    if (unit === "day") return void revealHeatCell(col.key, row.categoryId);
    // 주: 그 업무(모든 업무면 아무 업무)의 그 주 첫 기록일, 없으면 월요일
    const first = (ready ? heat.activity : [])
      .filter(
        (a) =>
          a.date >= col.from &&
          a.date <= col.to &&
          a.mains + a.subs > 0 &&
          (row.categoryId === null ? ids.includes(a.categoryId) : a.categoryId === row.categoryId),
      )
      .map((a) => a.date)
      .sort()[0];
    void revealHeatCell(first ?? col.from, row.categoryId);
  };

  const focusAt = (r: number, c: number) => {
    setCursor({ r, c });
    requestAnimationFrame(() =>
      gridRef.current
        ?.querySelector<HTMLElement>(`[data-heat-r="${r}"][data-heat-c="${c}"]`)
        ?.focus({ preventScroll: false }),
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing) return;
    const last = columns.length - 1;
    // 행 머리(c = -1)는 업무 행에만 — 모든 업무는 누를 수 없음
    const minC = curR > 0 ? -1 : 0;
    let next: { r: number; c: number };
    switch (e.key) {
      case "ArrowLeft":
        next = { r: curR, c: Math.max(minC, curC - 1) };
        break;
      case "ArrowRight":
        next = { r: curR, c: Math.min(last, curC + 1) };
        break;
      case "ArrowUp":
        next = { r: Math.max(0, curR - 1), c: curR - 1 === 0 ? Math.max(0, curC) : curC };
        break;
      case "ArrowDown":
        next = { r: Math.min(grid.length - 1, curR + 1), c: curC };
        break;
      case "Home":
        next = { r: curR, c: 0 };
        break;
      case "End":
        next = { r: curR, c: startCol };
        break;
      case "PageUp":
      case "PageDown": {
        e.preventDefault();
        const to = e.key === "PageUp" ? range.prev : range.next;
        if (to) {
          hideTip();
          moveHeat(to);
          requestAnimationFrame(() => focusAt(curR, Math.max(0, curC)));
        }
        return;
      }
      case "Enter":
      case " ":
        e.preventDefault();
        if (curC < 0) {
          const id = grid[curR]?.categoryId;
          if (id) openTimelineOf(id);
        } else activate(curR, curC);
        return;
      default:
        return;
    }
    e.preventDefault();
    focusAt(next.r, next.c);
  };

  const monthHead = columnSpans(columns, (c) => c.month);
  const weekHead = unit === "day" ? columnSpans(columns, (c) => c.week) : [];
  const firstMonth = monthHead[0]?.key;
  const tableData = table ? heatTable(grid, columns, unit) : null;

  const cellClass = (cell: HeatCell, isTotal: boolean) =>
    [
      styles.hcell,
      cell.outside ? styles.rest : cell.future ? styles.hfuture : LEVEL[cell.level],
      isTotal ? styles.htotalCell : "",
    ].join(" ");

  return (
    <section className={styles.card} aria-label={STR.insights.heat} data-testid="activity-heatmap">
      <div className={styles.mapHead}>
        <h3 className={styles.mapTitle}>{STR.insights.heat}</h3>
        <span className={styles.muted}>{STR.insights.heatHint(unit)}</span>
        <span className={styles.grow} />
        <div className={styles.seg} role="group" aria-label={STR.insights.heatUnit}>
          <button
            type="button"
            aria-pressed={unit === "day"}
            data-testid="heat-unit-day"
            onClick={() => setHeatUnit("day")}
          >
            {STR.insights.heatDay}
          </button>
          <button
            type="button"
            aria-pressed={unit === "week"}
            data-testid="heat-unit-week"
            onClick={() => setHeatUnit("week")}
          >
            {STR.insights.heatWeek}
          </button>
        </div>
        <div className={styles.pager}>
          <button
            type="button"
            className={styles.iconBtn}
            disabled={!range.prev}
            aria-label={STR.insights.heatPrev(unit)}
            title={STR.insights.heatPrev(unit)}
            data-testid="heat-prev"
            onClick={() => range.prev && moveHeat(range.prev)}
          >
            ◀
          </button>
          <span className={styles.pagerLabel} data-testid="heat-range">
            {range.label}
          </span>
          <button
            type="button"
            className={styles.iconBtn}
            disabled={!range.next}
            aria-label={STR.insights.heatNext(unit)}
            title={STR.insights.heatNext(unit)}
            data-testid="heat-next"
            onClick={() => range.next && moveHeat(range.next)}
          >
            ▶
          </button>
        </div>
        <button
          type="button"
          className={styles.linkBtn}
          aria-expanded={table}
          data-testid="heat-table-toggle"
          onClick={() => setTable((t) => !t)}
        >
          {table ? STR.insights.heatTableHide : STR.insights.heatTable}
        </button>
      </div>

      {rows.length === 0 ? (
        <div className={styles.empty} data-testid="heat-none">
          <strong>{STR.insights.heatNone}</strong>
          <span>{STR.insights.heatNoneHint}</span>
        </div>
      ) : (
        <div ref={scrollRef} className={styles.heatScroll} onMouseLeave={hideTip}>
          <div className={styles.heatInner} aria-hidden="true">
            <div className={styles.hrow} style={{ gridTemplateColumns: template }}>
              <span className={styles.hname} />
              {monthHead.map((m, i) => (
                <span
                  key={`${m.key}-${i}`}
                  className={styles.hmonth}
                  style={{ gridColumn: `span ${m.count}` }}
                  data-testid="heat-month"
                >
                  {m.count >= (unit === "day" ? 5 : 2)
                    ? m.key === firstMonth || m.key.endsWith("-01")
                      ? monthLabel(m.key)
                      : `${Number(m.key.slice(5))}월`
                    : ""}
                </span>
              ))}
            </div>
            {unit === "day" && (
              <div className={styles.hrow} style={{ gridTemplateColumns: template }}>
                <span className={styles.hname} />
                {weekHead.map((w) => (
                  <span key={w.key} className={styles.hweek} style={{ gridColumn: `span ${w.count}` }}>
                    W{parseWeekId(w.key).week}
                  </span>
                ))}
              </div>
            )}
            <div className={styles.hrow} style={{ gridTemplateColumns: template }}>
              <span className={styles.hname} />
              {columns.map((c) => (
                <span
                  key={c.key}
                  className={`${styles.hmark} ${c.mark && !c.current ? styles.hmarkLeave : ""}`}
                  data-heat-mark={c.current ? "today" : (c.mark ?? undefined)}
                >
                  {c.current
                    ? "▼"
                    : c.mark === "leave"
                      ? STR.insights.heatLeave
                      : c.mark
                        ? STR.insights.heatHalf
                        : ""}
                </span>
              ))}
            </div>
          </div>

          <div
            ref={gridRef}
            className={`${styles.heatInner} ${styles.heatGrid}`}
            role="grid"
            aria-label={`${STR.insights.heat} ${range.label}`}
            aria-rowcount={grid.length}
            aria-colcount={columns.length + 1}
            onKeyDown={onKeyDown}
            data-testid="heat-grid"
          >
            {grid.map((row, r) => {
              const isTotal = row.categoryId === null;
              const meta = rows.find((x) => x.category.id === row.categoryId);
              return (
                <div
                  key={row.categoryId ?? "__all__"}
                  role="row"
                  className={`${styles.hrow} ${isTotal ? styles.htotal : ""}`}
                  style={{ gridTemplateColumns: template }}
                  data-testid="heat-row"
                  data-heat-cat={row.categoryId ?? "__all__"}
                >
                  {isTotal ? (
                    <span role="rowheader" className={`${styles.hname} ${styles.hnameTotal}`}>
                      {STR.insights.heatAll}
                    </span>
                  ) : (
                    <span role="rowheader" className={styles.hname}>
                      <button
                        type="button"
                        className={styles.hnameBtn}
                        tabIndex={curR === r && curC === -1 ? 0 : -1}
                        aria-label={STR.insights.rowToTimeline(meta?.category.name ?? "")}
                        title={STR.insights.rowToTimeline(meta?.category.name ?? "")}
                        data-heat-r={r}
                        data-heat-c={-1}
                        data-testid="heat-row-name"
                        onFocus={() => setCursor({ r, c: -1 })}
                        onClick={() => openTimelineOf(row.categoryId!)}
                      >
                        <span
                          className={`${styles.dot} ${meta?.ended ? styles.dotEnded : ""}`}
                          style={
                            meta?.ended ? undefined : { background: `var(--cat-${meta?.category.color})` }
                          }
                        />
                        <span className={styles.hnameText}>{meta?.category.name}</span>
                      </button>
                    </span>
                  )}
                  {row.cells.map((cell, c) => {
                    const lines = tipLines(row, cell, columns[c]!);
                    return (
                      <button
                        key={cell.key}
                        type="button"
                        role="gridcell"
                        className={cellClass(cell, isTotal)}
                        tabIndex={curR === r && curC === c ? 0 : -1}
                        aria-label={lines
                          .slice(0, 2)
                          .map((l) => l.text)
                          .join(" · ")}
                        aria-disabled={cell.outside || cell.future ? true : undefined}
                        data-heat-r={r}
                        data-heat-c={c}
                        data-heat-key={cell.key}
                        data-level={cell.outside ? "outside" : cell.future ? "future" : cell.level}
                        data-value={cell.value}
                        onFocus={(e) => {
                          setCursor({ r, c });
                          window.clearTimeout(timer.current);
                          showTip(e.currentTarget, r, c);
                        }}
                        onBlur={hideTip}
                        onMouseEnter={(e) => {
                          const el = e.currentTarget;
                          window.clearTimeout(timer.current);
                          if (tip) showTip(el, r, c);
                          else timer.current = window.setTimeout(() => showTip(el, r, c), TIP_DELAY);
                        }}
                        onClick={() => activate(r, c)}
                      />
                    );
                  })}
                  <span className={styles.hcount} data-testid="heat-days">
                    {STR.insights.heatDays(row.recordedDays)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className={styles.legend}>
        <span className={styles.legendItem}>
          {STR.insights.mapLess}
          {LEVEL.map((l, i) => (
            <span key={i} className={`${styles.sw} ${l}`} />
          ))}
          {STR.insights.mapMore} {unit === "day" ? STR.insights.heatDayLevels : STR.insights.heatWeekLevels}
        </span>
        {unit === "day" && (
          <span className={styles.legendItem}>
            <span className={styles.hmarkLeave}>
              {STR.insights.heatLeave}·{STR.insights.heatHalf}
            </span>
            {STR.insights.heatLegendMarks}
          </span>
        )}
        <span className={styles.legendItem}>
          ▼ {unit === "day" ? STR.insights.heatToday : STR.insights.thisWeek}
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.sw} ${styles.hfuture}`} />
          {STR.insights.tipFuture(unit)}
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.sw} ${styles.rest}`} />
          {STR.insights.heatLegendOutside}
        </span>
      </div>

      {tableData && (
        <div className={styles.mapTable} data-testid="heat-table">
          <table>
            <caption className={styles.muted}>{STR.insights.heatTableHint(unit)}</caption>
            <thead>
              <tr>
                <th>{STR.insights.heatTableName}</th>
                {tableData.head.map((h) => (
                  <th key={h}>{unit === "day" ? `W${parseWeekId(h).week}` : `${Number(h.slice(5))}월`}</th>
                ))}
                <th>{STR.insights.heatTableTotal}</th>
              </tr>
            </thead>
            <tbody>
              {tableData.body.map((r) => (
                <tr key={r.categoryId ?? "__all__"}>
                  <th scope="row">{nameOf(r.categoryId)}</th>
                  {r.cells.map((c, i) => (
                    <td key={i}>
                      {c.outside && r.categoryId !== null
                        ? "—"
                        : unit === "day"
                          ? STR.insights.heatTableDay(c.mains, c.days)
                          : c.days}
                    </td>
                  ))}
                  <td>
                    {unit === "day" ? STR.insights.heatTableDay(r.total.mains, r.total.days) : r.total.days}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tip && (
        <div ref={tipRef} className={styles.tip} role="tooltip" data-testid="heat-tip">
          {tip.lines.map((l, i) => (
            <span
              key={i}
              className={
                l.kind === "title"
                  ? styles.tipTitle
                  : l.kind === "sub"
                    ? styles.tipSub
                    : l.kind === "go"
                      ? styles.tipGo
                      : undefined
              }
            >
              {l.text}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
