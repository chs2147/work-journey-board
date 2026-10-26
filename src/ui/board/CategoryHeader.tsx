// 업무 행 머리: 색 점·이름(더블클릭 편집)·⋯ 메뉴·끌어서 순서 바꾸기·무기록 제안 배지·종료됨 표시(overview 10-4).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent } from "react";
import type { VisibleCategory } from "../../domain/categories";
import { chipsToShow } from "../../domain/tags";
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
  useBoard,
} from "./boardStore";
import { TagPopover } from "./TagPopover";
import { isComposingKey } from "./helpers";
import styles from "./Board.module.css";

interface Props {
  vc: VisibleCategory;
  index: number;
  total: number;
  nudge: boolean;
  nudgeWeeks: number;
  onDragStart(id: string): void;
  onDragEnd(): void;
  /** 끌어 온 업무를 이 업무의 위(before)·아래(after)에 놓는다 */
  onDrop(targetId: string, place: DropPlace): void;
  /** 지금 끌고 있는 업무(자기 자신 위에는 표시를 내지 않는다) */
  draggingId: string | null;
}

export type DropPlace = "before" | "after";

/** 업무 끌기 전용 자료형 — 글자(text/plain)로 싣지 않아 입력칸에 떨어뜨려도 글자가 들어가지 않는다 */
const DRAG_TYPE = "application/x-wjb-category";

/** 머리 칸 위쪽 절반이면 위, 아래쪽 절반이면 아래 */
function placeAt(e: DragEvent<HTMLElement>): DropPlace {
  const r = e.currentTarget.getBoundingClientRect();
  return e.clientY < r.top + r.height / 2 ? "before" : "after";
}

export function CategoryHeader({
  vc,
  index,
  total,
  nudge,
  nudgeWeeks,
  onDragStart,
  onDragEnd,
  onDrop,
  draggingId,
}: Props) {
  const { category, state } = vc;
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [dropAt, setDropAt] = useState<DropPlace | null>(null);
  /** 태그 팝오버를 붙인 업무 머리(null = 닫힘) */
  const [tagAnchor, setTagAnchor] = useState<HTMLElement | null>(null);
  const openTags = () => setTagAnchor(headerRef.current);
  const closeTags = useCallback(() => setTagAnchor(null), []);
  const headerRef = useRef<HTMLDivElement>(null);
  const allTags = useBoard((s) => s.tags);
  const tagIds = useBoard((s) => s.categoryTags[category.id]);
  const myTags = allTags.filter((t) => tagIds?.includes(t.id));
  const chips = chipsToShow(myTags);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuListRef = useRef<HTMLDivElement>(null);
  const ended = state !== "active";

  useEffect(() => {
    if (!menuOpen) return;
    let alive = true;
    void countItems(category.id).then((n) => alive && setCanDelete(n === 0));
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    // 메뉴는 화면 기준(fixed)으로 떠 있으므로 보드가 스크롤되거나 창 크기가 바뀌면 닫는다
    const dismiss = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
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
  }, [menuOpen, category.id]);

  // 메뉴 자리: 보드 스크롤 영역에 잘리지 않게 화면 기준으로 띄우고, 아래 자리가 모자라면 버튼 위로 연다
  // (보드 아래 메모 도크가 있어 보드가 짧아질 수 있다 — weekly-note-spec 3절)
  useLayoutEffect(() => {
    const menu = menuListRef.current;
    const button = menuRef.current;
    if (!menuOpen || !menu || !button) return;
    const r = button.getBoundingClientRect();
    const h = menu.offsetHeight;
    const below = r.bottom + 2;
    const top = below + h <= window.innerHeight - 8 ? below : Math.max(8, r.top - 2 - h);
    menu.style.top = `${top}px`;
    menu.style.left = `${Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)}px`;
  }, [menuOpen]);

  const run = (fn: () => unknown) => {
    setMenuOpen(false);
    void fn();
  };

  return (
    <div
      ref={headerRef}
      className={[
        styles.rowHeader,
        ended ? styles.ended : "",
        draggingId === category.id ? styles.dragging : "",
        dropAt === "before" ? styles.dropBefore : "",
        dropAt === "after" ? styles.dropAfter : "",
        menuOpen ? styles.menuOpen : "",
      ].join(" ")}
      style={{ borderLeftColor: `var(--cat-${category.color})` }}
      draggable={!editing}
      title={STR.categoryMenu.dragHint}
      data-testid="category-header"
      onDragStart={(e: DragEvent<HTMLDivElement>) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(DRAG_TYPE, category.id);
        onDragStart(category.id);
      }}
      onDragEnd={() => {
        setDropAt(null);
        onDragEnd();
      }}
      onDragOver={(e) => {
        if (!draggingId || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDropAt(draggingId === category.id ? null : placeAt(e));
      }}
      onDragLeave={(e) => {
        // 머리 칸 안의 글자·버튼 사이를 지날 때는 표시를 지우지 않는다
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropAt(null);
      }}
      onDrop={(e) => {
        if (!draggingId) return;
        e.preventDefault();
        setDropAt(null);
        onDrop(category.id, placeAt(e));
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
            <div className={styles.menu} role="menu" ref={menuListRef}>
              <button role="menuitem" type="button" onClick={() => run(() => setEditing(true))}>
                {STR.categoryMenu.rename}
              </button>
              <button role="menuitem" type="button" onClick={() => run(openTags)}>
                {STR.tags.menuItem}
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
      {/* 태그 칩(회색, 3개 넘으면 +N) — 누르면 태그 팝오버. 태그가 없으면 마우스를 올릴 때만 [+ 태그] */}
      <div className={styles.tagChips} data-testid="tag-chips">
        {chips.shown.map((t) => (
          <button
            key={t.id}
            type="button"
            tabIndex={-1}
            className={styles.tagChip}
            title={STR.tags.addTitle(category.name)}
            onClick={openTags}
          >
            #{t.name}
          </button>
        ))}
        {chips.more > 0 && (
          <button
            type="button"
            tabIndex={-1}
            className={styles.tagChip}
            title={myTags
              .slice(chips.shown.length)
              .map((t) => `#${t.name}`)
              .join(" ")}
            onClick={openTags}
          >
            {STR.tags.more(chips.more)}
          </button>
        )}
        <button
          type="button"
          tabIndex={-1}
          className={styles.tagAdd}
          aria-label={STR.tags.addTitle(category.name)}
          title={STR.tags.addTitle(category.name)}
          onClick={openTags}
        >
          {STR.tags.add}
        </button>
      </div>
      {tagAnchor && (
        <TagPopover
          categoryId={category.id}
          categoryName={category.name}
          anchor={tagAnchor}
          onClose={closeTags}
        />
      )}
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
