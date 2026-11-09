import { V18, TABLE_ACTIONS as actions } from "../../shared/v18Strings";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { selectedRect } from "@tiptap/pm/tables";
import { moveCabiTableAxis } from "./cabiTableMoves";
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
  const menuRef = useRef<HTMLDivElement>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const suppressClick = useRef(0);
  useEffect(() => () => cleanup.current?.(), []);
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
      if (e.key === "Escape") {
        cleanup.current?.();
        suppressClick.current = performance.now() + 200;
        setMenu(null);
      }
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
  useEffect(() => {
    if (!menu) return;
    const outside = (e: PointerEvent) => {
      if (
        e.target instanceof Element &&
        (menuRef.current?.contains(e.target) || e.target.closest("[data-table-grip]"))
      )
        return;
      setMenu(null);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [menu]);
  const startDrag = (kind: "row" | "column", e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || disabled || !editor.isEditable) return;
    const source = selectedRect(editor.state),
      doc = editor.state.doc;
    const table = editor.view.nodeDOM(source.tableStart - 1);
    const tableElement =
      table instanceof Element ? (table.matches("table") ? table : table.querySelector("table")) : null;
    if (!tableElement) return;
    const from = kind === "row" ? source.top : source.left;
    let to = from,
      moved = false;
    const move = (event: PointerEvent) => {
      if (editor.state.doc !== doc) {
        cleanup.current?.();
        return;
      }
      if (Math.hypot(event.clientX - e.clientX, event.clientY - e.clientY) < 5) return;
      moved = true;
      setMenu(null);
      const cell = document
        .elementsFromPoint(event.clientX, event.clientY)
        .map((el) => el.closest("td,th"))
        .find((el) => el?.closest("table") === tableElement);
      if (!cell) return;
      const pos = editor.state.doc.resolve(editor.view.posAtDOM(cell, 0));
      for (let depth = pos.depth; depth > 0; depth--) {
        if (!["tableCell", "tableHeader"].includes(pos.node(depth).type.name)) continue;
        const target = source.map.findCell(pos.before(depth) - source.tableStart);
        to = kind === "row" ? target.top : target.left;
        break;
      }
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      cleanup.current = null;
    };
    const finish = () => {
      stop();
      if (!moved) return;
      suppressClick.current = performance.now() + 200;
      const state = useCabiChange.getState();
      if (state.locked || state.disconnected || !editor.isEditable || editor.state.doc !== doc || from === to)
        return;
      moveCabiTableAxis(editor, kind, from, to, source.tableStart);
      editor.view.focus();
    };
    const cancel = () => {
      suppressClick.current = performance.now() + 200;
      stop();
    };
    cleanup.current?.();
    cleanup.current = stop;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
  };
  if (disabled || !anchor) return null;
  return createPortal(
    <>
      <button
        data-table-grip
        className={styles.grip}
        aria-label={V18.rowMenu}
        title={V18.rowMenu}
        style={{ left: Math.max(0, anchor.left - 28), top: anchor.rowTop }}
        onMouseDown={(e) => e.preventDefault()}
        onPointerDown={(e) => startDrag("row", e)}
        onClick={() => {
          if (performance.now() >= suppressClick.current) setMenu(menu === "row" ? null : "row");
        }}
      >
        ⠿
      </button>
      <button
        data-table-grip
        className={styles.grip}
        aria-label={V18.columnMenu}
        title={V18.columnMenu}
        style={{ left: anchor.columnLeft + 12, top: Math.max(0, anchor.top - 28) }}
        onMouseDown={(e) => e.preventDefault()}
        onPointerDown={(e) => startDrag("column", e)}
        onClick={() => {
          if (performance.now() >= suppressClick.current) setMenu(menu === "column" ? null : "column");
        }}
      >
        ⠿
      </button>
      {menu && (
        <div
          ref={menuRef}
          className={styles.menu}
          role="menu"
          aria-label={V18.tableMenu}
          style={{
            left: Math.max(8, Math.min(innerWidth - 235, anchor.left)),
            top: Math.max(8, Math.min(innerHeight - 330, anchor.rowTop + 24)),
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              cleanup.current?.();
              suppressClick.current = performance.now() + 200;
              setMenu(null);
            }
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
