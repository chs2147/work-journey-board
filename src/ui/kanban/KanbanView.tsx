// 칸반 보드 화면(docs/improve-v21-spec.md 2·3·4절, 시안 docs/mockups/v21 ①②⑤).
// 카드 전체가 끌기 대상(HTML5 DnD) — 열에 놓으면 상태 변경, Cabinet 줄을 카드에 놓으면 그 항목에 연결.
import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import {
  suggestIcon,
  DONE,
  KANBAN_FREE,
  KANBAN_FREE_MIN_VIEW,
  TODO,
  doneGroupOf,
  snapGrid,
  type KanbanRect,
  type KanbanSection,
  type SectionKey,
} from "../../domain/kanban";
import type { KanbanCard, StatusLogRow } from "../../data/kanbanRepository";
import { localDate } from "../../domain/localTime";
import { shortDateLabel } from "../../domain/week";
import { matchesTagFilter } from "../../domain/tags";
import { STR } from "../../shared/strings";
import { revealItem, useBoard } from "../board/boardStore";
import { dueView } from "../board/dueView";
import { CAB_MIME } from "../cabinet/CabinetPanel";
import { useModal } from "./kanbanUi";
import { Celebration } from "./Celebration";
import { IconPicker, SectionIconImg } from "./SectionIcon";
import {
  closeKanban,
  cardsOf,
  clearSection,
  createSection,
  deleteCard,
  deleteSection,
  DONE_PAGE,
  linkCabinetItem,
  load,
  moveCard,
  columnIcon,
  columnKeys,
  columnName,
  placeColumn,
  setColumnIcon,
  shiftColumn,
  toggleCardRepeat,
  cardRepeating,
  layoutRects,
  setRect,
  neighborKey,
  patchCard,
  setDragging,
  setFilter,
  statusLog,
  toggleExpanded,
  updateSection,
  useKanban,
} from "./kanbanStore";
import { ItemDialog, type ItemDialogTarget } from "./ItemDialog";
import { BulkDialog, RecentBulk } from "./BulkDialog";
import { DueDatePopover, StartTimePopover } from "../board/ItemActions";
import { defaultStartTime } from "../../domain/startTime";
import styles from "./Kanban.module.css";

const K = STR.kanban;
export const CARD_MIME = "application/x-wjb-kanban-card";
/** 끄는 중인 카드(dragover 중엔 자료를 읽을 수 없음) */
let dragCard: { id: string; from: SectionKey; children: number } | null = null;

function md(at: string) {
  return shortDateLabel(localDate(new Date(at))).replace(" ", "");
}

export function KanbanView() {
  const s = useKanban();
  // 상단 [업무 추가] 창이 닫히면 업무 목록을 다시 읽는다(새 업무가 카드 추가 창·거르기에 바로 보이게)
  const addOpen = useBoard((b) => b.addOpen);
  const wasAdding = useRef(false);
  useEffect(() => {
    if (wasAdding.current && !addOpen) void load();
    wasAdding.current = addOpen;
  }, [addOpen]);
  const [dialog, setDialog] = useState<ItemDialogTarget | null>(null);
  const sectionDlg = useKanban((k) => k.sectionDialog);
  const setSectionDlg = (v: { id: string | null } | null) => useKanban.setState({ sectionDialog: v });
  const [confirmDel, setConfirmDel] = useState<KanbanSection | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [recentBulk, setRecentBulk] = useState<{ x: number; y: number } | null>(null);
  const keys: SectionKey[] = columnKeys(s);

  // N = 항목 추가(입력에 초점이 없을 때)
  useEffect(() => {
    const key = (e: globalThis.KeyboardEvent) => {
      if (dialog || sectionDlg || bulkOpen) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input,textarea,select,[contenteditable=true],dialog")) return;
      if (!e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "n" || e.key === "N" || e.key === "ㅜ")) {
        e.preventDefault();
        setDialog({ mode: "add", sectionId: null });
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [dialog, sectionDlg, bulkOpen]);

  // 배치 모드(improve-v22-spec 4절): 좁은 창(< 900px)은 자유여도 균등으로 보인다(저장값 그대로)
  const layoutMode = useKanban((k) => k.layout.mode);
  const [viewW, setViewW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setViewW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const free = layoutMode === "free" && viewW >= KANBAN_FREE_MIN_VIEW;
  const rects = free ? layoutRects(s) : null;
  const [front, setFront] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ key: string; rect: KanbanRect } | null>(null);
  /** 머리 끌기 = 위치, 오른쪽 아래 모서리 = 크기. 8px 격자에 붙음 */
  const freeDrag = (key: SectionKey, kind: "move" | "size") => (e: React.PointerEvent) => {
    if (e.button !== 0 || !rects) return;
    if (kind === "move" && (e.target as HTMLElement).closest("button,select,input,a")) return;
    e.preventDefault();
    const start = rects[key]!;
    const x0 = e.clientX,
      y0 = e.clientY;
    setFront(key);
    const calc = (ev: PointerEvent): KanbanRect =>
      kind === "move"
        ? {
            ...start,
            x: Math.max(0, snapGrid(start.x + ev.clientX - x0)),
            y: Math.max(0, snapGrid(start.y + ev.clientY - y0)),
          }
        : {
            ...start,
            w: Math.max(KANBAN_FREE.minW, snapGrid(start.w + ev.clientX - x0)),
            h: Math.max(KANBAN_FREE.minH, snapGrid(start.h + ev.clientY - y0)),
          };
    const move = (ev: PointerEvent) => setDraft({ key, rect: calc(ev) });
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDraft(null);
      const r = calc(ev);
      if (r.x !== start.x || r.y !== start.y || r.w !== start.w || r.h !== start.h) void setRect(key, r);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const column = (key: SectionKey) => (
    <Column
      key={key}
      freeMove={rects ? freeDrag(key, "move") : undefined}
      sectionKey={key}
      section={s.sections.find((x) => x.id === key) ?? null}
      onAdd={() => setDialog({ mode: "add", sectionId: key === TODO ? null : key })}
      onEdit={(card) => setDialog({ mode: "edit", card })}
      onRename={(id) => setSectionDlg({ id })}
      onDelete={(sec) => setConfirmDel(sec)}
      onBulk={() => setBulkOpen(true)}
      onRecent={(x, y) => setRecentBulk({ x, y })}
      index={keys.indexOf(key)}
      count={keys.length}
    />
  );

  return (
    <section className={styles.view} aria-label={K.title} data-testid="kanban-view">
      <div
        className={`${styles.cols} ${rects ? styles.freeBoard : ""}`}
        data-testid="kanban-board"
        data-layout={rects ? "free" : "equal"}
      >
        {rects
          ? keys.map((key) => {
              const r = draft?.key === key ? draft.rect : rects[key]!;
              return (
                <div
                  key={key}
                  className={styles.freeItem}
                  data-testid="kanban-free-item"
                  data-key={key}
                  style={{ left: r.x, top: r.y, width: r.w, height: r.h, zIndex: front === key ? 2 : 1 }}
                >
                  {column(key)}
                  <span
                    className={styles.resize}
                    data-testid="kanban-free-resize"
                    aria-hidden="true"
                    onPointerDown={freeDrag(key, "size")}
                  />
                </div>
              );
            })
          : keys.map(column)}
      </div>
      {dialog && <ItemDialog target={dialog} onClose={() => setDialog(null)} />}
      {sectionDlg && <SectionDialog id={sectionDlg.id} onClose={() => setSectionDlg(null)} />}
      {confirmDel && (
        <ConfirmDelete
          section={confirmDel}
          count={s.openCards.filter((c) => c.sectionId === confirmDel.id).length}
          onClose={() => setConfirmDel(null)}
        />
      )}
      {bulkOpen && <BulkDialog onClose={() => setBulkOpen(false)} />}
      {recentBulk && <RecentBulk at={recentBulk} onClose={() => setRecentBulk(null)} />}
      <Celebration />
    </section>
  );
}

/** 섹션 머리 끌기 — TODO·DONE 포함 모든 열(improve-v23-spec 2절) */
const SECTION_MIME = "application/x-wjb-kanban-section";
let dragSection: string | null = null;

function Column({
  freeMove,
  sectionKey,
  section,
  onAdd,
  onEdit,
  onRename,
  onDelete,
  onBulk,
  onRecent,
  index,
  count,
}: {
  /** 자유 배치: 머리를 끌면 상자 위치를 옮김(순서 끌기 대신) */
  freeMove?: (e: React.PointerEvent) => void;
  sectionKey: SectionKey;
  section: KanbanSection | null;
  onAdd(): void;
  onEdit(card: KanbanCard): void;
  onRename(id: string): void;
  onDelete(s: KanbanSection): void;
  onBulk(): void;
  onRecent(x: number, y: number): void;
  index: number;
  count: number;
}) {
  const s = useKanban();
  const [over, setOver] = useState(false);
  const [secOver, setSecOver] = useState<"before" | "after" | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const flashing = useKanban((k) => k.flashKey === sectionKey);
  // 상단 태그 거르기(주간 보드와 같은 것, improve-v22-spec 5절) — 고른 태그가 있는 업무의 카드만
  const tagFilter = useBoard((b) => b.tagFilter);
  const categoryTags = useBoard((b) => b.categoryTags);
  const cards = cardsOf(sectionKey, s).filter(
    (c) => !tagFilter.length || matchesTagFilter(categoryTags[c.categoryId] ?? [], tagFilter),
  );
  const isDone = sectionKey === DONE;
  const name = columnName(sectionKey, s);
  const icon = columnIcon(sectionKey, s);
  // 섹션 색은 무채색 두 가지만(업무 색과 혼동 방지): DONE만 진한 회색, TODO·사용자 섹션은 모두 같은 회색
  const color = isDone ? "var(--kanban-done)" : "var(--kanban-section)";
  const total = isDone && !tagFilter.length ? s.doneTotal : cards.length;
  const canDrop = () => !!dragCard && dragCard.from !== sectionKey;

  const onDragOver = (e: DragEvent) => {
    if ([...e.dataTransfer.types].includes(SECTION_MIME)) {
      if (!dragSection || dragSection === sectionKey) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const r = e.currentTarget.getBoundingClientRect();
      const side = e.clientX < r.left + r.width / 2 ? "before" : "after";
      if (secOver !== side) setSecOver(side);
      return;
    }
    if (![...e.dataTransfer.types].includes(CARD_MIME) || !canDrop()) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!over) setOver(true);
  };
  const onDrop = (e: DragEvent) => {
    if ([...e.dataTransfer.types].includes(SECTION_MIME)) {
      e.preventDefault();
      const id = dragSection;
      const side = secOver;
      setSecOver(null);
      dragSection = null;
      if (!id || !side || id === sectionKey) return;
      void placeColumn(id, side === "before" ? index : index + 1);
      return;
    }
    if (![...e.dataTransfer.types].includes(CARD_MIME)) return;
    e.preventDefault();
    setOver(false);
    const id = e.dataTransfer.getData(CARD_MIME) || dragCard?.id;
    const ok = !!id && canDrop();
    // 옮긴 카드는 다른 열에서 새로 그려져 원래 요소의 dragend가 React에 닿지 않는다 — 놓을 때 끌기 상태를 지운다
    dragCard = null;
    setDragging(null);
    if (ok) void moveCard(id, sectionKey, { x: e.clientX, y: e.clientY });
  };

  return (
    <div
      className={`${styles.col} ${isDone ? styles.colDone : ""} ${over ? styles.colOver : ""} ${secOver === "before" ? styles.secBefore : secOver === "after" ? styles.secAfter : ""} ${flashing ? styles.colFlash : ""}`}
      data-testid={`kanban-col-${isDone ? "done" : sectionKey === TODO ? "todo" : "section"}`}
      data-section={sectionKey}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setOver(false);
          setSecOver(null);
        }
      }}
      onDrop={onDrop}
    >
      <div
        className={`${styles.colHead} ${styles.colHeadDrag}`}
        style={{ borderTopColor: color }}
        data-testid="kanban-col-head"
        onPointerDown={freeMove}
        {...(!freeMove
          ? {
              draggable: true,
              tabIndex: 0,
              title: K.sectionDragTip,
              "aria-roledescription": K.sectionDragTip,
              onDragStart: (e: DragEvent) => {
                if ((e.target as HTMLElement).closest("button,select,input")) return e.preventDefault();
                dragSection = sectionKey;
                e.dataTransfer.setData(SECTION_MIME, sectionKey);
                e.dataTransfer.effectAllowed = "move";
              },
              onDragEnd: () => {
                dragSection = null;
              },
              onKeyDown: (e: KeyboardEvent) => {
                if (!e.altKey || !e.shiftKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
                if (e.target !== e.currentTarget) return;
                e.preventDefault();
                void shiftColumn(sectionKey, e.key === "ArrowLeft" ? -1 : 1).then(() =>
                  document
                    .querySelector<HTMLElement>(
                      `[data-section="${sectionKey}"] [data-testid="kanban-col-head"]`,
                    )
                    ?.focus(),
                );
              },
            }
          : {})}
      >
        <button
          type="button"
          className={styles.secIconBtn}
          aria-label={K.iconMenu}
          title={K.iconMenu}
          data-testid="kanban-col-icon"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setPicker({ x: r.left, y: r.bottom + 4 });
          }}
        >
          <SectionIconImg id={icon} />
        </button>
        <span className={styles.colName} data-testid="kanban-col-name">
          {name}
        </span>
        <span className={styles.count} data-testid="kanban-col-count">
          {K.count(total)}
        </span>
        <span className={styles.spacer} />
        {sectionKey !== DONE && sectionKey === TODO && (
          <select
            className={styles.select}
            aria-label={K.sortAria}
            value={s.filter.sort}
            onChange={(e) => setFilter({ sort: e.target.value as "new" | "old" | "due" })}
          >
            {(["new", "old", "due"] as const).map((k) => (
              <option key={k} value={k}>
                {K.sort[k]}
              </option>
            ))}
          </select>
        )}
        {
          <button
            type="button"
            className={`${styles.btn} ${styles.ghost}`}
            aria-label={K.sectionMenu}
            aria-haspopup="menu"
            aria-expanded={!!menu}
            data-testid="kanban-col-menu"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMenu(menu ? null : { x: r.right - 210, y: r.bottom + 4 });
            }}
          >
            ⋯
          </button>
        }
        {menu && (
          <Menu at={menu} onClose={() => setMenu(null)}>
            {section && (
              <button type="button" onClick={() => (setMenu(null), onRename(section.id))}>
                {K.rename}
              </button>
            )}
            <button
              type="button"
              data-testid="kanban-col-icon-menu"
              onClick={() => (setMenu(null), setPicker({ x: menu.x, y: menu.y }))}
            >
              {K.iconMenu}
            </button>
            <button
              type="button"
              disabled={index <= 0}
              onClick={() => (setMenu(null), void shiftColumn(sectionKey, -1))}
            >
              {K.moveLeft}
            </button>
            <button
              type="button"
              disabled={index >= count - 1}
              onClick={() => (setMenu(null), void shiftColumn(sectionKey, 1))}
            >
              {K.moveRight}
            </button>
            {section && (
              <>
                <hr />
                <button type="button" onClick={() => (setMenu(null), void clearSection(section.id))}>
                  {K.allToTodo}
                </button>
                <button
                  type="button"
                  className={styles.danger}
                  data-testid="kanban-section-delete"
                  onClick={() => (setMenu(null), onDelete(section))}
                >
                  {K.deleteSection}
                </button>
              </>
            )}
            {sectionKey === TODO && (
              <>
                <hr />
                <button type="button" data-testid="kanban-bulk" onClick={() => (setMenu(null), onBulk())}>
                  {K.bulk}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenu(null);
                    onRecent(menu.x, menu.y);
                  }}
                >
                  {K.bulkRecent}
                </button>
              </>
            )}
          </Menu>
        )}
        {picker && (
          <IconPicker
            at={picker}
            value={icon}
            title={K.iconTitle(name)}
            onPick={(id) => {
              setPicker(null);
              setColumnIcon(sectionKey, id);
            }}
            onReset={() => {
              setPicker(null);
              setColumnIcon(sectionKey, null);
            }}
            onClose={() => setPicker(null)}
          />
        )}
      </div>
      <div className={styles.list} data-drag-scroll>
        {!isDone && (
          <button type="button" className={styles.addCard} data-testid="kanban-add-card" onClick={onAdd}>
            ＋ {K.addCard}
          </button>
        )}
        {over && dragCard && (
          <div className={styles.dropHint} data-testid="kanban-drop-hint">
            {isDone ? K.dropDone : K.dropHere}
            {isDone && dragCard.children > 0 && (
              <>
                <br />
                <span>{K.dropDoneChildren(dragCard.children)}</span>
              </>
            )}
          </div>
        )}
        {cards.length === 0 && !over && <p className={styles.empty}>{K.empty}</p>}
        {cards.map((c, i) => {
          if (!isDone) return <Card key={c.id} card={c} sectionKey={sectionKey} onEdit={onEdit} />;
          const today = useBoard.getState().today;
          const g = doneGroupOf(c.flagDoneAt!, today);
          const prev = i > 0 ? doneGroupOf(cards[i - 1]!.flagDoneAt!, today).key : "";
          const head =
            g.key !== prev ? (
              <div key={`g-${g.key}`} className={styles.doneGroup} data-testid="kanban-done-group">
                {g.key === "today" || g.key === "week" || g.key === "last"
                  ? K.doneGroups[g.key]
                  : K.doneMonth(g.label)}
              </div>
            ) : null;
          return (
            <FragmentWith key={c.id} head={head}>
              {s.expanded[c.id] ? (
                <Card card={c} sectionKey={DONE} onEdit={onEdit} onCollapse={() => toggleExpanded(c.id)} />
              ) : (
                <DoneRow card={c} />
              )}
            </FragmentWith>
          );
        })}
        {isDone && s.done.length < s.doneTotal && (
          <button
            type="button"
            className={styles.moreBtn}
            data-testid="kanban-done-more"
            onClick={() => void load(true)}
          >
            {K.doneMore(Math.min(DONE_PAGE, s.doneTotal - s.done.length))}
          </button>
        )}
      </div>
    </div>
  );
}

function FragmentWith({ head, children }: { head: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      {head}
      {children}
    </>
  );
}

function dragProps(card: KanbanCard, from: SectionKey) {
  return {
    draggable: true,
    onDragStart: (e: DragEvent<HTMLElement>) => {
      e.dataTransfer.setData(CARD_MIME, card.id);
      e.dataTransfer.setData("text/plain", card.text);
      e.dataTransfer.effectAllowed = "copyMove";
      dragCard = { id: card.id, from, children: card.children.filter((x) => !x.done).length };
      setTimeout(() => setDragging(card.id), 0);
    },
    onDragEnd: () => {
      dragCard = null;
      setDragging(null);
    },
  };
}

/** Cabinet 줄(폴더·링크)을 카드에 놓으면 그 항목에 연결 */
function useCabinetDrop(card: KanbanCard) {
  const [over, setOver] = useState(false);
  const isCab = (e: DragEvent) => [...e.dataTransfer.types].includes(CAB_MIME);
  return {
    over,
    props: {
      onDragOver: (e: DragEvent) => {
        if (!isCab(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
        if (!over) setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent) => {
        if (!isCab(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const id = e.dataTransfer.getData(CAB_MIME);
        if (id) void linkCabinetItem(id, card.id);
      },
    },
  };
}

function DoneRow({ card }: { card: KanbanCard }) {
  const today = useBoard((b) => b.today);
  const dragging = useKanban((s) => s.dragging === card.id);
  const highlight = useKanban((s) => s.highlight === card.id);
  const cab = useCabinetDrop(card);
  const at = card.flagDoneAt!;
  const d = localDate(new Date(at));
  const when = d === today ? new Date(at).toTimeString().slice(0, 5) : md(at).replace(/\(.*\)$/, "");
  return (
    <button
      type="button"
      className={`${styles.doneRow} ${dragging ? styles.cardDragging : ""} ${highlight ? styles.cardHighlight : ""} ${cab.over ? styles.cardCabOver : ""}`}
      style={{ borderLeftColor: `var(--cat-${card.categoryColor})` }}
      data-testid="kanban-done-row"
      data-card={card.id}
      aria-label={K.cardAria(card.categoryName, card.text)}
      aria-expanded={false}
      onClick={() => toggleExpanded(card.id)}
      {...dragProps(card, DONE)}
      {...cab.props}
    >
      <span className={styles.check} aria-hidden="true">
        ✓
      </span>
      <span className={styles.doneText}>{card.text}</span>
      <span className={styles.when}>{when}</span>
    </button>
  );
}

function Card({
  card,
  sectionKey,
  onEdit,
  onCollapse,
}: {
  card: KanbanCard;
  sectionKey: SectionKey;
  onEdit(card: KanbanCard): void;
  onCollapse?(): void;
}) {
  const today = useBoard((b) => b.today);
  const dragging = useKanban((s) => s.dragging === card.id);
  const highlight = useKanban((s) => s.highlight === card.id);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [history, setHistory] = useState<{ x: number; y: number; rows: StatusLogRow[] } | null>(null);
  const [pop, setPop] = useState<"due" | "time" | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const cab = useCabinetDrop(card);
  useLayoutEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ block: "nearest" });
  }, [highlight]);
  const kids = card.children;
  const shown = kids.length > 3 ? kids.slice(0, 3) : kids;
  const due = card.dueDate ? dueView(today, card.dueDate) : null;
  const [repeatOn, setRepeatOn] = useState(false);
  const openMenu = (x: number, y: number) => {
    setMenu({ x: Math.min(x, window.innerWidth - 240), y });
    void cardRepeating(card).then(setRepeatOn);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter") {
      e.preventDefault();
      onEdit(card);
    } else if (e.altKey && e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      const to = neighborKey(card.id, e.key === "ArrowLeft" ? -1 : 1);
      if (to) void moveCard(card.id, to);
    } else if (e.altKey && !e.shiftKey && (e.code === "KeyR" || e.key === "r")) {
      e.preventDefault();
      void toggleCardRepeat(card);
    } else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      openMenu(r.left + 20, r.top + 24);
    }
  };
  // 옮길 곳 = 열 순서 그대로(improve-v23-spec 2절)
  const st = useKanban();
  const targets: { key: SectionKey; name: string }[] = columnKeys(st)
    .filter((k) => k !== sectionKey)
    .map((k) => ({ key: k, name: k === DONE ? K.moveToDone : columnName(k, st) }));
  return (
    <div
      ref={ref}
      className={`${styles.card} ${dragging ? styles.cardDragging : ""} ${highlight ? styles.cardHighlight : ""} ${cab.over ? styles.cardCabOver : ""}`}
      style={{ borderLeftColor: `var(--cat-${card.categoryColor})` }}
      tabIndex={0}
      role="group"
      aria-label={K.cardAria(card.categoryName, card.text)}
      data-testid="kanban-card"
      data-card={card.id}
      onDoubleClick={() => onEdit(card)}
      onClick={() => onCollapse?.()}
      onContextMenu={(e) => {
        e.preventDefault();
        openMenu(e.clientX, e.clientY);
      }}
      onKeyDown={onKey}
      {...dragProps(card, sectionKey)}
      {...cab.props}
    >
      <div className={styles.meta}>
        <span className={styles.cat}>{card.categoryName}</span>· {shortDateLabel(card.date).replace(" ", "")}
        {card.flagged && (
          <span className={styles.star} aria-label={STR.insights.flagged}>
            ★
          </span>
        )}
      </div>
      <div className={styles.text} data-testid="kanban-card-text">
        {card.text}
      </div>
      {shown.length > 0 && (
        <ul className={styles.children}>
          {shown.map((c) => (
            <li key={c.id} className={c.done ? styles.childDone : ""} data-testid="kanban-card-child">
              {c.text}
            </li>
          ))}
          {kids.length > 3 && <li className={styles.childDone}>{K.moreChildren(kids.length - 3)}</li>}
        </ul>
      )}
      <div className={styles.tags}>
        {due && sectionKey !== DONE && (
          <span
            className={`${styles.tag} ${due.kind === "late" ? styles.tagLate : due.kind === "soon" || due.kind === "today" ? styles.tagSoon : ""}`}
            data-testid="kanban-due"
          >
            {due.chip}
          </span>
        )}
        {card.startTime && <span className={styles.tag}>⏰ {card.startTime}</span>}
        {card.recurrenceId && <span className={styles.tag}>↻</span>}
        {kids.length > 0 && (
          <span className={styles.tag}>
            {K.childProgress(kids.filter((x) => x.done).length, kids.length)}
          </span>
        )}
        {card.memoCount > 0 && <span className={styles.tag}>▤ {K.memos(card.memoCount)}</span>}
        {card.cabinetCount > 0 && (
          <span className={styles.tag} data-testid="kanban-cabinet-count">
            🗄 {card.cabinetCount}
          </span>
        )}
        {card.sectionSince && (
          <span className={styles.tag} data-testid="kanban-since">
            {K.since(md(card.sectionSince).replace(/\(.*\)$/, ""))}
          </span>
        )}
        {sectionKey === DONE && card.flagDoneAt && (
          <span className={styles.tag}>✓ {md(card.flagDoneAt)}</span>
        )}
      </div>
      <button
        type="button"
        className={styles.more}
        aria-label={K.menu}
        aria-haspopup="menu"
        aria-expanded={!!menu}
        data-testid="kanban-card-menu"
        draggable={false}
        onClick={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          if (menu) setMenu(null);
          else openMenu(r.right - 220, r.bottom + 4);
        }}
      >
        ⋯
      </button>
      {menu && (
        <Menu at={menu} onClose={() => setMenu(null)} label={K.menu}>
          <button type="button" onClick={() => (setMenu(null), onEdit(card))}>
            {K.edit} <span className={styles.key}>Enter</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMenu(null);
              closeKanban();
              void revealItem(card);
            }}
          >
            {K.showInBoard}
          </button>
          {sectionKey !== DONE && (
            <>
              <hr />
              <button
                type="button"
                data-testid="kanban-menu-flag"
                onClick={() => (
                  setMenu(null),
                  void patchCard(card, { flagged: !card.flagged, flagDoneAt: null })
                )}
              >
                {card.flagged ? K.flagOff : K.flagOn} <span className={styles.key}>Alt+I</span>
              </button>
              <button type="button" onClick={() => (setMenu(null), setPop("due"))}>
                {K.dueMenu} <span className={styles.key}>Alt+U</span>
              </button>
              <button type="button" onClick={() => (setMenu(null), setPop("time"))}>
                {K.timeMenu} <span className={styles.key}>Alt+O</span>
              </button>
              <button
                type="button"
                data-testid="kanban-card-repeat"
                onClick={() => (setMenu(null), void toggleCardRepeat(card))}
              >
                ↻ {repeatOn ? K.repeatOff : K.repeatOn} <span className={styles.key}>Alt+R</span>
              </button>
            </>
          )}
          <hr />
          <div className={styles.menuHead}>{K.moveTo}</div>
          {targets.map((t) => (
            <button
              key={t.key}
              type="button"
              data-testid="kanban-move-to"
              data-to={t.key}
              onClick={() => (setMenu(null), void moveCard(card.id, t.key))}
            >
              → {t.name}
            </button>
          ))}
          <hr />
          <button
            type="button"
            data-testid="kanban-history"
            onClick={() => {
              const at = menu;
              setMenu(null);
              void statusLog(card.id).then((rows) =>
                setHistory({ x: Math.min(at.x, window.innerWidth - 460), y: at.y, rows }),
              );
            }}
          >
            {K.history}
          </button>
          <button
            type="button"
            className={styles.danger}
            onClick={() => (setMenu(null), void deleteCard(card))}
          >
            {K.remove} <span className={styles.key}>Alt+Delete</span>
          </button>
        </Menu>
      )}
      {history && (
        <Menu
          at={history}
          onClose={() => setHistory(null)}
          className={styles.history}
          label={K.historyTitle(card.text)}
        >
          <div className={styles.menuHead} style={{ padding: "0 0 6px" }}>
            {K.historyTitle(card.text)}
          </div>
          {history.rows.length === 0 ? (
            <p className={styles.note}>{K.historyEmpty}</p>
          ) : (
            <table data-testid="kanban-history-table">
              <tbody>
                {history.rows.map((r, i) => {
                  const d = new Date(r.changedAt);
                  return (
                    <tr key={i}>
                      <td>
                        {localDate(d)} {d.toTimeString().slice(0, 5)}
                      </td>
                      <td>{r.fromName}</td>
                      <td>→</td>
                      <td>{r.toName}</td>
                      <td className={styles.key}>{K.sources[r.source] ?? r.source}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className={styles.note}>{K.historyNote}</p>
        </Menu>
      )}
      {pop === "due" && (
        <PopLayer onClose={() => setPop(null)}>
          <DueDatePopover
            text={card.text}
            today={today}
            initial={card.dueDate}
            hasValue={!!card.dueDate}
            onSave={(d) => {
              setPop(null);
              void patchCard(
                card,
                d
                  ? { dueDate: d, ...(card.flagged ? {} : { flagged: true, flagDoneAt: null }) }
                  : { dueDate: null },
              );
            }}
            onClose={() => setPop(null)}
          />
        </PopLayer>
      )}
      {pop === "time" && (
        <PopLayer onClose={() => setPop(null)}>
          <StartTimePopover
            date={card.date}
            initial={card.startTime ?? defaultStartTime(card.date === today, new Date())}
            hasValue={!!card.startTime}
            onSave={(t) => {
              setPop(null);
              void patchCard(card, { startTime: t });
            }}
            onClose={() => setPop(null)}
          />
        </PopLayer>
      )}
    </div>
  );
}

/** 카드 위에 띄우는 마감일·시작 시각 창(주간 보드와 같은 창을 그대로) */
function PopLayer({ children, onClose }: { children: React.ReactNode; onClose(): void }) {
  return (
    <div
      style={{ position: "absolute", left: 0, top: "100%", zIndex: 310 }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onClose();
      }}
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
    >
      {children}
    </div>
  );
}

export function Menu({
  at,
  onClose,
  children,
  className,
  label,
}: {
  at: { x: number; y: number };
  onClose(): void;
  children: React.ReactNode;
  className?: string;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(at.x, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(at.y, window.innerHeight - r.height - 8)),
    });
    el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [at]);
  useEffect(() => {
    const out = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", out);
    window.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", out);
      window.removeEventListener("keydown", key, true);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      className={className ?? styles.menu}
      style={{ left: pos.x, top: pos.y }}
      role="menu"
      aria-label={label}
      data-testid="kanban-menu"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      draggable={false}
      onDragStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onKeyDown={(e) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault();
        const bs = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        const i = bs.indexOf(document.activeElement as HTMLButtonElement);
        bs[(i + (e.key === "ArrowDown" ? 1 : -1) + bs.length) % bs.length]?.focus();
      }}
    >
      {children}
    </div>
  );
}

function SectionDialog({ id, onClose }: { id: string | null; onClose(): void }) {
  const sections = useKanban((s) => s.sections);
  const cur = id ? sections.find((x) => x.id === id) : null;
  const [name, setName] = useState(cur?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  // 아이콘: 고르지 않으면 이름에 맞춘 추천(improve-v23-spec 8절) — 설명 글은 두지 않는다(15절 U1)
  const [icon, setIcon] = useState<string | null>(() =>
    cur ? (useKanban.getState().columns.icons[cur.id] ?? null) : null,
  );
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const shown = icon ?? suggestIcon(name);
  const ref = useModal(onClose);
  const save = async () => {
    if (cur) {
      const err = await updateSection(cur.id, { name });
      if (err) return setError(err);
      if (icon !== (useKanban.getState().columns.icons[cur.id] ?? null)) setColumnIcon(cur.id, icon);
      return onClose();
    }
    const err = await createSection(name, "gray", icon);
    if (err) setError(err);
    else onClose();
  };
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      style={{ width: 380 }}
      aria-label={cur ? K.sectionRename : K.sectionDialog}
      data-testid="kanban-section-dialog"
    >
      <h2>{cur ? K.sectionRename : K.sectionDialog}</h2>
      <div className={styles.row} style={{ gridTemplateColumns: "50px 1fr" }}>
        <span className={styles.label}>{K.iconLabel}</span>
        <div>
          <button
            type="button"
            className={styles.iconField}
            aria-label={K.iconMenu}
            data-testid="kanban-section-icon"
            data-icon={shown}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setPicker({ x: r.left, y: r.bottom + 4 });
            }}
          >
            <SectionIconImg id={shown} size={20} /> ▾
          </button>
        </div>
      </div>
      {picker && (
        <IconPicker
          at={picker}
          value={shown}
          title={K.iconTitle(name || K.sectionDialog)}
          onPick={(id) => (setIcon(id), setPicker(null))}
          onReset={() => (setIcon(null), setPicker(null))}
          onClose={() => setPicker(null)}
        />
      )}
      <div className={styles.row} style={{ gridTemplateColumns: "50px 1fr" }}>
        <label className={styles.label} htmlFor="kanban-section-name">
          {K.sectionName}
        </label>
        <input
          id="kanban-section-name"
          className={styles.textInput}
          value={name}
          maxLength={20}
          autoFocus
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void save();
            }
          }}
        />
      </div>
      {error && (
        <p className={styles.error} role="alert" data-testid="kanban-section-error">
          {error}
        </p>
      )}
      <div className={styles.acts}>
        <button type="button" className={styles.btn} onClick={onClose}>
          {K.cancel}
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.primary}`}
          data-testid="kanban-section-save"
          onClick={() => void save()}
        >
          {cur ? K.save : K.add}
        </button>
      </div>
    </dialog>
  );
}

function ConfirmDelete({
  section,
  count,
  onClose,
}: {
  section: KanbanSection;
  count: number;
  onClose(): void;
}) {
  const ref = useModal(onClose);
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      style={{ width: 380 }}
      aria-label={K.deleteTitle(section.name)}
      data-testid="kanban-section-confirm"
    >
      <h2>{K.deleteTitle(section.name)}</h2>
      <div className={styles.box}>{K.deleteBody(count)}</div>
      <div className={styles.acts}>
        <button type="button" className={`${styles.btn} ${styles.primary}`} autoFocus onClick={onClose}>
          {K.cancel}
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.danger}`}
          data-testid="kanban-section-confirm-delete"
          onClick={() => {
            onClose();
            void deleteSection(section.id);
          }}
        >
          {K.deleteSection.replace("…", "")}
        </button>
      </div>
    </dialog>
  );
}
