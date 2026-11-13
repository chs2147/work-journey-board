// 칸반 상단 도구(improve-v22-spec 5절·6-1절): 주간 보드처럼 상단 막대 한 줄에 — 업무 거르기 · 기간 아이콘 | [섹션 추가].
// "칸반 보드" 제목 글자는 두지 않는다(레일 강조로 위치가 보임, 2026-11-12 사용자 지시).
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { periodRange } from "../../domain/kanban";
import { shortDateLabel } from "../../domain/week";
import { STR } from "../../shared/strings";
import { useBoard } from "../board/boardStore";
import { IconPeriod, IconSectionAdd } from "../common/icons";
import { resetLayout, setFilter, setLayoutMode, useKanban } from "./kanbanStore";
import styles from "./Kanban.module.css";

const K = STR.kanban;
const PERIODS = ["today", "week", "2w", "4w", "12w", "all", "custom"] as const;

/** 기간 단추 툴팁: 이름 + 실제 날짜 범위(전체·지정일은 설명) */
function periodTip(p: (typeof PERIODS)[number], today: string): string {
  const name = K.periods[p];
  if (p === "all") return `${name} · ${K.periodAllHint}`;
  if (p === "custom") return `${name} · ${K.periodCustomHint}`;
  const r = periodRange({ period: p, from: null, to: null }, today);
  if (!r.from || !r.to) return name;
  return r.from === r.to
    ? `${name} · ${shortDateLabel(r.from)}`
    : `${name} · ${shortDateLabel(r.from)} ~ ${shortDateLabel(r.to)}`;
}

/** 왼쪽: 업무 거르기 · 기간 아이콘 · (지정일) 날짜 두 칸 */
export function KanbanFilters() {
  const filter = useKanban((s) => s.filter);
  const today = useBoard((b) => b.today);
  return (
    <div className={styles.toolbar} data-testid="kanban-toolbar">
      <CategoryFilter />
      {/* 기간 = 아이콘 세그먼트(시안 period-icons A안) — 이름·실제 날짜는 툴팁, 짧은 기간 | 긴 기간 | 전체·지정 사이 구분 */}
      <div
        className={`${styles.seg} ${styles.iconSeg}`}
        role="group"
        aria-label={K.periodAria}
        data-testid="kanban-period"
      >
        {PERIODS.map((p, i) => (
          <span key={p} className={styles.segItem}>
            {(i === 2 || i === 5) && <span className={styles.segGap} aria-hidden="true" />}
            <button
              type="button"
              aria-pressed={filter.period === p}
              aria-label={K.periods[p]}
              title={periodTip(p, today)}
              data-period={p}
              onClick={() =>
                setFilter(
                  p === "custom" && !filter.from ? { period: p, from: today, to: today } : { period: p },
                )
              }
            >
              <IconPeriod kind={p} />
            </button>
          </span>
        ))}
      </div>
      {filter.period === "custom" && (
        <span className={styles.inline}>
          <input
            type="date"
            className={styles.dateInput}
            aria-label={K.from}
            value={filter.from ?? ""}
            onChange={(e) => setFilter({ from: e.target.value || null })}
          />
          ~
          <input
            type="date"
            className={styles.dateInput}
            aria-label={K.to}
            value={filter.to ?? ""}
            onChange={(e) => setFilter({ to: e.target.value || null })}
          />
        </span>
      )}
    </div>
  );
}

/** 오른쪽 [⊞ 균등 / ▦ 자유] — [업무 추가] 앞(improve-v23-spec 5절) */
export function KanbanLayoutToggle({ segmentClass }: { segmentClass: string }) {
  const mode = useKanban((s) => s.layout.mode);
  return (
    <div className={segmentClass} role="group" aria-label={K.layoutGroup} data-testid="kanban-layout">
      <button
        type="button"
        aria-pressed={mode === "equal"}
        aria-label={K.layoutEqual}
        title={K.layoutEqual}
        data-testid="kanban-layout-equal"
        onClick={() => setLayoutMode("equal")}
      >
        <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <rect x="2.5" y="3.5" width="13" height="11" />
          <path d="M6.8 3.5v11M11.2 3.5v11" />
        </svg>
      </button>
      <button
        type="button"
        aria-pressed={mode === "free"}
        aria-label={K.layoutFree}
        title={K.layoutFree}
        data-testid="kanban-layout-free"
        onClick={() => setLayoutMode("free")}
      >
        <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <rect x="2.5" y="3" width="6" height="7" />
          <rect x="10.5" y="3" width="5" height="4.5" />
          <rect x="10.5" y="9.5" width="5" height="5.5" />
          <rect x="2.5" y="12" width="6" height="3" />
        </svg>
      </button>
    </div>
  );
}

/** 오른쪽 [업무 추가] 다음: (자유) [배치 초기화] · [섹션 추가] */
export function KanbanActions({ className }: { className: string }) {
  const mode = useKanban((s) => s.layout.mode);
  return (
    <>
      {mode === "free" && (
        <button
          type="button"
          className={className}
          data-testid="kanban-layout-reset"
          onClick={() => resetLayout()}
        >
          {K.layoutReset}
        </button>
      )}
      <button
        type="button"
        className={className}
        data-testid="kanban-add-section"
        onClick={() => useKanban.setState({ sectionDialog: { id: null } })}
      >
        <IconSectionAdd />
        {K.addSection}
      </button>
    </>
  );
}

/**
 * 업무 거르기(6-1절 K7): 전체 · 업무 1개 · 여러 업무. 단추 글자로 지금 범위를 보인다.
 * 데이터 = `ui.kanban.categories`(비면 전체) — 구조 변경 없음.
 */
function CategoryFilter() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const filter = useKanban((s) => s.filter);
  const categories = useKanban((s) => s.categories);
  const list = categories.filter((c) => filter.includeEnded || !c.ended);
  const picked = filter.categories.filter((id) => categories.some((c) => c.id === id));
  const all = picked.length === 0;
  const one = picked.length === 1 ? categories.find((c) => c.id === picked[0]) : undefined;
  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLElement>("[data-cat-row]")?.focus();
    const out = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", out);
    return () => document.removeEventListener("mousedown", out);
  }, [open]);
  const set = (ids: string[]) =>
    setFilter({ categories: ids.length >= list.length && list.length > 1 ? [] : ids });
  const toggle = (id: string) =>
    set(all ? [id] : picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const rows = [...(wrap.current?.querySelectorAll<HTMLElement>("[data-cat-row]") ?? [])];
    const i = rows.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
    } else if (e.key === "Enter" && i > 0) {
      e.preventDefault();
      const id = rows[i]!.dataset.catRow!;
      set([id]);
    }
  };
  const label = all ? K.categoryAll : one ? one.name : K.categoryMany(picked.length);
  const names = picked
    .map((id) => categories.find((c) => c.id === id)?.name)
    .filter(Boolean)
    .join(", ");
  return (
    <div className={styles.popWrap} ref={wrap}>
      <button
        type="button"
        className={`${styles.btn} ${all ? "" : styles.filtered}`}
        aria-haspopup="true"
        aria-expanded={open}
        title={all ? undefined : names}
        data-testid="kanban-cat-filter"
        onClick={() => setOpen((o) => !o)}
      >
        {one && <span className={styles.catDot} style={{ background: `var(--cat-${one.color})` }} />}
        {label} ▾
      </button>
      {open && (
        <div
          className={`${styles.menu} ${styles.catMenu}`}
          role="dialog"
          aria-label={K.categoryAll}
          data-testid="kanban-cat-menu"
          onKeyDown={onKey}
        >
          <button
            type="button"
            role="menuitemradio"
            aria-checked={all}
            data-cat-row="__all"
            data-testid="kanban-cat-all"
            onClick={() => set([])}
          >
            <span>
              <span className={`${styles.radio} ${all ? styles.radioOn : ""}`} aria-hidden="true" />{" "}
              {K.categoryAllRow}
            </span>
            <span className={styles.key}>{list.length}</span>
          </button>
          <hr />
          <div className={styles.menuHead}>{K.categoryHint}</div>
          {list.map((c) => {
            const on = !all && picked.includes(c.id);
            return (
              <div key={c.id} className={`${styles.catRow} ${on ? styles.catRowOn : ""}`}>
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={on}
                  data-cat-row={c.id}
                  data-testid="kanban-cat-row"
                  onClick={() => toggle(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === " ") {
                      e.preventDefault();
                      toggle(c.id);
                    }
                  }}
                >
                  <span className={`${styles.check} ${on ? styles.checkOn : ""}`} aria-hidden="true">
                    {on ? "✓" : ""}
                  </span>
                  <span className={styles.catDot} style={{ background: `var(--cat-${c.color})` }} />
                  {c.name}
                </button>
                <button
                  type="button"
                  className={styles.only}
                  tabIndex={-1}
                  data-testid="kanban-cat-only"
                  onClick={() => set([c.id])}
                >
                  {K.categoryOnly}
                </button>
              </div>
            );
          })}
          <hr />
          <label className={styles.checkRow} style={{ padding: "2px 10px" }}>
            <input
              type="checkbox"
              checked={filter.includeEnded}
              onChange={(e) => setFilter({ includeEnded: e.target.checked })}
            />
            {K.includeEnded}
          </label>
        </div>
      )}
    </div>
  );
}
