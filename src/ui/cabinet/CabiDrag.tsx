import { captureNoteScope } from "../note/noteStore";
import { CABI_DRAG_PREFIX } from "./cabiDragFormat";
import { useState, useRef, type DragEvent } from "react";
import { IconCopyItem } from "../common/icons";
import { reportError } from "../board/boardStore";
import { flushNote, useNote } from "../note/noteStore";
import { cabiCall, registerCabiDrag } from "./cabiService";
import type { CabiReference } from "../../domain/cabi";
import { CABI } from "../../shared/cabiStrings";
import styles from "./Cabi.module.css";
export function CabiDragGrip({ reference, boxId }: { reference?: CabiReference; boxId?: string }) {
  const [ready, setReady] = useState(false);
  const activeToken = useRef<string | null>(null);
  const start = (e: DragEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const token = crypto.randomUUID();
    activeToken.current = token;
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("text/plain", CABI_DRAG_PREFIX + token);
    const register = async () => {
      const current = captureNoteScope();
      if (reference) {
        await cabiCall("dragResource", token, reference);
        return;
      }
      const s = useNote.getState();
      const ids =
        s.multi.length > 1 && boxId && s.multi.includes(boxId)
          ? s.multi
          : boxId
            ? [boxId]
            : s.selectedId
              ? [s.selectedId]
              : [];
      await flushNote(true, true);
      if (!current()) throw new Error(CABI.disconnected);
      await registerCabiDrag(
        token,
        s.task ? { kind: "task", categoryId: s.task.categoryId } : { kind: "week", weekId: s.weekId },
        s.doc,
        ids,
      );
    };
    void register().catch(reportError);
  };
  return (
    <button
      type="button"
      draggable
      onPointerDown={(e) => {
        e.stopPropagation();
        setReady(true);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onDragStart={start}
      onDragEnd={() => {
        setReady(false);
        void cabiCall("dragEnd", activeToken.current).catch(() => undefined);
      }}
      className={`${styles.icon} ${styles.copyGrip}`}
      title={reference ? CABI.dragResource : CABI.dragCopy}
      aria-label={reference ? CABI.dragResource : CABI.dragCopy}
      aria-pressed={ready}
    >
      <IconCopyItem />
    </button>
  );
}
export function BoardCopyHandles() {
  const { doc, selectedId, multi } = useNote();
  return (
    <>
      {doc.boxes
        .filter((b) => b.id === selectedId || multi.includes(b.id))
        .map((b) => (
          <span
            key={b.id}
            style={{ position: "absolute", left: b.x + b.w - 37, top: Math.max(0, b.y - 38), zIndex: 10000 }}
          >
            <CabiDragGrip boxId={b.id} />
          </span>
        ))}
    </>
  );
}
