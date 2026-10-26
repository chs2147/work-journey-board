// 메모 보드 미니맵(improve-1026-spec 11-1): 오른쪽 아래 작은 지도 — 상자 배치 + 보이는 범위 틀. 누르거나 끌면 그곳으로.
// 판이 보이는 영역보다 클 때만 보이고, 접어 둘 수 있다(설정 ui.noteMinimap).
import { useEffect, useState, type PointerEvent, type RefObject } from "react";
import type { NoteBox } from "../../domain/note";
import { STR } from "../../shared/strings";
import { IconMap } from "../common/icons";
import { setMinimap, useNote } from "./noteStore";
import styles from "./Note.module.css";

const MAX_W = 168;
const MAX_H = 104;

interface Props {
  scrollRef: RefObject<HTMLDivElement | null>;
  boxes: readonly NoteBox[];
  /** 판 크기(문서 px) */
  size: { w: number; h: number };
  /** 보이는 영역(화면 px) */
  view: { w: number; h: number };
  zoom: number;
}

export function Minimap({ scrollRef, boxes, size, view, zoom }: Props) {
  const open = useNote((s) => s.minimap);
  const [scroll, setScroll] = useState({ left: 0, top: 0 });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const on = () => setScroll({ left: el.scrollLeft, top: el.scrollTop });
    on();
    el.addEventListener("scroll", on, { passive: true });
    return () => el.removeEventListener("scroll", on);
  }, [scrollRef]);

  const scrollable = size.w * zoom > view.w + 1 || size.h * zoom > view.h + 1;
  if (!scrollable || view.w === 0) return null;

  if (!open)
    return (
      <button
        type="button"
        className={`${styles.iconButton} ${styles.minimapToggle}`}
        aria-label={STR.note.minimapShow}
        title={STR.note.minimapShow}
        onClick={() => setMinimap(true)}
      >
        <IconMap />
      </button>
    );

  const s = Math.min(MAX_W / size.w, MAX_H / size.h);
  const frame = {
    left: (scroll.left / zoom) * s,
    top: (scroll.top / zoom) * s,
    width: Math.min(size.w, view.w / zoom) * s,
    height: Math.min(size.h, view.h / zoom) * s,
  };

  /** 누른 곳이 보이는 영역 가운데가 되게 */
  const moveTo = (e: PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    const r = e.currentTarget.getBoundingClientRect();
    el.scrollLeft = ((e.clientX - r.left) / s) * zoom - el.clientWidth / 2;
    el.scrollTop = ((e.clientY - r.top) / s) * zoom - el.clientHeight / 2;
  };

  return (
    <div className={styles.minimap} data-testid="note-minimap">
      <div
        className={styles.minimapMap}
        style={{ width: size.w * s, height: size.h * s }}
        role="img"
        aria-label={STR.note.minimapAria}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          moveTo(e);
        }}
        onPointerMove={(e) => e.buttons === 1 && moveTo(e)}
      >
        {boxes.map((b) => (
          <span
            key={b.id}
            className={
              b.kind === "image"
                ? styles.minimapImage
                : b.kind === "link"
                  ? styles.minimapLink
                  : styles.minimapBox
            }
            style={{ left: b.x * s, top: b.y * s, width: b.w * s, height: (b.h ?? 48) * s }}
          />
        ))}
        <span className={styles.minimapFrame} style={frame} data-testid="note-minimap-frame" />
      </div>
      <button
        type="button"
        className={styles.minimapClose}
        aria-label={STR.note.minimapHide}
        title={STR.note.minimapHide}
        onClick={() => setMinimap(false)}
      >
        ×
      </button>
    </div>
  );
}
