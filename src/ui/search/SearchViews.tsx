import { openCabi } from "../cabinet/cabiService";
import { CABI } from "../../shared/cabiStrings";
// 검색 화면(features-1102-spec F1): 상단 검색 칸 · 오른쪽 결과 패널 · 보드 위 "결과 기준 보기" 띠 · 보드·메모 강조.
import { Fragment, useEffect, useRef } from "react";
import { openCabinet } from "../cabinet/cabinetStore";
import { highlightRanges, searchTerms, type SearchHit } from "../../domain/search";
import { dayIndex, DAY_LABELS, weekRange } from "../../domain/week";
import { STR } from "../../shared/strings";
import { useBoard } from "../board/boardStore";
import { PanelResizer } from "../common/PanelResizer";
import { usePanelWidths } from "../common/panelWidths";
import { useNote } from "../note/noteStore";
import { openCard } from "../universe/universeStore";
import styles from "./Search.module.css";
import {
  closePanel,
  goToHit,
  openSearch,
  resetSearch,
  runSearch,
  setFilter,
  setQuery,
  setRange,
  stepHit,
  useSearch,
  visibleHits,
  type SearchFilter,
  type SearchRange,
} from "./searchStore";

const T = STR.search;

/** 상단 2줄 검색 칸 */
export function SearchBox() {
  const query = useSearch((s) => s.query);
  const focusSeq = useSearch((s) => s.focusSeq);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusSeq) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [focusSeq]);
  return (
    <label className={styles.box}>
      <span aria-hidden="true">🔍</span>
      <input
        ref={ref}
        type="search"
        value={query}
        placeholder={T.placeholder}
        aria-label={T.boxAria}
        data-testid="search-input"
        onChange={(e) => setQuery(e.currentTarget.value)}
        onFocus={() => useSearch.setState({ panelOpen: true })}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") {
            e.preventDefault();
            const s = useSearch.getState();
            if (s.ran !== s.query.trim()) void runSearch();
            else stepHit(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            closePanel();
            e.currentTarget.blur();
          }
        }}
      />
      <span className={styles.boxKey}>{T.key}</span>
    </label>
  );
}

function Marked({ text, terms }: { text: string; terms: string[] }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  highlightRanges(text, terms).forEach(([a, b], i) => {
    if (a > at) parts.push(<Fragment key={`t${i}`}>{text.slice(at, a)}</Fragment>);
    parts.push(<mark key={`m${i}`}>{text.slice(a, b)}</mark>);
    at = b;
  });
  if (at < text.length) parts.push(<Fragment key="end">{text.slice(at)}</Fragment>);
  return <>{parts}</>;
}

const dayLabel = (d: string) =>
  `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}(${DAY_LABELS[dayIndex(d)]})`;
const weekHead = (w: string) => {
  const { start, end } = weekRange(w);
  return `${w} (${Number(start.slice(5, 7))}/${Number(start.slice(8, 10))}~${Number(end.slice(5, 7))}/${Number(end.slice(8, 10))})`;
};

/** 오른쪽 결과 패널 */
export function SearchPanel({ overlay }: { overlay: boolean }) {
  const s = useSearch();
  const panelW = usePanelWidths((st) => st.summary);
  const terms = searchTerms(s.ran);
  const list = visibleHits(s);
  const counts = {
    all: s.hits.length,
    item: s.hits.filter((h) => h.area === "item").length,
    memo: s.hits.filter((h) => h.area === "memo").length,
  };
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-hit-index="${s.index}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [s.index]);

  return (
    <aside
      className={`${styles.panel} ${overlay ? styles.overlay : ""}`}
      style={{ width: panelW }}
      aria-label={T.panel}
      data-testid="search-panel"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          closePanel();
        }
      }}
    >
      <PanelResizer panel="summary" />
      <header className={styles.head}>
        <h2 className={styles.title}>{T.panel}</h2>
        {s.ran && <span className={styles.muted}>{T.count(s.ran, s.hits.length)}</span>}
        {s.busy && <span className={styles.muted}>{T.busy}</span>}
        <span className={styles.grow} />
        <button
          type="button"
          className={styles.iconBtn}
          aria-label={T.close}
          title={T.close}
          onClick={closePanel}
        >
          ✕
        </button>
      </header>
      <div className={styles.filters}>
        {(["all", "item", "memo"] as SearchFilter[]).map((f) => (
          <button
            key={f}
            type="button"
            className={`${styles.chip} ${s.filter === f ? styles.chipOn : ""}`}
            aria-pressed={s.filter === f}
            onClick={() => setFilter(f)}
          >
            {T.filters[f]} {counts[f]}
          </button>
        ))}
        <span className={styles.grow} />
        <select
          className={styles.range}
          aria-label={T.rangeAria}
          value={s.range}
          onChange={(e) => setRange(e.currentTarget.value as SearchRange)}
        >
          {(["all", "year", "12w"] as SearchRange[]).map((r) => (
            <option key={r} value={r}>
              {T.ranges[r]}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.list} ref={listRef} data-testid="search-results">
        {!terms.length && <p className={styles.note}>{T.hint}</p>}
        {terms.length > 0 &&
          !s.busy &&
          list.length === 0 &&
          !s.cabinet.length &&
          !s.cards.length &&
          !s.cabiNotes.length &&
          !s.cabiBoards.length && <p className={styles.note}>{T.empty}</p>}
        {s.filter === "all" && s.cards.length > 0 && (
          <>
            <div className={styles.week}>{STR.universe.kindName.card}</div>
            {s.cards.map((c) => (
              <button
                key={c.id}
                type="button"
                className={styles.hit}
                data-testid="search-card-hit"
                onClick={() => void openCard(c.id)}
              >
                <span className={styles.meta}>
                  <span className={`${styles.kind} ${styles.k_link}`}>
                    ◆ {STR.universe.card.typeName[c.type]} · {STR.universe.card.statusName[c.status]}
                  </span>
                  <span className={styles.where}>{c.title}</span>
                </span>
                <span className={styles.text}>
                  <Marked text={c.text || c.title} terms={terms} />
                </span>
              </button>
            ))}
          </>
        )}
        {s.filter === "all" &&
          [
            ...s.cabiNotes.map((n) => ({ id: n.id, title: n.title, text: n.excerpt, kind: "note" as const })),
            ...s.cabiBoards.map((b) => ({
              id: b.categoryId,
              title: b.title,
              text: CABI.boardOwner,
              kind: "board" as const,
            })),
          ].map((hit) => (
            <button
              key={hit.kind + hit.id}
              type="button"
              className={styles.hit}
              data-testid="search-cabi-hit"
              onClick={() => void openCabi(hit.kind, hit.id)}
            >
              <span className={styles.meta}>
                <span className={styles.kind}>
                  {CABI.name} · {hit.kind === "note" ? CABI.note : CABI.board}
                </span>
                <span className={styles.where}>{hit.title}</span>
              </span>
              <span className={styles.text}>
                <Marked text={hit.text} terms={terms} />
              </span>
            </button>
          ))}
        {s.filter === "all" && s.cabinet.length > 0 && (
          <>
            <div className={styles.week}>{CABI.name}</div>
            {s.cabinet.map((c) => (
              <button
                key={c.id}
                type="button"
                className={styles.hit}
                data-testid="search-cabinet-hit"
                onClick={() => void openCabinet({ itemId: c.id })}
              >
                <span className={styles.meta}>
                  <span className={`${styles.kind} ${styles.k_link}`}>{STR.cabinet.search[c.kind]}</span>
                  <span className={styles.where}>{c.title}</span>
                </span>
                <span className={styles.text}>
                  <Marked text={c.text} terms={terms} />
                </span>
              </button>
            ))}
          </>
        )}
        {list.map((h, i) => {
          const head = i === 0 || list[i - 1]!.weekId !== h.weekId ? weekHead(h.weekId) : null;
          return (
            <Fragment key={h.key}>
              {head && <div className={styles.week}>{head}</div>}
              <button
                type="button"
                className={`${styles.hit} ${i === s.index ? styles.hitOn : ""}`}
                data-hit-index={i}
                data-hit-kind={h.kind}
                onClick={() => void goToHit(i)}
              >
                <span className={styles.meta}>
                  <span className={`${styles.kind} ${styles[`k_${h.kind}`]}`}>{T.kinds[h.kind]}</span>
                  <span className={styles.where}>{where(h)}</span>
                </span>
                <span className={styles.text}>
                  <Marked text={h.text} terms={terms} />
                </span>
              </button>
            </Fragment>
          );
        })}
        {s.truncated && <p className={styles.note}>{T.truncated(s.hits.length)}</p>}
      </div>
      <footer className={styles.help}>{T.help}</footer>
    </aside>
  );
}

function where(h: SearchHit): string {
  if (h.area === "item")
    return `${h.categoryName ?? ""} · ${dayLabel(h.date!)}${h.dueDate ? ` · ${STR.dueDate.searchTag(h.dueDate.slice(5).replace("-", "/"))}` : ""}`;
  return T.memoWhere;
}

/** 보드 위 띠 — 결과 기준 보기(초기화 전까지). 패널이 보드 위에 겹쳐 뜨면 그만큼 오른쪽을 비운다 */
export function SearchBand({ rightInset = 0 }: { rightInset?: number }) {
  const active = useSearch((s) => s.active);
  const ran = useSearch((s) => s.ran);
  const hits = useSearch((s) => s.hits);
  const filter = useSearch((s) => s.filter);
  const index = useSearch((s) => s.index);
  const panelOpen = useSearch((s) => s.panelOpen);
  useBoardHighlight();
  if (!active) return null;
  const n = visibleHits({ hits, filter }).length;
  const items = hits.filter((h) => h.area === "item").length;
  return (
    <div
      className={styles.band}
      style={rightInset ? { paddingRight: rightInset + 16 } : undefined}
      role="status"
      data-testid="search-band"
    >
      <span aria-hidden="true">🔍</span>
      <b className={styles.bandQ}>{T.band(ran)}</b>
      <span className={styles.muted}>· {T.bandCounts(items, hits.length - items)}</span>
      <span className={styles.grow} />
      {!panelOpen && (
        <button type="button" className={styles.bandBtn} onClick={openSearch}>
          {T.openPanel}
        </button>
      )}
      <button
        type="button"
        className={styles.bandBtn}
        aria-label={T.prev}
        title={T.prev}
        disabled={!n}
        onClick={() => stepHit(-1)}
      >
        ▲
      </button>
      <span className={styles.pos} data-testid="search-position">
        {T.position(index < 0 ? 0 : index + 1, n)}
      </span>
      <button
        type="button"
        className={styles.bandBtn}
        aria-label={T.next}
        title={T.next}
        disabled={!n}
        onClick={() => stepHit(1)}
      >
        ▼
      </button>
      <button
        type="button"
        className={`${styles.bandBtn} ${styles.reset}`}
        onClick={resetSearch}
        data-testid="search-reset"
      >
        ✕ {T.reset}
      </button>
    </div>
  );
}

/**
 * 보드·메모 강조: 지금 보는 주의 결과 항목/상자에 data-search-hit, 지금 결과에 data-search-current.
 * React가 다루지 않는 속성이라 다시 그려도 남고, 칸이 새로 생기면 관찰자가 다시 붙인다.
 */
function useBoardHighlight() {
  const active = useSearch((s) => s.active);
  const hits = useSearch((s) => s.hits);
  const filter = useSearch((s) => s.filter);
  const index = useSearch((s) => s.index);
  const weekId = useBoard((s) => s.weekId);
  const noteWeek = useNote((s) => s.weekId);
  useEffect(() => {
    const clear = () => {
      document.querySelectorAll("[data-search-hit]").forEach((el) => el.removeAttribute("data-search-hit"));
      document
        .querySelectorAll("[data-search-current]")
        .forEach((el) => el.removeAttribute("data-search-current"));
    };
    if (!active) {
      clear();
      return;
    }
    const list = visibleHits({ hits, filter });
    const cur = list[index];
    const mine = list.filter((h) => h.weekId === weekId);
    const sel = (h: SearchHit) =>
      h.itemId ? `[data-item-id="${CSS.escape(h.itemId)}"]` : `[data-box-id="${CSS.escape(h.boxId ?? "")}"]`;
    let raf = 0;
    const apply = () => {
      raf = 0;
      clear();
      for (const h of mine)
        document.querySelectorAll(sel(h)).forEach((el) => el.setAttribute("data-search-hit", ""));
      if (cur && cur.weekId === weekId)
        document.querySelectorAll(sel(cur)).forEach((el) => el.setAttribute("data-search-current", ""));
    };
    apply();
    const obs = new MutationObserver(() => {
      if (!raf) raf = requestAnimationFrame(apply);
    });
    obs.observe(document.body, { childList: true, subtree: true });
    return () => {
      obs.disconnect();
      if (raf) cancelAnimationFrame(raf);
      clear();
    };
  }, [active, hits, filter, index, weekId, noteWeek]);
}
