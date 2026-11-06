import "../note/prosemirror.css";
import { CabiImageView } from "./CabiImageView";
import { Extension, Node, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Plugin, NodeSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { TextColor, LinkOpener } from "../note/editorExtensions";
import { CABI } from "../../shared/cabiStrings";
import { openLink } from "../common/openLink";
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
const BlockGrips = Extension.create({
  name: "cabiBlockGrips",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            const handles: Decoration[] = [];
            state.doc.forEach((_node, pos) =>
              handles.push(
                Decoration.widget(
                  pos,
                  () => {
                    const el = document.createElement("span");
                    el.className = "cabi-block-grip";
                    el.textContent = "⋮⋮";
                    el.draggable = true;
                    el.contentEditable = "false";
                    el.dataset.cabiBlock = String(pos);
                    el.title = CABI.moveUp + " / " + CABI.moveDown;
                    return el;
                  },
                  { side: -1, ignoreSelection: true },
                ),
              ),
            );
            return DecorationSet.create(state.doc, handles);
          },
          handleDOMEvents: {
            dragstart(view, event) {
              const handle = (event.target as Element).closest<HTMLElement>("[data-cabi-block]");
              if (!handle) return false;
              const pos = Number(handle.dataset.cabiBlock);
              view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
              return false;
            },
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
    TableKit.configure({ table: { resizable: true } }),
    TextColor,
    LinkOpener,
    CabiImage,
    BlockGrips,
  ];
}
