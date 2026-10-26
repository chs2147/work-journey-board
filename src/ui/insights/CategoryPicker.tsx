// 업무 고르기(m3-s2-spec 2절): 두 탭 공통 — 상단 태그 필터 다음 단계. 기본 = 전체, 앱 실행 중만 유지.
// 종료된 업무 묶음은 [종료 업무 포함]일 때만 고를 수 있다.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Category } from "../../domain/types";
import { STR } from "../../shared/strings";
import { isPicked, pickAll, pickNone, togglePicked } from "./insightsStore";
import styles from "./Insights.module.css";

interface Props {
  /** 태그 필터를 지난 진행 중 업무(보드 순서) */
  ongoing: Category[];
  /** 태그 필터를 지난 종료 업무 */
  ended: Category[];
  includeEnded: boolean;
  picked: string[] | null;
}

export function CategoryPicker({ ongoing, ended, includeEnded, picked }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const all = [...ongoing, ...(includeEnded ? ended : [])].map((c) => c.id);
  const n = all.filter((id) => isPicked(picked, id)).length;

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const outside = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);

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

  const option = (c: Category, isEnded: boolean) => {
    const on = includeEnded || !isEnded ? isPicked(picked, c.id) : false;
    return (
      <button
        key={c.id}
        type="button"
        role="menuitemcheckbox"
        aria-checked={on}
        disabled={isEnded && !includeEnded}
        className={styles.pickOption}
        data-testid="pick-option"
        onClick={() => togglePicked(c.id, all)}
      >
        <span className={`${styles.pickCheck} ${on ? styles.pickCheckOn : ""}`} aria-hidden="true" />
        <span
          className={`${styles.dot} ${isEnded ? styles.dotEnded : ""}`}
          style={isEnded ? undefined : { background: `var(--cat-${c.color})` }}
        />
        <span className={styles.pickName}>{c.name}</span>
      </button>
    );
  };

  return (
    <div className={styles.pickWrap} ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`${styles.btn} ${picked !== null ? styles.pickActive : ""}`}
        title={STR.insights.pickTitle}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="insight-pick"
        onClick={() => setOpen((o) => !o)}
      >
        {picked === null ? STR.insights.pickAll(all.length) : STR.insights.pickSome(n)} ▾
      </button>
      {open && (
        <div
          ref={listRef}
          className={styles.pickMenu}
          role="menu"
          aria-label={STR.insights.pickTitle}
          onKeyDown={onKeyDown}
        >
          <div className={styles.pickTools}>
            <button
              type="button"
              role="menuitem"
              className={styles.linkBtn}
              data-testid="pick-all"
              onClick={pickAll}
            >
              {STR.insights.pickSelectAll}
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.linkBtn}
              data-testid="pick-none"
              onClick={pickNone}
            >
              {STR.insights.pickClear}
            </button>
          </div>
          {ongoing.map((c) => option(c, false))}
          {ended.length > 0 && (
            <>
              <div className={styles.group}>{STR.insights.endedGroup}</div>
              {!includeEnded && <p className={styles.pickHint}>{STR.insights.pickEndedOff}</p>}
              {ended.map((c) => option(c, true))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
