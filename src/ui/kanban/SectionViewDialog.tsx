import { useState } from "react";
import { KANBAN_PERIODS, type KanbanPeriod, type SectionPeriod } from "../../domain/kanban";
import { isDueDate } from "../../domain/dueDate";
import { STR } from "../../shared/strings";
import { saveSectionPeriod } from "./kanbanStore";
import { useModal } from "./kanbanUi";
import styles from "./Kanban.module.css";

const K = STR.kanban;

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
