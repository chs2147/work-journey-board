// 업무일지 내보내기 대화상자(output-spec 4-1 · improve-v27 1-2): 타이틀(형식 토글) · 범위(기간·연도·업무) · 포함 · 미리 계산.
// 구역 사이는 구분선. 키보드만으로 끝까지 된다.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { addWeeks, weekTitle, type WeekId } from "../../domain/week";
import type { Category } from "../../domain/types";
import { weekList } from "../../data/repository";
import { STR } from "../../shared/strings";
import { focusStartCell, useBoard } from "../board/boardStore";
import { useAppStore } from "../common/appStore";
import {
  cancelExport,
  categoryLabel,
  defaultChoice,
  resolveRange,
  runExport,
  setExportOpen,
  useExport,
  type ExportChoice,
  type ExportFormat,
  type RangeKind,
} from "./exportStore";
import { memoWeeks as listMemoWeeks } from "../note/snapshot";
import styles from "./ExportDialog.module.css";

const E = STR.export;
const KINDS: RangeKind[] = ["thisWeek", "last4", "custom", "year", "all"];
const KIND_LABEL: Record<RangeKind, string> = {
  thisWeek: E.thisWeek,
  last4: E.last4,
  custom: E.custom,
  year: E.year,
  all: E.all,
};

type ExportCategory = Category & { ended: boolean };

const rangeText = ([a, b]: [WeekId, WeekId]) => (a === b ? a : `${a} ~ ${b}`);

export function ExportDialog() {
  const journal = useAppStore((s) => s.journal);
  const busy = useExport((s) => s.busy);
  const progress = useExport((s) => s.progress);
  const ratio = useExport((s) => s.ratio);
  const [memoWeeks, setMemoWeeks] = useState<number | null>(null);
  const [choice, setChoice] = useState<ExportChoice>(defaultChoice);
  const [first, setFirst] = useState<WeekId | null>(null);
  const [stats, setStats] = useState<{ weeks: number; categories: number; items: number } | null>(null);
  const [cats, setCats] = useState<ExportCategory[]>([]);
  const dialogRef = useRef<HTMLDivElement>(null);
  const repo = journal.state === "ready" ? journal.repo : null;
  const current = useBoard((s) => s.weekId);

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.focus();
    void repo?.firstRecordWeek().then(setFirst);
    // 형식·[메모 보드 스냅샷]은 마지막 선택을 기억(업무 고르기는 기억하지 않음 — D4)
    void repo
      ?.getSettings()
      .then((s) => setChoice((c) => ({ ...c, snapshots: s.ui.exportSnapshots, format: s.ui.exportFormat })));
  }, [repo]);

  // 내보내는 동안: 앱 단축키·다른 조작을 막는다(Esc = 취소). 창 안 조작은 inert로 막고 [취소]만 둔다
  useEffect(() => {
    if (!busy) return;
    const block = (e: globalThis.KeyboardEvent) => {
      const inStop = (e.target as Element | null)?.closest?.("[data-export-progress]");
      if (e.key === "Escape") cancelExport();
      if (inStop && (e.key === "Enter" || e.key === " " || e.key === "Tab")) return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", block, true);
    dialogRef.current?.querySelector<HTMLButtonElement>("[data-export-stop]")?.focus();
    return () => window.removeEventListener("keydown", block, true);
  }, [busy]);

  const latest = repo?.currentWeek() ?? current;
  const range = resolveRange(choice, current, first, latest);
  const ids = choice.categoryIds;
  const idsKey = ids?.join(",") ?? "";
  useEffect(() => {
    let alive = true;
    void repo?.exportStats(range[0], range[1], ids).then((s) => alive && setStats(s));
    if (repo) void listMemoWeeks(repo, range[0], range[1]).then((m) => alive && setMemoWeeks(m.length));
    void repo?.exportCategories(range[0], range[1]).then((c) => {
      if (!alive) return;
      setCats(c);
      // 범위가 바뀌어 목록에서 빠진 업무는 고른 것에서도 뺀다(다 빠지면 전체)
      setChoice((x) => {
        const kept = x.categoryIds?.filter((id) => c.some((k) => k.id === id)) ?? null;
        const next = kept && kept.length ? kept : null;
        return (next?.join(",") ?? "") === (x.categoryIds?.join(",") ?? "") ? x : { ...x, categoryIds: next };
      });
    });
    return () => {
      alive = false;
    };
  }, [repo, range[0], range[1], idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 기간 지정 선택지: 첫 기록 주(없으면 4주 전)부터 이번 주까지, 최근 주가 위
  const start = first && first < addWeeks(current, -3) ? first : addWeeks(current, -3);
  const weekOptions = weekList(start, latest > current ? latest : current).reverse();
  // 연도 선택지: 첫 기록 연도 ~ 올해(최신 위)
  const lastYear = Number((latest > current ? latest : current).slice(0, 4));
  const firstYear = Math.min(lastYear, Number((first ?? current).slice(0, 4)));
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => lastYear - i);

  const close = () => {
    setExportOpen(false);
    focusStartCell();
  };
  const set = (patch: Partial<ExportChoice>) => setChoice((c) => ({ ...c, ...patch }));
  const md = choice.format === "md";
  const nothing = md
    ? !choice.mdRecords && !choice.mdSummary && !choice.mdMemo
    : !choice.weekly && !choice.ledger && !choice.summary && !choice.snapshots;

  const save = async () => {
    const path = await runExport(choice);
    if (path) focusStartCell();
  };

  const setFormat = (f: ExportFormat) => set({ format: f });
  const onSegKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next: ExportFormat = choice.format === "xlsx" ? "md" : "xlsx";
    setFormat(next);
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-format="${next}"]`)?.focus();
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
        <div className={styles.head} {...lock(busy)}>
          <h2 id="export-title" className={styles.title}>
            {E.title}
          </h2>
          <div className={styles.seg} role="radiogroup" aria-label={E.format} onKeyDown={onSegKey}>
            {(["xlsx", "md"] as const).map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={choice.format === f}
                tabIndex={choice.format === f ? 0 : -1}
                title={f === "xlsx" ? E.formatXlsxTitle : E.formatMdTitle}
                data-format={f}
                data-testid={`export-format-${f}`}
                onClick={() => setFormat(f)}
              >
                {f === "xlsx" ? E.formatXlsx : E.formatMd}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.section} role="group" aria-labelledby="export-range-head" {...lock(busy)}>
          <p id="export-range-head" className={styles.sectionHead}>
            {E.range}
          </p>
          {KINDS.map((k) => {
            const r = resolveRange({ ...choice, kind: k }, current, first, latest);
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
                      aria-label={E.from}
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
                      aria-label={E.to}
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
                ) : k === "year" ? (
                  <span className={styles.selects}>
                    <select
                      aria-label={E.year}
                      value={choice.year}
                      data-testid="export-year"
                      onChange={(e) => set({ kind: "year", year: Number(e.target.value) })}
                    >
                      {years.map((y) => (
                        <option key={y} value={y}>
                          {E.yearValue(y)}
                        </option>
                      ))}
                    </select>
                    <span className={styles.range}>{rangeText(r)}</span>
                  </span>
                ) : (
                  <span className={styles.range}>{k === "all" && !first ? E.noRecords : rangeText(r)}</span>
                )}
              </div>
            );
          })}
          <div className={styles.catRow}>
            <span className={styles.catLabel}>{E.category}</span>
            <CategoryPicker list={cats} picked={ids} onChange={(next) => set({ categoryIds: next })} />
          </div>
        </div>

        <div className={styles.section} role="group" aria-labelledby="export-include-head" {...lock(busy)}>
          <p id="export-include-head" className={styles.sectionHead}>
            {E.include}
          </p>
          {md ? (
            <>
              <Check
                label={E.mdRecords}
                on={choice.mdRecords}
                set={(v) => set({ mdRecords: v })}
                testId="export-md-records"
              />
              <Check
                label={E.mdSummary}
                on={choice.mdSummary}
                set={(v) => set({ mdSummary: v })}
                testId="export-md-summary"
              />
              <Check
                label={E.mdMemo}
                info={E.mdMemoInfo}
                on={choice.mdMemo}
                set={(v) => set({ mdMemo: v })}
                testId="export-md-memo"
              />
            </>
          ) : (
            <>
              <Check label={E.weekly} on={choice.weekly} set={(v) => set({ weekly: v })} />
              <Check label={E.ledger} on={choice.ledger} set={(v) => set({ ledger: v })} />
              <Check label={E.summary} on={choice.summary} set={(v) => set({ summary: v })} />
              <Check
                label={E.snapshots}
                info={memoWeeks !== null ? E.snapshotsInfo(memoWeeks) : undefined}
                on={choice.snapshots}
                set={(v) => set({ snapshots: v })}
                testId="export-snapshots"
              />
            </>
          )}
        </div>

        <div className={styles.section}>
          <p className={styles.sectionHead}>{E.statsHead}</p>
          <p className={styles.stats} data-testid="export-stats">
            {stats ? E.stats(stats.weeks, stats.categories, stats.items) : " "}
          </p>
          {!md && choice.snapshots && (
            <p className={styles.note} data-testid="export-snapshots-note">
              {memoWeeks !== null && memoWeeks > 20 ? E.snapshotsMany(memoWeeks) : E.snapshotsNote}
            </p>
          )}
          {ids ? (
            <p className={styles.note} data-testid="export-filtered-note">
              {E.categoryFiltered}
            </p>
          ) : (
            !md && choice.weekly && <p className={styles.note}>{E.summaryNote}</p>
          )}
          {busy ? (
            <div className={styles.progress} data-export-progress="" data-testid="export-progress">
              <div className={styles.progressText}>
                <span data-testid="export-progress-label">{progress ?? E.saving}</span>
                {ratio !== null && <span>{Math.round(ratio * 100)}%</span>}
              </div>
              <div
                className={styles.bar}
                role="progressbar"
                aria-label={E.progressAria}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={ratio === null ? undefined : Math.round(ratio * 100)}
              >
                <div
                  className={`${styles.barFill} ${ratio === null ? styles.barWait : ""}`}
                  style={ratio === null ? undefined : { width: `${ratio * 100}%` }}
                />
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.button}
                  data-export-stop=""
                  data-testid="export-stop"
                  title={E.stopTitle}
                  onClick={cancelExport}
                >
                  {E.stop}
                </button>
              </div>
            </div>
          ) : (
            <div className={styles.actions}>
              <button type="button" className={styles.button} onClick={close}>
                {E.cancel}
              </button>
              <button
                type="button"
                className={styles.primary}
                onClick={() => void save()}
                disabled={nothing}
                title={nothing ? (md ? E.noPart : E.noSheet) : undefined}
              >
                {E.save}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 내보내는 동안 그 구역을 막는다(포커스·클릭 모두) */
const lock = (on: boolean) => (on ? { inert: "" as unknown as boolean, "aria-busy": true } : {});

function Check({
  label,
  info,
  on,
  set,
  testId,
}: {
  label: string;
  info?: string;
  on: boolean;
  set(v: boolean): void;
  testId?: string;
}) {
  return (
    <label className={styles.check}>
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} data-testid={testId} />
      {label}
      {info && <span className={styles.checkInfo}>{info}</span>}
    </label>
  );
}

/** 업무 고르기(improve-v27 1-4) — 칸반 업무 거르기와 같은 모양: 전체 · 체크해서 여러 개 · [이것만] */
function CategoryPicker({
  list,
  picked,
  onChange,
}: {
  list: ExportCategory[];
  picked: string[] | null;
  onChange(ids: string[] | null): void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  // 범위가 바뀌어 목록에서 빠진 업무는 고른 것에서도 뺀다
  const valid = picked?.filter((id) => list.some((c) => c.id === id)) ?? null;
  const all = !valid || valid.length === 0;
  const one = valid?.length === 1 ? list.find((c) => c.id === valid[0]) : undefined;
  const names = new Map(list.map((c) => [c.id, c.name]));

  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLElement>("[data-cat-row]")?.focus();
    const out = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", out);
    return () => document.removeEventListener("mousedown", out);
  }, [open]);

  const set = (ids: string[]) => onChange(ids.length === 0 || ids.length >= list.length ? null : ids);
  const toggle = (id: string) =>
    set(all ? [id] : valid!.includes(id) ? valid!.filter((x) => x !== id) : [...valid!, id]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const rows = [...(wrap.current?.querySelectorAll<HTMLElement>("[data-cat-row]") ?? [])];
    const i = rows.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
    }
  };

  return (
    <div ref={wrap} style={{ position: "relative" }}>
      <button
        ref={button}
        type="button"
        className={`${styles.catButton} ${all ? "" : styles.filtered}`}
        aria-haspopup="true"
        aria-expanded={open}
        title={all ? undefined : valid!.map((id) => names.get(id)).join(", ")}
        data-testid="export-category"
        onClick={() => setOpen((o) => !o)}
      >
        {one && <span className={styles.dot} style={{ background: `var(--cat-${one.color})` }} />}
        {categoryLabel(all ? null : valid, names)} ▾
      </button>
      {open && (
        <div
          className={styles.catMenu}
          role="dialog"
          aria-label={STR.export.category}
          data-testid="export-category-menu"
          onKeyDown={onKey}
        >
          <button
            type="button"
            role="menuitemradio"
            aria-checked={all}
            className={styles.menuAll}
            data-cat-row="__all"
            data-testid="export-category-all"
            onClick={() => onChange(null)}
          >
            <span className={`${styles.round} ${all ? styles.on : ""}`} aria-hidden="true" />
            {STR.export.categoryAllRow}
            <span className={styles.menuCount}>{list.length}</span>
          </button>
          <hr />
          <div className={styles.menuHead}>{STR.export.categoryHint}</div>
          {list.map((c) => {
            const on = !all && valid!.includes(c.id);
            return (
              <div key={c.id} className={styles.menuRow}>
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={on}
                  data-cat-row={c.id}
                  data-testid="export-category-row"
                  onClick={() => toggle(c.id)}
                >
                  <span className={`${styles.box} ${on ? styles.on : ""}`} aria-hidden="true">
                    {on ? "✓" : ""}
                  </span>
                  <span className={styles.dot} style={{ background: `var(--cat-${c.color})` }} />
                  <span className={`${styles.menuName} ${c.ended ? styles.menuEnded : ""}`}>{c.name}</span>
                  {c.ended && <span className={styles.menuCount}>{STR.export.categoryEnded}</span>}
                </button>
                <button
                  type="button"
                  className={styles.only}
                  tabIndex={-1}
                  onClick={() => (onChange([c.id]), setOpen(false))}
                >
                  {STR.export.categoryOnly}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
