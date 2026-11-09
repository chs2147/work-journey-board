import type { Editor } from "@tiptap/react";
import { closeHistory } from "@tiptap/pm/history";
import { moveTableRow, moveTableColumn } from "@tiptap/pm/tables";

/** Drag moves must not merge with table creation, resizing or subsequent typing. */
export function moveCabiTableAxis(
  editor: Editor,
  kind: "row" | "column",
  from: number,
  to: number,
  pos: number,
) {
  return (kind === "row" ? moveTableRow : moveTableColumn)({ from, to, pos })(editor.state, (tr) => {
    editor.view.dispatch(closeHistory(tr));
    editor.view.dispatch(closeHistory(editor.state.tr));
  });
}
