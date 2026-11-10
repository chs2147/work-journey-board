// 이미지 상자(weekly-note-spec 4-4): 그림은 일지 파일 안(note_asset), 표시는 data: 주소.
// 그림을 끌면 이동, 선택된 그림을 한 번 더 누르면 크게 보기, 오른쪽 아래 손잡이 = 크기(비율 유지), 아래 한 줄 설명.
import { useEffect, useRef, useState } from "react";
import type { ImageBox } from "../../domain/note";
import { STR } from "../../shared/strings";
import { onSelectedBoxKey, startBoxDrag, useBoxFrame } from "./boxShared";
import { FullImageCanvas, NoteImageCanvas } from "./noteImage";
import {
  noteRepo,
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
  const zoom = useNote((s) => s.zoom);
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
      {!!box.refs?.length && <LinkStrip boxId={box.id} refs={box.refs} />}
      {img ? (
        <NoteImageCanvas
          className={styles.image}
          repo={noteRepo()}
          assetId={box.asset}
          label={STR.note.imageAlt(box.caption)}
          width={img.width}
          height={img.height}
          shownWidth={box.w * zoom}
          data-mime={img.mime}
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

/** 크게 보기: 원본 크기(넘치면 스크롤), Esc·바깥 클릭으로 닫기.
 * 1.24.2: 네이티브 <dialog>.showModal()로 브라우저 최상위 레이어(top layer)에 띄운다 — 부모의 z-index·쌓임 맥락과
 * 상관없이 앱 전체 위에 오고, 나머지 화면은 inert(누르기·초점·화면 읽기 차단). 뒤에 더해지는 기능의 z-index가
 * 아무리 커도 이 위로 올라오지 못한다. 키 입력은 창 밖(전역 단축키)으로 새지 않게 여기서 멈춘다. */
export function ImagePreview({ box, onClose }: { box: ImageBox; onClose(): void }) {
  const img = useNote((s) => s.assets[box.asset]);
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const ready = !!img;
  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    const prev = document.activeElement as HTMLElement | null;
    if (!dlg.open) dlg.showModal();
    closeRef.current?.focus();
    const cancel = (e: Event) => {
      e.preventDefault();
      onCloseRef.current();
    };
    const key = (e: KeyboardEvent) => {
      e.stopPropagation(); // 전역 단축키(주 이동·뷰 전환 등)가 뒤 화면을 바꾸지 않게
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
      }
    };
    dlg.addEventListener("cancel", cancel);
    dlg.addEventListener("keydown", key);
    return () => {
      dlg.removeEventListener("cancel", cancel);
      dlg.removeEventListener("keydown", key);
      if (dlg.open) dlg.close();
      prev?.focus();
    };
  }, [ready]);
  if (!img) return null;
  return (
    <dialog
      ref={ref}
      className={styles.preview}
      aria-label={STR.note.previewTitle}
      data-testid="note-image-preview"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={styles.previewBar}>
        <span>{box.caption || STR.note.previewTitle}</span>
        <button ref={closeRef} type="button" className={styles.headButton} onClick={onClose}>
          {STR.note.close}
        </button>
      </div>
      <div className={styles.previewBody} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
        <FullImageCanvas
          repo={noteRepo()}
          assetId={box.asset}
          label={STR.note.imageAlt(box.caption)}
          width={img.width}
          height={img.height}
        />
      </div>
    </dialog>
  );
}
