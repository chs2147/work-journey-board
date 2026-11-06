import { captureNoteScope } from "../note/noteStore";
import { CABI } from "../../shared/cabiStrings";
import { toast } from "../board/boardStore";
import { flushNote, importBoardObjects, refreshBoardAssetMeta, useNote } from "../note/noteStore";
import { cabiCall, receiveCabiDrag, registerCabiDrag } from "./cabiService";
export async function copyBoardObjects() {
  const current = captureNoteScope();
  const s = useNote.getState(),
    ids = s.multi.length ? s.multi : s.selectedId ? [s.selectedId] : [];
  if (!ids.length) {
    toast(CABI.copyEmpty);
    return;
  }
  await flushNote(true, true);
  if (!current()) throw new Error(CABI.disconnected);
  const token = crypto.randomUUID();
  await registerCabiDrag(
    token,
    s.task ? { kind: "task", categoryId: s.task.categoryId } : { kind: "week", weekId: s.weekId },
    s.doc,
    ids,
  );
  if (!current()) throw new Error(CABI.disconnected);
  await cabiCall("clipboardSet", token);
  toast(CABI.clipboardHelp);
}
export async function pasteBoardObjects() {
  const current = captureNoteScope();
  const token = await cabiCall<string>("clipboardGet"),
    s = useNote.getState();
  await flushNote(true, true);
  if (!current()) throw new Error(CABI.disconnected);
  const at = { x: 24, y: Math.max(24, ...s.doc.boxes.map((b) => b.y + (b.h ?? 100) + 24)) },
    doc = await receiveCabiDrag(
      token,
      s.task ? { kind: "task", categoryId: s.task.categoryId } : { kind: "week", weekId: s.weekId },
      at,
    );
  if (!current()) throw new Error(CABI.disconnected);
  await refreshBoardAssetMeta();
  if (!current()) throw new Error(CABI.disconnected);
  importBoardObjects(doc);
  await flushNote(true, true);
  if (!current()) throw new Error(CABI.disconnected);
  toast(CABI.copied(doc.boxes.length));
}
