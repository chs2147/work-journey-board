import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { IconGrip } from "../common/icons";
import { blockAt, selectedBlock, moveCabiBlock, alterCabiBlock, type Block } from "./cabiBlockMoves";
import { TEXT_COLORS } from "../../domain/note";
import { CABI } from "../../shared/cabiStrings";
import { STR } from "../../shared/strings";
import { V17 } from "../../shared/v17Strings";
import { useCabiChange } from "./cabiService";
import styles from "./NoteBlockControls.module.css";
export function NoteBlockControls({
  editor,
  slashOpen,
  onCloseSlash,
  selectBlock,
}: {
  editor: Editor;
  slashOpen: boolean;
  onCloseSlash: () => void;
  selectBlock: (kind: string) => void;
}) {
  const [hover, setHover] = useState<Block | null>(null),
    [menu, setMenu] = useState(false),
    [bubble, setBubble] = useState<{ left: number; top: number } | null>(null),
    [open, setOpen] = useState<"colors" | "link" | null>(null),
    [href, setHref] = useState(""),
    [error, setError] = useState(""),
    [drop, setDrop] = useState<{ left: number; top: number; width: number } | null>(null);
  const drag = useRef<{ pos: number; doc: PMNode; token: string } | null>(null),
    target = useRef<{ pos: number; after: boolean } | null>(null),
    leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disabled = useCabiChange((s) => s.locked || s.disconnected);
  useEffect(() => {
    const refresh = () => {
      const selection = editor.state.selection;
      if (selection instanceof TextSelection && !selection.empty) {
        const a = editor.view.coordsAtPos(selection.from),
          b = editor.view.coordsAtPos(selection.to);
        setBubble({
          left: Math.max(10, Math.min(window.innerWidth - 285, a.left)),
          top: Math.max(10, Math.min(a.top, b.top) - 45),
        });
      } else {
        setBubble(null);
        setOpen(null);
      }
    };
    const hoverBlock = (e: MouseEvent) => {
      if (menu || drag.current) return;
      const found = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
      if (found) {
        const b = blockAt(editor, found.inside >= 0 ? Math.max(found.inside + 1, found.pos) : found.pos);
        if (b) setHover((old) => (old?.pos === b.pos && old.rect.top === b.rect.top ? old : b));
      }
    };
    const leave = () => {
      leaveTimer.current = setTimeout(() => {
        if (!menu && !drag.current) setHover(null);
      }, 250);
    };
    const over = (e: DragEvent) => {
      if (!drag.current) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";
      const found = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
      if (!found) return;
      const b = blockAt(editor, found.pos);
      if (!b) return;
      const after = e.clientY > (b.rect.top + b.rect.bottom) / 2;
      target.current = { pos: b.pos, after };
      setDrop({ left: b.rect.left, top: after ? b.rect.bottom : b.rect.top, width: b.rect.width });
    };
    const finish = () => {
      editor.view.dom
        .querySelectorAll(`.${styles.dragSource}`)
        .forEach((el) => el.classList.remove(styles.dragSource!));
      drag.current = null;
      target.current = null;
      setDrop(null);
    };
    const dropped = (e: DragEvent) => {
      const d = drag.current,
        t = target.current;
      if (!d || e.dataTransfer?.getData("application/x-cabi-block") !== d.token) return;
      e.preventDefault();
      e.stopPropagation();
      if (t && editor.state.doc === d.doc && !disabled) moveCabiBlock(editor, d.pos, t.pos, t.after);
      finish();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu(false);
        setOpen(null);
        finish();
        onCloseSlash();
      }
      if (e.shiftKey && e.key === "F10") {
        e.preventDefault();
        const b = selectedBlock(editor);
        if (b) {
          setHover(b);
          setMenu(true);
        }
      }
    };
    const scroll = (e: Event) => {
      if (e.target instanceof Element && e.target.closest(`[data-cabi-block-menu]`)) return;
      setMenu(false);
      setOpen(null);
      if (!drag.current) setHover(null);
      setBubble(null);
    };
    editor.on("selectionUpdate", refresh);
    editor.on("transaction", refresh);
    editor.view.dom.addEventListener("mousemove", hoverBlock);
    editor.view.dom.addEventListener("mouseleave", leave);
    editor.view.dom.addEventListener("dragover", over);
    editor.view.dom.addEventListener("drop", dropped, true);
    editor.view.dom.addEventListener("keydown", key);
    window.addEventListener("dragend", finish);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", scroll);
    return () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
      editor.off("selectionUpdate", refresh);
      editor.off("transaction", refresh);
      editor.view.dom.removeEventListener("mousemove", hoverBlock);
      editor.view.dom.removeEventListener("mouseleave", leave);
      editor.view.dom.removeEventListener("dragover", over);
      editor.view.dom.removeEventListener("drop", dropped, true);
      editor.view.dom.removeEventListener("keydown", key);
      window.removeEventListener("dragend", finish);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", scroll);
    };
  }, [editor, menu, disabled, onCloseSlash]);
  const active = hover ?? (slashOpen ? selectedBlock(editor) : null);
  if (disabled) return null;
  const close = () => {
    setMenu(false);
    onCloseSlash();
  };
  const menuPos = active
    ? {
        left: Math.max(8, Math.min(window.innerWidth - 230, active.rect.left - 30)),
        top: Math.max(8, Math.min(window.innerHeight - 470, active.rect.top + 25)),
      }
    : undefined;
  return createPortal(
    <>
      {hover && (
        <button
          className={styles.grip}
          aria-label={V17.grip}
          title={V17.grip}
          data-testid="cabi-block-grip"
          data-block={hover.node.type.name}
          style={{ left: Math.max(3, hover.rect.left - 29), top: hover.rect.top }}
          draggable
          onPointerEnter={() => {
            if (leaveTimer.current) clearTimeout(leaveTimer.current);
          }}
          onClick={() => {
            if (drag.current) return;
            editor.view.dispatch(
              editor.state.tr
                .setSelection(NodeSelection.create(editor.state.doc, hover.pos))
                .setMeta("addToHistory", false),
            );
            setMenu(!menu);
          }}
          onDragStart={(e) => {
            if (leaveTimer.current) clearTimeout(leaveTimer.current);
            const token = crypto.randomUUID();
            editor.view.dispatch(
              editor.state.tr
                .setSelection(NodeSelection.create(editor.state.doc, hover.pos))
                .setMeta("addToHistory", false),
            );
            drag.current = { pos: hover.pos, doc: editor.state.doc, token };
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("application/x-cabi-block", token);
            e.dataTransfer.setData("text/plain", hover.node.textContent);
            const dom = editor.view.nodeDOM(hover.pos);
            if (dom instanceof Element) {
              e.dataTransfer.setDragImage(dom, 0, 0);
              // 끄는 동안 원래 블록(표 포함)을 반투명으로(improve-v20-spec 5-1)
              requestAnimationFrame(() => dom.classList.add(styles.dragSource!));
            }
            setMenu(false);
          }}
        >
          <IconGrip />
        </button>
      )}
      {(menu || slashOpen) && active && (
        <div
          data-cabi-block-menu
          className={styles.menu}
          role="menu"
          aria-label={CABI.blockMenu}
          style={menuPos}
        >
          {Object.entries(CABI.blocks).map(([kind, label]) => (
            <button
              key={kind}
              role="menuitem"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                selectBlock(kind);
                close();
              }}
            >
              {label}
            </button>
          ))}
          <hr />
          {(["up", "down", "copy", "delete"] as const).map((action, i) => (
            <button
              role="menuitem"
              key={action}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                alterCabiBlock(editor, action);
                close();
              }}
            >
              {[CABI.moveUp, CABI.moveDown, CABI.duplicateBlock, CABI.deleteBlock][i]}
            </button>
          ))}
          <button role="menuitem" onClick={close}>
            {V17.close}
          </button>
        </div>
      )}
      {bubble && !menu && !slashOpen && (
        <div
          className={styles.bubble}
          role="toolbar"
          aria-label={CABI.textColor}
          data-below={bubble.top < 160}
          style={bubble}
          onMouseDown={(e) => {
            if ((e.target as Element).closest("button")) e.preventDefault();
          }}
        >
          {(["bold", "italic", "strike", "code"] as const).map((kind, i) => (
            <button
              key={kind}
              aria-label={[CABI.bold, CABI.italic, CABI.strike, CABI.code][i]}
              aria-pressed={editor.isActive(kind)}
              onClick={() => {
                const c = editor.chain().focus();
                if (kind === "bold") c.toggleBold().run();
                if (kind === "italic") c.toggleItalic().run();
                if (kind === "strike") c.toggleStrike().run();
                if (kind === "code") c.toggleCode().run();
              }}
            >
              {["B", "I", "S", "<>"][i]}
            </button>
          ))}
          <button
            aria-label={V17.color}
            className={styles.colorButton}
            onClick={() => setOpen(open === "colors" ? null : "colors")}
          >
            A
          </button>
          <button
            aria-label={V17.link}
            onClick={() => {
              setHref(editor.getAttributes("link").href ?? "https://");
              setOpen(open === "link" ? null : "link");
            }}
          >
            ↗
          </button>
          {open === "colors" && (
            <div className={styles.colors} role="group" aria-label={CABI.textColor}>
              <button
                aria-label={STR.note.colors.default}
                onClick={() => {
                  editor.chain().focus().unsetMark("textColor").run();
                  setOpen(null);
                }}
              >
                A
              </button>
              {TEXT_COLORS.map((c) => (
                <button
                  key={c}
                  className={"note-c-" + c}
                  aria-label={STR.note.colors[c]}
                  aria-pressed={editor.getAttributes("textColor").color === c}
                  onClick={() => {
                    editor.chain().focus().setMark("textColor", { color: c }).run();
                    setOpen(null);
                  }}
                >
                  A
                </button>
              ))}
            </div>
          )}
          {open === "link" && (
            <div className={styles.link} role="group" aria-label={V17.link}>
              <input aria-label={V17.linkAddress} value={href} onChange={(e) => setHref(e.target.value)} />
              <button
                onClick={() => {
                  if (!/^https?:\/\//i.test(href)) {
                    setError(V17.badLink);
                    return;
                  }
                  editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
                  setOpen(null);
                  setError("");
                }}
              >
                {V17.apply}
              </button>
              <button
                onClick={() => {
                  editor.chain().focus().unsetLink().run();
                  setOpen(null);
                }}
              >
                {V17.removeLink}
              </button>
              {error && <p role="alert">{error}</p>}
            </div>
          )}
        </div>
      )}
      {drop && <div className={styles.drop} style={drop} aria-hidden="true" />}
    </>,
    document.body,
  );
}
