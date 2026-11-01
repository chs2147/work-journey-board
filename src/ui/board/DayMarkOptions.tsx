// 이 날 근무 상태 고르기(요일 머리 ⋯ 메뉴·데일리 뷰 [근무 ▾] 공용) — 연차·반차 + 공휴일(이름)·기타 휴가(사유)(features-1102-spec F2).
// 내장 공휴일·회사 휴일인 날은 위에 출처를 보여 주고, [근무]를 고르면 그 날 표시를 끈다(설정의 끈 날짜).
import { useEffect, useState } from "react";
import { DAY_MARK_KINDS, LABEL_MAX, type DayMarkKind } from "../../domain/dayMark";
import { STR } from "../../shared/strings";
import { useAppStore } from "../common/appStore";
import { setDayMark, useBoard } from "./boardStore";
import styles from "./DayMarkOptions.module.css";

export function DayMarkOptions({ day, onDone }: { day: string; onDone: () => void }) {
  const info = useBoard((s) => s.dayMarkInfo[day]) ?? null;
  const mark = info?.kind ?? null;
  const [pending, setPending] = useState<"holiday" | "other" | null>(
    info?.source === "user" && (mark === "holiday" || mark === "other") ? mark : null,
  );
  const [label, setLabel] = useState(info?.source === "user" ? (info.label ?? "") : "");
  const [reasons, setReasons] = useState<string[]>([]);
  useEffect(() => {
    const j = useAppStore.getState().journal;
    if (j.state === "ready") void j.repo.getSettings().then((s) => setReasons(s.holiday.reasons));
  }, []);

  const apply = (k: DayMarkKind | null, l: string | null = null) => {
    onDone();
    void setDayMark(day, k, l);
  };

  return (
    <div className={styles.wrap}>
      {info && info.source !== "user" && (
        <div className={styles.source} data-testid="mark-source">
          {info.source === "builtin"
            ? STR.dayMenu.builtin(info.label ?? "")
            : STR.dayMenu.company(info.label ?? "")}
        </div>
      )}
      {([null, ...DAY_MARK_KINDS] as const).map((k) => {
        const checked = pending ? pending === k : k === null ? !mark : mark === k;
        return (
          <button
            key={k ?? "work"}
            type="button"
            role="menuitemradio"
            aria-checked={checked}
            className={styles.radioItem}
            onClick={() => {
              if (k === "holiday" || k === "other") {
                setPending(k);
                if (k === "holiday" && !label && info?.label) setLabel(info.label);
              } else apply(k);
            }}
          >
            <span className={`${styles.radio} ${checked ? styles.radioOn : ""}`} aria-hidden="true" />
            {STR.dayMenu.kinds[k ?? "work"]}
          </button>
        );
      })}
      {pending && (
        <div className={styles.extra}>
          {pending === "other" && reasons.length > 0 && (
            <div className={styles.chips}>
              {reasons.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="menuitem"
                  className={`${styles.chip} ${label === r ? styles.chipOn : ""}`}
                  onClick={() => apply("other", r)}
                >
                  {r}
                </button>
              ))}
            </div>
          )}
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              apply(pending, label.trim() || null);
            }}
          >
            <input
              className={styles.input}
              value={label}
              maxLength={LABEL_MAX}
              placeholder={pending === "holiday" ? STR.dayMenu.holidayName : STR.dayMenu.otherReason}
              aria-label={pending === "holiday" ? STR.dayMenu.holidayName : STR.dayMenu.otherReason}
              autoFocus
              onChange={(e) => setLabel(e.currentTarget.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <button type="submit" className={styles.apply}>
              {STR.dayMenu.labelApply}
            </button>
          </form>
          {pending === "other" && <div className={styles.hint}>{STR.dayMenu.reasonsHint}</div>}
        </div>
      )}
    </div>
  );
}
