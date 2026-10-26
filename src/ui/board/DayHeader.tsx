// 요일 머리(overview 10-1): 날짜·[오늘] 배지·연차/반차 배지·⋯ 메뉴(근무 상태, 직전 기록 전체 가져오기) — improve-1026-spec 1·3·7절.
// 오늘 머리는 포커스와 무관하게 늘 채운 파랑, 포커스 열은 위쪽 굵은 선으로 따로 보인다.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { DAY_MARK_KINDS, type DayMarkKind } from "../../domain/dayMark";
import { DAY_LABELS, type DateStr } from "../../domain/week";
import { STR } from "../../shared/strings";
import { previousDayFor, pullLabel, pullPreviousDay, setDayMark, setFocusDay, useBoard } from "./boardStore";
import styles from "./Board.module.css";

interface Props {
  day: DateStr;
  index: number;
  narrow: boolean;
}

export function DayHeader({ day, index, narrow }: Props) {
  const focusDay = useBoard((s) => s.focusDay);
  const today = useBoard((s) => s.today);
  const mark = useBoard((s) => s.dayMarks[day]) ?? null;
  const [menuOpen, setMenuOpen] = useState(false);
  /** 메뉴를 열 때 찾은 직전 기록일 — undefined = 찾는 중 */
  const [prevDay, setPrevDay] = useState<DateStr | null | undefined>(undefined);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const isFocus = day === focusDay;
  const isToday = day === today;
  const [, m, d] = day.split("-");
  const dayName = `${DAY_LABELS[index]} ${Number(m)}/${Number(d)}`;

  useEffect(() => {
    if (!menuOpen) return;
    let alive = true;
    void previousDayFor(day)
      .then((p) => alive && setPrevDay(p))
      .catch(() => alive && setPrevDay(null));
    const close = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenuOpen(false);
      buttonRef.current?.focus();
    };
    // 화면 기준(fixed)으로 떠 있으므로 보드가 스크롤되거나 창 크기가 바뀌면 닫는다
    const dismiss = (e: Event) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      alive = false;
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [menuOpen, day]);

  // 메뉴 자리: 버튼 아래(오른쪽 끝 맞춤), 창 밖으로 나가면 안쪽으로. 열리면 지금 상태 항목에 포커스
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const button = buttonRef.current;
    if (!menuOpen || !menu || !button) return;
    const r = button.getBoundingClientRect();
    menu.style.top = `${r.bottom + 2}px`;
    menu.style.left = `${Math.max(8, Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }, [menuOpen]);

  const choose = (kind: DayMarkKind | null) => {
    setMenuOpen(false);
    buttonRef.current?.focus();
    void setDayMark(day, kind);
  };

  /** 메뉴 안 ↑/↓로 항목 사이 이동 */
  const onMenuKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
  };

  return (
    <div
      ref={wrapRef}
      className={[
        styles.colHeader,
        styles.dayHeader,
        isFocus ? styles.colFocus : "",
        mark === "leave" ? styles.colLeave : "",
        isToday ? styles.colToday : "",
        narrow ? styles.colNarrow : "",
        menuOpen ? styles.menuOpen : "",
      ].join(" ")}
      data-testid={`day-${day}`}
      data-mark={mark ?? undefined}
    >
      <button type="button" className={styles.dayLabel} onClick={() => setFocusDay(day)}>
        {narrow ? (
          <>
            <span>{DAY_LABELS[index]}</span>
            <span className={styles.colNarrowDate}>{Number(d)}</span>
          </>
        ) : (
          <>
            <span className={styles.dayName}>{dayName}</span>
            {isToday && <span className={styles.todayBadge}>{STR.board.todaySuffix}</span>}
            {mark && (
              <span
                className={`${styles.markBadge} ${mark === "leave" ? styles.markLeave : ""}`}
                data-testid="day-mark"
              >
                {STR.dayMenu.badge[mark]}
              </span>
            )}
          </>
        )}
      </button>
      {!narrow && (
        <button
          ref={buttonRef}
          type="button"
          className={styles.dayMenuButton}
          aria-label={STR.dayMenu.open(dayName)}
          title={STR.dayMenu.open(dayName)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          data-testid={`day-menu-${day}`}
          onClick={() => {
            setPrevDay(undefined);
            setMenuOpen((o) => !o);
          }}
        >
          ⋯
        </button>
      )}
      {menuOpen && (
        <div ref={menuRef} className={styles.menu} role="menu" aria-label={dayName} onKeyDown={onMenuKey}>
          <div className={styles.menuLabel}>{STR.dayMenu.status}</div>
          {([null, ...DAY_MARK_KINDS] as const).map((k) => (
            <button
              key={k ?? "work"}
              type="button"
              role="menuitemradio"
              aria-checked={mark === k}
              className={styles.menuRadio}
              onClick={() => choose(k)}
            >
              <span className={`${styles.radio} ${mark === k ? styles.radioOn : ""}`} aria-hidden="true" />
              {STR.dayMenu.kinds[k ?? "work"]}
            </button>
          ))}
          <div className={styles.menuSep} role="separator" />
          <button
            type="button"
            role="menuitem"
            disabled={!prevDay}
            onClick={() => {
              setMenuOpen(false);
              void pullPreviousDay(day);
            }}
          >
            {prevDay === undefined
              ? STR.dayMenu.pullAllLoading
              : prevDay
                ? STR.dayMenu.pullAll(pullLabel(prevDay))
                : STR.dayMenu.pullAllNone}
            {prevDay && <span className={styles.menuKey}>{STR.dayMenu.pullAllKey}</span>}
          </button>
          {!isFocus && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setFocusDay(day);
              }}
            >
              {STR.dayMenu.widen}
              <span className={styles.menuKey}>{STR.dayMenu.widenKey}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
