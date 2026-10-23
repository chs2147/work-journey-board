// 연간 보기 팝오버(overview 10-2): ISO 연도의 주를 월별 행으로, 칸 색 = 그 주 기록한 날 수(단일 파랑 5단계).
import { useEffect, useRef, useState } from "react";
import {
  parseWeekId,
  weekIdOf,
  weekTitle,
  weeksInIsoYear,
  weeksOfIsoYear,
  type WeekId,
} from "../../domain/week";
import { STR } from "../../shared/strings";
import { goToWeek, setYearOpen, useBoard, yearDensity } from "./boardStore";
import { densityLevel } from "./helpers";
import styles from "./YearMinimap.module.css";

export function YearMinimap() {
  const weekId = useBoard((s) => s.weekId);
  const today = useBoard((s) => s.today);
  const [year, setYear] = useState(() => parseWeekId(weekId).year);
  const [density, setDensity] = useState<Map<WeekId, number>>(new Map());
  const ref = useRef<HTMLDivElement>(null);
  const currentWeek = today ? weekIdOf(today) : weekId;

  useEffect(() => {
    let alive = true;
    void yearDensity(year).then((m) => alive && setDensity(m));
    return () => {
      alive = false;
    };
  }, [year]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (
        !ref.current?.contains(e.target as Node) &&
        !(e.target as HTMLElement).closest("[data-year-toggle]")
      ) {
        setYearOpen(false);
      }
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setYearOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, []);

  const byMonth = new Map<number, WeekId[]>();
  for (const w of weeksOfIsoYear(year)) byMonth.set(w.month, [...(byMonth.get(w.month) ?? []), w.weekId]);

  return (
    <div
      className={styles.pop}
      ref={ref}
      role="dialog"
      aria-label={STR.topBar.year}
      data-testid="year-minimap"
    >
      <div className={styles.head}>
        <button
          type="button"
          aria-label={STR.year.prev}
          title={STR.year.prev}
          onClick={() => setYear((y) => y - 1)}
        >
          ◀
        </button>
        <span className={styles.title}>{STR.year.title(year, weeksInIsoYear(year))}</span>
        <button
          type="button"
          aria-label={STR.year.next}
          title={STR.year.next}
          onClick={() => setYear((y) => y + 1)}
        >
          ▶
        </button>
      </div>
      {[...byMonth.entries()].map(([month, weeks]) => (
        <div className={styles.row} key={month}>
          <span className={styles.month}>{STR.year.month(month)}</span>
          {weeks.map((w) => {
            const days = density.get(w) ?? 0;
            return (
              <button
                type="button"
                key={w}
                className={`${styles.week} ${styles[`l${densityLevel(days)}`]} ${w === currentWeek ? styles.current : ""} ${w === weekId ? styles.viewing : ""}`}
                title={STR.year.weekTitle(weekTitle(w), days)}
                aria-label={STR.year.weekTitle(weekTitle(w), days)}
                onClick={() => {
                  setYearOpen(false);
                  void goToWeek(w);
                }}
              >
                {w.slice(5)}
              </button>
            );
          })}
        </div>
      ))}
      <div className={styles.legend}>
        <span>{STR.year.less}</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={`${styles.swatch} ${styles[`l${l}`]}`} />
        ))}
        <span>{STR.year.more}</span>
        <span className={styles.legendNote}>{STR.year.legend}</span>
      </div>
    </div>
  );
}
