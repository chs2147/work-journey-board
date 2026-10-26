// 업무연계 오브젝트의 타이틀 띠(improve-1026v2-spec 6절): `● 업무명 · 10/22 (목) · 항목 글` + 끊긴 사슬(연결 해제).
// 글은 저장하지 않고 늘 지금 보드의 항목에서 만든다 — 항목을 고치거나 옮기면 바로 따라 바뀐다.
// 항목이 없으면(삭제) 회색 "연결된 항목이 삭제됨" + [연결 해제]. 항목 삭제를 되돌리면 같은 id라 다시 정상.
import type { BoxRef } from "../../domain/note";
import { shortDateLabel } from "../../domain/week";
import { useShallow } from "zustand/react/shallow";
import { STR } from "../../shared/strings";
import { revealItem, splitKey, useBoard } from "../board/boardStore";
import { IconUnlink } from "../common/icons";
import { unlinkBox } from "./noteStore";
import styles from "./Note.module.css";

/** 보고 있는 주의 칸에서 항목 찾기 */
function useLinkedItem(itemId: string) {
  return useBoard(
    useShallow((s) => {
      for (const [key, items] of Object.entries(s.cells)) {
        const it = items.find((i) => i.id === itemId);
        if (!it || !it.text.trim()) continue;
        const { date, categoryId } = splitKey(key);
        const cat = s.view?.categories.find((c) => c.category.id === categoryId)?.category;
        return {
          id: it.id,
          text: it.text,
          date,
          categoryId,
          catName: cat?.name ?? "",
          color: cat?.color ?? "c1",
        };
      }
      return null;
    }),
  );
}

export function LinkStrip({ boxId, link }: { boxId: string; link: BoxRef }) {
  const it = useLinkedItem(link.item);
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
  if (!it) {
    return (
      <div className={`${styles.strip} ${styles.stripGone}`} data-testid="link-strip" onPointerDown={stop}>
        <span className={styles.stripDot} />
        <span className={styles.stripText}>{STR.linked.gone}</span>
        <button
          type="button"
          className={styles.stripUnlinkText}
          tabIndex={-1}
          onClick={() => unlinkBox(boxId)}
        >
          {STR.linked.unlink}
        </button>
      </div>
    );
  }
  const date = shortDateLabel(it.date);
  return (
    <div className={styles.strip} data-testid="link-strip" onPointerDown={stop}>
      <span className={styles.stripDot} style={{ background: `var(--cat-${it.color})` }} />
      <button
        type="button"
        className={styles.stripText}
        tabIndex={-1}
        title={STR.linked.strip(it.catName, date, it.text)}
        aria-label={STR.linked.strip(it.catName, date, it.text)}
        onClick={() => void revealItem(it)}
      >
        <b>{it.catName}</b> · {date} · {it.text}
      </button>
      <button
        type="button"
        className={styles.stripUnlink}
        tabIndex={-1}
        aria-label={STR.linked.unlink}
        title={STR.linked.unlink}
        onClick={() => unlinkBox(boxId)}
      >
        <IconUnlink />
      </button>
    </div>
  );
}
