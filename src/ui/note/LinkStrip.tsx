// 업무연계 오브젝트의 타이틀 띠(improve-1026v2-spec 6절 → multi-link-spec 1·4·5절): 연결된 항목 하나 = 한 줄
// `● 업무명 · 10/22 (목) · 항목 글` + ✂(그 연결만 해제). 줄 순서는 보드 순서(업무 → 날짜 → 칸 안), 지워진 항목은 맨 아래.
// 글은 저장하지 않고 늘 지금 보드의 항목에서 만든다 — 항목을 고치거나 옮기면 바로 따라 바뀐다.
// 5개 이상이면 4줄 + "연결 N개 더 보기". 띠 높이는 상자의 CSS 변수 --strip-h로 알려 ⋯ 단추가 띠 아래에 오게 한다.
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BoxRef } from "../../domain/note";
import { shortDateLabel } from "../../domain/week";
import { STR } from "../../shared/strings";
import { revealItem, splitKey, useBoard } from "../board/boardStore";
import { useLinkHover } from "../board/rowDrag";
import { IconUnlink } from "../common/icons";
import { unlinkBox } from "./noteStore";
import styles from "./Note.module.css";

/** 이만큼부터 접는다(처음 FOLD_SHOW줄만) */
const FOLD_AT = 5;
const FOLD_SHOW = 4;

interface LinkedLine {
  /** 연결된 항목 id */
  item: string;
  /** 보드에 있으면 그 항목(없으면 지워진 항목) */
  found: {
    id: string;
    text: string;
    date: string;
    categoryId: string;
    catName: string;
    color: string;
    order: string;
  } | null;
}

/** 보고 있는 주의 칸에서 연결된 항목들을 찾아 보드 순서로 — 고르는 쪽은 글자열(같으면 다시 그리지 않음) */
function useLinkedLines(refs: BoxRef[]): LinkedLine[] {
  const wanted = refs.map((r) => r.item).join("|");
  const json = useBoard((s) => {
    const ids = wanted ? wanted.split("|") : [];
    const catIndex = new Map((s.view?.categories ?? []).map((c, i) => [c.category.id, i]));
    const found = new Map<string, NonNullable<LinkedLine["found"]>>();
    for (const [key, items] of Object.entries(s.cells)) {
      items.forEach((it, idx) => {
        if (!ids.includes(it.id) || !it.text.trim()) return;
        const { date, categoryId } = splitKey(key);
        const cat = s.view?.categories.find((c) => c.category.id === categoryId)?.category;
        found.set(it.id, {
          id: it.id,
          text: it.text,
          date,
          categoryId,
          catName: cat?.name ?? "",
          color: cat?.color ?? "c1",
          order: `${String(catIndex.get(categoryId) ?? 999).padStart(4, "0")}|${date}|${String(idx).padStart(4, "0")}`,
        });
      });
    }
    return JSON.stringify(
      ids
        .map((item) => ({ item, found: found.get(item) ?? null }))
        // 지워진 항목은 맨 아래(localeCompare는 "~"를 숫자보다 앞에 두므로 따로 가른다)
        .sort((a, b) =>
          !a.found || !b.found ? Number(!a.found) - Number(!b.found) : a.found.order < b.found.order ? -1 : 1,
        ),
    );
  });
  return useMemo(() => JSON.parse(json) as LinkedLine[], [json]);
}

export function LinkStrip({ boxId, refs }: { boxId: string; refs: BoxRef[] }) {
  const lines = useLinkedLines(refs);
  const [open, setOpen] = useState(false);
  const [cutHover, setCutHover] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const fold = lines.length >= FOLD_AT && !open;
  const shown = fold ? lines.slice(0, FOLD_SHOW) : lines;
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
  const hover = (item: string | null) => {
    if (useLinkHover.getState().itemId !== item) useLinkHover.setState({ itemId: item });
  };

  // 띠 높이 → 상자 CSS 변수(⋯ 단추·메뉴가 띠 아래로)
  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    parent.style.setProperty("--strip-h", `${el.offsetHeight}px`);
  });
  // 띠가 사라지면 보드 강조도 끈다
  useLayoutEffect(() => () => hover(null), []);

  return (
    <div
      ref={ref}
      className={styles.strip}
      data-testid="link-strip"
      data-count={lines.length}
      onPointerDown={stop}
      onPointerLeave={() => hover(null)}
    >
      {shown.map(({ item, found: it }) => {
        if (!it) {
          return (
            <div
              key={item}
              className={`${styles.stripLine} ${styles.stripGone} ${cutHover === item ? styles.stripCut : ""}`}
              data-testid="link-line"
            >
              <span className={styles.stripDot} />
              <span className={styles.stripText}>{STR.linked.gone}</span>
              <button
                type="button"
                className={styles.stripUnlink}
                tabIndex={-1}
                aria-label={STR.linked.unlink}
                title={STR.linked.unlink}
                data-testid="link-line-unlink"
                onPointerEnter={() => setCutHover(item)}
                onPointerLeave={() => setCutHover(null)}
                onClick={() => unlinkBox(boxId, item)}
              >
                <IconUnlink />
              </button>
            </div>
          );
        }
        const date = shortDateLabel(it.date);
        return (
          <div
            key={item}
            className={`${styles.stripLine} ${cutHover === item ? styles.stripCut : ""}`}
            data-testid="link-line"
            data-item={item}
            onPointerEnter={() => hover(item)}
          >
            <span className={styles.stripDot} style={{ background: `var(--cat-${it.color})` }} />
            <button
              type="button"
              className={styles.stripText}
              tabIndex={-1}
              title={STR.linked.strip(it.catName, date, it.text)}
              aria-label={STR.linked.strip(it.catName, date, it.text)}
              onClick={() => {
                hover(null);
                void revealItem(it);
              }}
            >
              <b>{it.catName}</b> · {date} · {it.text}
            </button>
            <button
              type="button"
              className={styles.stripUnlink}
              tabIndex={-1}
              aria-label={STR.linked.lineUnlink(it.catName, it.text)}
              title={STR.linked.unlink}
              data-testid="link-line-unlink"
              onPointerEnter={() => setCutHover(item)}
              onPointerLeave={() => setCutHover(null)}
              onClick={() => {
                hover(null);
                unlinkBox(boxId, item);
              }}
            >
              <IconUnlink />
            </button>
          </div>
        );
      })}
      {lines.length >= FOLD_AT && (
        <button
          type="button"
          className={`${styles.stripLine} ${styles.stripMore}`}
          tabIndex={-1}
          data-testid="link-more"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? STR.linked.less : STR.linked.more(lines.length - FOLD_SHOW)}
        </button>
      )}
    </div>
  );
}
