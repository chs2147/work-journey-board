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
      rowHeight: number;
      columnLeft: number;
      columnWidth: number;
    } | null>(null),
    [menu, setMenu] = useState<keyof typeof actions | null>(null),
    // 끄는 동안 표시(improve-v20-spec 5-3): 옮기는 행/열 바탕 + 들어갈 경계 선
    [guide, setGuide] = useState<{
      source: { left: number; top: number; width: number; height: number };
      line: { left: number; top: number; width: number; height: number } | null;
    } | null>(null),
    [flash, setFlash] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
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
      setAnchor({
        left: t.left,
        top: t.top,
        rowTop: r.top,
        rowHeight: r.height,
        columnLeft: r.left,
        columnWidth: r.width,
      });
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
    const count = kind === "row" ? source.map.height : source.map.width;
    // 행/열 i의 화면 위치(표 DOM 기준) — 행은 tr, 열은 첫 행의 i번째 칸
    const lineOf = (i: number) => {
      const t = tableElement.getBoundingClientRect();
      if (kind === "row") {
        const rows = tableElement.querySelectorAll(":scope > tbody > tr, :scope > tr");
        const r = rows[Math.min(i, rows.length - 1)]?.getBoundingClientRect();
        return r ? { start: r.top, end: r.bottom, t } : null;
      }
      const cells = tableElement.querySelector("tr")?.children;
      const c = cells?.[Math.min(i, (cells?.length ?? 1) - 1)]?.getBoundingClientRect();
      return c ? { start: c.left, end: c.right, t } : null;
    };
    const sourceRect = () => {
      const l = lineOf(from);
      if (!l) return null;
      return kind === "row"
        ? { left: l.t.left, top: l.start, width: l.t.width, height: l.end - l.start }
        : { left: l.start, top: l.t.top, width: l.end - l.start, height: l.t.height };
    };
    let to = from,
      moved = false;
    const move = (event: PointerEvent) => {
      if (editor.state.doc !== doc) {
        cleanup.current?.();
        return;
      }
      if (Math.hypot(event.clientX - e.clientX, event.clientY - e.clientY) < 5) return;
      if (!moved) document.body.classList.add(styles.grabbing!);
      moved = true;
      setMenu(null);
      const src = sourceRect();
      const cell = document
        .elementsFromPoint(event.clientX, event.clientY)
        .map((el) => el.closest("td,th"))
        .find((el) => el?.closest("table") === tableElement);
      if (!cell || !src) {
        to = from;
        setGuide(src ? { source: src, line: null } : null);
        return;
      }
      const pos = editor.state.doc.resolve(editor.view.posAtDOM(cell, 0));
      let index = -1;
      for (let depth = pos.depth; depth > 0; depth--) {
        if (!["tableCell", "tableHeader"].includes(pos.node(depth).type.name)) continue;
        const target = source.map.findCell(pos.before(depth) - source.tableStart);
        index = kind === "row" ? target.top : target.left;
        break;
      }
      if (index < 0) return;
      // 칸의 위/아래(왼/오른) 절반으로 앞/뒤 — 선 위치와 실제 결과가 같게
      const r = cell.getBoundingClientRect();
      const after =
        kind === "row" ? event.clientY > r.top + r.height / 2 : event.clientX > r.left + r.width / 2;
      const gap = Math.max(0, Math.min(count, index + (after ? 1 : 0)));
      to = gap > from ? gap - 1 : gap;
      if (to === from) {
        setGuide({ source: src, line: null });
        return;
      }
      const at = gap < count ? lineOf(gap) : lineOf(count - 1);
      if (!at) return;
      const edge = gap < count ? at.start : at.end;
      setGuide({
        source: src,
        line:
          kind === "row"
            ? { left: at.t.left - 4, top: edge - 1.5, width: at.t.width + 8, height: 3 }
            : { left: edge - 1.5, top: at.t.top - 4, width: 3, height: at.t.height + 8 },
      });
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
      document.body.classList.remove(styles.grabbing!);
      setGuide(null);
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
      // 옮겨진 행/열을 잠깐 강조
      requestAnimationFrame(() => {
        const dom = editor.view.nodeDOM(source.tableStart - 1);
        const t = dom instanceof Element ? (dom.matches("table") ? dom : dom.querySelector("table")) : null;
        if (!t) return;
        const tr = t.getBoundingClientRect();
        const rect =
          kind === "row"
            ? t.querySelectorAll("tr")[to]?.getBoundingClientRect()
            : t.querySelector("tr")?.children[to]?.getBoundingClientRect();
        if (!rect) return;
        setFlash(
          kind === "row"
            ? { left: tr.left, top: rect.top, width: tr.width, height: rect.height }
            : { left: rect.left, top: tr.top, width: rect.width, height: tr.height },
        );
        setTimeout(() => setFlash(null), 600);
      });
    };
    const cancel = () => {
      suppressClick.current = performance.now() + 200;
      to = from;
      stop();
    };
    cleanup.current?.();
    cleanup.current = stop;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
  };
  if (disabled || !anchor) return null;
  return createPortal(
    <>
      <button
        data-table-grip
        className={`${styles.axisGrip} ${styles.rowGrip}`}
        aria-label={V18.rowMenu}
        title={V18.rowMenu}
        data-testid="table-row-grip"
        style={{ left: anchor.left - 4, top: anchor.rowTop + anchor.rowHeight / 2 - 12 }}
        onMouseDown={(e) => e.preventDefault()}
        onPointerDown={(e) => startDrag("row", e)}
        onClick={() => {
          if (performance.now() >= suppressClick.current) setMenu(menu === "row" ? null : "row");
        }}
      >
        ⋮
      </button>
      <button
        data-table-grip
        className={`${styles.axisGrip} ${styles.columnGrip}`}
        aria-label={V18.columnMenu}
        title={V18.columnMenu}
        data-testid="table-column-grip"
        style={{ left: anchor.columnLeft + anchor.columnWidth / 2 - 12, top: anchor.top - 7 }}
        onMouseDown={(e) => e.preventDefault()}
        onPointerDown={(e) => startDrag("column", e)}
        onClick={() => {
          if (performance.now() >= suppressClick.current) setMenu(menu === "column" ? null : "column");
        }}
      >
        ⋯
      </button>
      {guide && <div className={styles.axisSource} data-testid="table-drag-source" style={guide.source} />}
      {guide?.line && <div className={styles.axisLine} data-testid="table-drop-line" style={guide.line} />}
      {flash && <div className={styles.axisFlash} style={flash} />}
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
