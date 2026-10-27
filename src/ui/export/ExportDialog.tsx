// 엑셀 내보내기 대화상자(output-spec 4-1): 범위 4종 · 시트 선택 · 미리 계산 → [저장 위치 선택…]. 키보드만으로 끝까지 된다.
import { useEffect, useRef, useState } from "react";
import { addWeeks, weekTitle, type WeekId } from "../../domain/week";
import { weekList } from "../../data/repository";
import { STR } from "../../shared/strings";
import { focusStartCell } from "../board/boardStore";
import { useAppStore } from "../common/appStore";
import {
  defaultChoice,
  resolveRange,
  runExport,
  setExportOpen,
  useExport,
  type ExportChoice,
  type RangeKind,
} from "./exportStore";
import { memoWeeks as listMemoWeeks } from "../note/snapshot";
import styles from "./ExportDialog.module.css";

const KINDS: RangeKind[] = ["thisWeek", "last4", "custom", "all"];
const KIND_LABEL: Record<RangeKind, string> = {
  thisWeek: STR.export.thisWeek,
  last4: STR.export.last4,
  custom: STR.export.custom,
  all: STR.export.all,
};

const rangeText = ([a, b]: [WeekId, WeekId]) => (a === b ? a : `${a} ~ ${b}`);

export function ExportDialog() {
  const journal = useAppStore((s) => s.journal);
  const busy = useExport((s) => s.busy);
  const progress = useExport((s) => s.progress);
  const [memoWeeks, setMemoWeeks] = useState<number | null>(null);
  const [choice, setChoice] = useState<ExportChoice>(defaultChoice);
  const [first, setFirst] = useState<WeekId | null>(null);
  const [stats, setStats] = useState<{ weeks: number; categories: number; items: number } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const repo = journal.state === "ready" ? journal.repo : null;
  const current = repo?.currentWeek() ?? choice.to;

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.focus();
    void repo?.firstRecordWeek().then(setFirst);
    // [메모 보드 스냅샷]은 마지막 선택을 기억(기본 꺼짐)
    void repo?.getSettings().then((s) => setChoice((c) => ({ ...c, snapshots: s.ui.exportSnapshots })));
  }, [repo]);

  const range = resolveRange(choice, current, first);
  useEffect(() => {
    let alive = true;
    void repo?.exportStats(range[0], range[1]).then((s) => alive && setStats(s));
    if (repo) void listMemoWeeks(repo, range[0], range[1]).then((m) => alive && setMemoWeeks(m.length));
    return () => {
      alive = false;
    };
  }, [repo, range[0], range[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  // 기간 지정 선택지: 첫 기록 주(없으면 4주 전)부터 이번 주까지, 최근 주가 위
  const start = first && first < addWeeks(current, -3) ? first : addWeeks(current, -3);
  const weekOptions = weekList(start, current).reverse();

  const close = () => {
    setExportOpen(false);
    focusStartCell();
  };
  const set = (patch: Partial<ExportChoice>) => setChoice((c) => ({ ...c, ...patch }));
  const noSheet = !choice.weekly && !choice.ledger && !choice.snapshots;

  const save = async () => {
    const path = await runExport(choice);
    if (path) focusStartCell();
  };

  return (
    <div className={styles.backdrop} onMouseDown={(e) => e.target === e.currentTarget && !busy && close()}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
        data-testid="export-dialog"
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) {
            e.preventDefault();
            close();
          }
        }}
      >
        <h2 id="export-title" className={styles.title}>
          {STR.export.title}
        </h2>

        <fieldset className={styles.group}>
          <legend>{STR.export.range}</legend>
          {KINDS.map((k) => {
            const r = resolveRange({ ...choice, kind: k }, current, first);
            return (
              <div key={k} className={styles.option}>
                <label className={styles.radio}>
                  <input
                    type="radio"
                    name="export-range"
                    value={k}
                    checked={choice.kind === k}
                    onChange={() => set({ kind: k })}
                  />
                  <span className={styles.kind}>{KIND_LABEL[k]}</span>
                </label>
                {k === "custom" ? (
                  <span className={styles.selects}>
                    <select
                      aria-label={STR.export.from}
                      value={choice.from}
                      onChange={(e) => set({ kind: "custom", from: e.target.value })}
                    >
                      {weekOptions.map((w) => (
                        <option key={w} value={w} title={weekTitle(w)}>
                          {w}
                        </option>
                      ))}
                    </select>
                    ~
                    <select
                      aria-label={STR.export.to}
                      value={choice.to}
                      onChange={(e) => set({ kind: "custom", to: e.target.value })}
                    >
                      {weekOptions.map((w) => (
                        <option key={w} value={w} title={weekTitle(w)}>
                          {w}
                        </option>
                      ))}
                    </select>
                  </span>
                ) : (
                  <span className={styles.range}>
                    {k === "all" && !first ? STR.export.noRecords : rangeText(r)}
                  </span>
                )}
              </div>
            );
          })}
        </fieldset>

        <fieldset className={styles.group}>
          <legend>{STR.export.include}</legend>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={choice.weekly}
              onChange={(e) => set({ weekly: e.target.checked })}
            />
            {STR.export.weekly}
          </label>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={choice.ledger}
              onChange={(e) => set({ ledger: e.target.checked })}
            />
            {STR.export.ledger}
          </label>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={choice.snapshots}
              onChange={(e) => set({ snapshots: e.target.checked })}
              data-testid="export-snapshots"
            />
            {STR.export.snapshots}
            {memoWeeks !== null && (
              <span className={styles.checkInfo}>{STR.export.snapshotsInfo(memoWeeks)}</span>
            )}
          </label>
          {choice.snapshots && (
            <p className={styles.note} data-testid="export-snapshots-note">
              {memoWeeks !== null && memoWeeks > 20
                ? STR.export.snapshotsMany(memoWeeks)
                : STR.export.snapshotsNote}
            </p>
          )}
        </fieldset>

        <p className={styles.note}>{STR.export.summaryNote}</p>
        <p className={styles.stats} data-testid="export-stats">
          {stats ? STR.export.stats(stats.weeks, stats.categories, stats.items) : " "}
        </p>

        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={close} disabled={busy}>
            {STR.export.cancel}
          </button>
          <button
            type="button"
            className={styles.primary}
            onClick={() => void save()}
            disabled={noSheet || busy}
            title={noSheet ? STR.export.noSheet : undefined}
          >
            {busy ? (progress ?? STR.export.saving) : STR.export.save}
          </button>
        </div>
      </div>
    </div>
  );
}
