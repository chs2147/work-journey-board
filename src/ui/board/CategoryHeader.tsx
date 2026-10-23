// 업무 행 머리: 색 점·이름(더블클릭 편집)·⋯ 메뉴·끌어서 순서 바꾸기·무기록 제안 배지·종료됨 표시(overview 10-4).
import { useEffect, useRef, useState, type DragEvent } from "react";
import type { VisibleCategory } from "../../domain/categories";
import { CATEGORY_COLOR_KEYS, CATEGORY_COLORS } from "../../shared/palette";
import { STR } from "../../shared/strings";
import {
  archiveCategory,
  countItems,
  deleteCategory,
  keepCategory,
  moveCategory,
  renameCategory,
  setCategoryColor,
} from "./boardStore";
import { isComposingKey } from "./helpers";
import styles from "./Board.module.css";

interface Props {
  vc: VisibleCategory;
  index: number;
  total: number;
  nudge: boolean;
  nudgeWeeks: number;
  onDragStart(id: string): void;
  onDrop(targetId: string): void;
}

export function CategoryHeader({ vc, index, total, nudge, nudgeWeeks, onDragStart, onDrop }: Props) {
  const { category, state } = vc;
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const ended = state !== "active";

  useEffect(() => {
    if (!menuOpen) return;
    let alive = true;
    void countItems(category.id).then((n) => alive && setCanDelete(n === 0));
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      alive = false;
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [menuOpen, category.id]);

  const run = (fn: () => unknown) => {
    setMenuOpen(false);
    void fn();
  };

  return (
    <div
      className={`${styles.rowHeader} ${ended ? styles.ended : ""} ${dragOver ? styles.dragOver : ""}`}
      style={{ borderLeftColor: `var(--cat-${category.color})` }}
      draggable={!editing}
      title={STR.categoryMenu.dragHint}
      data-testid="category-header"
      onDragStart={(e: DragEvent) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart(category.id);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        onDrop(category.id);
      }}
    >
      <div className={styles.rowHeaderTop}>
        <span className={styles.dot} style={{ background: `var(--cat-${category.color})` }} aria-hidden />
        {editing ? (
          <input
            className={styles.nameInput}
            defaultValue={category.name}
            autoFocus
            maxLength={40}
            aria-label={STR.categoryMenu.rename}
            onKeyDown={(e) => {
              if (isComposingKey(e)) return;
              if (e.key === "Enter") {
                setEditing(false);
                void renameCategory(category.id, e.currentTarget.value);
              } else if (e.key === "Escape") setEditing(false);
            }}
            onBlur={(e) => {
              setEditing(false);
              void renameCategory(category.id, e.currentTarget.value);
            }}
          />
        ) : (
          <span className={styles.name} onDoubleClick={() => setEditing(true)}>
            {category.name}
          </span>
        )}
        <div className={styles.menuWrap} ref={menuRef}>
          <button
            type="button"
            className={styles.menuButton}
            aria-label={STR.categoryMenu.open(category.name)}
            title={STR.categoryMenu.open(category.name)}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className={styles.menu} role="menu">
              <button role="menuitem" type="button" onClick={() => run(() => setEditing(true))}>
                {STR.categoryMenu.rename}
              </button>
              <div className={styles.swatches} role="group" aria-label={STR.categoryMenu.color}>
                {CATEGORY_COLOR_KEYS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`${styles.swatch} ${k === category.color ? styles.swatchOn : ""}`}
                    style={{ background: `var(--cat-${k})` }}
                    aria-label={CATEGORY_COLORS[k].name}
                    title={CATEGORY_COLORS[k].name}
                    onClick={() => run(() => setCategoryColor(category.id, k))}
                  />
                ))}
              </div>
              <button
                role="menuitem"
                type="button"
                disabled={index === 0}
                onClick={() => run(() => moveCategory(category.id, -1))}
              >
                {STR.categoryMenu.moveUp}
              </button>
              <button
                role="menuitem"
                type="button"
                disabled={index === total - 1}
                onClick={() => run(() => moveCategory(category.id, 1))}
              >
                {STR.categoryMenu.moveDown}
              </button>
              {!ended && (
                <button role="menuitem" type="button" onClick={() => run(() => archiveCategory(category.id))}>
                  {STR.categoryMenu.archive}
                </button>
              )}
              <button
                role="menuitem"
                type="button"
                disabled={!canDelete}
                title={canDelete ? undefined : STR.categoryMenu.deleteDisabled}
                onClick={() =>
                  run(() => {
                    if (window.confirm(STR.categoryMenu.deleteConfirm(category.name)))
                      return deleteCategory(category.id);
                  })
                }
              >
                {STR.categoryMenu.delete}
              </button>
            </div>
          )}
        </div>
      </div>
      {ended && <span className={styles.endedTag}>{STR.board.ended}</span>}
      {nudge && (
        <div className={styles.nudge} data-testid="nudge">
          <span>{STR.nudge.message(nudgeWeeks)}</span>
          <span className={styles.nudgeActions}>
            <button type="button" onClick={() => void archiveCategory(category.id)}>
              {STR.nudge.archive}
            </button>
            <button type="button" onClick={() => void keepCategory(category.id)}>
              {STR.nudge.keep}
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
