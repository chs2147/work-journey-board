import { STR } from "../../shared/strings";
import { LinkStrip } from "../note/LinkStrip";
import { useEffect, useRef, useState } from "react";
import type { TextBox } from "../../domain/note";
import { CABI } from "../../shared/cabiStrings";
import { IconNote, IconExpand, IconTrash, IconLink } from "../common/icons";
import { onSelectedBoxKey, startBoxDrag, useBoxFrame } from "../note/boxShared";
import { EdgeKnobs } from "../note/EdgeBoxParts";
import { deleteBox, selectBox, useNote, openLinkPicker } from "../note/noteStore";
import { reportError } from "../board/boardStore";
import { openCabiReference, resolveCabiReference, useCabiChange } from "./cabiService";
import styles from "./Cabi.module.css";
type Resolved = {
  title: string;
  text: string;
  missing: boolean;
  owner?: string;
  image?: { mime: string; data: string };
};
function useResolved(box: TextBox) {
  const version = useCabiChange((s) => s.version);
  const [value, setValue] = useState<Resolved | null>(null);
  useEffect(() => {
    let active = true;
    if (box.resource)
      void resolveCabiReference(box.resource)
        .then((v) => {
          if (active) setValue(v);
        })
        .catch(() => {
          if (active) setValue({ title: CABI.missing, text: CABI.sourceGone, missing: true });
        });
    return () => {
      active = false;
    };
  }, [box.resource, version]);
  return value;
}
export function ResourceCard({ box, selected }: { box: TextBox; selected: boolean }) {
  return box.resource?.kind === "note" ? (
    <NoteShortcut box={box} selected={selected} />
  ) : (
    <SourceCard box={box} selected={selected} />
  );
}
/** 메모보드에 붙인 업무노트 = 제목만 보이는 바로가기(본문·그림 없음, improve-v25 S4 A안) */
function NoteShortcut({ box, selected }: { box: TextBox; selected: boolean }) {
  const ref = useRef<HTMLDivElement>(null),
    multi = useNote((s) => s.multi.includes(box.id)),
    value = useResolved(box);
  useBoxFrame(ref, box.id, selected, true);
  const open = () => box.resource && void openCabiReference(box.resource).catch(reportError);
  const title = value?.title || (value ? CABI.untitled : CABI.loading);
  return (
    <div
      ref={ref}
      data-cabi-card="true"
      data-cabi-shortcut="note"
      data-missing={value?.missing || undefined}
      className={`${styles.shortcut} ${selected || multi ? styles.selected : ""}`}
      style={{ left: box.x, top: box.y, width: box.w, zIndex: box.z }}
      tabIndex={0}
      title={title}
      data-box-id={box.id}
      data-testid="note-box"
      onKeyDown={(e) => onSelectedBoxKey(e, box.id, open)}
      onPointerDown={(e) => {
        if ((e.target as Element).closest("button")) return;
        selectBox(box.id);
        startBoxDrag(e, box, "move");
      }}
      onDoubleClick={open}
    >
      {box.refs?.length ? <LinkStrip boxId={box.id} refs={box.refs} /> : null}
      <div className={styles.shortcutMain}>
        <span className={styles.shortcutTile} aria-hidden="true">
          <IconNote />
        </span>
        <span className={styles.shortcutText}>
          <span className={styles.shortcutTitle} data-testid="note-shortcut-title">
            {title}
          </span>
          <span className={styles.shortcutMeta}>
            {value?.missing ? CABI.missing : [CABI.taskNote, value?.owner].filter(Boolean).join(" · ")}
          </span>
        </span>
        {!value?.missing && (
          <button
            className={styles.shortcutOpen}
            title={CABI.openNote}
            aria-label={CABI.openNote}
            onClick={open}
          >
            ↗
          </button>
        )}
      </div>
      {selected && (
        <div className={styles.shortcutTools}>
          <button
            className={styles.icon}
            title={STR.linked.pick}
            aria-label={STR.linked.pick}
            onClick={() => openLinkPicker(box.id)}
          >
            <IconLink />
          </button>
          <button
            className={`${styles.icon} ${styles.shortcutRemove}`}
            title={CABI.removeCard}
            aria-label={CABI.removeCard}
            onClick={() => deleteBox(box.id)}
          >
            <IconTrash />
          </button>
        </div>
      )}
      <EdgeKnobs boxId={box.id} exposed={selected} />
    </div>
  );
}
function SourceCard({ box, selected }: { box: TextBox; selected: boolean }) {
  const ref = useRef<HTMLDivElement>(null),
    multi = useNote((s) => s.multi.includes(box.id)),
    value = useResolved(box);
  useBoxFrame(ref, box.id, selected);
  return (
    <div
      ref={ref}
      data-cabi-card="true"
      className={`${styles.reference} ${selected || multi ? styles.selected : ""}`}
      style={{ left: box.x, top: box.y, width: box.w, zIndex: box.z }}
      tabIndex={0}
      data-box-id={box.id}
      data-testid="note-box"
      onKeyDown={(e) =>
        onSelectedBoxKey(
          e,
          box.id,
          () => box.resource && void openCabiReference(box.resource).catch(reportError),
        )
      }
      onPointerDown={(e) => {
        if ((e.target as Element).closest("button")) return;
        selectBox(box.id);
        startBoxDrag(e, box, "move");
      }}
      onDoubleClick={() => box.resource && void openCabiReference(box.resource).catch(reportError)}
    >
      {box.refs?.length ? <LinkStrip boxId={box.id} refs={box.refs} /> : null}
      <div
        style={
          box.frameH
            ? { height: Math.max(30, box.frameH - (box.refs?.length ? 90 : 24)), overflowY: "auto" }
            : undefined
        }
      >
        <header>
          <IconNote />
          {value?.missing ? CABI.missing : box.resource?.kind === "memo" ? CABI.weekly : CABI.source}
        </header>
        <h3>{value?.title ?? CABI.loading}</h3>
        <p>{value?.text}</p>
        {value?.image && (
          <img
            src={`data:${value.image.mime};base64,${value.image.data}`}
            alt={value.title}
            style={{ maxWidth: "100%", maxHeight: 170, objectFit: "contain" }}
          />
        )}
        <footer>
          <button
            className={styles.icon}
            title={CABI.openSource}
            aria-label={CABI.openSource}
            onClick={() => box.resource && void openCabiReference(box.resource).catch(reportError)}
          >
            <IconExpand />
          </button>
          <button
            className={styles.icon}
            title={CABI.removeCard}
            aria-label={CABI.removeCard}
            onClick={() => deleteBox(box.id)}
          >
            <IconTrash />
          </button>
          <button
            className={styles.icon}
            title={STR.linked.pick}
            aria-label={STR.linked.pick}
            onClick={() => openLinkPicker(box.id)}
          >
            <IconLink />
          </button>
        </footer>
      </div>
      <EdgeKnobs boxId={box.id} exposed={selected} />
      <button
        style={{
          position: "absolute",
          right: 0,
          bottom: 0,
          width: 12,
          height: 12,
          padding: 0,
          border: 0,
          cursor: "ew-resize",
          background: "var(--line-strong)",
        }}
        aria-label={CABI.settings}
        onPointerDown={(e) => startBoxDrag(e, box, "resize")}
      />
    </div>
  );
}
