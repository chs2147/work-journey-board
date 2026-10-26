// 주간 메모(weekly-note-spec 3절): 보드 아래 도크(경계선 끌어 높이 조절, 접기, 크게 보기) 또는
// 오늘 뷰 왼쪽 판(improve-1026-spec 8-2, variant="side"). 머리 기능 단추는 아이콘(11-3), 배율은 값 표시(11-1).
// 판(편집기 포함)은 늦게 불러온다.
import { lazy, Suspense, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { ZOOM_STEPS } from "../../domain/noteZoom";
import { STR } from "../../shared/strings";
import {
  IconChevronDown,
  IconChevronUp,
  IconExpand,
  IconFit,
  IconImage,
  IconMinus,
  IconPlus,
  IconShrink,
  IconTextBox,
} from "../common/icons";
import { ACCEPT_TYPES } from "./imageProcess";
import {
  addBoxBelow,
  addImages,
  pastePlace,
  requestFit,
  setCollapsed,
  setDockAuto,
  setDockHeight,
  setExpanded,
  setZoom,
  useNote,
  zoomStep,
} from "./noteStore";
import styles from "./Note.module.css";

const NoteCanvas = lazy(() => import("./NoteCanvas"));

interface Props {
  /** dock = 보드 아래 도크, side = 오늘 뷰 왼쪽(늘 펼침, 높이는 부모가 정함) */
  variant?: "dock" | "side";
}

/** 메모 안 배율 단축키: Ctrl+= / Ctrl+- / Ctrl+0(100%) / Ctrl+1(화면에 맞춤) */
function onZoomKey(e: KeyboardEvent<HTMLElement>) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.nativeEvent.isComposing) return;
  const code = e.code;
  if (code === "Equal" || code === "NumpadAdd") zoomStep(1);
  else if (code === "Minus" || code === "NumpadSubtract") zoomStep(-1);
  else if (code === "Digit0" || code === "Numpad0") setZoom(1);
  else if (code === "Digit1" || code === "Numpad1") requestFit();
  else return;
  e.preventDefault();
}

function IconButton({
  label,
  title,
  onClick,
  pressed,
  children,
}: {
  label: string;
  title: string;
  onClick(): void;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={styles.iconButton}
      aria-label={label}
      title={title}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function NoteDock({ variant = "dock" }: Props) {
  const side = variant === "side";
  // 대기 상자(글자를 치기 전 커서 자리)는 세지 않는다
  const boxes = useNote((s) => s.doc.boxes.filter((b) => b.id !== s.pendingId).length);
  const images = useNote((s) => s.doc.boxes.filter((b) => b.kind === "image").length);
  const busy = useNote((s) => s.busy);
  const fileRef = useRef<HTMLInputElement>(null);
  const legacy = useNote((s) => s.legacy);
  const height = useNote((s) => s.dockHeight);
  const auto = useNote((s) => s.dockAuto);
  const zoom = useNote((s) => s.zoom);
  const dockRef = useRef<HTMLElement>(null);
  const collapsed = useNote((s) => s.collapsed) && !side;
  const expanded = useNote((s) => s.expanded) && !side;

  /** 경계선 끌기: 위로 끌면 메모가 커진다 */
  const startResize = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || collapsed || expanded) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    // 자동 높이였으면 지금 보이는 높이에서 시작, 끌면 그 높이로 고정
    const [sy, h0] = [e.clientY, auto ? (dockRef.current?.offsetHeight ?? height) : height];
    let moved = false;
    const move = (ev: globalThis.PointerEvent) => {
      if (!moved && Math.abs(ev.clientY - sy) < 2) return;
      moved = true;
      useNote.setState({ dockHeight: Math.max(120, h0 + sy - ev.clientY), dockAuto: false });
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      if (moved) setDockHeight(useNote.getState().dockHeight);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const pickImage = () => fileRef.current?.click();

  return (
    <section
      ref={dockRef}
      className={[
        styles.dock,
        side ? styles.dockSide : "",
        expanded ? styles.dockExpanded : "",
        auto && !collapsed && !expanded && !side ? styles.dockAuto : "",
      ].join(" ")}
      style={collapsed || expanded || auto || side ? undefined : { height }}
      data-dock-mode={
        side ? "side" : collapsed ? "collapsed" : expanded ? "expanded" : auto ? "auto" : "fixed"
      }
      aria-label={STR.note.title}
      data-note-root
      data-testid="note-dock"
      onKeyDown={(e) => {
        onZoomKey(e);
        // [크게 보기]는 Esc로 돌아온다(상자가 Esc를 먼저 쓰면 그쪽 동작)
        if (e.key === "Escape" && expanded && !e.defaultPrevented) setExpanded(false);
      }}
    >
      {!collapsed && !expanded && !side && (
        <button
          type="button"
          className={styles.splitter}
          aria-label={STR.note.resizeDock}
          title={STR.note.resizeDock}
          tabIndex={-1}
          onPointerDown={startResize}
          onDoubleClick={setDockAuto}
        />
      )}
      {/* 머리 빈 곳을 두 번 누르면 보드 우선 자동 높이로 */}
      <div
        className={styles.head}
        title={collapsed || expanded || side ? undefined : STR.note.autoHeightHint}
        onDoubleClick={(e) => {
          if ((e.target as Element).closest("button, input, select") || collapsed || expanded || side) return;
          setDockAuto();
        }}
      >
        <h2 className={styles.title}>{STR.note.title}</h2>
        <span className={styles.counts} data-testid="note-counts">
          {STR.note.counts(boxes, images)}
        </span>
        {busy && (
          <span className={styles.busy} role="status">
            {STR.note.imageBusy}
          </span>
        )}
        {legacy && <span className={styles.legacy}>{STR.note.legacy}</span>}
        <span className={styles.spacer} />
        {!collapsed && (
          <div className={styles.zoomGroup} role="group" aria-label={STR.note.zoomLevel}>
            <IconButton label={STR.note.zoomOut} title={STR.note.zoomOutTitle} onClick={() => zoomStep(-1)}>
              <IconMinus />
            </IconButton>
            <select
              className={styles.zoomSelect}
              aria-label={STR.note.zoomLevel}
              title={STR.note.zoomLevelTitle}
              value={String(zoom)}
              data-testid="note-zoom"
              onChange={(e) => setZoom(Number(e.target.value))}
            >
              {(ZOOM_STEPS.includes(zoom as (typeof ZOOM_STEPS)[number])
                ? [...ZOOM_STEPS]
                : [...ZOOM_STEPS, zoom].sort((a, b) => a - b)
              ).map((z) => (
                <option key={z} value={String(z)}>
                  {STR.note.percent(z)}
                </option>
              ))}
            </select>
            <IconButton label={STR.note.zoomIn} title={STR.note.zoomInTitle} onClick={() => zoomStep(1)}>
              <IconPlus />
            </IconButton>
          </div>
        )}
        {!collapsed && (
          <IconButton label={STR.note.fit} title={STR.note.fitTitle} onClick={requestFit}>
            <IconFit />
          </IconButton>
        )}
        {!collapsed && <span className={styles.headSep} aria-hidden="true" />}
        {!collapsed && (
          <IconButton label={STR.note.addBox} title={STR.note.addBoxTitle} onClick={() => addBoxBelow()}>
            <IconTextBox />
          </IconButton>
        )}
        {!collapsed && (
          <IconButton label={STR.note.addImage} title={STR.note.addImageTitle} onClick={pickImage}>
            <IconImage />
          </IconButton>
        )}
        <input
          ref={fileRef}
          type="file"
          className={styles.fileInput}
          accept={ACCEPT_TYPES.join(",")}
          multiple
          tabIndex={-1}
          aria-label={STR.note.addImage}
          data-testid="note-image-input"
          onChange={(e) => {
            const files = [...(e.currentTarget.files ?? [])];
            e.currentTarget.value = "";
            if (files.length) void addImages(files, pastePlace());
          }}
        />
        {!collapsed && !side && (
          <IconButton
            label={expanded ? STR.note.shrink : STR.note.expand}
            title={expanded ? STR.note.shrink : STR.note.expand}
            onClick={() => setExpanded(!expanded)}
            pressed={expanded}
          >
            {expanded ? <IconShrink /> : <IconExpand />}
          </IconButton>
        )}
        {!side && (
          <button
            type="button"
            className={styles.iconButton}
            aria-label={collapsed ? STR.note.open : STR.note.collapse}
            title={collapsed ? STR.note.open : STR.note.collapse}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <IconChevronUp /> : <IconChevronDown />}
          </button>
        )}
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
