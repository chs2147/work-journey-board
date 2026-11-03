// 항목 도구 ⋯ 메뉴 · 시작 시각 창 · 다른 날로 옮기기 창(improve-1103v8-spec T1·T4·5절).
// 세 창 모두 항목 줄 안에 떠 있고, Esc·바깥 누르기 = 닫기(커서는 그 항목으로 돌아간다).
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { krHolidaysBetween } from "../../domain/holidaysKr";
import { parseTimeInput, QUARTERS, stepTime } from "../../domain/startTime";
import { addDays, dayIndex, formatDate, parseDate, shortDateLabel, type DateStr } from "../../domain/week";
import { osText } from "../../shared/platformText";
import { STR } from "../../shared/strings";
import styles from "./Board.module.css";

/** 바깥을 누르면 닫히는 작은 창 */
function usePopover(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close.current();
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, []);
  return ref;
}

function Pop({
  label,
  className,
  testId,
  onClose,
  onKeyDown,
  children,
}: {
  label: string;
  className: string | undefined;
  testId: string;
  onClose(): void;
  onKeyDown?(e: ReactKeyboardEvent<HTMLDivElement>): void;
  children: ReactNode;
}) {
  const ref = usePopover(onClose);
  // 화면 기준으로 띄운다 — 보드 칸 영역(스크롤 상자)에 잘리지 않게. 항목 아래가 모자라면 위로
  useLayoutEffect(() => {
    const el = ref.current;
    const row = el?.parentElement;
    if (!el || !row) return;
    const r = row.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const below = r.bottom + 4;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 4) : below;
    const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
    Object.assign(el.style, { position: "fixed", top: `${top}px`, left: `${left}px`, right: "auto" });
  }, [ref]);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [ref]);
  return (
    <div
      ref={ref}
      className={className}
      role="dialog"
      aria-label={label}
      data-testid={testId}
      onMouseDown={(e) => {
        // 칸 입력란의 blur(칸 떠나기)를 막는다 — 창 안 단추는 그대로 눌린다
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
          return;
        }
        onKeyDown?.(e);
      }}
    >
      {children}
    </div>
  );
}

/** ⋯ 메뉴: 시작 시각… / 다른 날로 옮기기… */
export function ItemMoreMenu({
  onTime,
  onMove,
  onClose,
}: {
  onTime(): void;
  onMove(): void;
  onClose(): void;
}) {
  const T = STR.itemTools;
  return (
    <Pop label={T.more} className={styles.itemMenu} testId="item-menu" onClose={onClose}>
      <div role="menu">
        <button type="button" role="menuitem" data-autofocus onClick={onTime}>
          <span>⏰ {T.time}</span>
          <kbd>{osText(T.timeKey)}</kbd>
        </button>
        <button type="button" role="menuitem" onClick={onMove}>
          <span>📅 {T.move}</span>
          <kbd>{osText(T.moveKey)}</kbd>
        </button>
      </div>
    </Pop>
  );
}

const COMMON_HOURS = Array.from({ length: 12 }, (_, i) => String(i + 8).padStart(2, "0"));
const ALL_HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));

/** 시작 시각 창(T1): 시 · 분(15분) · [지우기] [취소] [HH:MM 시작] */
export function StartTimePopover({
  date,
  initial,
  hasValue,
  onSave,
  onClose,
}: {
  date: DateStr;
  initial: string;
  hasValue: boolean;
  onSave(time: string | null): void;
  onClose(): void;
}) {
  const S = STR.startTime;
  const [t, setT] = useState(initial);
  const [all, setAll] = useState(() => !COMMON_HOURS.includes(initial.slice(0, 2)));
  const typed = useRef("");
  const hh = t.slice(0, 2);
  const mm = t.slice(3, 5);
  return (
    <Pop
      label={S.title(shortDateLabel(date))}
      className={styles.timePop}
      testId="start-time-popover"
      onClose={onClose}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const next = stepTime(t, e.key === "ArrowUp" ? 1 : -1);
          setT(next);
          if (!COMMON_HOURS.includes(next.slice(0, 2))) setAll(true);
        } else if (e.key === "Enter") {
          e.preventDefault();
          onSave(t);
        } else if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          if (typed.current) typed.current = typed.current.slice(0, -1);
          else onSave(null);
        } else if (/^\d$/.test(e.key)) {
          e.preventDefault();
          typed.current = (typed.current + e.key).slice(-4);
          const parsed = parseTimeInput(typed.current);
          if (parsed) {
            setT(parsed);
            if (!COMMON_HOURS.includes(parsed.slice(0, 2))) setAll(true);
          }
        }
      }}
    >
      <strong className={styles.popTitle}>{S.title(shortDateLabel(date))}</strong>
      <span className={styles.popLabel}>{S.hour}</span>
      <div className={styles.hourGrid} role="group" aria-label={S.hour}>
        {(all ? ALL_HOURS : COMMON_HOURS).map((h) => (
          <button
            key={h}
            type="button"
            className={h === hh ? styles.pickOn : styles.pick}
            aria-pressed={h === hh}
            onClick={() => setT(`${h}:${mm}`)}
          >
            {h}
          </button>
        ))}
      </div>
      <button type="button" className={styles.popLink} onClick={() => setAll(!all)}>
        {all ? S.fewerHours : S.moreHours}
      </button>
      <span className={styles.popLabel}>{S.minute}</span>
      <div className={styles.minuteGrid} role="group" aria-label={S.minute}>
        {QUARTERS.map((q) => (
          <button
            key={q}
            type="button"
            className={q === mm ? styles.pickOn : styles.pick}
            aria-pressed={q === mm}
            onClick={() => setT(`${hh}:${q}`)}
          >
            :{q}
          </button>
        ))}
      </div>
      <div className={styles.popActions}>
        {hasValue && (
          <button type="button" className={styles.popBtn} onClick={() => onSave(null)}>
            {S.clear}
          </button>
        )}
        <span className={styles.popSpacer} />
        <button type="button" className={styles.popBtn} onClick={onClose}>
          {S.cancel}
        </button>
        <button type="button" className={styles.popPrimary} data-autofocus onClick={() => onSave(t)}>
          {S.ok(t)}
        </button>
      </div>
      <span className={styles.popHelp}>{S.help}</span>
    </Pop>
  );
}

const monthStart = (d: DateStr) => `${d.slice(0, 7)}-01`;
const addMonths = (first: DateStr, n: number): DateStr => {
  const d = parseDate(first);
  return formatDate(new Date(d.getFullYear(), d.getMonth() + n, 1));
};

/** 다른 날로 옮기기 창(T4): 빠른 단추 3개 + 달력 + [옮기기] */
export function MoveDatePopover({
  from,
  today,
  subs,
  onMove,
  onClose,
}: {
  from: DateStr;
  today: DateStr;
  subs: number;
  onMove(date: DateStr): void;
  onClose(): void;
}) {
  const M = STR.moveDate;
  const [sel, setSel] = useState<DateStr>(addDays(from, 7));
  const [month, setMonth] = useState<DateStr>(monthStart(addDays(from, 7)));
  const grid = useMemo(() => {
    const first = month;
    const lead = dayIndex(first); // 월요일 시작
    const start = addDays(first, -lead);
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [month]);
  const holidays = useMemo(() => krHolidaysBetween(grid[0]!, grid[41]!), [grid]);
  const pick = (d: DateStr) => {
    setSel(d);
    if (monthStart(d) !== month) setMonth(monthStart(d));
  };
  const quick: [string, DateStr][] = [
    [M.nextWeek(shortDateLabel(addDays(from, 7))), addDays(from, 7)],
    [M.prevWeek(shortDateLabel(addDays(from, -7))), addDays(from, -7)],
    [M.tomorrow(shortDateLabel(addDays(from, 1))), addDays(from, 1)],
  ];
  const [y, m] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
  return (
    <Pop
      label={M.title(subs)}
      className={styles.movePop}
      testId="move-date-popover"
      onClose={onClose}
      onKeyDown={(e) => {
        if (!(e.target as HTMLElement).closest("[data-cal]")) return;
        const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
        if (step) {
          e.preventDefault();
          pick(addDays(sel, step));
        } else if (e.key === "PageUp" || e.key === "PageDown") {
          e.preventDefault();
          const next = addMonths(monthStart(sel), e.key === "PageUp" ? -1 : 1);
          const day = Math.min(Number(sel.slice(8, 10)), 28);
          pick(`${next.slice(0, 8)}${String(day).padStart(2, "0")}`);
        } else if (e.key === "Enter") {
          e.preventDefault();
          if (sel !== from) onMove(sel);
        }
      }}
    >
      <strong className={styles.popTitle}>{M.title(subs)}</strong>
      <div className={styles.moveQuick}>
        {quick.map(([label, d], i) => (
          <button
            key={d}
            type="button"
            className={styles.popBtn}
            data-autofocus={i === 0 ? true : undefined}
            onClick={() => onMove(d)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className={styles.calHead}>
        <span className={styles.popLabel}>{M.pick}</span>
        <button
          type="button"
          className={styles.calNav}
          aria-label={M.prevMonth}
          onClick={() => setMonth(addMonths(month, -1))}
        >
          ‹
        </button>
        <span data-testid="move-month">{M.month(y, m)}</span>
        <button
          type="button"
          className={styles.calNav}
          aria-label={M.nextMonth}
          onClick={() => setMonth(addMonths(month, 1))}
        >
          ›
        </button>
      </div>
      <div className={styles.cal} role="grid" data-cal tabIndex={0} aria-label={M.pick}>
        {["월", "화", "수", "목", "금", "토", "일"].map((d, i) => (
          <b key={d} className={i >= 5 ? styles.calOff : undefined}>
            {d}
          </b>
        ))}
        {grid.map((d) => {
          const off = dayIndex(d) >= 5 || !!holidays[d];
          return (
            <button
              key={d}
              type="button"
              tabIndex={-1}
              role="gridcell"
              aria-selected={d === sel}
              aria-label={shortDateLabel(d)}
              title={holidays[d]?.name}
              className={[
                styles.calDay,
                monthStart(d) !== month ? styles.calOut : "",
                off ? styles.calOff : "",
                d === today ? styles.calToday : "",
                d === from ? styles.calFrom : "",
                d === sel ? styles.calSel : "",
              ].join(" ")}
              onClick={() => setSel(d)}
              onDoubleClick={() => d !== from && onMove(d)}
            >
              {Number(d.slice(8, 10))}
            </button>
          );
        })}
      </div>
      <span className={styles.popHelp} data-testid="move-where">
        {sel === from ? M.same : M.where(shortDateLabel(sel))}
      </span>
      <div className={styles.popActions}>
        <span className={styles.popSpacer} />
        <button type="button" className={styles.popBtn} onClick={onClose}>
          {M.cancel}
        </button>
        <button
          type="button"
          className={styles.popPrimary}
          disabled={sel === from}
          onClick={() => onMove(sel)}
        >
          {M.go}
        </button>
      </div>
      <span className={styles.popHelp}>{M.help}</span>
    </Pop>
  );
}
