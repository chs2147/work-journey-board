// 보드 칸 항목의 "보기" — 칸에 커서가 없을 때 글 속 http/https 주소를 밑줄 링크 + ↗로 그린다(improve-1026-spec 9-1).
// 그냥 클릭 = 그 자리에 커서를 둔 편집(입력칸으로 바뀜), Ctrl+클릭·↗ = 기본 브라우저로 열기.
// 조각마다 원래 글에서의 시작 위치(data-start)를 달아 클릭한 글자 위치를 입력칸 커서로 옮긴다.
import type { MouseEvent } from "react";
import { shortUrl, splitLinks } from "../../domain/links";
import { STR } from "../../shared/strings";
import { openLink } from "../common/openLink";
import styles from "./Board.module.css";

interface Props {
  text: string;
  ariaLabel: string;
  /** 편집으로 바꾸기 — caret = 원래 글에서의 커서 위치 */
  onEdit(caret: number): void;
}

/** 화면 좌표의 글자 위치 → 원래 글의 위치(줄인 주소 안이면 그 주소 끝, ↗는 세지 않음) */
function caretAt(root: HTMLElement, x: number, y: number, fallback: number): number {
  const doc = document as Document & {
    caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null;
  };
  const pos = doc.caretPositionFromPoint?.(x, y);
  const range = pos ? null : document.caretRangeFromPoint?.(x, y);
  const node = pos?.offsetNode ?? range?.startContainer;
  const offset = pos?.offset ?? range?.startOffset ?? 0;
  const seg = (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>("[data-start]");
  if (!seg || !root.contains(seg)) return fallback;
  const start = Number(seg.dataset.start);
  if (seg.dataset.short) return start + Number(seg.dataset.len);
  return start + Math.min(offset, Number(seg.dataset.len));
}

export function LinkedText({ text, ariaLabel, onEdit }: Props) {
  const segments = splitLinks(text);
  /** 조각마다 원래 글에서의 시작 위치 */
  const starts = segments.map((_, i) => segments.slice(0, i).reduce((n, s) => n + s.text.length, 0));

  const onMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    const url = t.closest<HTMLElement>("[data-url]")?.dataset.url;
    e.preventDefault();
    if (url && (t.closest("[data-open]") || e.ctrlKey || e.metaKey)) {
      void openLink(url);
      return;
    }
    onEdit(caretAt(e.currentTarget, e.clientX, e.clientY, text.length));
  };

  return (
    <div className={styles.itemView} aria-label={ariaLabel} data-testid="item-view" onMouseDown={onMouseDown}>
      {segments.map((s, i) => {
        const start = starts[i]!;
        if (!s.url)
          return (
            <span key={i} data-start={start} data-len={s.text.length}>
              {s.text}
            </span>
          );
        const shown = shortUrl(s.url);
        return (
          <span key={i} data-url={s.url}>
            <span
              className={styles.link}
              data-start={start}
              data-len={s.text.length}
              data-short={shown !== s.url ? "1" : undefined}
              title={`${s.url}\n${STR.links.ctrlClick}`}
            >
              {shown}
            </span>
            <span
              className={styles.linkOpen}
              data-open
              role="button"
              aria-label={STR.links.openAria(s.url)}
              title={STR.links.open}
            >
              ↗
            </span>
          </span>
        );
      })}
    </div>
  );
}
