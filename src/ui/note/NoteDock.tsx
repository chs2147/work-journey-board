// 보드 아래 메모 도크(weekly-note-spec 3절): 경계선 끌어 높이 조절, [▾] 접기, [크게 보기]. 판(편집기 포함)은 늦게 불러온다.
import { lazy, Suspense, type PointerEvent } from "react";
import { STR } from "../../shared/strings";
import { addBoxBelow, setCollapsed, setDockHeight, setExpanded, useNote } from "./noteStore";
import styles from "./Note.module.css";

const NoteCanvas = lazy(() => import("./NoteCanvas"));

export function NoteDock() {
  const boxes = useNote((s) => s.doc.boxes.length);
  const legacy = useNote((s) => s.legacy);
  const height = useNote((s) => s.dockHeight);
  const collapsed = useNote((s) => s.collapsed);
  const expanded = useNote((s) => s.expanded);

  /** 경계선 끌기: 위로 끌면 메모가 커진다 */
  const startResize = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || collapsed || expanded) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const [sy, h0] = [e.clientY, height];
    const move = (ev: globalThis.PointerEvent) =>
      useNote.setState({ dockHeight: Math.max(120, h0 + sy - ev.clientY) });
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      setDockHeight(useNote.getState().dockHeight);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  return (
    <section
      className={`${styles.dock} ${expanded ? styles.dockExpanded : ""}`}
      style={collapsed || expanded ? undefined : { height }}
      aria-label={STR.note.title}
      data-note-root
      data-testid="note-dock"
      onKeyDown={(e) => {
        // [크게 보기]는 Esc로 돌아온다(상자가 Esc를 먼저 쓰면 그쪽 동작)
        if (e.key === "Escape" && expanded && !e.defaultPrevented) setExpanded(false);
      }}
    >
      {!collapsed && !expanded && (
        <button
          type="button"
          className={styles.splitter}
          aria-label={STR.note.resizeDock}
          title={STR.note.resizeDock}
          tabIndex={-1}
          onPointerDown={startResize}
        />
      )}
      <div className={styles.head}>
        <h2 className={styles.title}>{STR.note.title}</h2>
        <span className={styles.counts} data-testid="note-counts">
          {STR.note.counts(boxes)}
        </span>
        {legacy && <span className={styles.legacy}>{STR.note.legacy}</span>}
        <span className={styles.spacer} />
        {!collapsed && (
          <button
            type="button"
            className={styles.headButton}
            title={STR.note.addBoxTitle}
            onClick={() => addBoxBelow()}
          >
            {STR.note.addBox}
          </button>
        )}
        {!collapsed && (
          <button
            type="button"
            className={styles.headButton}
            aria-pressed={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? STR.note.shrink : STR.note.expand}
          </button>
        )}
        <button
          type="button"
          className={styles.headButton}
          aria-label={collapsed ? STR.note.open : STR.note.collapse}
          title={collapsed ? STR.note.open : STR.note.collapse}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? "▴" : "▾"}
        </button>
      </div>
      {!collapsed && (
        <div className={styles.body}>
          <Suspense fallback={<div className={styles.loading}>…</div>}>
            <NoteCanvas />
          </Suspense>
        </div>
      )}
    </section>
  );
}
