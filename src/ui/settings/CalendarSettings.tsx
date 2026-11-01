// 설정 › 달력·휴일(features-1102-spec F2·F3): 대한민국 공휴일(앱 안 표)·연도별 표·날짜별 끄기, 회사 휴일, 기타 휴가 사유.
// 바꾸면 일지 설정(holiday)에 저장하고 보드를 다시 읽어 바로 보이게 한다. 외부 접속 없음.
import { useEffect, useState } from "react";
import type { Settings } from "../../data/settings";
import {
  HOLIDAY_DATA_VERSION,
  HOLIDAY_YEARS,
  KR_HOLIDAYS,
  type HolidaySettings,
} from "../../domain/holidaysKr";
import { LABEL_MAX } from "../../domain/dayMark";
import { DAY_LABELS, dayIndex } from "../../domain/week";
import { STR } from "../../shared/strings";
import { reload, useBoard } from "../board/boardStore";
import { useAppStore } from "../common/appStore";
import styles from "./Settings.module.css";
import { Card } from "./SettingsCard";

const T = STR.calendar;
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}(${DAY_LABELS[dayIndex(d)]})`;

export function CalendarSettings() {
  const journal = useAppStore((s) => s.journal);
  const today = useBoard((s) => s.today);
  const [h, setH] = useState<HolidaySettings | null>(null);
  const [year, setYear] = useState(() =>
    Math.min(HOLIDAY_YEARS[1], Math.max(HOLIDAY_YEARS[0], Number(today.slice(0, 4)) || HOLIDAY_YEARS[0])),
  );
  const [cDate, setCDate] = useState("");
  const [cName, setCName] = useState("");
  const [cYearly, setCYearly] = useState(true);
  const [cBad, setCBad] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (journal.state !== "ready") return;
    void journal.repo.getSettings().then((s) => setH(s.holiday));
  }, [journal]);
  if (journal.state !== "ready" || !h) return null;

  const save = async (patch: Partial<HolidaySettings>) => {
    const next: Settings = await journal.repo.updateSettings({ holiday: patch });
    setH(next.holiday);
    await reload();
  };

  const rows = KR_HOLIDAYS.filter((x) => x.date.startsWith(`${year}-`));
  const addCompany = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cDate)) {
      setCBad(true);
      return;
    }
    setCBad(false);
    void save({
      company: [...h.company, { date: cYearly ? cDate.slice(5) : cDate, name: cName.trim() || "회사 휴일" }],
    });
    setCDate("");
    setCName("");
  };

  return (
    <>
      <Card id="s-kr-holiday" title={T.krTitle} desc={T.krDesc} testId="kr-holidays">
        <div className={styles.setRow}>
          <div className={styles.rowText}>
            <span className={styles.rowLabel}>{T.krToggle}</span>
            <span className={styles.rowDesc}>
              {T.dataNote(HOLIDAY_DATA_VERSION, HOLIDAY_YEARS[0], HOLIDAY_YEARS[1])}
            </span>
          </div>
          <div className={styles.rowCtl}>
            <input
              type="checkbox"
              role="switch"
              aria-label={T.krToggle}
              checked={h.krEnabled}
              onChange={(e) => void save({ krEnabled: e.currentTarget.checked })}
            />
          </div>
        </div>
        <div className={styles.holYear}>
          <button
            type="button"
            aria-label={T.prevYear}
            disabled={year <= HOLIDAY_YEARS[0]}
            onClick={() => setYear(year - 1)}
          >
            ‹
          </button>
          <b data-testid="holiday-year">{year}</b>
          <button
            type="button"
            aria-label={T.nextYear}
            disabled={year >= HOLIDAY_YEARS[1]}
            onClick={() => setYear(year + 1)}
          >
            ›
          </button>
        </div>
        <table className={styles.holTable} data-testid="holiday-table">
          <thead>
            <tr>
              <th>{T.colDate}</th>
              <th>{T.colName}</th>
              <th>{T.colType}</th>
              <th className={styles.holShow}>{T.colShow}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => {
              const on = h.krEnabled && !h.off.includes(x.date);
              return (
                <tr key={x.date + x.name} className={on ? "" : styles.holOff}>
                  <td>{md(x.date)}</td>
                  <td>{x.name}</td>
                  <td>{T.types[x.type]}</td>
                  <td className={styles.holShow}>
                    <input
                      type="checkbox"
                      aria-label={T.showAria(x.name, md(x.date))}
                      checked={!h.off.includes(x.date)}
                      disabled={!h.krEnabled}
                      onChange={(e) =>
                        void save({
                          off: e.currentTarget.checked
                            ? h.off.filter((d) => d !== x.date)
                            : [...h.off, x.date],
                        })
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className={styles.infoNote}>{T.tempNote}</p>
      </Card>

      <div className={styles.pair}>
        <Card id="s-company-holiday" title={T.companyTitle} testId="company-holidays">
          {h.company.length === 0 && <p className={styles.empty}>{T.companyEmpty}</p>}
          <ul className={styles.holList}>
            {h.company.map((c, i) => (
              <li key={`${c.date}-${i}`}>
                <span className={styles.holDate}>
                  {c.date.length === 10 ? md(c.date) : c.date.replace("-", "/")}
                </span>
                <span className={styles.holName}>{c.name}</span>
                <span className={styles.rowDesc}>
                  {c.date.length === 10 ? T.companyOnce : T.companyYearly}
                </span>
                <button
                  type="button"
                  aria-label={T.companyRemove(c.name)}
                  onClick={() => void save({ company: h.company.filter((_, j) => j !== i) })}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <form
            className={styles.holForm}
            onSubmit={(e) => {
              e.preventDefault();
              addCompany();
            }}
          >
            <input
              type="date"
              aria-label={T.companyDate}
              value={cDate}
              onChange={(e) => setCDate(e.currentTarget.value)}
            />
            <input
              type="text"
              aria-label={T.companyName}
              placeholder={T.companyNamePh}
              maxLength={LABEL_MAX}
              value={cName}
              onChange={(e) => setCName(e.currentTarget.value)}
            />
            <label className={styles.holCheck}>
              <input
                type="checkbox"
                checked={cYearly}
                onChange={(e) => setCYearly(e.currentTarget.checked)}
              />
              {T.companyYearly}
            </label>
            <button type="submit">{T.companySave}</button>
            {cBad && <span className={styles.holBad}>{T.companyBad}</span>}
          </form>
        </Card>

        <Card id="s-reasons" title={T.reasonsTitle} testId="leave-reasons">
          {h.reasons.length === 0 && <p className={styles.empty}>{T.reasonsEmpty}</p>}
          <div className={styles.holChips}>
            {h.reasons.map((r) => (
              <span key={r} className={styles.holChip}>
                {r}
                <button
                  type="button"
                  aria-label={T.reasonRemove(r)}
                  onClick={() => void save({ reasons: h.reasons.filter((x) => x !== r) })}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
          <form
            className={styles.holForm}
            onSubmit={(e) => {
              e.preventDefault();
              const r = reason.trim();
              if (r && !h.reasons.includes(r)) void save({ reasons: [...h.reasons, r] });
              setReason("");
            }}
          >
            <input
              type="text"
              aria-label={T.reasonsAdd}
              placeholder={T.reasonPh}
              maxLength={LABEL_MAX}
              value={reason}
              onChange={(e) => setReason(e.currentTarget.value)}
            />
            <button type="submit">{T.reasonsAdd}</button>
          </form>
        </Card>
      </div>
    </>
  );
}
