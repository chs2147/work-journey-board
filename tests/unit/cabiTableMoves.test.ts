import { it, expect } from "vitest";
import { getSchema, type Editor } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { history, undo, redo } from "@tiptap/pm/history";
import { cabiEditorExtensions } from "../../src/ui/cabinet/cabiEditorExtensions";
import { moveCabiTableAxis } from "../../src/ui/cabinet/cabiTableMoves";

for (const kind of ["row", "column"] as const) {
  it(`${kind} movement has its own undo event even immediately after import and resize`, () => {
    const schema = getSchema(cabiEditorExtensions());
    let state = EditorState.create({ schema, plugins: [history()] });
    let clock = 1000;
    const dispatch = (tr: typeof state.tr) => {
      state = state.apply(tr.setTime(clock++));
    };
    const editor = {
      get state() {
        return state;
      },
      view: { dispatch },
    } as unknown as Editor;
    const table = schema.nodeFromJSON({
      type: "table",
      content: [0, 1, 2].map((r) => ({
        type: "tableRow",
        content: [0, 1, 2].map((c) => ({
          type: r === 0 ? "tableHeader" : "tableCell",
          content: [{ type: "paragraph", content: [{ type: "text", text: `${r}-${c}` }] }],
        })),
      })),
    });
    dispatch(state.tr.replaceWith(0, state.doc.content.size, table));
    dispatch(state.tr.setNodeMarkup(2, undefined, { colspan: 1, rowspan: 1, colwidth: [140] }));
    const before = state.doc.toJSON();
    expect(moveCabiTableAxis(editor, kind, 0, 2, 1)).toBe(true);
    const moved = state.doc.toJSON();
    expect(moved).not.toEqual(before);
    expect(undo(state, dispatch)).toBe(true);
    expect(state.doc.toJSON()).toEqual(before);
    expect(redo(state, dispatch)).toBe(true);
    expect(state.doc.toJSON()).toEqual(moved);
    // A subsequent edit is also independent of the move.
    dispatch(state.tr.insertText("추가", 4));
    expect(undo(state, dispatch)).toBe(true);
    expect(state.doc.toJSON()).toEqual(moved);
  });
}
