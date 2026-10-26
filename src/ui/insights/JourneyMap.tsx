// 업무 경과 지도(m3-s1-spec 4-0): 그 업무의 시작 주(달) → 이번 주 또는 종료까지 한 칸 = 한 주(한 달) 히트맵.
// 칸은 실제 단추(키보드·화면 읽기), 색은 단계 클래스로만(CSP: 인라인 style 문자열 없음 — React style 속성은 CSSOM).
import { useMemo, useState, type KeyboardEvent } from "react";
import {
  mapNeedsYearRows,
  monthLabel,
  monthSpans,
  spanDates,
  type MapCell,
  type MapUnit,
  type WeekSpan,
} from "../../domain/insights";
import { weekRange } from "../../domain/week";
import { STR } from "../../shared/strings";
import { jumpTo, setMapUnit } from "./insightsStore";
import styles from "./Insights.module.css";

const LEVEL = [styles.l0, styles.l1, styles.l2, styles.l3, styles.l4];
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

function cellLabel(c: MapCell, unit: MapUnit) {
  if (unit === "week") {
    const range = `${md(c.from)}~${md(c.to)}`;
    return c.rest
      ? STR.insights.mapCellRest(`${c.key} ${range}`)
      : STR.insights.mapCellWeek(c.key, range, c.days, c.items, c.current);
  }
  const label = monthLabel(c.key);
  return c.rest ? STR.insights.mapCellRest(label) : STR.insights.mapCellMonth(label, c.days, c.items);
}

interface Props {
  cells: MapCell[];
  unit: MapUnit;
  /** 지금 타임라인 기간 */
  range: WeekSpan | null;
  rangeLabel: string;
  /** 타임라인에 보이는 주 */
  visibleWeeks: string[];
  ongoing: boolean;
}

export function JourneyMap({ cells, unit, range, rangeLabel, visibleWeeks, ongoing }: Props) {
  const [table, setTable] = useState(false);
  // 화면에 보이는 칸: 주 = 그 주, 달 = 보이는 주와 날짜가 겹치는 달
  const seen = useMemo(() => {
    if (unit === "week") return new Set(visibleWeeks);
    const ranges = visibleWeeks.map(weekRange);
    return new Set(
      cells.filter((c) => ranges.some((r) => r.start <= c.to && r.end >= c.from)).map((c) => c.key),
    );
  }, [unit, visibleWeeks, cells]);
  const dates = range ? spanDates(range) : null;
  const inRange = (c: MapCell) =>
    !!range &&
    (unit === "week"
      ? c.key >= range.fromWeek && c.key <= range.toWeek
      : c.from <= dates!.to && c.to >= dates!.from);
  if (!cells.length) return null;
  const first = cells[0]!;
  const last = cells.at(-1)!;
  const yearRows = unit === "week" && mapNeedsYearRows(cells);
  const small = unit === "week" && cells.length > 26;
  // 주 칸은 46px까지만 넓어진다(몇 주 안 된 업무가 화면 끝까지 늘어나지 않게)
  const cols = `repeat(${cells.length}, minmax(0, 46px))`;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const all = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("[data-map-cell]")];
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    all[Math.max(0, Math.min(all.length - 1, i + (e.key === "ArrowLeft" ? -1 : 1)))]?.focus();
  };

  const cellButton = (c: MapCell) => {
    const label = cellLabel(c, unit);
    const isSeen = seen.has(c.key);
    return (
      <button
        key={c.key}
        type="button"
        className={[
          styles.cell,
          small ? styles.cellSmall : "",
          c.rest ? styles.rest : LEVEL[c.level],
          inRange(c) ? styles.inRange : "",
          isSeen ? styles.seen : "",
          c.current ? styles.nowCell : "",
        ].join(" ")}
        aria-label={label}
        title={label}
        data-map-cell={c.key}
        data-level={c.rest ? "rest" : c.level}
        onClick={() => void jumpTo(c.key, unit)}
      />
    );
  };

  return (
    <section className={styles.map} aria-label={STR.insights.map} data-testid="journey-map">
      <div className={styles.mapHead}>
        <h3 className={styles.mapTitle}>{STR.insights.map}</h3>
        <span className={styles.muted}>{STR.insights.mapHint(unit)}</span>
        <span className={styles.grow} />
        <span className={styles.muted}>
          {STR.insights.mapSpan(
            unit === "week" ? first.key : monthLabel(first.key),
            unit === "week" ? last.key : monthLabel(last.key),
            ongoing,
          )}
        </span>
        <div className={styles.seg} role="group" aria-label={STR.insights.mapUnit}>
          <button type="button" aria-pressed={unit === "week"} onClick={() => setMapUnit("week")}>
            {STR.insights.mapWeek}
          </button>
          <button type="button" aria-pressed={unit === "month"} onClick={() => setMapUnit("month")}>
            {STR.insights.mapMonth}
          </button>
        </div>
        <button type="button" className={styles.linkBtn} onClick={() => setTable((t) => !t)}>
          {table ? STR.insights.mapTableHide : STR.insights.mapTable}
        </button>
      </div>

      <div role="group" aria-label={STR.insights.map} onKeyDown={onKeyDown}>
        {unit === "month" ? (
          <div className={styles.monthCells}>
            {cells.map((c) => (
              <div key={c.key} className={styles.monthCell}>
                {cellButton(c)}
                <span className={styles.muted}>
                  {c.index === 1 || c === first ? `${String(c.year).slice(2)}.${c.index}` : c.index}
                </span>
              </div>
            ))}
          </div>
        ) : yearRows ? (
          [...new Set(cells.map((c) => c.year))].map((y) => (
            <div key={y} className={styles.mapYear}>
              <span className={styles.mapYearLabel}>{y}</span>
              <div
                className={styles.mapGrid}
                style={{ gridTemplateColumns: "repeat(53, minmax(0, 1fr))", flex: "1 1 auto" }}
              >
                {cells
                  .filter((c) => c.year === y)
                  .map((c) => (
                    <span key={c.key} style={{ gridColumn: String(c.index), display: "grid" }}>
                      {cellButton(c)}
                    </span>
                  ))}
              </div>
            </div>
          ))
        ) : (
          <>
            <div className={styles.mapGrid} style={{ gridTemplateColumns: cols }}>
              {monthSpans(cells).map((m) => (
                <span key={m.month} className={styles.mapMonth} style={{ gridColumn: `span ${m.count}` }}>
                  {monthLabel(m.month).replace(
                    /^\d+년 /,
                    m.month === first.month || m.month.endsWith("-01") ? `${m.month.slice(0, 4)}년 ` : "",
                  )}
                </span>
              ))}
            </div>
            <div className={styles.mapGrid} style={{ gridTemplateColumns: cols }}>
              {cells.map(cellButton)}
            </div>
            {!small && (
              <div className={styles.mapLabels} style={{ gridTemplateColumns: cols }}>
                {cells.map((c) => (
                  <span key={c.key}>W{c.index}</span>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className={styles.legend}>
        <span className={styles.legendItem}>
          {STR.insights.mapLess}
          {LEVEL.map((l, i) => (
            <span key={i} className={`${styles.sw} ${l}`} />
          ))}
          {STR.insights.mapMore} {unit === "week" ? STR.insights.mapWeekLevels : STR.insights.mapMonthLevels}
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.sw} ${styles.rest}`} />
          {STR.insights.mapRest}
        </span>
        {range && (
          <span className={styles.legendItem}>
            <span className={styles.swRange} />
            {STR.insights.mapRange(rangeLabel)}
          </span>
        )}
        <span className={styles.legendItem}>
          <span className={styles.swSeen} />
          {STR.insights.mapVisible}
        </span>
      </div>

      {table && (
        <div className={styles.mapTable}>
          <table>
            <thead>
              <tr>
                {STR.insights.mapTableHead.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cells.map((c) => (
                <tr key={c.key}>
                  <td>{unit === "week" ? `${c.key} (${md(c.from)}~${md(c.to)})` : monthLabel(c.key)}</td>
                  <td>{c.rest ? "—" : c.days}</td>
                  <td>{c.rest ? "—" : c.items}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
