import { it, expect } from "vitest";
import { EditorState } from "@tiptap/pm/state";
import { getSchema, type Editor } from "@tiptap/core";
import { cabiEditorExtensions } from "../../src/ui/cabinet/cabiEditorExtensions";
import { moveCabiBlock } from "../../src/ui/cabinet/cabiBlockMoves";
const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
function fixture(content: unknown[]) {
  const schema = getSchema(cabiEditorExtensions());
  let state = EditorState.create({ schema, doc: schema.nodeFromJSON({ type: "doc", content }) });
  let writes = 0;
  const editor = {
    schema,
    get state() {
      return state;
    },
    view: {
      dispatch(tr: Parameters<typeof state.apply>[0]) {
        state = state.apply(tr);
        writes++;
      },
    },
  } as unknown as Editor;
  return {
    editor,
    get doc() {
      return state.doc;
    },
    get writes() {
      return writes;
    },
  };
}
it("moves one paragraph in one transaction and preserves content", () => {
  const f = fixture([p("첫째"), p("둘째"), p("셋째")]),
    a = f.doc.child(0).nodeSize;
  expect(moveCabiBlock(f.editor, 0, a, true)).toBe(true);
  expect(f.doc.textContent).toBe("둘째첫째셋째");
  expect(f.writes).toBe(1);
});
it("moves nested list items with descendants and rejects dropping into itself", () => {
  const f = fixture([
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [p("부모"), { type: "bulletList", content: [{ type: "listItem", content: [p("자식")] }] }],
        },
        { type: "listItem", content: [p("다음")] },
      ],
    },
    p("밖"),
  ]);
  const item = f.doc.child(0).child(0),
    second = 1 + item.nodeSize;
  expect(moveCabiBlock(f.editor, 1, second, true)).toBe(true);
  expect(f.doc.textContent).toBe("다음부모자식밖");
  const before = f.doc;
  expect(moveCabiBlock(f.editor, 0, 1, false)).toBe(false);
  expect(f.doc).toBe(before);
});
it("moves a list item outside its list without losing child blocks", () => {
  const f = fixture([
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [p("항목"), { type: "bulletList", content: [{ type: "listItem", content: [p("하위")] }] }],
        },
      ],
    },
    p("본문"),
  ]);
  const end = f.doc.child(0).nodeSize;
  expect(moveCabiBlock(f.editor, 1, end, true)).toBe(true);
  expect(f.doc.textContent).toContain("항목하위");
  expect(f.doc.textContent).toContain("본문");
});
