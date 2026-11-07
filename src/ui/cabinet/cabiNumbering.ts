import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
export const CabiNumbering = Extension.create({
  name: "cabiNumbering",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            const out: Decoration[] = [];
            const walk = (node: PMNode, pos: number, path: number[]) => {
              node.forEach((child, offset, index) => {
                const at = pos + offset;
                if (node.type.name === "orderedList") {
                  const number = [...path, index + Number(node.attrs.start ?? 1)];
                  out.push(
                    Decoration.node(at, at + child.nodeSize, { "data-cabi-number": number.join("-") + "." }),
                  );
                  walk(child, at + 1, number);
                } else
                  walk(
                    child,
                    at + 1,
                    node.type.name === "bulletList" || node.type.name === "taskList" ? [] : path,
                  );
              });
            };
            walk(state.doc, 0, []);
            return DecorationSet.create(state.doc, out);
          },
        },
      }),
    ];
  },
});
