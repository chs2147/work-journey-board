import { captureNoteScope } from "../note/noteStore";
import type { DragEvent } from "react";
import { CABI } from "../../shared/cabiStrings";
import { flushNote, importBoardObjects, refreshBoardAssetMeta, useNote } from "../note/noteStore";
import { reportError, toast } from "../board/boardStore";
import { cabiToken } from "./cabiDragFormat";
import { receiveCabiDrag } from "./cabiService";
export function handleCabiDrop(e: DragEvent, at: { x: number; y: number }): boolean {
  const token = cabiToken(e.dataTransfer);
  if (!token) return false;
  e.preventDefault();
  e.stopPropagation();
  void (async () => {
    const current = captureNoteScope();
    const s = useNote.getState(),
      owner = s.task
        ? { kind: "task" as const, categoryId: s.task.categoryId }
        : { kind: "week" as const, weekId: s.weekId };
    await flushNote(true, true);
    if (!current()) throw new Error(CABI.disconnected);
    const doc = await receiveCabiDrag(token, owner, at);
    if (!current()) throw new Error(CABI.disconnected);
    await refreshBoardAssetMeta();
    if (!current()) throw new Error(CABI.disconnected);
    if (useNote.getState().task?.categoryId !== s.task?.categoryId || useNote.getState().weekId !== s.weekId)
      throw new Error(CABI.disconnected);
    importBoardObjects(doc);
    await flushNote(true, true);
    if (!current()) throw new Error(CABI.disconnected);
    toast(CABI.copied(doc.boxes.length));
  })().catch(reportError);
  return true;
}
