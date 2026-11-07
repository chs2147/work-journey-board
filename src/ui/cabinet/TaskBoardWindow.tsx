import { flushSync } from "react-dom";
import { V17 } from "../../shared/v17Strings";
import { SaveStatus } from "../common/SaveStatus";
import { DeleteBoardDialog } from "./DeleteBoardDialog";
import { emptyContent, type TextBox } from "../../domain/note";
import { saveSnapshot } from "../note/snapshot";
import { IconExportFile, IconExpand } from "../common/icons";
import { useEffect, useState } from "react";
import type { WeeklyMemo } from "../../domain/cabi";
import { referenceBox } from "../../domain/cabi";
import type { NoteDoc } from "../../domain/note";
import type { CabinetItem } from "../../domain/cabinet";
import { CABI } from "../../shared/cabiStrings";
import { IconNote, IconClock, IconPlus, IconTrash, IconChevronRight } from "../common/icons";
import { useAppStore } from "../common/appStore";
import { NoteDock } from "../note/NoteDock";
import {
  flushNote,
  importBoardObjects,
  initTaskNote,
  refreshBoardAssetMeta,
  refreshNoteLinks,
  detachNote,
  useNote,
} from "../note/noteStore";
import { reportError, toast, useBoard } from "../board/boardStore";
import {
  cabiCall,
  cabiClient,
  cabiContext,
  createCabiNote,
  openCabiReference,
  receiveCabiDrag,
  registerCabiDrag,
  registerCabiFlush,
  useCabiChange,
} from "./cabiService";
import { taskNotePort } from "./taskNotePort";
import { CabiDragGrip } from "./CabiDrag";
import { exportTaskBoard } from "./cabiExport";
import styles from "./Cabi.module.css";

function savedWidth(key: string, fallback: number) {
  return Math.max(200, Math.min(480, Number(localStorage.getItem(key)) || fallback));
}
function PanelResize({
  width,
  onChange,
  keyName,
  side = "left",
}: {
  width: number;
  onChange: (n: number) => void;
  keyName: string;
  side?: "left" | "right";
}) {
  return (
    <button
      className={styles.resize}
      aria-label={CABI.settings}
      onKeyDown={(e) => {
        if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
          e.preventDefault();
          const n = Math.max(
            200,
            Math.min(480, width + (e.key === "ArrowRight" ? 20 : -20) * (side === "right" ? -1 : 1)),
          );
          onChange(n);
          localStorage.setItem(keyName, String(n));
        }
      }}
      onPointerDown={(e) => {
        const el = e.currentTarget,
          x = e.clientX;
        el.setPointerCapture(e.pointerId);
        let next = width;
        const move = (ev: PointerEvent) => {
          next = Math.max(200, Math.min(480, width + (ev.clientX - x) * (side === "right" ? -1 : 1)));
          onChange(next);
        };
        const up = () => {
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerup", up);
          el.removeEventListener("pointercancel", up);
          localStorage.setItem(keyName, String(next));
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);
      }}
    />
  );
}
export function TaskBoardWindow({ categoryId }: { categoryId: string }) {
  const [title, setTitle] = useState(""),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [library, setLibrary] = useState(false),
    [weekly, setWeekly] = useState(false),
    [resources, setResources] = useState<CabinetItem[]>([]),
    [notes, setNotes] = useState<{ id: string; title: string }[]>([]),
    [leftW, setLeftW] = useState(() => savedWidth("cabi-library-width", 260)),
    [deleteRevision, setDeleteRevision] = useState<number | null>(null),
    [addWidget, setAddWidget] = useState(false),
    [exportOpen, setExportOpen] = useState(false),
    [rightW, setRightW] = useState(() => savedWidth("cabi-weekly-width", 300));
  useEffect(() => {
    if (!title) return;
    document.title = `${title} — Cabi.NET · ${CABI.boardOwner}`;
    void useAppStore
      .getState()
      .platform?.setWindowTitle?.(document.title)
      .catch(() => undefined);
  }, [title]);
  const saveError = useNote((s) => s.saveError),
    version = useCabiChange((s) => s.version),
    disconnected = useCabiChange((s) => s.disconnected);
  useEffect(() => {
    let active = true;
    void (async () => {
      const c = await cabiContext(),
        board = await cabiClient().board(categoryId, true);
      if (!active || !board) return;
      const name = c.categories.find((t) => t.id === categoryId)?.name ?? CABI.board;
      setTitle(name);
      useBoard.setState({ view: c.view, cells: c.cells, weekId: c.weekId, today: c.today });
      await initTaskNote(taskNotePort(board), {
        categoryId,
        boardId: board.id,
        title: name,
        dataDir: c.dataDir,
      });
      if (active) setReady(true);
    })().catch((e) => setError(String(e)));
    const off = registerCabiFlush(async () => {
      await flushNote(true, true);
    });
    return () => {
      active = false;
      off();
    };
  }, [categoryId]);
  useEffect(() => {
    if (ready) void refreshNoteLinks().catch(reportError);
  }, [version, ready]);
  useEffect(() => {
    let active = true;
    void (async () => {
      const [snapshot, n] = await Promise.all([
        cabiCall<{
          items: CabinetItem[];
          links: { itemId: string; categoryId: string | null; entry?: { categoryId: string } | null }[];
        }>("snapshot"),
        cabiClient().listNotes(categoryId),
      ]);
      if (!active) return;
      const ids = new Set(
        snapshot.links
          .filter((l) => l.categoryId === categoryId || l.entry?.categoryId === categoryId)
          .map((l) => l.itemId),
      );
      setResources(snapshot.items.filter((r) => ids.has(r.id)));
      setNotes(n);
    })().catch(reportError);
    return () => {
      active = false;
    };
  }, [categoryId, version]);
  return (
    <div className={styles.window} data-testid="cabi-task-board">
      <header className={styles.header}>
        <div>
          <h1>{title || CABI.board}</h1>
        </div>
        <div className={styles.actions}>
          <SaveStatus
            saving={useBoard((s) => s.saving) > 0}
            error={saveError ?? undefined}
            onRetry={() => void flushNote(true, true).catch(reportError)}
          />
          <button className={styles.button} aria-label={V17.add} onClick={() => setAddWidget(!addWidget)}>
            + {V17.add}
          </button>
          <button
            className={`${styles.button} ${library ? styles.active : ""}`}
            onClick={() => setLibrary((v) => !v)}
          >
            <IconNote />
            {CABI.library}
          </button>
          <button
            className={`${styles.button} ${weekly ? styles.active : ""}`}
            onClick={() => setWeekly((v) => !v)}
          >
            <IconClock />
            {CABI.weekly}
          </button>
          <button className={styles.button} onClick={() => setExportOpen(!exportOpen)}>
            <IconExportFile />
            {CABI.export}
          </button>
          <button
            className={styles.icon}
            title={CABI.deleteBoard}
            aria-label={CABI.deleteBoard}
            onClick={() =>
              void (async () => {
                await flushNote(true, true);
                const b = await cabiClient().board(categoryId);
                if (b) setDeleteRevision(b.revision);
              })().catch(reportError)
            }
          >
            <IconTrash />
          </button>
        </div>
      </header>
      {addWidget && (
        <div className={styles.toolbar}>
          {(["elapsed", "timeline", "important"] as const).map((type) => (
            <button
              className={styles.button}
              key={type}
              onClick={() => {
                const doc = useNote.getState().doc;
                const box: TextBox = {
                  id: crypto.randomUUID(),
                  kind: "text",
                  x: 24,
                  y: Math.max(24, ...doc.boxes.map((b) => b.y + (b.h ?? 100) + 24)),
                  w: type === "elapsed" ? 300 : 640,
                  h: type === "elapsed" ? 200 : 340,
                  z: doc.boxes.length + 1,
                  bg: null,
                  content: emptyContent(),
                  widget: { type, basis: "start", variant: "records", weeks: 8, milestoneEntryIds: [] },
                };
                importBoardObjects({ v: 1, boxes: [box] });
                setAddWidget(false);
              }}
            >
              {V17[type]}
            </button>
          ))}
        </div>
      )}
      {exportOpen && (
        <div className={styles.toolbar}>
          <button
            className={styles.button}
            onClick={() => {
              setExportOpen(false);
              void exportTaskBoard().catch(reportError);
            }}
          >
            {CABI.markdown}
          </button>
          <button
            className={styles.button}
            onClick={() => {
              setExportOpen(false);
              void saveSnapshot().catch(reportError);
            }}
          >
            {V17.png}
          </button>
        </div>
      )}
      {deleteRevision !== null && (
        <DeleteBoardDialog
          title={title}
          count={useNote.getState().doc.boxes.length}
          onCancel={() => setDeleteRevision(null)}
          onDelete={async () => {
            await flushNote(true, true);
            await cabiClient().removeBoard(categoryId, deleteRevision);
            // Dismiss the native modal before closing its modeless window.
            flushSync(() => {
              setDeleteRevision(null);
              setReady(false);
            });
            detachNote();
            await useAppStore.getState().platform?.cabi.closeSelf();
          }}
        />
      )}
      {(error || saveError || disconnected) && (
        <p className={`${styles.message} ${styles.error}`} role="alert">
          {error || saveError || (disconnected ? CABI.disconnected : "")}{" "}
          {saveError && (
            <button className={styles.button} onClick={() => void flushNote(true, true).catch(reportError)}>
              {CABI.retry}
            </button>
          )}
        </p>
      )}
      <div
        className={styles.boardBody}
        style={disconnected ? { pointerEvents: "none", opacity: 0.65 } : undefined}
      >
        {library && (
          <>
            <aside className={`${styles.panel} ${styles.panelLeft}`} style={{ width: leftW }}>
              <header className={styles.header}>
                <h2>{CABI.library}</h2>
                <button
                  className={styles.icon}
                  title={CABI.close}
                  aria-label={CABI.close}
                  onClick={() => setLibrary(false)}
                >
                  <IconChevronRight />
                </button>
              </header>
              <p className={styles.message}>{CABI.referenceHelp}</p>
              <div className={styles.scroll}>
                {[
                  ...notes.map((n) => ({ id: n.id, title: n.title, kind: "note" as const })),
                  ...resources,
                ].map((r) => (
                  <div className={styles.row} key={r.id}>
                    <span className={styles.rowMain}>{r.title}</span>
                    <CabiDragGrip reference={{ kind: r.kind, id: r.id }} />
                  </div>
                ))}
                <button
                  className={styles.button}
                  onClick={() => void createCabiNote(categoryId).catch(reportError)}
                >
                  <IconPlus />
                  {CABI.newNote}
                </button>
              </div>
            </aside>
            <PanelResize width={leftW} onChange={setLeftW} keyName="cabi-library-width" />
          </>
        )}
        <div className={styles.boardCanvas}>
          {ready ? <NoteDock variant="side" /> : <p className={styles.message}>{CABI.loading}</p>}
        </div>
        {weekly && (
          <>
            <PanelResize width={rightW} onChange={setRightW} keyName="cabi-weekly-width" side="right" />
            <WeeklyPanel categoryId={categoryId} width={rightW} onClose={() => setWeekly(false)} />
          </>
        )}
      </div>
    </div>
  );
}
function WeeklyPanel({
  categoryId,
  width,
  onClose,
}: {
  categoryId: string;
  width: number;
  onClose: () => void;
}) {
  const [memos, setMemos] = useState<WeeklyMemo[]>([]),
    [query, setQuery] = useState(""),
    [week, setWeek] = useState(""),
    [limit, setLimit] = useState(60),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [mode, setMode] = useState("ref"),
    [busy, setBusy] = useState(false),
    version = useCabiChange((s) => s.version);
  useEffect(() => {
    let active = true;
    void cabiClient()
      .weeklyMemos(categoryId, query, 0, limit)
      .then((rows) => {
        if (active) setMemos(rows);
      })
      .catch(reportError);
    return () => {
      active = false;
    };
  }, [categoryId, query, limit, version]);
  const key = (m: WeeklyMemo) => m.weekId + "/" + m.boxId,
    doc = useNote((s) => s.doc),
    shown = memos.filter((m) => !week || m.weekId === week),
    linked = (m: WeeklyMemo) =>
      doc.boxes.some(
        (b) =>
          b.kind === "text" &&
          b.resource?.kind === "memo" &&
          b.resource.weekId === m.weekId &&
          b.resource.boxId === m.boxId,
      );
  const add = async () => {
    setBusy(true);
    try {
      await flushNote(true, true);
      const source = memos.filter((m) => selected.has(key(m))),
        current = useNote.getState().doc,
        y = Math.max(24, ...current.boxes.map((b) => b.y + (b.h ?? 100) + 25));
      if (mode === "ref") {
        const boxes = source
          .filter((m) => !linked(m))
          .map((m, i) =>
            referenceBox(
              crypto.randomUUID(),
              { kind: "memo", weekId: m.weekId, boxId: m.boxId },
              m.title,
              24 + (i % 2) * 350,
              y + Math.floor(i / 2) * 180,
              current.boxes.length + i,
            ),
          );
        importBoardObjects({ v: 1, boxes });
      } else {
        for (const w of new Set(source.map((m) => m.weekId))) {
          const token = crypto.randomUUID(),
            original = await cabiCall<NoteDoc>("source", { kind: "week", weekId: w });
          await registerCabiDrag(
            token,
            { kind: "week", weekId: w },
            original,
            source.filter((m) => m.weekId === w).map((m) => m.boxId),
          );
          const bottom = Math.max(y, ...useNote.getState().doc.boxes.map((b) => b.y + (b.h ?? 100) + 25));
          const incoming = await receiveCabiDrag(token, { kind: "task", categoryId }, { x: 24, y: bottom });
          await refreshBoardAssetMeta();
          importBoardObjects(incoming);
        }
      }
      await flushNote(true, true);
      setSelected(new Set());
      toast(mode === "ref" ? CABI.referenced(source.length) : CABI.copied(source.length));
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside className={styles.panel} style={{ width }} data-testid="cabi-weekly-panel">
      <header className={styles.header}>
        <h2>{CABI.weeklyTitle}</h2>
        <button className={styles.icon} title={CABI.close} aria-label={CABI.close} onClick={onClose}>
          <IconChevronRight />
        </button>
        <p>{CABI.weeklyHelp}</p>
        <input
          className={styles.search}
          aria-label={CABI.memoSearch}
          placeholder={CABI.memoSearch}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className={styles.taskSelect}
          aria-label={CABI.weekFilter}
          value={week}
          onChange={(e) => setWeek(e.target.value)}
        >
          <option value="">{CABI.allWeeks}</option>
          {[...new Set(memos.map((m) => m.weekId))].map((w) => (
            <option key={w}>{w}</option>
          ))}
        </select>
      </header>
      <div className={styles.scroll}>
        {shown.map((m) => (
          <article className={styles.memo} key={key(m)}>
            <header>
              <span>{m.weekId}</span>
              <input
                type="checkbox"
                aria-label={m.title}
                checked={selected.has(key(m))}
                onChange={() =>
                  setSelected((prev) => {
                    const n = new Set(prev);
                    if (n.has(key(m))) n.delete(key(m));
                    else n.add(key(m));
                    return n;
                  })
                }
              />
            </header>
            <strong>{m.title}</strong>
            <p>{CABI.linkedItems(m.entryIds.length)}</p>
            <footer className={styles.memoActions}>
              {linked(m) ? <span className={styles.tag}>{CABI.linked}</span> : <span />}
              <button
                className={styles.icon}
                title={CABI.openSource}
                aria-label={CABI.openSource}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void openCabiReference({ kind: "memo", weekId: m.weekId, boxId: m.boxId }).catch(
                    reportError,
                  );
                }}
              >
                <IconExpand />
              </button>
            </footer>
          </article>
        ))}
        {!shown.length && <p className={styles.message}>{CABI.emptyWeekly}</p>}
        {memos.length >= limit && (
          <button className={styles.button} onClick={() => setLimit((n) => n + 60)}>
            {CABI.loadMore}
          </button>
        )}
      </div>
      <div className={styles.panelFoot}>
        <select
          className={styles.taskSelect}
          aria-label={CABI.copy}
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          <option value="ref">{CABI.reference}</option>
          <option value="copy">{CABI.copy}</option>
        </select>
        <button
          className={`${styles.button} ${styles.primary}`}
          disabled={!selected.size || busy}
          onClick={() => void add()}
        >
          {CABI.addSelected(selected.size)}
        </button>
      </div>
    </aside>
  );
}
