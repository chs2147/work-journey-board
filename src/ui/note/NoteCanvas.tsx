// 메모 판(weekly-note-spec 4절, 시안 A): 점 격자 위 자유 배치 텍스트 상자. 빈 곳 클릭 = 새 상자, 위 막대 끌기 = 이동,
// 오른쪽 손잡이 = 폭, Esc = 선택(방향키·Delete), 편집 중에는 서식 막대. 편집기(TipTap)는 이 조각과 함께 처음 열 때만 불러온다.
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { anchoredScroll, canvasSize, fitZoom, wheelZoom } from "../../domain/noteZoom";
import {
  boxName,
  boxText,
  FONT_SIZES,
  NOTE_BG,
  TEXT_COLORS,
  type ImageBox,
  type NoteDoc,
  type PMNode,
  type TextBox,
} from "../../domain/note";
import { STR } from "../../shared/strings";
import { reportError, toast } from "../board/boardStore";
import { useAppStore } from "../common/appStore";
import { onSelectedBoxKey, startBoxDrag, useBoxFrame } from "./boxShared";
import { noteExtensions } from "./editorExtensions";
import { ImageBoxView, ImagePreview } from "./ImageBoxView";
import { Minimap } from "./Minimap";
import { LinkBoxView } from "./LinkBoxView";
import { LinkStrip } from "./LinkStrip";
import { EdgeKnobs, EdgeMenuItems } from "./EdgeBoxParts";
import { useEdgeCount } from "./edgeHooks";
import { EdgeLayer, EdgeToolbar } from "./EdgeLayer";
import { linkCandidates } from "./edgeHooks";
import { useRowDrag } from "../board/rowDrag";
import { singleUrl } from "../../domain/links";
import { openLink } from "../common/openLink";
import {
  addBox,
  addBoxBelow,
  addImages,
  addLinkBox,
  pastePlace,
  bringToFront,
  cancelLinking,
  connect,
  finishLinking,
  selectEdge,
  setLinkTarget,
  setZoom,
  takeZoomAnchor,
  deleteBox,
  duplicateBox,
  endEditing,
  selectBox,
  sendToBack,
  setBoxBg,
  setEditing,
  unlinkBox,
  updateContent,
  useNote,
} from "./noteStore";
import "./prosemirror.css";
import styles from "./Note.module.css";

const boxNameOf = (doc: NoteDoc, id: string) => {
  const b = doc.boxes.find((x) => x.id === id);
  return b ? boxName(b) : "";
};

/** 판 아래·오른쪽에 늘 남겨 둘 빈 공간(이어 붙이기용, 스펙 4-1) */
const ROOM = { right: 40, bottom: 160 };

/** 글자를 치는 중인 곳(Space가 글자인 곳) */
const isEditable = (el: Element | null) => !!el?.closest('input, textarea, select, [contenteditable="true"]');

export default function NoteCanvas() {
  const doc = useNote((s) => s.doc);
  const editingId = useNote((s) => s.editingId);
  const selectedId = useNote((s) => s.selectedId);
  const pendingId = useNote((s) => s.pendingId);
  const zoom = useNote((s) => s.zoom);
  const fitRequest = useNote((s) => s.fitRequest);
  const linking = useNote((s) => s.linking);
  // 보드 행을 이 판에 끌어 오는 중이면 놓을 자리(improve-1026v2-spec 4절)
  const rowDrop = useRowDrag((s) => s.drag?.note ?? null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  /** Space를 누르고 있어 끌면 판이 움직이는 상태 / 지금 끌어 옮기는 중 */
  const [panReady, setPanReady] = useState(false);
  const [panning, setPanning] = useState(false);
  const spaceDown = useRef(false);
  const hover = useRef(false);
  const prevZoom = useRef(zoom);
  const fitPending = useRef(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  // 상자마다 편집기 — 서식 막대가 편집 중인 상자의 편집기를 쓴다
  const [editors, setEditors] = useState<Record<string, Editor>>({});
  const onEditor = (id: string, ed: Editor | null) =>
    setEditors((m) => {
      if (ed) return m[id] === ed ? m : { ...m, [id]: ed };
      if (!(id in m)) return m;
      const { [id]: _gone, ...rest } = m; // eslint-disable-line @typescript-eslint/no-unused-vars
      return rest;
    });

  // 판 크기(문서 px) — 축소해도 보이는 영역을 다 채워 빈 곳을 누를 수 있게(improve-1026-spec 11-2)
  const size = canvasSize(doc.boxes, view, zoom, ROOM);
  const editingBox = doc.boxes.find((b): b is TextBox => b.id === editingId && b.kind === "text");
  const editingEditor = editingId ? editors[editingId] : undefined;
  const previewBox = doc.boxes.find((b): b is ImageBox => b.id === previewId && b.kind === "image");

  // 캡처 붙여넣기(Ctrl+V): 메모 도크 안 어디서든. 글이 함께 있으면 편집기가 글로 붙인다(스펙 4-3·4-4)
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as Element | null;
      if (!target?.closest?.("[data-note-root]") || !e.clipboardData) return;
      const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
      const text = e.clipboardData.getData("text/plain");
      // 주소 하나를 판에(빈 곳의 커서 자리·선택한 상자 상태) 붙이면 링크 카드(improve-1026-spec 10-1).
      // 글이 있는 상자 안에 붙이면 편집기가 글 속 링크로 만든다
      const url = singleUrl(text);
      if (url && !files.length) {
        const st = useNote.getState();
        const inText = st.editingId && st.editingId !== st.pendingId;
        if (inText) return;
        e.preventDefault();
        e.stopPropagation();
        addLinkBox(url, pastePlace());
        return;
      }
      if (!files.length || text.trim()) return;
      e.preventDefault();
      e.stopPropagation();
      void addImages(files, pastePlace());
    };
    document.addEventListener("paste", onPaste, true);
    return () => document.removeEventListener("paste", onPaste, true);
  }, []);

  // 키보드로 잇는 중(note-relation-spec 2-2): Tab·번호·Enter·Esc. 상자 단축키(방향키·Delete)는 잠시 쉰다
  const keysFrom = linking?.mode === "keys" ? linking.from : null;
  useEffect(() => {
    if (!keysFrom) return;
    const st = () => useNote.getState();
    const list = () => linkCandidates(st().doc, keysFrom, st().pendingId);
    // 처음엔 가장 가까운 상자
    if (!st().linking?.target) setLinkTarget(list()[0]?.id ?? null);
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.isComposing || isEditable(document.activeElement)) return;
      const cands = list();
      const cur = cands.findIndex((b) => b.id === st().linking?.target);
      if (e.key === "Tab") {
        const n = cands.length;
        if (n) setLinkTarget(cands[(cur + (e.shiftKey ? n - 1 : 1) + n) % n]!.id);
      } else if (/^Digit[1-9]$/.test(e.code) && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const b = cands[Number(e.code.slice(5)) - 1];
        if (b) setLinkTarget(b.id);
      } else if (e.key === "Enter") finishLinking();
      else if (e.key === "Escape") cancelLinking();
      else if (!e.key.startsWith("Arrow") && e.key !== "Delete" && e.key !== "Backspace" && e.code !== "KeyL")
        return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [keysFrom]);

  // 보이는 영역 크기
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setView({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 배율이 바뀌면 커서(또는 가운데) 아래 문서 위치를 그대로 둔다. [화면에 맞춤]이면 왼쪽 위로
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || prevZoom.current === zoom) return;
    const at = takeZoomAnchor() ?? { x: el.clientWidth / 2, y: el.clientHeight / 2 };
    const next = fitPending.current
      ? { left: 0, top: 0 }
      : anchoredScroll({ left: el.scrollLeft, top: el.scrollTop }, at, prevZoom.current, zoom);
    prevZoom.current = zoom;
    fitPending.current = false;
    el.scrollLeft = next.left;
    el.scrollTop = next.top;
  }, [zoom]);

  // [화면에 맞춤]·Ctrl+1 — 이 판이 뜬 뒤에 온 요청만(뷰를 바꿔 판이 새로 떠도 지난 요청을 다시 쓰지 않게)
  const handledFit = useRef(fitRequest);
  useEffect(() => {
    const el = scrollRef.current;
    if (fitRequest === handledFit.current || !el) return;
    handledFit.current = fitRequest;
    const z = fitZoom(useNote.getState().doc.boxes, el.clientWidth, el.clientHeight);
    if (z === useNote.getState().zoom) el.scrollTo({ left: 0, top: 0 });
    else {
      fitPending.current = true;
      setZoom(z);
    }
  }, [fitRequest]);

  // Ctrl+휠(터치패드 두 손가락 벌리기 포함) = 커서 위치 중심 확대·축소. React onWheel은 기본 동작을 막을 수 없어 직접 단다
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setZoom(wheelZoom(useNote.getState().zoom, e.deltaY), { x: e.clientX - r.left, y: e.clientY - r.top });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Space를 누르고 있는 동안(글자를 치는 중이 아니고 판 위에 마우스가 있을 때) 끌면 판이 움직인다
  useEffect(() => {
    const down = (e: globalThis.KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || !hover.current || isEditable(document.activeElement)) return;
      e.preventDefault();
      spaceDown.current = true;
      setPanReady(true);
    };
    const up = (e: globalThis.KeyboardEvent) => {
      if (e.code !== "Space") return;
      spaceDown.current = false;
      setPanReady(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  /** 가운데 단추 끌기 또는 Space+끌기 = 이동(상자 위에서 시작해도 상자를 옮기지 않는다) */
  const onPanPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!(e.button === 1 || (e.button === 0 && spaceDown.current))) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const [x0, y0, l0, t0] = [e.clientX, e.clientY, el.scrollLeft, el.scrollTop];
    setPanning(true);
    const move = (ev: globalThis.PointerEvent) => {
      el.scrollLeft = l0 - (ev.clientX - x0);
      el.scrollTop = t0 - (ev.clientY - y0);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      setPanning(false);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  /** 키보드로 잇는 중에 마우스로 상자를 누르면 그 상자와 잇고, 빈 곳이면 취소 */
  const onCanvasPointerDownCapture = (e: PointerEvent<HTMLDivElement>) => {
    const l = useNote.getState().linking;
    if (!l || l.mode !== "keys" || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const id = (e.target as Element).closest<HTMLElement>("[data-box-id]")?.dataset.boxId;
    if (id && id !== l.from) connect(l.from, id);
    else cancelLinking();
  };

  const onCanvasPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.button !== 0) return;
    e.preventDefault();
    if (useNote.getState().edgeId) selectEdge(null);
    const rect = e.currentTarget.getBoundingClientRect();
    if (editingId) endEditing(editingId);
    addBox((e.clientX - rect.left) / zoom, (e.clientY - rect.top) / zoom);
  };

  const hasFiles = (e: DragEvent) => [...e.dataTransfer.types].includes("Files");
  /** 탐색기에서 끌어 놓은 그림 → 놓은 자리에 이미지 상자(편집기 안에 놓아도 상자로) */
  /** 브라우저 주소창·링크를 끌어다 놓음 — 파일이 아니고 주소 하나 */
  const droppedUrl = (e: DragEvent) =>
    hasFiles(e)
      ? null
      : (singleUrl(e.dataTransfer.getData("text/uri-list").split("\n")[0] ?? "") ??
        singleUrl(e.dataTransfer.getData("text/plain")));
  const onDropCapture = (e: DragEvent<HTMLDivElement>) => {
    const url = droppedUrl(e);
    if (!hasFiles(e) && !url) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = canvasRef.current!.getBoundingClientRect();
    const at = { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom };
    if (url) addLinkBox(url, at);
    else void addImages([...e.dataTransfer.files], at);
  };

  return (
    <div className={styles.canvasWrap}>
      <div
        ref={scrollRef}
        className={[styles.canvasScroll, panReady ? styles.panReady : "", panning ? styles.panning : ""].join(
          " ",
        )}
        data-testid="note-scroll"
        onPointerDownCapture={onPanPointerDown}
        // 가운데 단추의 자동 스크롤(브라우저 기본)을 막는다
        onMouseDownCapture={(e) => e.button === 1 && e.preventDefault()}
        onPointerEnter={() => (hover.current = true)}
        onPointerLeave={() => (hover.current = false)}
      >
        {/* 배율만큼의 자리(스크롤 범위) 안에 판을 CSS scale로 그린다 — 상자 좌표는 늘 문서 px */}
        <div className={styles.sizer} style={{ width: size.w * zoom, height: size.h * zoom }}>
          <div
            ref={canvasRef}
            className={styles.canvas}
            style={{
              width: size.w,
              height: size.h,
              transform: zoom === 1 ? undefined : `scale(${zoom})`,
            }}
            role="application"
            aria-label={STR.note.canvasAria}
            data-testid="note-canvas"
            data-zoom={zoom}
            data-note-drop
            onPointerDownCapture={onCanvasPointerDownCapture}
            onPointerDown={onCanvasPointerDown}
            // 빈 곳 클릭의 기본 동작(포커스 옮기기)이 방금 커서를 넣은 새 상자를 빼앗지 않게
            onMouseDown={(e) => e.target === e.currentTarget && e.preventDefault()}
            onDragOverCapture={(e) => {
              const types = [...e.dataTransfer.types];
              if (!hasFiles(e) && !types.includes("text/uri-list")) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }}
            onDropCapture={onDropCapture}
          >
            <EdgeLayer doc={doc} size={size} />
            {doc.boxes.map((b) =>
              b.kind === "image" ? (
                <ImageBoxView
                  key={b.id}
                  box={b}
                  selected={b.id === selectedId}
                  onPreview={() => setPreviewId(b.id)}
                />
              ) : b.kind === "link" ? (
                <LinkBoxView key={b.id} box={b} selected={b.id === selectedId} />
              ) : (
                <TextBoxView
                  key={b.id}
                  box={b}
                  editing={b.id === editingId}
                  selected={b.id === selectedId}
                  pending={b.id === pendingId}
                  onEditor={onEditor}
                />
              ),
            )}
            {rowDrop && (
              <div
                className={styles.linkDropSpot}
                style={{ left: rowDrop.x, top: rowDrop.y }}
                data-testid="link-drop-spot"
              >
                {STR.linked.dropToCreate}
              </div>
            )}
          </div>
          {/* 서식 막대는 배율과 상관없이 100% 크기로 상자 위(11-2) */}
          {editingBox && editingEditor && editingBox.id !== pendingId && (
            <FormatToolbar editor={editingEditor} box={editingBox} zoom={zoom} />
          )}
          <EdgeToolbar doc={doc} zoom={zoom} />
        </div>
      </div>
      {doc.boxes.length === 0 && (
        <div className={styles.empty} data-testid="note-empty">
          <div className={styles.emptyTitle}>{STR.note.emptyTitle}</div>
          <div>{STR.note.emptyHint}</div>
        </div>
      )}
      {linking?.mode === "keys" && (
        <div className={styles.linkingBar} role="status" data-testid="note-linking">
          <b>
            {STR.note.edgeLinking(
              boxNameOf(doc, linking.from),
              linking.target ? boxNameOf(doc, linking.target) : null,
            )}
          </b>
          <span>{STR.note.edgeLinkingHelp}</span>
        </div>
      )}
      <Minimap scrollRef={scrollRef} doc={doc} size={size} view={view} zoom={zoom} />
      {previewBox && <ImagePreview box={previewBox} onClose={() => setPreviewId(null)} />}
    </div>
  );
}

// ── 상자 하나 ─────────────────────────────────────────
function TextBoxView({
  box,
  editing,
  selected,
  pending,
  onEditor,
}: {
  box: TextBox;
  editing: boolean;
  selected: boolean;
  /** 아직 글이 없는 대기 상자 — 커서 자리만 보인다(improve-1026-spec 2절) */
  pending: boolean;
  onEditor(id: string, ed: Editor | null): void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  /** 편집기가 마지막으로 내보낸 글 — 실행 취소 등으로 바깥에서 바뀐 글만 편집기에 다시 넣는다 */
  const emitted = useRef<PMNode>(box.content);
  const focusRequest = useNote((s) => s.focusRequest);
  const pulse = useNote((s) => s.pulseId === box.id);
  const [menuOpen, setMenuOpen] = useState(false);
  const edges = useEdgeCount(box.id);

  const editor = useEditor(
    {
      extensions: noteExtensions(),
      content: box.content,
      injectCSS: false,
      editorProps: {
        attributes: { class: "note-prose", "aria-label": STR.note.boxAria },
        handleDOMEvents: {
          // 글 속 링크: Ctrl+클릭 = 기본 브라우저(그냥 클릭은 편집 — improve-1026-spec 9-1)
          mousedown: (_view, ev) => {
            const a = (ev.target as Element | null)?.closest?.("a[href]");
            if (!a || !(ev.ctrlKey || ev.metaKey)) return false;
            ev.preventDefault();
            void openLink(a.getAttribute("href") ?? "");
            return true;
          },
          // 앱 창 안에서 페이지가 열리지 않게 링크의 기본 동작은 늘 막는다
          click: (_view, ev) => {
            if ((ev.target as Element | null)?.closest?.("a[href]")) ev.preventDefault();
            return false;
          },
        },
      },
      onUpdate: ({ editor: ed }) => {
        const json = ed.getJSON() as PMNode;
        emitted.current = json;
        updateContent(box.id, json);
      },
      onFocus: () => setEditing(box.id),
    },
    [box.id],
  );

  useEffect(() => {
    onEditor(box.id, editor);
    return () => onEditor(box.id, null);
  }, [editor, box.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 바깥(메모 실행 취소)에서 글이 바뀌었으면 편집기에 다시 넣는다
  useEffect(() => {
    if (!editor || box.content === emitted.current) return;
    emitted.current = box.content;
    editor.commands.setContent(box.content, { emitUpdate: false });
  }, [editor, box.content]);

  // 커서 넣기 요청(새 상자·Alt+M)
  useEffect(() => {
    // 막 만든 편집기는 화면에 옮겨 붙는 중이라 바로 포커스하면 풀린다 → TipTap의 다음 프레임 포커스에 맡긴다
    if (!editor || focusRequest?.id !== box.id) return;
    editor.commands.focus("end");
    // 한 번 쓴 요청은 지운다 — 되돌리기·주 이동으로 상자가 다시 그려질 때 커서를 또 가져가지 않게
    useNote.setState({ focusRequest: null });
  }, [editor, focusRequest, box.id]);

  useBoxFrame(wrapRef, box.id, selected);

  const onKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (editing && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      editor?.commands.blur();
      endEditing(box.id, true);
    } else if (editing && e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      endEditing(box.id);
      addBoxBelow();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (editing) return;
    onSelectedBoxKey(e, box.id, () => editor && focusEnd(editor));
  };

  const copyText = async () => {
    setMenuOpen(false);
    const text = boxText(box);
    try {
      await useAppStore.getState().platform?.writeClipboard(text);
      toast(STR.note.copied);
    } catch (err) {
      reportError(err);
    }
  };

  return (
    <div
      ref={wrapRef}
      className={[
        styles.box,
        box.bg ? styles[`bg_${box.bg}`] : "",
        editing ? styles.editing : "",
        selected ? styles.selected : "",
        pending ? styles.ghost : "",
        box.ref ? styles.hasStrip : "",
        pulse ? styles.pulse : "",
      ].join(" ")}
      style={{ left: box.x, top: box.y, width: box.w, zIndex: menuOpen ? 100000 : box.z + 1 }}
      tabIndex={-1}
      role="group"
      aria-label={edges ? `${STR.note.boxAria} · ${STR.note.edgeCount(edges)}` : STR.note.boxAria}
      data-testid={pending ? "note-ghost" : "note-box"}
      data-box-id={box.id}
      onPointerDown={(e) => {
        // 상자 안 클릭은 판의 새 상자 만들기로 가지 않게
        e.stopPropagation();
        if (e.target !== e.currentTarget) return;
        // 편집 중 상자 여백 클릭은 커서를 편집기에 그대로 둔다
        if (editing) e.preventDefault();
        else selectBox(box.id);
      }}
      onKeyDownCapture={onKeyDownCapture}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        const next = e.relatedTarget as Element | null;
        if (next && (wrapRef.current?.contains(next) || next.closest("[data-note-toolbar]"))) return;
        if (editing) endEditing(box.id);
      }}
    >
      <button
        type="button"
        className={styles.grip}
        aria-label={STR.note.grip}
        title={STR.note.grip}
        tabIndex={-1}
        onPointerDown={(e) => startBoxDrag(e, box, "move")}
      />
      <button
        type="button"
        className={styles.menuButton}
        aria-label={STR.note.menu}
        title={STR.note.menu}
        aria-expanded={menuOpen}
        tabIndex={-1}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setMenuOpen((o) => !o)}
      >
        ⋯
      </button>
      {menuOpen && (
        <div className={styles.menu} role="menu" onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" role="menuitem" onClick={() => (setMenuOpen(false), duplicateBox(box.id))}>
            {STR.note.duplicate}
          </button>
          <button type="button" role="menuitem" onClick={() => (setMenuOpen(false), bringToFront(box.id))}>
            {STR.note.front}
          </button>
          <button type="button" role="menuitem" onClick={() => (setMenuOpen(false), sendToBack(box.id))}>
            {STR.note.back}
          </button>
          <div className={styles.menuSwatches} role="group" aria-label={STR.note.bg}>
            {[null, ...NOTE_BG].map((bg) => (
              <button
                key={bg ?? "none"}
                type="button"
                role="menuitemradio"
                aria-checked={box.bg === bg}
                aria-label={STR.note.bgNames[bg ?? "none"]}
                title={STR.note.bgNames[bg ?? "none"]}
                className={`${styles.swatch} ${bg ? styles[`bg_${bg}`] : ""}`}
                onClick={() => (setMenuOpen(false), setBoxBg(box.id, bg))}
              />
            ))}
          </div>
          <button type="button" role="menuitem" onClick={() => void copyText()}>
            {STR.note.copyText}
          </button>
          {box.ref && (
            <button type="button" role="menuitem" onClick={() => (setMenuOpen(false), unlinkBox(box.id))}>
              {STR.linked.unlink}
            </button>
          )}
          <EdgeMenuItems boxId={box.id} close={() => setMenuOpen(false)} />
          <button
            type="button"
            role="menuitem"
            className={styles.danger}
            onClick={() => (setMenuOpen(false), deleteBox(box.id))}
          >
            {STR.note.delete}
          </button>
        </div>
      )}
      {box.ref && <LinkStrip boxId={box.id} link={box.ref} />}
      <EditorContent editor={editor} className={styles.editor} />
      {/* 대기 상자의 안내 — 글자를 치면 사라진다(조합 중에도 같은 편집기를 그대로 쓰게 구조는 바꾸지 않는다) */}
      {pending && (
        <span className={styles.ghostHint} aria-hidden="true">
          {STR.note.ghostHint}
        </span>
      )}
      <button
        type="button"
        className={styles.resize}
        aria-label={STR.note.resize}
        title={STR.note.resize}
        tabIndex={-1}
        onPointerDown={(e) => startBoxDrag(e, box, "resize")}
      />
      <EdgeKnobs boxId={box.id} />
    </div>
  );
}

/** 이미 떠 있는 편집기의 글 끝에 커서. TipTap focus 명령은 다음 프레임에 포커스를 주므로 먼저 바로 포커스해 첫 글자가 빠지지 않게 한다 */
function focusEnd(editor: Editor) {
  editor.view.focus();
  editor.commands.focus("end");
}

// ── 서식 막대 ─────────────────────────────────────────
function FormatToolbar({ editor, box, zoom }: { editor: Editor; box: TextBox; zoom: number }) {
  const st = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({
      block: ed.isActive("heading", { level: 1 })
        ? "h1"
        : ed.isActive("heading", { level: 2 })
          ? "h2"
          : "paragraph",
      size: (ed.getAttributes("fontSize").size as string | undefined) ?? "m",
      color: (ed.getAttributes("textColor").color as string | undefined) ?? "default",
      bold: ed.isActive("bold"),
      italic: ed.isActive("italic"),
      underline: ed.isActive("underline"),
      strike: ed.isActive("strike"),
      highlight: ed.isActive("highlight"),
      bullet: ed.isActive("bulletList"),
      ordered: ed.isActive("orderedList"),
      task: ed.isActive("taskList"),
    }),
  });
  const run = (f: (c: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) =>
    f(editor.chain().focus()).run();
  // 상자 바로 위, 판 맨 위라 자리가 없으면 상자 아래(화면 px = 문서 px × 배율)
  const top = box.y * zoom >= 44 ? box.y * zoom - 44 : (box.y + (box.h ?? 48)) * zoom + 8;
  const keep = (e: { preventDefault(): void }) => e.preventDefault(); // 단추를 눌러도 편집기 포커스 유지

  const toggle = (label: string, active: boolean, onClick: () => void, text: string, cls = "") => (
    <button
      type="button"
      className={`${styles.tool} ${active ? styles.toolOn : ""} ${cls}`}
      aria-label={label}
      title={label}
      aria-pressed={active}
      onMouseDown={keep}
      onClick={onClick}
    >
      {text}
    </button>
  );

  return (
    <div
      className={styles.toolbar}
      style={{ left: box.x * zoom, top }}
      role="toolbar"
      aria-label={STR.note.toolbar}
      data-note-toolbar
      data-testid="note-toolbar"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <select
        aria-label={STR.note.block}
        value={st.block}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "paragraph") run((c) => c.setParagraph());
          else run((c) => c.setHeading({ level: v === "h1" ? 1 : 2 }));
        }}
      >
        <option value="paragraph">{STR.note.blocks.paragraph}</option>
        <option value="h1">{STR.note.blocks.h1}</option>
        <option value="h2">{STR.note.blocks.h2}</option>
      </select>
      <select
        aria-label={STR.note.size}
        value={st.size}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "m") run((c) => c.unsetMark("fontSize"));
          else run((c) => c.setMark("fontSize", { size: v }));
        }}
      >
        {FONT_SIZES.map((s) => (
          <option key={s} value={s}>
            {STR.note.sizes[s]}
          </option>
        ))}
      </select>
      <span className={styles.sep} />
      {toggle(STR.note.bold, st.bold, () => run((c) => c.toggleBold()), "B", styles.toolBold)}
      {toggle(STR.note.italic, st.italic, () => run((c) => c.toggleItalic()), "I", styles.toolItalic)}
      {toggle(
        STR.note.underline,
        st.underline,
        () => run((c) => c.toggleUnderline()),
        "U",
        styles.toolUnderline,
      )}
      {toggle(STR.note.strike, st.strike, () => run((c) => c.toggleStrike()), "S", styles.toolStrike)}
      <span className={styles.sep} />
      <select
        aria-label={STR.note.color}
        value={st.color}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "default") run((c) => c.unsetMark("textColor"));
          else run((c) => c.setMark("textColor", { color: v }));
        }}
      >
        <option value="default">{STR.note.colors.default}</option>
        {TEXT_COLORS.map((c) => (
          <option key={c} value={c}>
            {STR.note.colors[c]}
          </option>
        ))}
      </select>
      {toggle(
        STR.note.highlight,
        st.highlight,
        () => run((c) => c.toggleMark("highlight")),
        "형광",
        styles.toolHl,
      )}
      <span className={styles.sep} />
      {toggle(STR.note.bullet, st.bullet, () => run((c) => c.toggleBulletList()), "•")}
      {toggle(STR.note.ordered, st.ordered, () => run((c) => c.toggleOrderedList()), "1.")}
      {toggle(STR.note.task, st.task, () => run((c) => c.toggleTaskList()), "☑")}
      {toggle(STR.note.rule, false, () => run((c) => c.setHorizontalRule()), "—")}
    </div>
  );
}
