import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
export type Block = { pos: number; node: PMNode; rect: DOMRect };
export function blockAt(editor: Editor, pos: number): Block | null {
  const sel = editor.state.doc.resolve(Math.max(0, Math.min(pos, editor.state.doc.content.size)));
  let depth = 1;
  for (let d = sel.depth; d >= 1; d--)
    if (["listItem", "taskItem"].includes(sel.node(d).type.name)) {
      depth = d;
      break;
    }
  const before = sel.depth ? sel.before(depth) : pos,
    node = editor.state.doc.nodeAt(before),
    dom = editor.view.nodeDOM(before);
  if (!node || !(dom instanceof Element)) return null;
  return { pos: before, node, rect: dom.getBoundingClientRect() };
}
export function selectedBlock(editor: Editor) {
  const s = editor.state.selection;
  if (s instanceof NodeSelection) {
    const dom = editor.view.nodeDOM(s.from);
    return dom instanceof Element ? { pos: s.from, node: s.node, rect: dom.getBoundingClientRect() } : null;
  }
  return blockAt(editor, s.from);
}
export function moveCabiBlock(editor: Editor, from: number, to: number, after: boolean) {
  const node = editor.state.doc.nodeAt(from),
    target = editor.state.doc.nodeAt(to);
  if (!node || !target || (to >= from && to < from + node.nodeSize)) return false;
  let payload = node;
  const sourceParent = editor.state.doc.resolve(from).parent,
    targetParent = editor.state.doc.resolve(to).parent;
  if (["listItem", "taskItem"].includes(node.type.name) && targetParent.type.name === "doc")
    payload = sourceParent.type.create(sourceParent.attrs, [node]);
  if (
    ["listItem", "taskItem"].includes(node.type.name) &&
    ["bulletList", "orderedList", "taskList"].includes(targetParent.type.name)
  ) {
    const item = editor.schema.nodes[targetParent.type.name === "taskList" ? "taskItem" : "listItem"];
    if (item) payload = item.create(node.attrs, node.content);
  }
  try {
    const tr = editor.state.tr.deleteRange(from, from + node.nodeSize),
      at = tr.mapping.map(to + (after ? target.nodeSize : 0));
    tr.replaceRange(at, at, new Slice(Fragment.from(payload), 0, 0));
    editor.view.dispatch(tr.scrollIntoView());
    return true;
  } catch {
    return false;
  }
}
export function alterCabiBlock(editor: Editor, action: "up" | "down" | "copy" | "delete") {
  const block = selectedBlock(editor);
  if (!block) return;
  const { pos, node } = block,
    tr = editor.state.tr;
  if (action === "copy") tr.insert(pos + node.nodeSize, node);
  else if (action === "delete") tr.deleteRange(pos, pos + node.nodeSize);
  else {
    const resolved = editor.state.doc.resolve(pos),
      index = resolved.index(),
      parent = resolved.parent,
      base = resolved.start();
    if (action === "up" && index > 0) {
      const prev = parent.child(index - 1);
      moveCabiBlock(editor, pos, pos - prev.nodeSize, false);
    } else if (action === "down" && index + 1 < parent.childCount) {
      let next = base;
      for (let i = 0; i <= index; i++) next += parent.child(i).nodeSize;
      moveCabiBlock(editor, pos, next, true);
    }
    return;
  }
  editor.view.dispatch(tr.scrollIntoView());
  editor.commands.focus();
}
