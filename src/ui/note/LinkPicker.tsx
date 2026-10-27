// 상자 ⋯ [업무 항목 연결…](multi-link-spec 2-3): 이번 주 보드 항목을 업무별로 보여 주고 체크로 연결·해제(키보드 가능).
// 상자 ⋯ 메뉴의 연결 항목도 여기 둔다 — [업무 항목 연결…] · [연결 해제] / [연결 모두 해제 (N)].
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { isLinkedTo, refItems, type NoteBox, type NoteDoc } from "../../domain/note";
import { shortDateLabel, weekDays } from "../../domain/week";
import { STR } from "../../shared/strings";
import { cellKey } from "../../data/repository";
import { useBoard } from "../board/boardStore";
import { openLinkPicker, toggleLink, unlinkBox, useNote } from "./noteStore";
import styles from "./Note.module.css";

const norm = (s: string) => s.normalize("NFKC").toLowerCase();

/** 상자 ⋯ 메뉴의 연결 항목 */
export function LinkMenuItems({ box, close }: { box: NoteBox; close(): void }) {
  const pending = useNote((s) => s.pendingId === box.id);
  if (pending) return null;
  const n = refItems(box).length;
  return (
    <>
      <button
        type="button"
        role="menuitem"
        data-testid="link-pick-open"
        onClick={() => {
          close();
          openLinkPicker(box.id);
        }}
      >
        {STR.linked.pick}
      </button>
      {n > 0 && (
        <button
          type="button"
          role="menuitem"
          data-testid="link-unlink-all"
          onClick={() => {
            close();
            unlinkBox(box.id);
          }}
        >
          {n === 1 ? STR.linked.unlink : STR.linked.unlinkAll(n)}
        </button>
      )}
    </>
  );
}

interface Row {
  id: string;
  categoryId: string;
  catName: string;
  color: string;
  date: string;
  text: string;
  sub: boolean;
}

/** 고르기 목록 — 판 바깥(100% 크기) 상자 바로 아래 */
export function LinkPicker({ doc, zoom }: { doc: NoteDoc; zoom: number }) {
  const pickerId = useNote((s) => s.pickerId);
  const box = doc.boxes.find((b) => b.id === pickerId);
  if (!box) return null;
  return <PickerPanel key={box.id} box={box} zoom={zoom} />;
}

function PickerPanel({ box, zoom }: { box: NoteBox; zoom: number }) {
  const view = useBoard((s) => s.view);
  const cells = useBoard((s) => s.cells);
  const weekId = useBoard((s) => s.weekId);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 이번 주 보드의 글 있는 항목: 업무(보드 순서) → 날짜 → 칸 안 순서
  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const v of view?.categories ?? []) {
      for (const date of weekDays(weekId)) {
        for (const it of cells[cellKey(date, v.category.id)] ?? []) {
          if (!it.text.trim()) continue;
          out.push({
            id: it.id,
            categoryId: v.category.id,
            catName: v.category.name,
            color: v.category.color,
            date,
            text: it.text,
            sub: it.depth === 1,
          });
        }
      }
    }
    return out;
  }, [view, cells, weekId]);
  const query = norm(q.trim());
  const shown = query ? rows.filter((r) => norm(`${r.catName} ${r.text}`).includes(query)) : rows;
  const groups = shown.reduce<{ id: string; name: string; color: string; rows: Row[] }[]>((acc, r) => {
    const last = acc.at(-1);
    if (last && last.id === r.categoryId) last.rows.push(r);
    else acc.push({ id: r.categoryId, name: r.catName, color: r.color, rows: [r] });
    return acc;
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const close = () => {
    openLinkPicker(null);
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(`[data-box-id="${CSS.escape(box.id)}"]`)
        ?.focus({ preventScroll: true }),
    );
  };

  const options = () => [...(listRef.current?.querySelectorAll<HTMLButtonElement>("[data-pick-item]") ?? [])];
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const list = options();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? Math.min(list.length - 1, i + 1) : i - 1;
    if (next < 0) inputRef.current?.focus();
    else list[next]?.focus();
  };

  const top = (box.y + (box.h ?? 48)) * zoom + 6;
  return (
    <div
      className={styles.picker}
      style={{ left: box.x * zoom, top }}
      role="dialog"
      aria-label={STR.linked.pickTitle}
      data-testid="link-picker"
      onKeyDown={onKey}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) openLinkPicker(null);
      }}
    >
      <input
        ref={inputRef}
        className={styles.pickerSearch}
        value={q}
        placeholder={STR.linked.pickSearch}
        aria-label={STR.linked.pickSearch}
        data-testid="link-pick-search"
        onChange={(e) => setQ(e.target.value)}
      />
      <div ref={listRef} className={styles.pickerList} role="menu" aria-label={STR.linked.pickTitle}>
        {!groups.length && <p className={styles.pickerEmpty}>{STR.linked.pickEmpty}</p>}
        {groups.map((g) => (
          <div key={g.id} role="group" aria-label={g.name}>
            <div className={styles.pickerGroup}>
              <span className={styles.stripDot} style={{ background: `var(--cat-${g.color})` }} />
              {g.name}
            </div>
            {g.rows.map((r) => {
              const on = isLinkedTo(box, r.id);
              return (
                <button
                  key={r.id}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={on}
                  className={`${styles.pickerItem} ${r.sub ? styles.pickerSub : ""}`}
                  data-pick-item={r.id}
                  data-testid="link-pick-item"
                  onClick={() => toggleLink(box.id, r.id)}
                >
                  <span
                    className={`${styles.pickerCheck} ${on ? styles.pickerCheckOn : ""}`}
                    aria-hidden="true"
                  />
                  <span className={styles.pickerDate}>{shortDateLabel(r.date)}</span>
                  <span className={styles.pickerText}>{r.text}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className={styles.pickerFoot}>
        <span data-testid="link-pick-count">{STR.linked.pickCount(refItems(box).length)}</span>
        <span>{STR.linked.pickHelp}</span>
      </div>
    </div>
  );
}
