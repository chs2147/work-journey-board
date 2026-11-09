import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CabinetItem } from "../../domain/cabinet";
import { cabiAssetIds, type CabiNoteSummary, type TaskBoard } from "../../domain/cabi";
import { boxText } from "../../domain/note";
import { CABI } from "../../shared/cabiStrings";
import {
  IconNote,
  IconList,
  IconTable,
  IconMap,
  IconTune,
  IconTrash,
  IconExpand,
  IconCopyItem,
  IconLock,
} from "../common/icons";
import { V20 } from "../../shared/v20Strings";
import { DeleteNoteDialog } from "./DeleteNoteDialog";
import { reportError } from "../board/boardStore";
import { cabiClient, cabiContext, createCabiNote, openCabi, useCabiChange } from "./cabiService";
import { CabiDragGrip } from "./CabiDrag";
import { openItem } from "./cabinetStore";
import styles from "./Cabi.module.css";

export function CabiHub({
  categoryId,
  includeNotes = true,
  name,
  resources,
  renderResource,
  footer,
}: {
  categoryId: string | null;
  includeNotes?: boolean;
  name: string;
  resources: CabinetItem[];
  renderResource: (item: CabinetItem) => ReactNode;
  footer: ReactNode;
}) {
  const version = useCabiChange((s) => s.version),
    [notes, setNotes] = useState<CabiNoteSummary[]>([]),
    [board, setBoard] = useState<TaskBoard | null>(null),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [view, setView] = useState<"list" | "cards" | "board">("list"),
    [preview, setPreview] = useState<CabiNoteSummary | null>(null),
    [previewOpen, setPreviewOpen] = useState(false),
    [tasks, setTasks] = useState<{ id: string; name: string }[]>([]),
    [chosen, setChosen] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState<{ id: string; title: string } | null>(null),
    [deleting, setDeleting] = useState<{ note: CabiNoteSummary; refs: number; images: number } | null>(null);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);
  const target = categoryId ?? chosen,
    revision = useRef(0);
  useEffect(() => {
    let active = true;
    void cabiContext()
      .then((c) => {
        if (active) setTasks(c.categories);
      })
      .catch(reportError);
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const seq = ++revision.current;
    const r = cabiClient();
    void Promise.all([
      includeNotes ? r.listNotes(categoryId ?? undefined, query) : Promise.resolve([]),
      target ? r.board(target) : Promise.resolve(null),
    ])
      .then(([n, b]) => {
        if (revision.current === seq) {
          setNotes(n);
          setBoard(b);
          setError("");
        }
      })
      .catch((e) => {
        if (revision.current === seq) setError(String(e));
      });
    return () => {
      if (revision.current === seq) revision.current = seq + 1;
    };
  }, [categoryId, target, query, version, includeNotes]);
  const shown = resources.filter(
    (r) =>
      (filter === "all" || filter === r.kind) &&
      (r.title + " " + r.target).toLowerCase().includes(query.toLowerCase()),
  );
  const noteRows = filter === "all" || filter === "note" ? notes : [];
  const newNote = () => {
    if (!target) return setError(CABI.selectTask);
    void createCabiNote(target).catch(reportError);
  };
  const openBoard = () => {
    if (!target) return setError(CABI.selectTask);
    void openCabi("board", target).catch(reportError);
  };
  return (
    <div className={styles.hub} data-testid="cabi-hub">
      <header className={styles.header}>
        <div>
          <h1 data-testid="cabinet-group-title">{name}</h1>
          <p>{CABI.taskHelp}</p>
        </div>
        <div className={styles.actions}>
          {!categoryId && (
            <select
              aria-label={CABI.selectTask}
              className={styles.taskSelect}
              value={chosen}
              onChange={(e) => setChosen(e.target.value)}
            >
              <option value="">{CABI.selectTask}</option>
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          <button
            className={`${styles.button} ${styles.primary}`}
            onClick={newNote}
            data-testid="cabi-new-note"
          >
            <IconNote />
            {CABI.newNote}
          </button>
          <button className={styles.button} onClick={openBoard} data-testid="cabi-open-board">
            <IconMap />
            {board ? CABI.board : CABI.makeBoard}
          </button>
        </div>
      </header>
      {error && (
        <p className={`${styles.message} ${styles.error}`} role="alert">
          {error}
        </p>
      )}
      <div className={styles.toolbar}>
        <div className={styles.actions}>
          {(
            [
              ["all", CABI.all],
              ["note", CABI.notes],
              ["folder", CABI.folders],
              ["link", CABI.links],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              className={`${styles.button} ${filter === key ? styles.active : ""}`}
              data-testid={`cabinet-filter-${key}`}
              role="radio"
              aria-checked={filter === key}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {label}
              <span aria-hidden="true">
                {" "}
                {key === "all"
                  ? resources.length + notes.length
                  : key === "note"
                    ? notes.length
                    : resources.filter((r) => r.kind === key).length}
              </span>
            </button>
          ))}
        </div>
        <div className={styles.actions}>
          <input
            className={styles.search}
            aria-label={CABI.search}
            placeholder={CABI.search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {(
            [
              ["list", CABI.list, IconList],
              ["cards", CABI.cards, IconTable],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={String(key)}
              className={`${styles.icon} ${view === key ? styles.active : ""}`}
              title={String(label)}
              aria-label={String(label)}
              onClick={() => setView(key as typeof view)}
            >
              {typeof Icon !== "string" && <Icon />}
            </button>
          ))}
          <button
            className={styles.icon}
            title={CABI.preview}
            aria-label={CABI.preview}
            onClick={() => setPreviewOpen((v) => !v)}
          >
            <IconTune />
          </button>
        </div>
      </div>
      <div className={styles.body}>
        <div className={styles.hub}>
          {view === "board" ? (
            <div className={styles.scroll}>
              {target ? (
                board ? (
                  <BoardPreview board={board} />
                ) : (
                  <p className={styles.message}>{CABI.makeBoard}</p>
                )
              ) : (
                <BoardGallery tasks={tasks} />
              )}
              {target && (
                <button className={styles.button} onClick={openBoard}>
                  <IconExpand />
                  {board ? CABI.board : CABI.makeBoard}
                </button>
              )}
            </div>
          ) : (
            <div
              className={`${styles.scroll} ${view === "cards" ? styles.grid : styles.list}`}
              data-testid="cabi-items"
            >
              {notice && (
                <p className={styles.notice} role="status" data-testid="cabi-note-notice">
                  {V20.duplicated(notice.title)}
                  <button
                    className={styles.button}
                    onClick={() => void openCabi("note", notice.id).catch(reportError)}
                  >
                    {V20.open}
                  </button>
                </p>
              )}
              {deleting && (
                <DeleteNoteDialog
                  title={deleting.note.title}
                  task={tasks.find((t) => t.id === deleting.note.categoryId)?.name ?? ""}
                  savedAt={deleting.note.updatedAt}
                  images={deleting.images}
                  refs={deleting.refs}
                  onCancel={() => setDeleting(null)}
                  onDelete={async () => {
                    const r = cabiClient(),
                      latest = await r.note(deleting.note.id);
                    await r.removeNote(latest.id, latest.revision);
                    setDeleting(null);
                  }}
                />
              )}
              {noteRows.map((n) => (
                <article
                  key={n.id}
                  className={`${styles.row} ${notice?.id === n.id ? styles.duplicated : ""}`}
                  data-testid="cabi-note-row"
                >
                  <IconNote />
                  <button
                    className={styles.rowMain}
                    onClick={() => setPreview(n)}
                    onDoubleClick={() => void openCabi("note", n.id).catch(reportError)}
                  >
                    <strong>{n.title}</strong>
                    <small>
                      {(tasks.find((t) => t.id === n.categoryId)?.name ?? "") +
                        " · " +
                        (n.excerpt || CABI.noteOwner)}
                    </small>
                  </button>
                  <span className={styles.tag}>{CABI.note}</span>
                  <span className={styles.muted}>{n.updatedAt.slice(0, 10)}</span>
                  <CabiDragGrip reference={{ kind: "note", id: n.id }} />
                  <button
                    className={styles.icon}
                    title={V20.duplicate}
                    aria-label={V20.duplicate}
                    data-testid="cabi-note-duplicate"
                    onClick={() =>
                      void cabiClient()
                        .duplicateNote(n.id)
                        .then((c) => setNotice({ id: c.id, title: c.title }))
                        .catch(reportError)
                    }
                  >
                    <IconCopyItem />
                  </button>
                  <button
                    className={styles.icon}
                    aria-label={CABI.open}
                    title={CABI.open}
                    onClick={() => void openCabi("note", n.id).catch(reportError)}
                  >
                    <IconExpand />
                  </button>
                  {n.deleteLocked ? (
                    <button
                      className={`${styles.icon} ${styles.lockedIcon}`}
                      title={V20.lockedRow}
                      aria-label={V20.lockedRow}
                      data-testid="cabi-note-locked"
                      onClick={() => setError(V20.lockedRow)}
                    >
                      <IconLock />
                    </button>
                  ) : (
                    <button
                      className={styles.icon}
                      title={CABI.deleteNote}
                      aria-label={CABI.deleteNote}
                      data-testid="cabi-note-delete"
                      onClick={() =>
                        void (async () => {
                          const r = cabiClient();
                          const [refs, full] = await Promise.all([
                            r.referenceCount("note", n.id),
                            r.note(n.id),
                          ]);
                          setDeleting({ note: n, refs, images: cabiAssetIds(full.content).length });
                        })().catch(reportError)
                      }
                    >
                      <IconTrash />
                    </button>
                  )}
                </article>
              ))}
              {view === "list" ? (
                <ul data-testid="cabinet-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {shown.map(renderResource)}
                </ul>
              ) : (
                shown.map((r) => (
                  <article className={styles.row} key={r.id}>
                    <button className={styles.rowMain} onClick={() => void openItem(r.id)}>
                      <strong>{r.title}</strong>
                      <small>{r.target}</small>
                    </button>
                    <span className={styles.tag}>{r.kind === "folder" ? CABI.folder : CABI.link}</span>
                    <CabiDragGrip reference={{ kind: r.kind, id: r.id }} />
                  </article>
                ))
              )}
              {!noteRows.length && !shown.length && <p className={styles.message}>{CABI.empty}</p>}
            </div>
          )}
          {footer}
        </div>
        {previewOpen && (
          <aside className={styles.preview}>
            <h2>{preview?.title ?? CABI.preview}</h2>
            <p>{preview?.excerpt ?? CABI.taskHelp}</p>
            {preview && (
              <button
                className={styles.button}
                onClick={() => void openCabi("note", preview.id).catch(reportError)}
              >
                <IconExpand />
                {CABI.open}
              </button>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
export function BoardPreview({ board }: { board: TaskBoard }) {
  const ref = useRef<HTMLDivElement>(null),
    [width, setWidth] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const maxX = Math.max(800, ...board.doc.boxes.map((b) => b.x + b.w)),
    maxY = Math.max(350, ...board.doc.boxes.map((b) => b.y + (b.h ?? 100))),
    scale = Math.min(1, Math.max(150, width - 24) / maxX, 260 / maxY);
  return (
    <div ref={ref} className={styles.boardPreview} data-testid="cabi-board-preview">
      {board.doc.boxes.map((b) => (
        <div
          key={b.id}
          className={styles.previewBox}
          style={{ left: b.x * scale, top: b.y * scale, width: b.w * scale }}
        >
          {boxText(b) || CABI.image}
        </div>
      ))}
      <span className={`${styles.tag} ${styles.previewCaption}`}>{CABI.boardOwner}</span>
    </div>
  );
}

function BoardGallery({ tasks }: { tasks: { id: string; name: string }[] }) {
  const version = useCabiChange((s) => s.version),
    [boards, setBoards] = useState<TaskBoard[]>([]),
    [limit, setLimit] = useState(12),
    [total, setTotal] = useState(0);
  useEffect(() => {
    let active = true;
    void (async () => {
      const r = cabiClient(),
        metadata = await r.listBoards(),
        documents = await Promise.all(metadata.slice(0, limit).map((b) => r.board(b.categoryId)));
      if (active) {
        setTotal(metadata.length);
        setBoards(documents.filter((b): b is TaskBoard => b !== null));
      }
    })().catch(reportError);
    return () => {
      active = false;
    };
  }, [version, limit]);
  return (
    <div>
      {boards.map((b) => (
        <article key={b.id}>
          <h3>{tasks.find((t) => t.id === b.categoryId)?.name ?? CABI.board}</h3>
          <BoardPreview board={b} />
          <button
            className={styles.button}
            onClick={() => void openCabi("board", b.categoryId).catch(reportError)}
          >
            <IconExpand />
            {CABI.board}
          </button>
        </article>
      ))}
      {!boards.length && <p className={styles.message}>{CABI.empty}</p>}
      {total > limit && (
        <button className={styles.button} onClick={() => setLimit((n) => n + 12)}>
          {CABI.loadMore}
        </button>
      )}
    </div>
  );
}
