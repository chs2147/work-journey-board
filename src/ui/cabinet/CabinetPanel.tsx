// Cabinet 창(features-1102-spec F5, 시안 f5b): 앱 안 모달리스 창 — 왼쪽 업무별 묶음, 오른쪽 [전체·폴더·링크] 목록,
// 끌어 놓기 등록(탐색기 폴더 = A안 경로, 브라우저 링크 = 브라우저가 준 제목), 링크 등록 창(제목 고치기), 연결 고치기.
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { useWindowDrag } from "./useWindowDrag";
import {
  ALL_GROUP,
  countKinds,
  firstAnchor,
  linkTitleFromUrl,
  shortUrl,
  UNLINKED,
  type CabinetFilter,
  type CabinetItem,
  type CabinetLinkDraft,
} from "../../domain/cabinet";
import { isOpenableUrl } from "../../domain/links";
import { weekTitle } from "../../domain/week";
import { STR } from "../../shared/strings";
import { FolderIcon, LinkIcon } from "./CabinetIcons";
import {
  acceptsDrop,
  addItemToCategory,
  closeCabinet,
  closeLinkDialog,
  copyTarget,
  currentGroup,
  editLinkDialog,
  finishRename,
  groupsOf,
  handleDrop,
  linkLabels,
  newLinkDialog,
  openItem,
  patchLinkDialog,
  pickAndAddFolders,
  removeItem,
  reorderItem,
  revealItem,
  saveLinkDialog,
  saveLinks,
  startRename,
  useCabinet,
} from "./cabinetStore";
import styles from "./Cabinet.module.css";

/** 앱 안에서만 쓰는 끌기 자료 형식(줄 순서·업무에 놓기, improve-1102-spec C3·C4) — 등록용 놓기와 섞이지 않는다 */
export const CAB_MIME = "application/x-wjb-cabinet";
const isInternal = (dt: DataTransfer | null) => !!dt && [...dt.types].includes(CAB_MIME);
/** 끄는 중인 줄 id(dragover 중에는 자료를 읽을 수 없어 따로 들고 있다) */
let draggingId: string | null = null;

/** standalone = 실앱 별도 OS 창(창 머리·위치는 OS가) */
export function CabinetPanel({ standalone = false }: { standalone?: boolean }) {
  const s = useCabinet();
  const { pos, onPointerDown, z, raise } = useWindowDrag({ x: 76, y: 96 });
  const [dropOn, setDropOn] = useState(false);
  const [groupOver, setGroupOver] = useState<string | null>(null);
  const [mark, setMark] = useState<{ id: string; after: boolean } | null>(null);
  const groups = useMemo(() => groupsOf(s), [s.items, s.links, s.categories, s.activeIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const group = currentGroup(s);
  const groupIds = groups.find((g) => g.key === group)?.itemIds ?? [];
  const inGroup = s.items.filter((i) => groupIds.includes(i.id));
  const counts = countKinds(inGroup);
  const shown = inGroup
    .filter((i) => s.filter === "all" || i.kind === s.filter)
    .sort((a, b) => groupIds.indexOf(a.id) - groupIds.indexOf(b.id));
  const groupName = (key: string) =>
    key === ALL_GROUP
      ? STR.cabinet.allGroup
      : key === UNLINKED
        ? STR.cabinet.unlinked
        : (s.categories.find((c) => c.id === key)?.name ?? "");
  const canTakeItem = (key: string) => key !== ALL_GROUP && key !== UNLINKED;
  const rowDrag = {
    mark,
    onStart: (id: string) => {
      draggingId = id;
    },
    onEnd: () => {
      draggingId = null;
      setMark(null);
      setGroupOver(null);
    },
    onOver: (id: string, after: boolean) => {
      if (!mark || mark.id !== id || mark.after !== after) setMark({ id, after });
    },
    onDrop: (id: string, after: boolean) => {
      const moving = draggingId;
      setMark(null);
      if (!moving || moving === id) return;
      void reorderItem(moving, after ? { afterId: id } : { beforeId: id });
    },
  };
  const groupColor = (key: string) => s.categories.find((c) => c.id === key)?.color;

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const st = useCabinet.getState();
      if (st.linkDialog || st.linksFor || st.renaming) return; // 안쪽 창이 먼저
      const el = document.activeElement;
      if (el && panelRef.current?.contains(el)) {
        e.preventDefault();
        closeCabinet();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const panelRef = useRef<HTMLDivElement>(null);

  const dragProps = {
    onDragOver: (e: DragEvent) => {
      if (isInternal(e.dataTransfer) || !acceptsDrop(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
      setDropOn(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropOn(false);
    },
    onDrop: (e: DragEvent) => {
      if (isInternal(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      setDropOn(false);
      void handleDrop(e.dataTransfer);
    },
  };

  return (
    <div
      ref={panelRef}
      className={standalone ? styles.standalone : styles.win}
      style={standalone ? undefined : { left: pos.x, top: pos.y, width: 820, height: 560, zIndex: z }}
      onPointerDownCapture={standalone ? undefined : raise}
      onFocusCapture={standalone ? undefined : raise}
      role={standalone ? "main" : "dialog"}
      aria-label={`${STR.cabinet.title} — ${STR.cabinet.subtitle}`}
      data-testid="cabinet"
      {...dragProps}
    >
      {!standalone && (
        <div className={styles.winHead} onPointerDown={onPointerDown}>
          <span className={styles.winTitle}>
            <CabinetGlyph />
            {STR.cabinet.title} <small>— {STR.cabinet.subtitle}</small>
          </span>
          <button
            type="button"
            className={styles.iconBtn}
            aria-label={STR.cabinet.close}
            title={STR.cabinet.close}
            data-testid="cabinet-close"
            onClick={closeCabinet}
          >
            ✕
          </button>
        </div>
      )}
      <div className={styles.body}>
        <nav className={styles.side} aria-label={STR.cabinet.groups}>
          <div className={styles.sideLabel}>{STR.cabinet.groups}</div>
          {groups.map((g) => (
            <button
              key={g.key}
              type="button"
              className={[
                styles.group,
                g.key === group ? styles.groupOn : "",
                g.ended ? styles.groupEnded : "",
                groupOver === g.key ? styles.groupDrop : "",
                g.key === ALL_GROUP ? styles.groupAll : "",
              ].join(" ")}
              aria-current={g.key === group ? "true" : undefined}
              data-testid={`cabinet-group-${g.key}`}
              title={canTakeItem(g.key) && draggingId ? STR.cabinet.groupDrop : undefined}
              onClick={() => useCabinet.setState({ group: g.key })}
              onDragOver={(e) => {
                if (!isInternal(e.dataTransfer) || !canTakeItem(g.key)) return;
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "copy";
                if (groupOver !== g.key) setGroupOver(g.key);
              }}
              onDragLeave={() => setGroupOver((k) => (k === g.key ? null : k))}
              onDrop={(e) => {
                if (!isInternal(e.dataTransfer) || !canTakeItem(g.key)) return;
                e.preventDefault();
                e.stopPropagation();
                setGroupOver(null);
                const id = e.dataTransfer.getData(CAB_MIME) || draggingId;
                if (id) void addItemToCategory(id, g.key);
              }}
            >
              {g.key === ALL_GROUP ? (
                <CabinetGlyph />
              ) : g.key === UNLINKED ? (
                <span className={styles.dot} style={{ border: "1px solid var(--line-strong)" }} />
              ) : (
                <span className={styles.dot} style={{ background: `var(--cat-${groupColor(g.key)})` }} />
              )}
              <span className={styles.groupName}>{groupName(g.key)}</span>
              {g.ended && <span className={styles.endedTag}>{STR.cabinet.endedTag}</span>}
              <span className={styles.groupCount}>{g.itemIds.length}</span>
            </button>
          ))}
          <div className={`${styles.drop} ${dropOn ? styles.dropOn : ""}`} data-testid="cabinet-drop">
            {dropOn ? STR.cabinet.dropActive : STR.cabinet.dropHint}
          </div>
        </nav>
        <section className={`${styles.main} ${dropOn ? styles.mainOn : ""}`}>
          <div className={styles.mainHead}>
            <span className={styles.mainTitle} data-testid="cabinet-group-title">
              {groupName(group)}
            </span>
            <div className={styles.chips} role="radiogroup" aria-label={STR.cabinet.filterAria}>
              {(["all", "folder", "link"] as CabinetFilter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={s.filter === f}
                  className={`${styles.chip} ${s.filter === f ? styles.chipOn : ""}`}
                  data-testid={`cabinet-filter-${f}`}
                  onClick={() => useCabinet.setState({ filter: f })}
                >
                  {f === "folder" && <FolderIcon size={13} />}
                  {f === "link" && <LinkIcon size={13} />}
                  {STR.cabinet.filters[f]} {counts[f]}
                </button>
              ))}
            </div>
          </div>
          {s.items.length === 0 ? (
            <p className={styles.empty}>{STR.cabinet.empty}</p>
          ) : shown.length === 0 ? (
            <p className={styles.empty}>{STR.cabinet.emptyGroup}</p>
          ) : (
            <ul className={styles.list} data-testid="cabinet-list">
              {shown.map((it) => (
                <CabinetRow key={it.id} item={it} drag={rowDrag} />
              ))}
            </ul>
          )}
          <div className={styles.foot}>
            <button
              type="button"
              className={styles.button}
              data-testid="cabinet-add-folder"
              onClick={() => void pickAndAddFolders()}
            >
              {STR.cabinet.addFolder}
            </button>
            <button
              type="button"
              className={styles.button}
              data-testid="cabinet-add-link"
              onClick={newLinkDialog}
            >
              {STR.cabinet.addLink}
            </button>
            <span className={styles.footHint}>{STR.cabinet.footHint}</span>
          </div>
          {s.linkDialog && <LinkDialog />}
          {s.linksFor && <LinksDialog itemId={s.linksFor} />}
        </section>
      </div>
    </div>
  );
}

const CabinetGlyph = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 18 18"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    aria-hidden="true"
  >
    <rect x="3.5" y="2" width="11" height="14" rx="1.6" />
    <path d="M3.5 6.7h11M3.5 11.3h11M7.6 4.4h2.8M7.6 9h2.8M7.6 13.6h2.8" />
  </svg>
);

interface RowDrag {
  mark: { id: string; after: boolean } | null;
  onStart(id: string): void;
  onEnd(): void;
  onOver(id: string, after: boolean): void;
  onDrop(id: string, after: boolean): void;
}

function CabinetRow({ item, drag }: { item: CabinetItem; drag: RowDrag }) {
  const renaming = useCabinet((s) => s.renaming === item.id);
  const isOpen = useCabinet((s) => s.folders.some((f) => f.id === item.id));
  const flash = useCabinet((s) => s.flash === item.id);
  const labels = useCabinet((s) => linkLabels(item.id, s).join(" · "));
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const rowRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (flash) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [flash]);
  const sub = [
    item.kind === "folder" ? item.target : shortUrl(item.target),
    labels && STR.cabinet.linkedTo(labels),
  ]
    .filter(Boolean)
    .join(" · ");
  const onKeyDown = (e: KeyboardEvent<HTMLLIElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter") {
      e.preventDefault();
      void openItem(item.id);
    } else if (e.key === "F2") {
      e.preventDefault();
      startRename(item.id);
    } else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      setMenu({ x: r.right - 220, y: r.bottom - 8 });
    }
  };
  const openMenuAt = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const host = el.closest(`.${styles.main}`)!.getBoundingClientRect();
    setMenu({ x: r.right - host.left - 200, y: r.bottom - host.top + 2 });
  };
  return (
    <li
      ref={rowRef}
      tabIndex={0}
      className={[
        styles.row,
        isOpen ? styles.rowOpen : "",
        flash ? styles.flash : "",
        drag.mark?.id === item.id ? (drag.mark.after ? styles.markAfter : styles.markBefore) : "",
      ].join(" ")}
      data-testid="cabinet-row"
      data-kind={item.kind}
      data-id={item.id}
      draggable={!renaming}
      onDragStart={(e) => {
        e.dataTransfer.setData(CAB_MIME, item.id);
        e.dataTransfer.effectAllowed = "copyMove"; // 업무에 놓기 = copy, 순서 = move
        drag.onStart(item.id);
      }}
      onDragEnd={drag.onEnd}
      onDragOver={(e) => {
        if (!isInternal(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        const r = e.currentTarget.getBoundingClientRect();
        drag.onOver(item.id, e.clientY > r.top + r.height / 2);
      }}
      onDrop={(e) => {
        if (!isInternal(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        drag.onDrop(item.id, e.clientY > r.top + r.height / 2);
      }}
      onKeyDown={onKeyDown}
      onDoubleClick={() => void openItem(item.id)}
      onClick={(e) => {
        if (item.kind === "link" && !renaming && !(e.target as HTMLElement).closest("button,input"))
          void openItem(item.id);
      }}
      title={item.kind === "link" ? item.target : undefined}
    >
      <span className={styles.rowIcon} aria-label={STR.cabinet.filters[item.kind]}>
        {item.kind === "folder" ? <FolderIcon size={18} /> : <LinkIcon size={18} />}
      </span>
      <div className={styles.rowText}>
        {renaming ? (
          <RenameInput item={item} />
        ) : (
          <div className={styles.rowTitle}>
            <span data-testid="cabinet-row-title">{item.title}</span>
            {isOpen && <span className={styles.openTag}>{STR.cabinet.opened}</span>}
          </div>
        )}
        <div className={styles.rowSub}>{sub}</div>
      </div>
      <div className={styles.rowBtns}>
        <button
          type="button"
          className={styles.iconBtn}
          aria-label={STR.cabinet.open}
          title={STR.cabinet.open}
          onClick={(e) => {
            e.stopPropagation();
            void openItem(item.id);
          }}
        >
          ↗
        </button>
        <button
          type="button"
          className={styles.iconBtn}
          aria-label={STR.cabinet.more}
          aria-haspopup="menu"
          title={STR.cabinet.more}
          data-testid="cabinet-row-more"
          onClick={(e) => {
            e.stopPropagation();
            openMenuAt(e.currentTarget);
          }}
        >
          ⋯
        </button>
      </div>
      {menu && <RowMenu item={item} at={menu} onClose={() => setMenu(null)} />}
    </li>
  );
}

function RenameInput({ item }: { item: CabinetItem }) {
  const [v, setV] = useState(item.title);
  const done = useRef(false);
  const finish = (val: string | null) => {
    if (done.current) return;
    done.current = true;
    void finishRename(item.id, val);
  };
  return (
    <input
      className={styles.renameInput}
      aria-label={STR.cabinet.renameAria}
      data-testid="cabinet-rename"
      value={v}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setV(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(v);
        else if (e.key === "Escape") {
          e.preventDefault();
          finish(null);
        }
      }}
      onBlur={() => finish(v)}
    />
  );
}

function RowMenu({
  item,
  at,
  onClose,
}: {
  item: CabinetItem;
  at: { x: number; y: number };
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector("button")?.focus();
    const off = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", off);
    return () => window.removeEventListener("mousedown", off);
  }, [onClose]);
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <div
      ref={ref}
      className={styles.menu}
      role="menu"
      style={{ left: Math.max(8, at.x), top: at.y, position: "fixed" }}
      data-testid="cabinet-menu"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const bs = [...(ref.current?.querySelectorAll("button") ?? [])];
          const i = bs.indexOf(document.activeElement as HTMLButtonElement);
          bs[(i + (e.key === "ArrowDown" ? 1 : bs.length - 1)) % bs.length]?.focus();
        }
      }}
    >
      <button type="button" role="menuitem" onClick={run(() => void openItem(item.id))}>
        {STR.cabinet.menu.open}
      </button>
      <button
        type="button"
        role="menuitem"
        data-testid="cabinet-menu-rename"
        onClick={run(() => startRename(item.id))}
      >
        {STR.cabinet.menu.rename}
      </button>
      <button
        type="button"
        role="menuitem"
        data-testid="cabinet-menu-links"
        onClick={run(() =>
          item.kind === "link" ? editLinkDialog(item.id) : useCabinet.setState({ linksFor: item.id }),
        )}
      >
        {STR.cabinet.menu.links}
      </button>
      <button type="button" role="menuitem" onClick={run(() => void copyTarget(item.id))}>
        {STR.cabinet.menu.copy}
      </button>
      {item.kind === "folder" && (
        <button type="button" role="menuitem" onClick={run(() => void revealItem(item.id))}>
          {STR.cabinet.menu.reveal}
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        className={styles.danger}
        data-testid="cabinet-menu-remove"
        onClick={run(() => void removeItem(item.id))}
      >
        {STR.cabinet.menu.remove}
      </button>
    </div>
  );
}

/** 이번 주(보드가 보는 주) 본 항목 — 항목 연결 고르기(메인 창이 채워 Cabinet 창에도 보낸다) */
function useWeekEntries() {
  const weekId = useCabinet((s) => s.weekId);
  const entries = useCabinet((s) => s.weekEntries);
  return useMemo(() => {
    const byCat = new Map<string, { id: string; date: string; text: string }[]>();
    for (const e of entries) byCat.set(e.categoryId, [...(byCat.get(e.categoryId) ?? []), e]);
    return { weekId, byCat };
  }, [weekId, entries]);
}

function LinkChips({
  links,
  onChange,
}: {
  links: CabinetLinkDraft[];
  onChange: (l: CabinetLinkDraft[]) => void;
}) {
  const cats = useCabinet((s) => s.categories);
  const { byCat } = useWeekEntries();
  const [adding, setAdding] = useState<"cat" | "entry" | null>(null);
  const entryText = (id: string) => {
    for (const list of byCat.values()) {
      const e = list.find((x) => x.id === id);
      if (e) return `${e.date.slice(5).replace("-", "/")} ${e.text}`;
    }
    const l = useCabinet.getState().links.find((x) => x.entryId === id);
    return l?.entry ? `${l.entry.date.slice(5).replace("-", "/")} ${l.entry.text}` : id;
  };
  const label = (l: CabinetLinkDraft) =>
    "categoryId" in l ? (cats.find((c) => c.id === l.categoryId)?.name ?? "") : entryText(l.entryId);
  const usedCats = links.flatMap((l) => ("categoryId" in l ? [l.categoryId] : []));
  const usedEntries = links.flatMap((l) => ("entryId" in l ? [l.entryId] : []));
  return (
    <div className={styles.linkChips} data-testid="cabinet-link-chips">
      {links.map((l) => {
        const n = label(l);
        return (
          <span key={"categoryId" in l ? `c${l.categoryId}` : `e${l.entryId}`} className={styles.linkChip}>
            <span>{n}</span>
            <button
              type="button"
              aria-label={STR.cabinet.linkDialog.removeLink(n)}
              onClick={() => onChange(links.filter((x) => x !== l))}
            >
              ✕
            </button>
          </span>
        );
      })}
      {adding === "cat" ? (
        <select
          className={styles.select}
          autoFocus
          aria-label={STR.cabinet.linkDialog.addCategory}
          data-testid="cabinet-add-cat-select"
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) onChange([...links, { categoryId: e.target.value }]);
            setAdding(null);
          }}
          onBlur={() => setAdding(null)}
        >
          <option value="" disabled>
            {STR.cabinet.linkDialog.addCategory}
          </option>
          {cats
            .filter((c) => !usedCats.includes(c.id))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      ) : adding === "entry" ? (
        <select
          className={styles.select}
          autoFocus
          aria-label={STR.cabinet.linkDialog.addEntry}
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) onChange([...links, { entryId: e.target.value }]);
            setAdding(null);
          }}
          onBlur={() => setAdding(null)}
        >
          <option value="" disabled>
            {STR.cabinet.linkDialog.addEntry}
          </option>
          {[...byCat.entries()].map(([cid, list]) => (
            <optgroup key={cid} label={cats.find((c) => c.id === cid)?.name ?? ""}>
              {list
                .filter((x) => !usedEntries.includes(x.id))
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {`${x.date.slice(5).replace("-", "/")} ${x.text}`.slice(0, 80)}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      ) : (
        <>
          <button
            type="button"
            className={styles.addChip}
            data-testid="cabinet-add-cat"
            onClick={() => setAdding("cat")}
          >
            {STR.cabinet.linkDialog.addCategory}
          </button>
          <button type="button" className={styles.addChip} onClick={() => setAdding("entry")}>
            {STR.cabinet.linkDialog.addEntry}
          </button>
        </>
      )}
    </div>
  );
}

function LinkDialog() {
  const d = useCabinet((s) => s.linkDialog)!;
  const titleRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const L = STR.cabinet.linkDialog;
  useEffect(() => {
    (d.url ? titleRef.current : urlRef.current)?.focus();
    if (d.url) titleRef.current?.select();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const valid = isOpenableUrl(d.url.trim()) && d.title.trim().length > 0;
  const submit = () => {
    if (valid) void saveLinkDialog();
  };
  return (
    <div
      className={styles.dialogBack}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeLinkDialog();
      }}
    >
      <div
        className={styles.dialog}
        role="dialog"
        aria-label={d.mode === "new" ? L.newTitle : L.editTitle}
        data-testid="cabinet-link-dialog"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            closeLinkDialog();
          } else if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
            e.preventDefault();
            submit();
          }
        }}
      >
        <h3 className={styles.dialogTitle}>
          <LinkIcon size={18} />
          {d.mode === "new" ? L.newTitle : L.editTitle}
          {d.fromDrop && <small>— {L.dropped}</small>}
        </h3>
        <label className={styles.label} htmlFor="cab-link-title">
          {L.title} {d.mode === "new" && d.url && (d.titleFromBrowser ? L.titleHintBrowser : L.titleHintUrl)}
        </label>
        <input
          id="cab-link-title"
          ref={titleRef}
          className={styles.input}
          data-testid="cabinet-link-title"
          value={d.title}
          maxLength={200}
          onChange={(e) => patchLinkDialog({ title: e.target.value })}
        />
        <label className={styles.label} htmlFor="cab-link-url">
          {L.url}
        </label>
        <input
          id="cab-link-url"
          ref={urlRef}
          className={styles.input}
          data-testid="cabinet-link-url"
          value={d.url}
          placeholder={L.urlPlaceholder}
          onChange={(e) => patchLinkDialog({ url: e.target.value })}
          onPaste={(e) => {
            // Edge [링크 복사](친숙한 형식): HTML에 제목이 함께 온다
            const a = firstAnchor(e.clipboardData.getData("text/html"));
            const plain = e.clipboardData.getData("text/plain").trim();
            const url = a && isOpenableUrl(a.url) ? a.url : plain;
            if (!isOpenableUrl(url)) return;
            e.preventDefault();
            const title = a && a.title && a.title !== url ? a.title : "";
            patchLinkDialog({
              url,
              title: d.title.trim() ? d.title : title || linkTitleFromUrl(url),
              titleFromBrowser: !!title,
            });
            setTimeout(() => titleRef.current?.select(), 0);
          }}
          onBlur={() => {
            const u = d.url.trim();
            if (isOpenableUrl(u) && !d.title.trim()) patchLinkDialog({ title: linkTitleFromUrl(u) });
          }}
        />
        <span className={styles.label}>{L.links}</span>
        <LinkChips links={d.links} onChange={(links) => patchLinkDialog({ links })} />
        <div className={styles.dialogFoot}>
          <span>{L.keys}</span>
          <button type="button" className={styles.button} onClick={closeLinkDialog}>
            {L.cancel}
          </button>
          <button
            type="button"
            className={styles.primary}
            disabled={!valid}
            data-testid="cabinet-link-save"
            onClick={submit}
          >
            {d.mode === "new" ? L.save : L.saveEdit}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 폴더 연결 고치기: 업무(체크) + 이번 주 그 업무 항목(체크) */
function LinksDialog({ itemId }: { itemId: string }) {
  const item = useCabinet((s) => s.items.find((i) => i.id === itemId));
  const cats = useCabinet((s) => s.categories);
  const initial = useCabinet.getState().links.filter((l) => l.itemId === itemId);
  const [catSel, setCatSel] = useState<string[]>(
    initial.flatMap((l) => (l.categoryId ? [l.categoryId] : [])),
  );
  const [entrySel, setEntrySel] = useState<string[]>(initial.flatMap((l) => (l.entryId ? [l.entryId] : [])));
  const { weekId, byCat } = useWeekEntries();
  const L = STR.cabinet.linksDialog;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector("input")?.focus();
  }, []);
  if (!item) return null;
  const close = () => useCabinet.setState({ linksFor: null });
  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const save = () =>
    void saveLinks(itemId, [
      ...catSel.map((categoryId) => ({ categoryId })),
      ...entrySel.map((entryId) => ({ entryId })),
    ]);
  // 지난 주 항목 연결(이번 주 목록에 없는 것)도 유지
  const otherEntries = initial.filter(
    (l) => l.entryId && ![...byCat.values()].flat().some((x) => x.id === l.entryId),
  );
  return (
    <div
      className={styles.dialogBack}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={ref}
        className={styles.dialog}
        role="dialog"
        aria-label={L.title(item.title)}
        data-testid="cabinet-links-dialog"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            close();
          } else if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "BUTTON") {
            e.preventDefault();
            save();
          }
        }}
      >
        <h3 className={styles.dialogTitle}>
          {item.kind === "folder" ? <FolderIcon size={18} /> : <LinkIcon size={18} />}
          {L.title(item.title)}
        </h3>
        <span className={styles.label}>
          {L.categories} · {weekId && L.entries(weekTitle(weekId))}
        </span>
        <ul className={styles.checkList}>
          {cats.map((c) => (
            <li key={c.id}>
              <label>
                <input
                  type="checkbox"
                  checked={catSel.includes(c.id)}
                  data-testid={`cabinet-link-cat-${c.id}`}
                  onChange={() => toggle(catSel, setCatSel, c.id)}
                />
                <span className={styles.dot} style={{ background: `var(--cat-${c.color})` }} />
                {c.name}
              </label>
              {(byCat.get(c.id) ?? []).map((x) => (
                <label key={x.id} className={styles.sub}>
                  <input
                    type="checkbox"
                    checked={entrySel.includes(x.id)}
                    onChange={() => toggle(entrySel, setEntrySel, x.id)}
                  />
                  {`${x.date.slice(5).replace("-", "/")} ${x.text}`.slice(0, 70)}
                </label>
              ))}
            </li>
          ))}
          {otherEntries.map((l) => (
            <li key={l.id}>
              <label className={styles.sub}>
                <input
                  type="checkbox"
                  checked={entrySel.includes(l.entryId!)}
                  onChange={() => toggle(entrySel, setEntrySel, l.entryId!)}
                />
                {l.entry ? `${l.entry.date.slice(5).replace("-", "/")} ${l.entry.text}`.slice(0, 70) : ""}
              </label>
            </li>
          ))}
        </ul>
        <div className={styles.dialogFoot}>
          <span />
          <button type="button" className={styles.button} onClick={close}>
            {L.cancel}
          </button>
          <button type="button" className={styles.primary} data-testid="cabinet-links-save" onClick={save}>
            {L.save}
          </button>
        </div>
      </div>
    </div>
  );
}
