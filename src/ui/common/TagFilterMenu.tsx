// 상단 [태그: 전체 ▾] — 보드 태그 필터(improve-1026-spec 6절): 고른 태그가 하나라도 있는 업무만(OR), "태그 없음"도 고를 수 있다.
// 체크 = 바로 적용·기억(설정 ui.tagFilter). 수 = 이번 주 보드의 업무 수.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { filterLabel, NO_TAG } from "../../domain/tags";
import { STR } from "../../shared/strings";
import { setTagFilter, useBoard } from "../board/boardStore";
import styles from "./TopBar.module.css";

export function TagFilterMenu() {
  const tags = useBoard((s) => s.tags);
  const filter = useBoard((s) => s.tagFilter);
  const categoryTags = useBoard((s) => s.categoryTags);
  const view = useBoard((s) => s.view);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);

  const weekCats = view?.categories.map((c) => c.category.id) ?? [];
  const count = (id: string) =>
    weekCats.filter((c) =>
      id === NO_TAG ? !(categoryTags[c] ?? []).length : (categoryTags[c] ?? []).includes(id),
    ).length;
  const toggle = (id: string) =>
    setTagFilter(filter.includes(id) ? filter.filter((x) => x !== id) : [...filter, id]);
  const label = filterLabel(filter, tags, STR.tags.noTag);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(listRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
  };

  const option = (id: string, name: string) => {
    const on = filter.includes(id);
    return (
      <button
        key={id}
        type="button"
        role="menuitemcheckbox"
        aria-checked={on}
        className={styles.filterOption}
        onClick={() => toggle(id)}
      >
        <span className={`${styles.check} ${on ? styles.checkOn : ""}`} aria-hidden="true" />
        <span className={styles.filterName}>{name}</span>
        <span className={styles.filterCount}>{count(id)}</span>
      </button>
    );
  };

  return (
    <div className={styles.filterWrap} ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`${styles.textButton} ${filter.length ? styles.filterActive : ""}`}
        title={STR.tags.filterTitle}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="tag-filter"
        onClick={() => setOpen((o) => !o)}
      >
        {label ? STR.tags.filterOn(label) : STR.tags.filterAll} ▾
      </button>
      {open && (
        <div
          ref={listRef}
          className={styles.filterMenu}
          role="menu"
          aria-label={STR.tags.filterTitle}
          onKeyDown={onKeyDown}
        >
          {tags.length === 0 ? (
            <p className={styles.filterHint}>{STR.tags.noTags}</p>
          ) : (
            <>
              {tags.map((t) => option(t.id, `#${t.name}`))}
              {option(NO_TAG, STR.tags.noTag)}
            </>
          )}
          <div className={styles.filterSep} role="separator" />
          <button
            type="button"
            role="menuitem"
            className={styles.filterOption}
            disabled={filter.length === 0}
            onClick={() => {
              setTagFilter([]);
              setOpen(false);
              buttonRef.current?.focus();
            }}
          >
            {STR.tags.clear}
          </button>
        </div>
      )}
    </div>
  );
}
