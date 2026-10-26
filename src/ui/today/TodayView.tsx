// 오늘 뷰(improve-1026-spec 8절): 왼쪽 = 그 날이 든 주의 메모 보드(폭 조절·기억), 오른쪽 = 그 날의 업무 카드.
// 카드 안 기록은 보드 칸과 같은 편집기(개조식 규칙·단축키·자동 저장 그대로), 카드 아래 = 직전 기록 한 줄 + [가져오기].
// 창이 좁으면(1100px 미만) 메모는 위쪽 접힌 띠가 된다.
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { cellKey } from "../../data/repository";
import { TODAY_SPLIT_MAX, TODAY_SPLIT_MIN, DEFAULT_SETTINGS } from "../../data/settings";
import { DAY_MARK_KINDS, type DayMarkKind } from "../../domain/dayMark";
import { chipsToShow } from "../../domain/tags";
import { dayIndex, DAY_LABELS } from "../../domain/week";
import { STR } from "../../shared/strings";
import {
  enterCell,
  pullLabel,
  pullPrevious,
  pullPreviousDay,
  setDayMark,
  shownCategories,
  useBoard,
} from "../board/boardStore";
import { CellEditor, type CellNav } from "../board/CellEditor";
import { TagFilterBanner } from "../board/TagFilterBanner";
import { useAppStore } from "../common/appStore";
import { useMediaQuery } from "../common/useMediaQuery";
import { NoteDock } from "../note/NoteDock";
import { focusNote } from "../note/noteStore";
import styles from "./Today.module.css";

export function TodayView() {
  const view = useBoard((s) => s.view);
  const day = useBoard((s) => s.focusDay);
  const today = useBoard((s) => s.today);
  const categoryTags = useBoard((s) => s.categoryTags);
  const tagFilter = useBoard((s) => s.tagFilter);
  const tags = useBoard((s) => s.tags);
  const prevDates = useBoard((s) => s.prevDates);
  const prevItems = useBoard((s) => s.prevItems);
  const narrow = useMediaQuery("(max-width: 1099px)");
  const [memoOpen, setMemoOpen] = useState(false);
  const [split, setSplit] = useState(DEFAULT_SETTINGS.ui.todaySplit);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 기억해 둔 메모 폭
  useEffect(() => {
    const j = useAppStore.getState().journal;
    if (j.state !== "ready") return;
    let alive = true;
    void j.repo.getSettings().then((s) => alive && setSplit(s.ui.todaySplit));
    return () => {
      alive = false;
    };
  }, []);

  if (!view || !day) return null;
  const cats = shownCategories({ view, categoryTags, tagFilter });
  // 전체 가져오기가 고를 날 = 보이는 진행 중 업무의 직전 기록일 중 가장 늦은 날(pullPreviousDay와 같은 규칙)
  const pullAllDate = cats
    .filter((c) => c.state === "active")
    .map((c) => prevDates[c.category.id])
    .filter((d): d is string => Boolean(d))
    .sort()
    .at(-1);

  const navFor = (row: number): CellNav => ({
    up() {
      if (row <= 0) return false;
      enterCell(cellKey(day, cats[row - 1]!.category.id), "below");
      return true;
    },
    down() {
      if (row < cats.length - 1) enterCell(cellKey(day, cats[row + 1]!.category.id), "above");
      else {
        // 마지막 카드 아래 = 왼쪽 메모(spec 8-2)
        if (narrow) setMemoOpen(true);
        focusNote();
      }
      return true;
    },
  });

  /** 경계선 끌기 = 메모 폭(창 폭 비율), 놓으면 기억. 두 번 누르면 기본 폭 */
  const startSplit = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const box = wrapRef.current!.getBoundingClientRect();
    let last = split;
    const move = (ev: globalThis.PointerEvent) => {
      last = Math.min(TODAY_SPLIT_MAX, Math.max(TODAY_SPLIT_MIN, (ev.clientX - box.left) / box.width));
      setSplit(last);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      saveSplit(last);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  const saveSplit = (v: number) => {
    const j = useAppStore.getState().journal;
    if (j.state === "ready") void j.repo.updateSettings({ ui: { todaySplit: v } }).catch(() => undefined);
  };

  const [, m, d] = day.split("-");
  const dateLabel = `${Number(m)}/${Number(d)}(${DAY_LABELS[dayIndex(day)]})`;

  return (
    <div ref={wrapRef} className={`${styles.today} ${narrow ? styles.narrow : ""}`} data-testid="today-view">
      {narrow ? (
        <div className={`${styles.memoBand} ${memoOpen ? styles.memoBandOpen : ""}`}>
          <button
            type="button"
            className={styles.bandToggle}
            aria-expanded={memoOpen}
            onClick={() => setMemoOpen((o) => !o)}
          >
            {memoOpen ? STR.today.memoClose : STR.today.memoOpen} {memoOpen ? "▴" : "▾"}
          </button>
          {memoOpen && <NoteDock variant="side" />}
        </div>
      ) : (
        <>
          <div className={styles.memo} style={{ width: `${split * 100}%` }}>
            <NoteDock variant="side" />
          </div>
          <button
            type="button"
            className={styles.splitter}
            aria-label={STR.today.resizeSplit}
            title={STR.today.resizeSplit}
            tabIndex={-1}
            onPointerDown={startSplit}
            onDoubleClick={() => {
              setSplit(DEFAULT_SETTINGS.ui.todaySplit);
              saveSplit(DEFAULT_SETTINGS.ui.todaySplit);
            }}
          />
        </>
      )}

      <div className={styles.right}>
        <div className={styles.head}>
          <h2 className={styles.date} data-testid="today-date">
            {dateLabel}
          </h2>
          {day === today && <span className={styles.todayBadge}>{STR.board.todaySuffix}</span>}
          <DayMarkPicker day={day} />
          <span className={styles.spacer} />
          {pullAllDate && (
            <button
              type="button"
              className={styles.textButton}
              title={STR.today.pullAllTitle}
              data-testid="today-pull-all"
              onClick={() => void pullPreviousDay(day)}
            >
              {STR.today.pullAll(pullLabel(pullAllDate))}
            </button>
          )}
        </div>
        <TagFilterBanner />
        <div className={styles.cards} data-drag-scroll>
          {cats.length === 0 && <p className={styles.empty}>{STR.today.empty}</p>}
          {cats.map((vc, row) => {
            const id = vc.category.id;
            const key = cellKey(day, id);
            const myTags = tags.filter((t) => categoryTags[id]?.includes(t.id));
            const chips = chipsToShow(myTags);
            const prev = prevItems[id];
            const prevDate = prevDates[id];
            return (
              <section
                key={id}
                className={`${styles.card} ${vc.state !== "active" ? styles.cardEnded : ""}`}
                style={{ borderLeftColor: `var(--cat-${vc.category.color})` }}
                data-testid={`today-card-${vc.category.name}`}
              >
                <header className={styles.cardHead}>
                  <span className={styles.cardName}>{vc.category.name}</span>
                  {chips.shown.map((t) => (
                    <span key={t.id} className={styles.chip}>
                      #{t.name}
                    </span>
                  ))}
                  {chips.more > 0 && <span className={styles.chip}>{STR.tags.more(chips.more)}</span>}
                  {vc.state !== "active" && <span className={styles.chip}>{STR.board.ended}</span>}
                </header>
                <div
                  className={styles.cardBody}
                  data-testid={`cell-${vc.category.name}-${day}`}
                  data-cell-key={key}
                >
                  <CellEditor
                    cellKey={key}
                    ariaLabel={STR.board.itemAria(vc.category.name, `${DAY_LABELS[dayIndex(day)]} ${day}`)}
                    showPlaceholder
                    nav={navFor(row)}
                    pullButton={false}
                  />
                </div>
                {prev && prevDate && (
                  <div className={styles.prev} data-testid="today-prev">
                    <span className={styles.prevText}>
                      <b>{STR.today.prevLine(pullLabel(prevDate))}</b>{" "}
                      {prev
                        .filter((i) => i.depth === 0)
                        .slice(0, 2)
                        .map((i) => i.text.split("\n")[0])
                        .join(" · ")}
                      {prev.filter((i) => i.depth === 0).length > 2 &&
                        ` ${STR.today.more(prev.filter((i) => i.depth === 0).length - 2)}`}
                    </span>
                    <button
                      type="button"
                      className={styles.pull}
                      title={STR.today.pullTitle}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => void pullPrevious(key)}
                    >
                      {STR.today.pull}
                    </button>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** [근무 ▾] — 이 날 근무 상태(연차·반차, spec 1-1) */
function DayMarkPicker({ day }: { day: string }) {
  const mark = useBoard((s) => s.dayMarks[day]) ?? null;
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const label = mark ? STR.dayMenu.badge[mark] : STR.dayMenu.kinds.work;

  useEffect(() => {
    if (!open) return;
    wrapRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const outside = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);

  const choose = (k: DayMarkKind | null) => {
    setOpen(false);
    void setDayMark(day, k);
  };

  return (
    <div className={styles.pickerWrap} ref={wrapRef}>
      <button
        type="button"
        className={`${styles.textButton} ${mark ? styles.marked : ""}`}
        title={STR.today.statusTitle}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="today-mark"
        onClick={() => setOpen((o) => !o)}
      >
        {label} ▾
      </button>
      {open && (
        <div
          className={styles.picker}
          role="menu"
          aria-label={STR.today.statusTitle}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }
          }}
        >
          {([null, ...DAY_MARK_KINDS] as const).map((k) => (
            <button
              key={k ?? "work"}
              type="button"
              role="menuitemradio"
              aria-checked={mark === k}
              onClick={() => choose(k)}
            >
              <span className={`${styles.radio} ${mark === k ? styles.radioOn : ""}`} aria-hidden="true" />
              {STR.dayMenu.kinds[k ?? "work"]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
