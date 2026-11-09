import { CabiNumbering } from "./cabiNumbering";
import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { openLink } from "../common/openLink";
import "../note/prosemirror.css";
import { CabiImageView } from "./CabiImageView";
import { Node, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { TextColor, LinkOpener } from "../note/editorExtensions";

const CabiImage = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      asset: { default: null, parseHTML: (el) => el.getAttribute("data-cabi-asset") },
      alt: { default: "" },
    };
  },
  parseHTML() {
    return [{ tag: "figure[data-cabi-asset]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["figure", mergeAttributes({ "data-cabi-asset": HTMLAttributes.asset }, HTMLAttributes)];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CabiImageView);
  },
});
export function cabiEditorExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https",
        isAllowedUri: (url) => /^https?:\/\//i.test(url),
        HTMLAttributes: { class: "note-link", target: null, rel: null },
      },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: true, cellMinWidth: 60, handleWidth: 6 } }),
    TextColor,
    LinkOpener,
    CabiImage,
    CabiNumbering,
    Extension.create({
      name: "cabiOrderedIndent",
      addKeyboardShortcuts() {
        return {
          Tab: () =>
            this.editor.isActive("table")
              ? false
              : this.editor.isActive("orderedList") && this.editor.commands.sinkListItem("listItem"),
          "Shift-Tab": () =>
            this.editor.isActive("table")
              ? false
              : this.editor.isActive("orderedList") && this.editor.commands.liftListItem("listItem"),
        };
      },
    }),
    Extension.create({
      name: "cabiLinkGuard",
      addProseMirrorPlugins() {
        return [
          new Plugin({
            props: {
              handleDOMEvents: {
                click(_view, event) {
                  const a = (event.target as Element).closest("a[href]");
                  if (!a) return false;
                  event.preventDefault();
                  if (event.ctrlKey || event.metaKey) void openLink(a.getAttribute("href") ?? "");
                  return true;
                },
              },
            },
          }),
        ];
      },
    }),
  ];
}
