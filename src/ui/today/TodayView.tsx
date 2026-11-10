// 오늘 뷰(improve-1026-spec 8절): 왼쪽 = 그 날이 든 주의 메모 보드(폭 조절·기억), 오른쪽 = 그 날의 업무 카드.
// 카드 안 기록은 보드 칸과 같은 편집기(개조식 규칙·단축키·자동 저장 그대로), 카드 아래 = 직전 기록 한 줄 + [가져오기].
// 창이 좁으면(1100px 미만) 메모는 위쪽 접힌 띠가 된다.
import { IconFilterRecorded } from "../common/icons";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { CabinetCategoryBadge } from "../cabinet/CabinetCategoryBadge";
import { cellKey } from "../../data/repository";
import { TODAY_SPLIT_MAX, TODAY_SPLIT_MIN, DEFAULT_SETTINGS } from "../../data/settings";
import { markText } from "../../domain/dayMark";
import { DayMarkOptions } from "../board/DayMarkOptions";
import { chipsToShow } from "../../domain/tags";
import { dayIndex, DAY_LABELS } from "../../domain/week";
import { STR } from "../../shared/strings";
import {
  goDay,
  goToday,
  enterCell,
  pullLabel,
  pullPrevious,
  shownCategories,
  useBoard,
} from "../board/boardStore";
import { CellEditor, type CellNav } from "../board/CellEditor";
import { TagFilterBanner } from "../board/TagFilterBanner";
import { useAppStore } from "../common/appStore";
import { useMediaQuery } from "../common/useMediaQuery";
import { NoteDock } from "../note/NoteDock";
import { focusNote, useNote } from "../note/noteStore";
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
  const cells = useBoard((s) => s.cells);
  const narrow = useMediaQuery("(max-width: 1099px)");
  const [memoOpen, setMemoOpen] = useState(false);
  const [split, setSplit] = useState(DEFAULT_SETTINGS.ui.todaySplit);
  const [hideEmpty, setHideEmpty] = useState(DEFAULT_SETTINGS.ui.todayHideEmpty);
  // 숨김을 켠 채 기록하는 카드는 그 날을 떠나거나 토글할 때까지 남긴다(마지막 항목을 지워도 바로 사라지지 않게)
  const [kept, setKept] = useState<{ day: string | null; ids: string[] }>({ day: null, ids: [] });
  const wrapRef = useRef<HTMLDivElement>(null);
  // 메모 [크게 보기](improve-1101 #3): 주간 뷰처럼 메모가 데일리 뷰 전체를 덮는다(카드는 숨겨 둔 채 그대로)
  const noteExpanded = useNote((s) => s.expanded);

  // 기억해 둔 메모 폭
  useEffect(() => {
    const j = useAppStore.getState().journal;
    if (j.state !== "ready") return;
    let alive = true;
    void j.repo.getSettings().then((s) => {
      if (!alive) return;
      setSplit(s.ui.todaySplit);
      setHideEmpty(s.ui.todayHideEmpty);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!view || !day) return null;
  const allCats = shownCategories({ view, categoryTags, tagFilter });
  const keptIds = kept.day === day ? kept.ids : [];
  const hasRecord = (id: string) => (cells[cellKey(day, id)] ?? []).some((i) => i.text.trim() !== "");
  const cats = hideEmpty
    ? allCats.filter((c) => hasRecord(c.category.id) || keptIds.includes(c.category.id))
    : allCats;
  const hiddenCount = allCats.length - cats.length;
  if (hideEmpty) {
    const add = cats.filter((c) => !keptIds.includes(c.category.id)).map((c) => c.category.id);
    if (add.length) setKept({ day, ids: [...keptIds, ...add] });
  }
  const toggleHideEmpty = (on: boolean) => {
    setHideEmpty(on);
    setKept({ day: null, ids: [] });
    const j = useAppStore.getState().journal;
    if (j.state === "ready")
      void j.repo.updateSettings({ ui: { todayHideEmpty: on } }).catch(() => undefined);
  };

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
      {narrow && !noteExpanded ? (
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
          {/* 크게 보기여도 같은 요소를 그대로 두고 폭만 바꾼다 — 메모를 다시 그리지 않아 포커스·Esc가 이어진다 */}
          <div
            className={noteExpanded ? styles.memoFull : styles.memo}
            style={noteExpanded ? undefined : { width: `${split * 100}%` }}
          >
            <NoteDock variant="side" />
          </div>
          {!noteExpanded && (
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
          )}
        </>
      )}

      <div className={noteExpanded ? styles.hidden : styles.right}>
        <div className={styles.head}>
          {/* 날짜 이동(improve-1101 #4 → 2026-11-01 다듬기): 지금 날짜 하나만 ‹ 날짜 › [오늘] 한 줄 */}
          <div className={styles.dayNav} role="group" aria-label={STR.today.stripAria} data-testid="day-nav">
            <button
              type="button"
              className={styles.navArrow}
              title={STR.today.prevDay}
              aria-label={STR.today.prevDay}
              onClick={() => void goDay(-1)}
            >
              ‹
            </button>
            <h2 className={styles.date} data-testid="today-date">
              {dateLabel}
            </h2>
            <button
              type="button"
              className={styles.navArrow}
              title={STR.today.nextDay}
              aria-label={STR.today.nextDay}
              onClick={() => void goDay(1)}
            >
              ›
            </button>
          </div>
          {day === today ? (
            <span className={styles.todayBadge}>{STR.board.todaySuffix}</span>
          ) : (
            <button type="button" className={styles.textButton} onClick={() => void goToday()}>
              {STR.topBar.today}
            </button>
          )}
          <DayMarkPicker day={day} />
          <span className={styles.spacer} />
          <button
            type="button"
            className={`${styles.textButton} ${styles.toggle}`}
            aria-pressed={hideEmpty}
            aria-label={STR.today.hideEmpty}
            title={hideEmpty ? STR.today.hideEmptyTitleOn : STR.today.hideEmptyTitleOff}
            data-testid="today-hide-empty"
            onClick={() => toggleHideEmpty(!hideEmpty)}
          >
            <IconFilterRecorded />
            <span className={styles.toggleTrack} aria-hidden="true" />
          </button>
        </div>
        <TagFilterBanner />
        <div className={styles.cards} data-drag-scroll>
          {allCats.length === 0 && <p className={styles.empty}>{STR.today.empty}</p>}
          {allCats.length > 0 && cats.length === 0 && (
            <p className={styles.empty} data-testid="today-none-recorded">
              {STR.today.noneRecorded}{" "}
              <button type="button" className={styles.textButton} onClick={() => toggleHideEmpty(false)}>
                {STR.today.showAll}
              </button>
            </p>
          )}
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
                data-category-id={vc.category.id}
              >
                <header className={styles.cardHead}>
                  <span className={styles.cardName}>{vc.category.name}</span>
                  <CabinetCategoryBadge categoryId={vc.category.id} name={vc.category.name} />
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
                      {prev.length === 0 && STR.itemCompletion.emptyPrevious}
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
                      disabled={prev.length === 0}
                      title={prev.length === 0 ? STR.itemCompletion.emptyPrevious : STR.today.pullTitle}
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
          {hideEmpty && hiddenCount > 0 && cats.length > 0 && (
            <div className={styles.hiddenBar} data-testid="today-hidden-bar">
              <span>{STR.today.hiddenBar(hiddenCount)}</span>
              <button type="button" className={styles.textButton} onClick={() => toggleHideEmpty(false)}>
                {STR.today.showAll}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** [근무 ▾] — 이 날 근무 상태(연차·반차·공휴일·기타 휴가, spec 1-1·features-1102-spec F2) */
function DayMarkPicker({ day }: { day: string }) {
  const mark = useBoard((s) => s.dayMarks[day]) ?? null;
  const info = useBoard((s) => s.dayMarkInfo[day]) ?? null;
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const label = mark ? markText(mark, info?.label) : STR.dayMenu.kinds.work;

  useEffect(() => {
    if (!open) return;
    wrapRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const outside = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);

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
          <DayMarkOptions day={day} onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
