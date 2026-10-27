// 링크 카드(improve-1026-spec 10-1, A 오프라인 카드): 왼쪽 정사각 = 도메인 첫 글자(도메인별 고정 색) 또는 내가 붙인 캡처 썸네일,
// 오른쪽 = 제목 · 도메인 ↗ · 메모, 아래 = 전체 주소. 앱은 주소에 접속하지 않는다(13절).
// 카드를 끌면 이동, 두 번 누르면(또는 선택 후 Enter) 제목·메모 고치기, Ctrl+클릭·↗ = 기본 브라우저로 열기.
import { useRef, useState, type KeyboardEvent } from "react";
import { domainInitial, domainOf, domainTone } from "../../domain/links";
import type { LinkBox } from "../../domain/note";
import { STR } from "../../shared/strings";
import { useAppStore } from "../common/appStore";
import { openLink } from "../common/openLink";
import { reportError, toast } from "../board/boardStore";
import { onSelectedBoxKey, startBoxDrag, useBoxFrame } from "./boxShared";
import { ACCEPT_TYPES, dataUrl } from "./imageProcess";
import {
  bringToFront,
  clearLinkThumb,
  deleteBox,
  duplicateBox,
  selectBox,
  sendToBack,
  setLinkThumb,
  updateLinkText,
  useNote,
} from "./noteStore";
import { LinkStrip } from "./LinkStrip";
import { LinkMenuItems } from "./LinkPicker";
import { EdgeKnobs, EdgeMenuItems } from "./EdgeBoxParts";
import { useEdgeCount } from "./edgeHooks";
import styles from "./Note.module.css";

export function LinkBoxView({ box, selected }: { box: LinkBox; selected: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const thumb = useNote((s) => (box.asset ? s.assets[box.asset] : undefined));
  const [menuOpen, setMenuOpen] = useState(false);
  const pulse = useNote((s) => s.pulseId === box.id);
  const [editing, setEditing] = useState(false);
  const edges = useEdgeCount(box.id);
  useBoxFrame(wrapRef, box.id, selected);
  const domain = domainOf(box.url);

  const run = (f: () => unknown) => () => {
    setMenuOpen(false);
    void f();
  };
  const pickThumb = () => {
    setMenuOpen(false);
    fileRef.current?.click();
  };
  const startEdit = () => {
    setMenuOpen(false);
    setEditing(true);
  };
  const copyUrl = async () => {
    try {
      await useAppStore.getState().platform?.writeClipboard(box.url);
      toast(STR.links.copied);
    } catch (e) {
      reportError(e);
    }
  };

  return (
    <div
      ref={wrapRef}
      className={[
        styles.box,
        styles.linkBox,
        selected ? styles.selected : "",
        box.refs ? styles.hasStrip : "",
        pulse ? styles.pulse : "",
      ].join(" ")}
      style={{ left: box.x, top: box.y, width: box.w, zIndex: menuOpen ? 100000 : box.z + 1 }}
      tabIndex={-1}
      role="group"
      aria-label={
        edges
          ? `${STR.links.cardAria(box.title)} · ${STR.note.edgeCount(edges)}`
          : STR.links.cardAria(box.title)
      }
      data-testid="note-link"
      data-box-id={box.id}
      onPointerDown={(e) => {
        e.stopPropagation(); // 판의 새 상자 만들기로 가지 않게
        const t = e.target as HTMLElement;
        if (editing || t.closest("button, input, [data-open]")) return;
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          void openLink(box.url);
          return;
        }
        // 카드 몸통을 끌면 이동(거의 움직이지 않으면 선택만)
        selectBox(box.id);
        startBoxDrag(e, box, "move");
      }}
      onDoubleClick={(e) => {
        if (!(e.target as HTMLElement).closest("button, input, [data-open]")) startEdit();
      }}
      onKeyDown={(e) => {
        if (!editing) onSelectedBoxKey(e, box.id, startEdit);
      }}
    >
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
          <button type="button" role="menuitem" onClick={run(() => openLink(box.url))}>
            {STR.links.open}
          </button>
          <button type="button" role="menuitem" onClick={startEdit}>
            {STR.links.edit}
          </button>
          <button type="button" role="menuitem" onClick={run(copyUrl)}>
            {STR.links.copyUrl}
          </button>
          <button type="button" role="menuitem" onClick={pickThumb}>
            {STR.links.thumb}
          </button>
          {box.asset && (
            <button type="button" role="menuitem" onClick={run(() => clearLinkThumb(box.id))}>
              {STR.links.thumbRemove}
            </button>
          )}
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
      <input
        ref={fileRef}
        type="file"
        className={styles.fileInput}
        accept={ACCEPT_TYPES.join(",")}
        tabIndex={-1}
        aria-label={STR.links.thumb}
        data-testid="link-thumb-input"
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (f) void setLinkThumb(box.id, f);
        }}
      />
      <div className={styles.linkMain}>
        {thumb ? (
          <img
            className={styles.linkThumb}
            src={dataUrl(thumb.mime, thumb.data)}
            alt={STR.links.thumbAlt(box.title)}
            draggable={false}
          />
        ) : (
          <span
            className={`${styles.linkInitial} ${styles[`tone${domainTone(box.url)}`]}`}
            aria-hidden="true"
          >
            {domainInitial(box.url)}
          </span>
        )}
        {editing ? (
          <LinkEditor box={box} onDone={() => (setEditing(false), wrapRef.current?.focus())} />
        ) : (
          <div className={styles.linkText}>
            <div className={styles.linkTitle} data-testid="link-title">
              {box.title}
            </div>
            <div className={styles.linkDomain}>
              {domain}
              <span
                className={styles.linkOpen}
                data-open
                role="button"
                aria-label={STR.links.openAria(box.url)}
                title={STR.links.open}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  void openLink(box.url);
                }}
              >
                ↗
              </span>
            </div>
            {box.note && <div className={styles.linkNote}>{box.note}</div>}
          </div>
        )}
      </div>
      <div className={styles.linkUrl} title={`${box.url}\n${STR.links.ctrlClick}`}>
        {box.url}
      </div>
      <button
        type="button"
        className={styles.resize}
        aria-label={STR.note.resize}
        title={STR.note.resize}
        tabIndex={-1}
        onPointerDown={(e) => startBoxDrag(e, box, "resize")}
      />
      <EdgeKnobs boxId={box.id} />
    </div>
  );
}

/** 제목·메모 고치기 — Enter 저장, Esc 취소, 바깥을 누르면 저장 */
function LinkEditor({ box, onDone }: { box: LinkBox; onDone(): void }) {
  const [title, setTitle] = useState(box.title);
  const [note, setNote] = useState(box.note);
  const save = () => {
    updateLinkText(box.id, title, note);
    onDone();
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onDone();
    }
  };
  return (
    <div
      className={styles.linkText}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) save();
      }}
    >
      <input
        className={styles.linkInput}
        value={title}
        maxLength={200}
        autoFocus
        aria-label={STR.links.title}
        placeholder={STR.links.title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={onKey}
      />
      <input
        className={styles.linkInput}
        value={note}
        maxLength={200}
        aria-label={STR.links.note}
        placeholder={STR.links.note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={onKey}
      />
    </div>
  );
}
