import { useState, type DragEvent } from "react";
import { KANBAN_PERIODS, type KanbanPeriod, type SectionPeriod } from "../../domain/kanban";
import { isDueDate } from "../../domain/dueDate";
import { localDate } from "../../domain/localTime";
import type { KanbanCard } from "../../data/kanbanRepository";
import { STR } from "../../shared/strings";
import { loadMoreCards, saveSectionOrder, saveSectionPeriod } from "./kanbanStore";
import { useModal } from "./kanbanUi";
import styles from "./Kanban.module.css";

const K = STR.kanban;
const CARD_ORDER_MIME = "application/x-wjb-kanban-order";

type DialogProps = { sectionKey: string; name: string; close(): void };

export function SectionPeriodDialog({
  sectionKey,
  name,
  close,
  value,
}: DialogProps & { value?: SectionPeriod }) {
  const [period, setPeriod] = useState<KanbanPeriod | "inherit">(value?.period ?? "inherit");
  const [from, setFrom] = useState(value?.from ?? "");
  const [to, setTo] = useState(value?.to ?? "");
  const [busy, setBusy] = useState(false);
  const ref = useModal(() => {
    if (!busy) close();
  });
  return (
    <dialog className={styles.dialog} ref={ref} aria-label={name + " · " + K.sectionPeriod}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          void saveSectionPeriod(
            sectionKey,
            period === "inherit"
              ? undefined
              : {
                  period,
                  from: period === "custom" && isDueDate(from) ? from : null,
                  to: period === "custom" && isDueDate(to) ? to : null,
                },
          ).then((saved) => {
            if (saved) close();
            else setBusy(false);
          });
        }}
      >
        <h2>
          {name} · {K.sectionPeriod.replace("…", "")}
        </h2>
        <label className={styles.row}>
          {K.periodAria}
          <select
            className={styles.select}
            value={period}
            onChange={(e) => setPeriod(e.target.value as typeof period)}
          >
            <option value="inherit">{K.inheritPeriod}</option>
            {KANBAN_PERIODS.map((v) => (
              <option key={v} value={v}>
                {v === "all" ? K.wholePeriod : K.periods[v]}
              </option>
            ))}
          </select>
        </label>
        {period === "custom" && (
          <>
            <label className={styles.row}>
              {K.from}
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className={styles.row}>
              {K.to}
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </>
        )}
        <div className={styles.actions}>
          <button type="button" disabled={busy} onClick={close}>
            취소
          </button>
          <button type="submit" disabled={busy}>
            적용
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function SectionOrderDialog({
  sectionKey,
  name,
  close,
  cards,
  more,
}: DialogProps & { cards: KanbanCard[]; more: boolean }) {
  const [draft, setDraft] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const ref = useModal(() => {
    if (!busy) close();
  });
  const byId = new Map(cards.map((card) => [card.id, card]));
  const order = [...new Set([...draft.filter((id) => byId.has(id)), ...byId.keys()])];
  const move = (from: number, to: number) => {
    if (busy || from === to || from < 0 || to < 0 || to >= order.length) return;
    const next = [...order];
    next.splice(to, 0, next.splice(from, 1)[0]!);
    setDraft(next);
  };
  const drop = (event: DragEvent, to: number) => {
    event.preventDefault();
    move(order.indexOf(event.dataTransfer.getData(CARD_ORDER_MIME)), to);
  };
  const save = async (ids?: string[]) => {
    setBusy(true);
    if (await saveSectionOrder(sectionKey, ids)) close();
    else setBusy(false);
  };
  return (
    <dialog className={styles.dialog} ref={ref} aria-label={name + " · " + K.orderCards}>
      <h2>
        {name} · {K.orderCards.replace("…", "")}
      </h2>
      {order.length ? (
        <ol className={styles.orderList}>
          {order.map((id, index) => {
            const card = byId.get(id)!;
            return (
              <li
                key={id}
                draggable={!busy}
                onDragStart={(e) => e.dataTransfer.setData(CARD_ORDER_MIME, id)}
                onDragOver={(e) => {
                  if ([...e.dataTransfer.types].includes(CARD_ORDER_MIME)) e.preventDefault();
                }}
                onDrop={(e) => drop(e, index)}
              >
                <span>
                  {card.text}
                  <small>{card.flagDoneAt ? localDate(new Date(card.flagDoneAt)) : card.date}</small>
                </span>
                <button
                  type="button"
                  disabled={busy || index === 0}
                  aria-label={card.text + " " + K.cardUp}
                  onClick={() => move(index, index - 1)}
                >
                  {K.cardUp}
                </button>
                <button
                  type="button"
                  disabled={busy || index === order.length - 1}
                  aria-label={card.text + " " + K.cardDown}
                  onClick={() => move(index, index + 1)}
                >
                  {K.cardDown}
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <p>{K.empty}</p>
      )}
      {more && (
        <button type="button" disabled={busy} onClick={() => void loadMoreCards(sectionKey)}>
          {K.moreCards}
        </button>
      )}
      <div className={styles.actions}>
        <button type="button" disabled={busy} onClick={() => void save()}>
          {K.resetOrder}
        </button>
        <button type="button" disabled={busy} onClick={close}>
          취소
        </button>
        <button type="button" disabled={busy || !order.length} onClick={() => void save(order)}>
          저장
        </button>
      </div>
    </dialog>
  );
}
