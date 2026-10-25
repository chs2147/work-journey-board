// 메모 판(weekly-note-spec 4절, 시안 A): 점 격자 위 자유 배치 텍스트 상자. 빈 곳 클릭 = 새 상자, 위 막대 끌기 = 이동,
// 오른쪽 손잡이 = 폭, Esc = 선택(방향키·Delete), 편집 중에는 서식 막대. 편집기(TipTap)는 이 조각과 함께 처음 열 때만 불러온다.
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent } from "react";
import {
  boxText,
  FONT_SIZES,
  NOTE_BG,
  TEXT_COLORS,
  type ImageBox,
  type PMNode,
  type TextBox,
} from "../../domain/note";
import { STR } from "../../shared/strings";
import { reportError, toast } from "../board/boardStore";
import { useAppStore } from "../common/appStore";
import { onSelectedBoxKey, startBoxDrag, useBoxFrame } from "./boxShared";
import { noteExtensions } from "./editorExtensions";
import { ImageBoxView, ImagePreview } from "./ImageBoxView";
import {
  addBox,
  addBoxBelow,
  addImages,
  pastePlace,
  bringToFront,
  deleteBox,
  duplicateBox,
  endEditing,
  selectBox,
  sendToBack,
  setBoxBg,
  setEditing,
  updateContent,
  useNote,
} from "./noteStore";
import "./prosemirror.css";
import styles from "./Note.module.css";

/** 판 아래 늘 남겨 둘 빈 공간(이어 붙이기용, 스펙 4-1) */
const BOTTOM_ROOM = 160;

export default function NoteCanvas() {
  const doc = useNote((s) => s.doc);
  const editingId = useNote((s) => s.editingId);
  const selectedId = useNote((s) => s.selectedId);
  const canvasRef = useRef<HTMLDivElement>(null);
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

  const bottom = doc.boxes.reduce((m, b) => Math.max(m, b.y + (b.h ?? 48)), 0);
  const right = doc.boxes.reduce((m, b) => Math.max(m, b.x + b.w), 0);
  const editingBox = doc.boxes.find((b): b is TextBox => b.id === editingId && b.kind === "text");
  const editingEditor = editingId ? editors[editingId] : undefined;
  const previewBox = doc.boxes.find((b): b is ImageBox => b.id === previewId && b.kind === "image");

  // 캡처 붙여넣기(Ctrl+V): 메모 도크 안 어디서든. 글이 함께 있으면 편집기가 글로 붙인다(스펙 4-3·4-4)
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as Element | null;
      if (!target?.closest?.("[data-note-root]") || !e.clipboardData) return;
      const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
      if (!files.length || e.clipboardData.getData("text/plain").trim()) return;
      e.preventDefault();
      e.stopPropagation();
      void addImages(files, pastePlace());
    };
    document.addEventListener("paste", onPaste, true);
    return () => document.removeEventListener("paste", onPaste, true);
  }, []);

  const onCanvasPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.button !== 0) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    if (editingId) endEditing(editingId);
    addBox(e.clientX - rect.left, e.clientY - rect.top);
  };

  const hasFiles = (e: DragEvent) => [...e.dataTransfer.types].includes("Files");
  /** 탐색기에서 끌어 놓은 그림 → 놓은 자리에 이미지 상자(편집기 안에 놓아도 상자로) */
  const onDropCapture = (e: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = canvasRef.current!.getBoundingClientRect();
    void addImages([...e.dataTransfer.files], { x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <div className={styles.canvasScroll}>
      <div
        ref={canvasRef}
        className={styles.canvas}
        style={{ height: Math.max(bottom + BOTTOM_ROOM, 0), minWidth: right + 40 }}
        role="application"
        aria-label={STR.note.canvasAria}
        data-testid="note-canvas"
        onPointerDown={onCanvasPointerDown}
        // 빈 곳 클릭의 기본 동작(포커스 옮기기)이 방금 커서를 넣은 새 상자를 빼앗지 않게
        onMouseDown={(e) => e.target === e.currentTarget && e.preventDefault()}
        onDragOverCapture={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDropCapture={onDropCapture}
      >
        {doc.boxes.length === 0 && (
          <div className={styles.empty} data-testid="note-empty">
            <div className={styles.emptyTitle}>{STR.note.emptyTitle}</div>
            <div>{STR.note.emptyHint}</div>
          </div>
        )}
        {doc.boxes.map((b) =>
          b.kind === "image" ? (
            <ImageBoxView
              key={b.id}
              box={b}
              selected={b.id === selectedId}
              onPreview={() => setPreviewId(b.id)}
            />
          ) : (
            <TextBoxView
              key={b.id}
              box={b}
              editing={b.id === editingId}
              selected={b.id === selectedId}
              onEditor={onEditor}
            />
          ),
        )}
        {editingBox && editingEditor && <FormatToolbar editor={editingEditor} box={editingBox} />}
      </div>
      {previewBox && <ImagePreview box={previewBox} onClose={() => setPreviewId(null)} />}
    </div>
  );
}

// ── 상자 하나 ─────────────────────────────────────────
function TextBoxView({
  box,
  editing,
  selected,
  onEditor,
}: {
  box: TextBox;
  editing: boolean;
  selected: boolean;
  onEditor(id: string, ed: Editor | null): void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  /** 편집기가 마지막으로 내보낸 글 — 실행 취소 등으로 바깥에서 바뀐 글만 편집기에 다시 넣는다 */
  const emitted = useRef<PMNode>(box.content);
  const focusRequest = useNote((s) => s.focusRequest);
  const [menuOpen, setMenuOpen] = useState(false);

  const editor = useEditor(
    {
      extensions: noteExtensions(),
      content: box.content,
      injectCSS: false,
      editorProps: { attributes: { class: "note-prose", "aria-label": STR.note.boxAria } },
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
      ].join(" ")}
      style={{ left: box.x, top: box.y, width: box.w, zIndex: box.z + 1 }}
      tabIndex={-1}
      role="group"
      aria-label={STR.note.boxAria}
      data-testid="note-box"
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
      <EditorContent editor={editor} className={styles.editor} />
      <button
        type="button"
        className={styles.resize}
        aria-label={STR.note.resize}
        title={STR.note.resize}
        tabIndex={-1}
        onPointerDown={(e) => startBoxDrag(e, box, "resize")}
      />
    </div>
  );
}

/** 이미 떠 있는 편집기의 글 끝에 커서. TipTap focus 명령은 다음 프레임에 포커스를 주므로 먼저 바로 포커스해 첫 글자가 빠지지 않게 한다 */
function focusEnd(editor: Editor) {
  editor.view.focus();
  editor.commands.focus("end");
}

// ── 서식 막대 ─────────────────────────────────────────
function FormatToolbar({ editor, box }: { editor: Editor; box: TextBox }) {
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
  // 상자 바로 위, 판 맨 위라 자리가 없으면 상자 아래
  const top = box.y >= 44 ? box.y - 44 : box.y + (box.h ?? 48) + 8;
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
      style={{ left: box.x, top }}
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
