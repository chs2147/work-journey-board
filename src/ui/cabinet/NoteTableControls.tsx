import { V18, TABLE_ACTIONS as actions } from "../../shared/v18Strings";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { useCabiChange } from "./cabiService";
import styles from "./NoteBlockControls.module.css";
export function NoteTableControls({ editor }: { editor: Editor }) {
  const [anchor, setAnchor] = useState<{
      left: number;
      top: number;
      rowTop: number;
      columnLeft: number;
    } | null>(null),
    [menu, setMenu] = useState<keyof typeof actions | null>(null);
  const disabled = useCabiChange((s) => s.locked || s.disconnected);
  useEffect(() => {
    const refresh = () => {
      if (!editor.isActive("table")) {
        setAnchor(null);
        setMenu(null);
        return;
      }
      const dom = editor.view.domAtPos(editor.state.selection.from).node;
      const el = dom instanceof Element ? dom : dom.parentElement;
      const cell = el?.closest("td,th"),
        table = cell?.closest("table");
      if (!cell || !table) return;
      const r = cell.getBoundingClientRect(),
        t = table.getBoundingClientRect();
      setAnchor({ left: t.left, top: t.top, rowTop: r.top, columnLeft: r.left });
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
      if (e.shiftKey && e.key === "F10" && editor.isActive("table")) {
        e.preventDefault();
        e.stopImmediatePropagation();
        refresh();
        setMenu("row");
      }
    };
    editor.view.dom.addEventListener("keydown", key, true);
    editor.on("selectionUpdate", refresh);
    editor.on("transaction", refresh);
    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", refresh, true);
    return () => {
      editor.view.dom.removeEventListener("keydown", key, true);
      editor.off("selectionUpdate", refresh);
      editor.off("transaction", refresh);
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", refresh, true);
    };
  }, [editor]);
  if (disabled || !anchor) return null;
  return createPortal(
    <>
      <button
        className={styles.grip}
        aria-label={V18.rowMenu}
        title={V18.rowMenu}
        style={{ left: Math.max(0, anchor.left - 28), top: anchor.rowTop }}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setMenu(menu === "row" ? null : "row")}
      >
        ⠿
      </button>
      <button
        className={styles.grip}
        aria-label={V18.columnMenu}
        title={V18.columnMenu}
        style={{ left: anchor.columnLeft + 12, top: Math.max(0, anchor.top - 28) }}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setMenu(menu === "column" ? null : "column")}
      >
        ⠿
      </button>
      {menu && (
        <div
          className={styles.menu}
          role="menu"
          aria-label={V18.tableMenu}
          style={{
            left: Math.max(8, Math.min(innerWidth - 235, anchor.left)),
            top: Math.max(8, Math.min(innerHeight - 330, anchor.rowTop + 24)),
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setMenu(null);
          }}
        >
          {[...actions[menu], ...actions.table].map(([command, label]) => (
            <button
              role="menuitem"
              key={command}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (!editor.isActive("table")) return setMenu(null);
                const pos = editor.state.doc.resolve(editor.state.selection.from);
                let last = false;
                for (let d = pos.depth; d > 0; d--) {
                  const n = pos.node(d);
                  if (command === "deleteRow" && n.type.name === "table") last = n.childCount === 1;
                  if (command === "deleteColumn" && n.type.name === "tableRow") last = n.childCount === 1;
                }
                if ((last || command === "deleteTable") && !window.confirm(V18.tableDelete)) return;
                const chain = editor.chain().focus();
                chain[command]().run();
                setMenu(null);
              }}
            >
              {label}
            </button>
          ))}
          <button role="menuitem" onClick={() => setMenu(null)}>
            닫기
          </button>
        </div>
      )}
    </>,
    document.body,
  );
}
