import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "../common/appStore";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import type { PMNode } from "../../domain/note";
import { TEXT_COLORS } from "../../domain/note";
import { cabiText, cabiAssetIds, cleanCabiContent, type CabiNote } from "../../domain/cabi";
import { importCabiMarkdown } from "../../domain/cabiMarkdown";
import { MARKDOWN_MAX_BYTES } from "../../domain/markdownNote";
import { CABI } from "../../shared/cabiStrings";
import { STR } from "../../shared/strings";
import {
  IconNote,
  IconExportFile,
  IconPlus,
  IconTune,
  IconChevronUp,
  IconChevronDown,
  IconCopyItem,
  IconTrash,
} from "../common/icons";
import { reportError, toast } from "../board/boardStore";
import { prepareImage, type PreparedImage } from "../note/imageProcess";
import { cabiClient, cabiContext, registerCabiFlush, useCabiChange } from "./cabiService";
import { cabiEditorExtensions } from "./cabiEditorExtensions";
import { writeCabiDocument } from "./cabiExport";
import styles from "./Cabi.module.css";

interface ImportPreview {
  title: string;
  content: PMNode;
  excluded: number;
  assets?: { id: string; name: string; image: PreparedImage }[];
}
export function TaskNoteWindow({ noteId }: { noteId: string }) {
  const [note, setNote] = useState<CabiNote | null>(null),
    [title, setTitle] = useState(""),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [toc, setToc] = useState(false),
    [wide, setWide] = useState(false),
    [menu, setMenu] = useState(false),
    [blockMenu, setBlockMenu] = useState(false),
    [preview, setPreview] = useState<ImportPreview | null>(null),
    [headings, setHeadings] = useState<{ text: string; pos: number }[]>([]),
    [tasks, setTasks] = useState<{ id: string; name: string }[]>([]);
  const disconnected = useCabiChange((s) => s.disconnected),
    titleRef = useRef<HTMLInputElement>(null),
    fileRef = useRef<HTMLInputElement>(null),
    imageRef = useRef<HTMLInputElement>(null),
    current = useRef<CabiNote | null>(null),
    dirty = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    queue = useRef<Promise<void>>(Promise.resolve()),
    generation = useRef(0),
    editorRef = useRef<Editor | null>(null);
  const save = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const job = queue.current.then(async () => {
      const before = current.current;
      if (!before || !dirty.current) return;
      const snapshot = { ...before },
        epoch = generation.current;
      dirty.current = false;
      setSaving(true);
      try {
        const saved = await cabiClient().saveNote(
          snapshot.id,
          snapshot.revision,
          snapshot.title,
          snapshot.content,
          snapshot.categoryId,
        );
        if (generation.current !== epoch) return;
        current.current = { ...current.current!, revision: saved.revision, updatedAt: saved.updatedAt };
        setNote(current.current);
        setError("");
        if (!dirty.current) document.body.dataset.cabiDirty = "false";
      } catch (e) {
        dirty.current = true;
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setSaving(false);
      }
    });
    queue.current = job.catch(() => undefined);
    return job;
  }, []);
  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save().catch(() => undefined), 600);
  }, [save]);
  const update = (patch: Partial<CabiNote>) => {
    if (!current.current) return;
    current.current = { ...current.current, ...patch };
    dirty.current = true;
    document.body.dataset.cabiDirty = "true";
    schedule();
  };
  const editor = useEditor(
    {
      extensions: cabiEditorExtensions(),
      content: { type: "doc", content: [{ type: "paragraph" }] },
      injectCSS: false,
      editorProps: {
        attributes: { class: styles.prose!, "aria-label": CABI.note },
        handleKeyDown: (_view, event) => {
          if (event.isComposing) return false;
          if (event.key === "/" && !event.ctrlKey && !event.metaKey) {
            setTimeout(() => setBlockMenu(true), 0);
          }
          return false;
        },
        handleDrop: (_view, event) => {
          const files = [...(event.dataTransfer?.files ?? [])];
          if (!files.length) return false;
          event.preventDefault();
          void importFiles(files);
          return true;
        },
        handlePaste: (_view, event, slice) => {
          const files = [...(event.clipboardData?.files ?? [])];
          if (!files.length) {
            const nodes = slice.content.toJSON() as PMNode[] | undefined;
            if (!nodes?.length || !cabiAssetIds({ type: "doc", content: nodes }).length) return false;
            event.preventDefault();
            void pasteImageBlocks(nodes).catch(reportError);
            return true;
          }
          event.preventDefault();
          void addImages(files);
          return true;
        },
      },
      onUpdate: ({ editor: ed }) => {
        update({ content: cleanCabiContent(ed.getJSON()) });
        const hs: { text: string; pos: number }[] = [];
        ed.state.doc.descendants((n, pos) => {
          if (n.type.name === "heading") hs.push({ text: n.textContent, pos });
        });
        setHeadings(hs);
      },
    },
    [],
  );
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);
  useEffect(() => {
    let active = true;
    const epoch = ++generation.current;
    void Promise.all([cabiClient().note(noteId), cabiContext()])
      .then(([n, c]) => {
        if (!active) return;
        current.current = n;
        setNote(n);
        setTitle(n.title);
        setTasks(c.categories);
        if (n.title === CABI.untitled)
          setTimeout(() => {
            titleRef.current?.focus();
            titleRef.current?.select();
          }, 0);
        editorRef.current?.commands.setContent(n.content, { emitUpdate: false });
      })
      .catch((e) => setError(String(e)));
    const unregister = registerCabiFlush(save);
    const blur = () => void save().catch(() => undefined);
    window.addEventListener("blur", blur);
    return () => {
      active = false;
      generation.current = epoch + 1;
      unregister();
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener("blur", blur);
    };
  }, [noteId, save]);
  useEffect(() => {
    editor?.setEditable(!disconnected);
  }, [editor, disconnected]);
  async function addImages(files: File[]) {
    if (!current.current || !editor) return;
    const owner = current.current.id;
    try {
      for (const file of files) {
        if (!file.type.startsWith("image/")) continue;
        const image = await prepareImage(file),
          asset = await cabiClient().addAsset("note", owner, image, image.thumb);
        if (current.current?.id !== owner) return;
        editor
          .chain()
          .focus()
          .insertContent({ type: "image", attrs: { asset, alt: file.name } })
          .run();
      }
    } catch (e) {
      reportError(e);
    }
  }
  async function pasteImageBlocks(nodes: PMNode[]) {
    const n = current.current,
      ed = editorRef.current,
      epoch = generation.current;
    if (!n || !ed) return;
    const content = cleanCabiContent({ type: "doc", content: nodes }),
      mapping: Record<string, string> = {};
    for (const id of cabiAssetIds(content)) {
      const image = await cabiClient().asset(id);
      if (!image) throw new Error(CABI.assetMissing);
      mapping[id] = await cabiClient().addAsset("note", n.id, image);
      if (generation.current !== epoch || current.current?.id !== n.id) return;
    }
    const rewrite = (node: PMNode): PMNode => ({
      ...node,
      ...(node.type === "image"
        ? { attrs: { ...node.attrs, asset: mapping[String(node.attrs?.asset)] } }
        : {}),
      ...(node.content ? { content: node.content.map(rewrite) } : {}),
    });
    ed.chain()
      .focus()
      .insertContent(rewrite(content).content ?? [])
      .run();
  }
  async function importFiles(files: File[]) {
    const file = files.find((f) => /\.(md|markdown)$/i.test(f.name));
    if (!file) {
      await addImages(files);
      return;
    }
    if (file.size > MARKDOWN_MAX_BYTES) {
      setError(STR.markdownDrop.tooLarge);
      return;
    }
    try {
      const assets: NonNullable<ImportPreview["assets"]> = [],
        mapping: Record<string, string> = {};
      for (const imageFile of files.filter((f) => f.type.startsWith("image/"))) {
        if (files.filter((f) => f.name === imageFile.name).length !== 1) continue;
        const id = "import-" + crypto.randomUUID();
        assets.push({ id, name: imageFile.name, image: await prepareImage(imageFile) });
        mapping[imageFile.name] = id;
      }
      const result = importCabiMarkdown(await file.text(), mapping),
        used = new Set<string>();
      const scan = (n: PMNode) => {
        if (n.type === "image") used.add(String(n.attrs?.asset));
        n.content?.forEach(scan);
      };
      scan(result.content);
      setPreview({
        ...result,
        title: result.title || file.name.replace(/\.(md|markdown)$/i, ""),
        assets: assets.filter((a) => used.has(a.id)),
      });
    } catch (e) {
      reportError(e);
    }
  }
  async function confirmImport(mode: "new" | "insert") {
    const source = preview,
      n = current.current;
    if (!source || !n || !editor) return;
    let created: CabiNote | null = null;
    try {
      await save();
      const owner =
          mode === "new" ? (created = await cabiClient().createNote(n.categoryId, source.title)) : n,
        map: Record<string, string> = {};
      for (const a of source.assets ?? [])
        map[a.id] = await cabiClient().addAsset("note", owner.id, a.image, a.image.thumb);
      const replace = (node: PMNode): PMNode => ({
        ...node,
        ...(node.type === "image"
          ? { attrs: { ...node.attrs, asset: map[String(node.attrs?.asset)] ?? node.attrs?.asset } }
          : {}),
        ...(node.content ? { content: node.content.map(replace) } : {}),
      });
      const content = replace(source.content);
      if (mode === "insert")
        editor
          .chain()
          .focus()
          .insertContent(content.content ?? [])
          .run();
      else {
        await cabiClient().saveNote(owner.id, owner.revision, source.title, content);
        const { openCabi } = await import("./cabiService");
        await openCabi("note", owner.id);
      }
      setPreview(null);
      toast(CABI.importDone);
    } catch (e) {
      if (created)
        await cabiClient()
          .removeNote(created.id, created.revision)
          .catch(() => undefined);
      reportError(e);
    }
  }
  const exportDoc = async (kind: "markdown" | "pdf") => {
    const n = current.current;
    if (!n) return;
    setMenu(false);
    const c = await cabiContext();
    await writeCabiDocument(kind, n.title, n.content, (id) => cabiClient().asset(id), c.dataDir);
  };
  const selectBlock = (kind: string) => {
    if (!editor) return;
    const { from } = editor.state.selection;
    if (from > 0 && editor.state.doc.textBetween(from - 1, from) === "/")
      editor.commands.deleteRange({ from: from - 1, to: from });
    const chain = editor.chain().focus();
    if (kind.startsWith("heading")) chain.toggleHeading({ level: Number(kind.slice(-1)) as 1 | 2 | 3 }).run();
    else if (kind === "paragraph") chain.setParagraph().run();
    else if (kind === "bulletList") chain.toggleBulletList().run();
    else if (kind === "orderedList") chain.toggleOrderedList().run();
    else if (kind === "taskList") chain.toggleTaskList().run();
    else if (kind === "blockquote") chain.toggleBlockquote().run();
    else if (kind === "codeBlock") chain.toggleCodeBlock().run();
    else if (kind === "horizontalRule") chain.setHorizontalRule().run();
    else if (kind === "table") chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    setBlockMenu(false);
  };
  useEffect(() => {
    if (!note) return;
    const name = `${title || CABI.untitled} — ${tasks.find((t) => t.id === note.categoryId)?.name ?? ""} · Cabi.NET`;
    document.title = name;
    const timer = setTimeout(
      () =>
        void useAppStore
          .getState()
          .platform?.setWindowTitle?.(name)
          .catch(() => undefined),
      200,
    );
    return () => clearTimeout(timer);
  }, [title, note, tasks]);
  const alterBlock = (action: "up" | "down" | "copy" | "delete") => {
    if (!editor) return;
    const { state } = editor;
    const pos =
        state.selection instanceof NodeSelection
          ? state.selection.from
          : state.selection.$from.depth
            ? state.selection.$from.before(1)
            : 0,
      node = state.doc.nodeAt(pos);
    if (!node) return;
    const index = state.doc.resolve(pos).index(),
      tr = state.tr;
    if (action === "copy") tr.insert(pos + node.nodeSize, node);
    else if (action === "delete") tr.delete(pos, pos + node.nodeSize);
    else if (action === "up" && index > 0) {
      const previous = state.doc.child(index - 1);
      tr.delete(pos, pos + node.nodeSize).insert(pos - previous.nodeSize, node);
    } else if (action === "down" && index < state.doc.childCount - 1) {
      const next = state.doc.child(index + 1);
      tr.delete(pos, pos + node.nodeSize).insert(pos + next.nodeSize, node);
    } else return;
    editor.view.dispatch(tr);
    editor.commands.focus();
  };
  if (!note)
    return (
      <div className={styles.window}>
        <p className={`${styles.message} ${error ? styles.error : ""}`} role={error ? "alert" : "status"}>
          {error || CABI.loading}
        </p>
        {error && (
          <button className={styles.button} onClick={() => location.reload()}>
            {CABI.retry}
          </button>
        )}
      </div>
    );
  return (
    <div className={`${styles.window} ${wide ? styles.wide : ""}`} data-testid="cabi-note-editor">
      <header className={styles.header}>
        <div>
          <span className={styles.muted}>
            Cabi.NET / {tasks.find((t) => t.id === note?.categoryId)?.name} / {CABI.note}
          </span>
        </div>
        <div className={styles.actions}>
          <span className={styles.muted} role="status">
            {error ? CABI.saveFailed : saving ? CABI.saving : CABI.saved}
          </span>
          <button className={styles.button} onClick={() => fileRef.current?.click()}>
            <IconPlus />
            {CABI.import}
          </button>
          <button className={styles.button} onClick={() => setMenu((v) => !v)}>
            <IconExportFile />
            {CABI.export}
          </button>
          <button
            className={styles.icon}
            aria-label={CABI.toc}
            title={CABI.toc}
            onClick={() => setToc((v) => !v)}
          >
            <IconTune />
          </button>
          <button
            className={styles.icon}
            aria-label={CABI.wide}
            title={CABI.wide}
            onClick={() => setWide((v) => !v)}
          >
            <IconNote />
          </button>
        </div>
      </header>
      {(error || disconnected) && (
        <p className={`${styles.message} ${styles.error}`} role="alert">
          {error || (disconnected ? CABI.disconnected : "")}{" "}
          <button className={styles.button} onClick={() => void save().catch(() => undefined)}>
            {CABI.retry}
          </button>
          <button
            className={styles.button}
            onClick={() =>
              void (async () => {
                if (dirty.current && !window.confirm(CABI.reload)) return;
                const n = await cabiClient().note(noteId);
                current.current = n;
                dirty.current = false;
                setNote(n);
                setTitle(n.title);
                editor?.commands.setContent(n.content, { emitUpdate: false });
                setError("");
              })().catch(reportError)
            }
          >
            {CABI.reload}
          </button>
        </p>
      )}
      {menu && (
        <div className={styles.menu}>
          <button className={styles.button} onClick={() => void exportDoc("markdown").catch(reportError)}>
            {CABI.markdown}
          </button>
          <button className={styles.button} onClick={() => void exportDoc("pdf").catch(reportError)}>
            {CABI.pdf}
          </button>
          <small>{CABI.exportColorHelp}</small>
          <select
            className={styles.taskSelect}
            aria-label={CABI.moveTask}
            value={note?.categoryId ?? ""}
            onChange={(e) => {
              update({ categoryId: e.target.value });
              setNote(current.current);
            }}
          >
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            className={styles.button}
            onClick={() =>
              void (async () => {
                const n = current.current;
                if (!n) return;
                await save();
                const count = await cabiClient().referenceCount("note", n.id);
                if (!window.confirm(CABI.deleteConfirm(count))) return;
                await cabiClient().removeNote(n.id, current.current!.revision);
                dirty.current = false;
                const { loadPlatform } = await import("../../platform");
                await (await loadPlatform()).cabi.closeSelf();
              })().catch(reportError)
            }
          >
            <IconTrash />
            {CABI.deleteNote}
          </button>
        </div>
      )}
      <div className={styles.format}>
        <button className={styles.button} aria-expanded={blockMenu} onClick={() => setBlockMenu((v) => !v)}>
          {CABI.blockMenu}
        </button>
        {[
          ["bold", CABI.bold, "B"],
          ["italic", CABI.italic, "I"],
          ["strike", CABI.strike, "S"],
          ["code", CABI.code, "<>"],
        ].map(([command, label, text]) => (
          <button
            key={command}
            className={styles.icon}
            aria-label={label}
            title={label}
            onClick={() => {
              if (!editor) return;
              if (command === "bold") editor.chain().focus().toggleBold().run();
              if (command === "italic") editor.chain().focus().toggleItalic().run();
              if (command === "strike") editor.chain().focus().toggleStrike().run();
              if (command === "code") editor.chain().focus().toggleCode().run();
            }}
          >
            {text}
          </button>
        ))}
        <select
          aria-label={CABI.textColor}
          onChange={(e) => {
            if (e.target.value) editor?.chain().focus().setMark("textColor", { color: e.target.value }).run();
            else editor?.chain().focus().unsetMark("textColor").run();
          }}
        >
          <option value="">{STR.note.colors.default}</option>
          {TEXT_COLORS.map((c) => (
            <option key={c} value={c}>
              {STR.note.colors[c]}
            </option>
          ))}
        </select>
        <button
          className={styles.button}
          onClick={() => {
            const href = window.prompt(CABI.linkPrompt, "https://");
            if (href && /^https?:\/\//i.test(href))
              editor?.chain().focus().extendMarkRange("link").setLink({ href }).run();
          }}
        >
          {CABI.addLink}
        </button>
        <button
          className={styles.icon}
          title={CABI.image}
          aria-label={CABI.image}
          onClick={() => imageRef.current?.click()}
        >
          <IconPlus />
        </button>
        {(
          [
            ["up", CABI.moveUp, IconChevronUp],
            ["down", CABI.moveDown, IconChevronDown],
            ["copy", CABI.duplicateBlock, IconCopyItem],
            ["delete", CABI.deleteBlock, IconTrash],
          ] as const
        ).map(([action, label, Icon]) => (
          <button
            key={String(action)}
            className={styles.icon}
            title={String(label)}
            aria-label={String(label)}
            onClick={() => alterBlock(action as "up" | "down" | "copy" | "delete")}
          >
            {typeof Icon !== "string" && <Icon />}
          </button>
        ))}
      </div>
      {blockMenu && (
        <div className={styles.toolbar} role="menu" aria-label={CABI.blockMenu}>
          {Object.entries(CABI.blocks).map(([key, label]) => (
            <button className={styles.button} key={key} role="menuitem" onClick={() => selectBlock(key)}>
              {label}
            </button>
          ))}
        </div>
      )}
      <div className={styles.docBody}>
        <div className={styles.editorScroll}>
          <div className={styles.page}>
            <span className={styles.muted}>{CABI.noteOwner}</span>
            <input
              ref={titleRef}
              className={styles.title}
              value={title}
              aria-label={CABI.noteTitle}
              placeholder={CABI.untitled}
              onChange={(e) => {
                setTitle(e.target.value);
                update({ title: e.target.value });
              }}
            />
            <EditorContent editor={editor} />
            <p className={styles.muted}>{CABI.placeholder}</p>
          </div>
        </div>
        {toc && (
          <aside className={styles.toc}>
            {headings.map((h, i) => (
              <button
                key={i}
                onClick={() =>
                  editor
                    ?.chain()
                    .setTextSelection(h.pos + 1)
                    .focus()
                    .scrollIntoView()
                    .run()
                }
              >
                {h.text}
              </button>
            ))}
          </aside>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".md,.markdown,image/png,image/jpeg,image/webp,image/gif"
        data-testid="cabi-import-input"
        multiple
        hidden
        onChange={(e) => {
          void importFiles([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      <input
        ref={imageRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        hidden
        onChange={(e) => {
          void addImages([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      {preview && (
        <div className={styles.modalBackdrop}>
          <section className={styles.modal} role="dialog" aria-modal="true" aria-label={CABI.importPreview}>
            <h2>{CABI.importPreview}</h2>
            <p>{CABI.importHelp}</p>
            <p>{CABI.excluded(preview.excluded)}</p>
            <pre>{cabiText(preview.content)}</pre>
            <div className={styles.actions}>
              <button className={styles.button} onClick={() => setPreview(null)}>
                {CABI.cancel}
              </button>
              <button className={styles.button} onClick={() => void confirmImport("insert")}>
                {CABI.importInsert}
              </button>
              <button
                className={`${styles.button} ${styles.primary}`}
                onClick={() => void confirmImport("new")}
              >
                {CABI.importNew}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
