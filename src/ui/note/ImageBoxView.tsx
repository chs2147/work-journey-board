// 이미지 상자(weekly-note-spec 4-4): 그림은 일지 파일 안(note_asset), 표시는 data: 주소.
// 그림을 끌면 이동, 선택된 그림을 한 번 더 누르면 크게 보기, 오른쪽 아래 손잡이 = 크기(비율 유지), 아래 한 줄 설명.
import { useEffect, useRef, useState } from "react";
import type { ImageBox } from "../../domain/note";
import { STR } from "../../shared/strings";
import { onSelectedBoxKey, startBoxDrag, useBoxFrame } from "./boxShared";
import { dataUrl } from "./imageProcess";
import {
  bringToFront,
  deleteBox,
  duplicateBox,
  saveImage,
  selectBox,
  sendToBack,
  setCaption,
  useNote,
} from "./noteStore";
import { LinkStrip } from "./LinkStrip";
import { LinkMenuItems } from "./LinkPicker";
import { EdgeKnobs, EdgeMenuItems } from "./EdgeBoxParts";
import { useEdgeCount } from "./edgeHooks";
import styles from "./Note.module.css";

export function ImageBoxView({
  box,
  selected,
  onPreview,
}: {
  box: ImageBox;
  selected: boolean;
  onPreview(): void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLInputElement>(null);
  const img = useNote((s) => s.assets[box.asset]);
  const [menuOpen, setMenuOpen] = useState(false);
  const pulse = useNote((s) => s.pulseId === box.id);
  const edges = useEdgeCount(box.id);
  useBoxFrame(wrapRef, box.id, selected);

  const editCaption = () => {
    setMenuOpen(false);
    captionRef.current?.focus();
  };
  const run = (f: () => unknown) => () => {
    setMenuOpen(false);
    void f();
  };

  return (
    <div
      ref={wrapRef}
      className={[
        styles.box,
        styles.imageBox,
        selected ? styles.selected : "",
        box.refs ? styles.hasStrip : "",
        pulse ? styles.pulse : "",
      ].join(" ")}
      style={{ left: box.x, top: box.y, width: box.w, zIndex: menuOpen ? 100000 : box.z + 1 }}
      tabIndex={-1}
      role="group"
      aria-label={edges ? `${STR.note.imageAria} · ${STR.note.edgeCount(edges)}` : STR.note.imageAria}
      data-testid="note-image"
      data-box-id={box.id}
      onPointerDown={(e) => {
        e.stopPropagation(); // 판의 새 상자 만들기로 가지 않게
        if (e.target === e.currentTarget) selectBox(box.id);
      }}
      onKeyDown={(e) => onSelectedBoxKey(e, box.id, editCaption)}
    >
      <button
        type="button"
        className={styles.grip}
        aria-label={STR.note.grip}
        title={STR.note.grip}
        tabIndex={-1}
        onPointerDown={(e) => startBoxDrag(e, box, "move")}
      />
      <button
        type="button"
        className={styles.menuButton}
        aria-label={STR.note.menu}
        title={STR.note.menu}
        aria-expanded={menuOpen}
        tabIndex={-1}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setMenuOpen((o) => !o)}
      >
        ⋯
      </button>
      {menuOpen && (
        <div className={styles.menu} role="menu" onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" role="menuitem" onClick={run(onPreview)}>
            {STR.note.preview}
          </button>
          <button type="button" role="menuitem" onClick={editCaption}>
            {STR.note.editCaption}
          </button>
          <button type="button" role="menuitem" onClick={run(() => saveImage(box.id))}>
            {STR.note.saveImage}
          </button>
          <button type="button" role="menuitem" onClick={run(() => duplicateBox(box.id))}>
            {STR.note.duplicate}
          </button>
          <button type="button" role="menuitem" onClick={run(() => bringToFront(box.id))}>
            {STR.note.front}
          </button>
          <button type="button" role="menuitem" onClick={run(() => sendToBack(box.id))}>
            {STR.note.back}
          </button>
          <LinkMenuItems box={box} close={() => setMenuOpen(false)} />
          <EdgeMenuItems boxId={box.id} close={() => setMenuOpen(false)} />
          <button
            type="button"
            role="menuitem"
            className={styles.danger}
            onClick={run(() => deleteBox(box.id))}
          >
            {STR.note.delete}
          </button>
        </div>
      )}
      {box.refs && <LinkStrip boxId={box.id} refs={box.refs} />}
      {img ? (
        <img
          className={styles.image}
          src={dataUrl(img.mime, img.data)}
          alt={STR.note.imageAlt(box.caption)}
          width={img.width}
          height={img.height}
          draggable={false}
          onPointerDown={(e) => {
            const wasSelected = selected;
            selectBox(box.id);
            startBoxDrag(e, box, "move", () => wasSelected && onPreview());
          }}
        />
      ) : (
        <div className={styles.imageMissing}>{STR.note.imageMissing}</div>
      )}
      <input
        ref={captionRef}
        className={`${styles.caption} ${box.caption ? styles.captionFilled : ""}`}
        value={box.caption}
        placeholder={STR.note.captionPlaceholder}
        aria-label={STR.note.caption}
        maxLength={200}
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => setCaption(box.id, e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter" || e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            selectBox(box.id);
            wrapRef.current?.focus();
          }
        }}
      />
      <button
        type="button"
        className={styles.resizeCorner}
        aria-label={STR.note.imageResize}
        title={STR.note.imageResize}
        tabIndex={-1}
        onPointerDown={(e) => startBoxDrag(e, box, "resize")}
      />
      <EdgeKnobs boxId={box.id} />
    </div>
  );
}

/** 크게 보기: 원본 크기(넘치면 스크롤), Esc·바깥 클릭으로 닫기 */
export function ImagePreview({ box, onClose }: { box: ImageBox; onClose(): void }) {
  const img = useNote((s) => s.assets[box.asset]);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => prev?.focus();
  }, []);
  if (!img) return null;
  return (
    <div
      className={styles.preview}
      role="dialog"
      aria-modal="true"
      aria-label={STR.note.previewTitle}
      data-testid="note-image-preview"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className={styles.previewBar}>
        <span>{box.caption || STR.note.previewTitle}</span>
        <button ref={closeRef} type="button" className={styles.headButton} onClick={onClose}>
          {STR.note.close}
        </button>
      </div>
      <div className={styles.previewBody} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
        <img
          src={dataUrl(img.mime, img.data)}
          alt={STR.note.imageAlt(box.caption)}
          width={img.width}
          height={img.height}
        />
      </div>
    </div>
  );
}
