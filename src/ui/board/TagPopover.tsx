// 업무 태그 팝오버(improve-1026-spec 4-1): 찾기·새로 만들기·체크(바로 저장).
// 키보드: 입력칸 ↓ = 목록으로, 목록 ↑↓ 이동·Space 붙이기/떼기(↑ 맨 위 = 입력칸), 입력칸 Enter = 새 태그(같은 이름이 있으면 그 태그 붙이기/떼기), Esc 닫기.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { findTagByName, normalizeTagName, TAG_NAME_MAX } from "../../domain/tags";
import { STR } from "../../shared/strings";
import { createTagFor, toggleCategoryTag, useBoard } from "./boardStore";
import { isComposingKey } from "./helpers";
import styles from "./Board.module.css";

interface Props {
  categoryId: string;
  categoryName: string;
  /** 팝오버를 붙일 요소(업무 머리) */
  anchor: HTMLElement;
  onClose(): void;
}

export function TagPopover({ categoryId, categoryName, anchor, onClose }: Props) {
  const tags = useBoard((s) => s.tags);
  const categoryTags = useBoard((s) => s.categoryTags);
  const mine = categoryTags[categoryId] ?? [];
  const [query, setQuery] = useState("");
  const popRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const name = normalizeTagName(query);
  const shown = tags.filter((t) => !name || t.name.toLowerCase().includes(name.toLowerCase()));
  const exact = name ? findTagByName(tags, name) : undefined;
  const usage = (id: string) => Object.values(categoryTags).filter((ids) => ids.includes(id)).length;

  // 자리: 업무 머리 오른쪽(모자라면 아래), 화면 밖으로 나가지 않게
  useLayoutEffect(() => {
    const pop = popRef.current;
    if (!pop) return;
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const left = r.right + 4 + w <= window.innerWidth - 8 ? r.right + 4 : Math.max(8, r.left);
    const top = Math.max(8, Math.min(r.top, window.innerHeight - h - 8));
    pop.style.left = `${left}px`;
    pop.style.top = `${left === r.right + 4 ? top : Math.min(r.bottom + 2, window.innerHeight - h - 8)}px`;
    inputRef.current?.focus();
  }, [anchor]);

  useEffect(() => {
    const outside = (e: Event) => {
      if (!popRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", outside);
    window.addEventListener("scroll", outside, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", outside);
      window.removeEventListener("scroll", outside, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const items = () => [...(listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isComposingKey(e)) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") list[i < 0 ? 0 : Math.min(i + 1, list.length - 1)]?.focus();
    else if (i <= 0) inputRef.current?.focus();
    else list[i - 1]?.focus();
  };

  const submit = async () => {
    if (!name) return;
    if (exact) await toggleCategoryTag(categoryId, exact.id);
    else if (await createTagFor(categoryId, name)) setQuery("");
    inputRef.current?.focus();
  };

  // 업무 머리는 끌기(draggable) 요소라 그 안의 입력칸은 마우스로 글자를 고르기 어렵다 → body에 띄운다
  return createPortal(
    <div
      ref={popRef}
      className={styles.tagPop}
      role="dialog"
      aria-label={STR.tags.popTitle(categoryName)}
      data-testid="tag-popover"
      onKeyDown={onKeyDown}
    >
      <input
        ref={inputRef}
        className={styles.tagSearch}
        value={query}
        placeholder={STR.tags.search}
        aria-label={STR.tags.search}
        maxLength={TAG_NAME_MAX + 1}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (isComposingKey(e)) return;
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <div ref={listRef} className={styles.tagList} role="group">
        {shown.map((t) => {
          const on = mine.includes(t.id);
          return (
            <button
              key={t.id}
              type="button"
              role="menuitemcheckbox"
              aria-checked={on}
              className={styles.tagOption}
              onClick={() => void toggleCategoryTag(categoryId, t.id)}
            >
              <span className={`${styles.check} ${on ? styles.checkOn : ""}`} aria-hidden="true" />
              <span className={styles.tagOptionName}>#{t.name}</span>
              <span className={styles.menuKey}>{usage(t.id)}</span>
            </button>
          );
        })}
      </div>
      {name && !exact && (
        <button type="button" className={styles.tagCreate} onClick={() => void submit()}>
          {STR.tags.create(name)}
        </button>
      )}
      {tags.length === 0 && !name && <p className={styles.tagHint}>{STR.tags.empty}</p>}
      {tags.length > 0 && shown.length === 0 && !name && <p className={styles.tagHint}>{STR.tags.noMatch}</p>}
      <p className={styles.tagKeys}>{STR.tags.keys}</p>
    </div>,
    document.body,
  );
}
