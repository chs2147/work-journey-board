// 기존 일지 가져오기 마법사(i-m3-plan 3-5): ① 준비(절차·양식·AI 지시문) ② 파일(엑셀·CSV·표 붙여넣기, 열 맞추기)
// ③ 미리보기(주별 병합·덮어쓰기·건너뛰기, 새 업무, 건너뜀·확인 필요) ④ 결과.
import { useEffect, useRef, useState } from "react";
import { columnLabels, type ImportIssue, type ImportRole } from "../../domain/importer";
import { weekTitle } from "../../domain/week";
import { STR } from "../../shared/strings";
import { focusStartCell } from "../board/boardStore";
import {
  closeImport,
  copyPrompt,
  goFirstImportedWeek,
  loadFile,
  loadPaste,
  mappingReady,
  openImport,
  pickTable,
  preview,
  runImport,
  saveTemplate,
  setAllExisting,
  setIncludeFuture,
  setMapping,
  setStep,
  setWeekAction,
  toggleReopen,
  useImport,
} from "./importStore";
import styles from "./ImportWizard.module.css";

const T = STR.importer;
const ROLES: ImportRole[] = ["weekStart", "date", "day", "category", "depth", "text"];

export function ImportWizard() {
  const step = useImport((s) => s.step);
  const busy = useImport((s) => s.busy);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [step]);

  // Esc = 닫기 — 파일 선택 창을 다녀오면 포커스가 창 밖에 있을 수 있어 문서 전체에서 받는다
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || useImport.getState().busy || e.defaultPrevented) return;
      e.preventDefault();
      closeImport();
      focusStartCell();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const close = () => {
    closeImport();
    focusStartCell();
  };

  return (
    <div className={styles.backdrop} onMouseDown={(e) => e.target === e.currentTarget && !busy && close()}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        data-testid="import-wizard"
      >
        <header className={styles.head}>
          <h2 id="import-title" className={styles.title}>
            {T.title}
          </h2>
          <ol className={styles.steps} aria-label={T.title}>
            {T.steps.map((label, i) => (
              <li
                key={label}
                aria-current={i === step ? "step" : undefined}
                className={i === step ? styles.stepOn : ""}
              >
                {i + 1}. {label}
              </li>
            ))}
          </ol>
        </header>
        <div className={styles.body}>
          {step === 0 && <Prepare />}
          {step === 1 && <PickSource />}
          {step === 2 && <Preview />}
          {step === 3 && <Result onClose={close} />}
        </div>
        {step < 3 && (
          <footer className={styles.actions}>
            {step > 0 && (
              <button
                type="button"
                className={styles.button}
                disabled={busy}
                onClick={() => setStep((step - 1) as 0 | 1)}
              >
                {T.back}
              </button>
            )}
            <span className={styles.spacer} />
            <button type="button" className={styles.button} disabled={busy} onClick={close}>
              {T.close}
            </button>
            {step === 0 && (
              <button type="button" className={styles.primary} data-autofocus onClick={() => setStep(1)}>
                {T.next}
              </button>
            )}
            {step === 2 && <RunButton />}
          </footer>
        )}
      </div>
    </div>
  );
}

// ── ① 준비 ───────────────────────────────────────────
function Prepare() {
  const busy = useImport((s) => s.busy);
  return (
    <>
      <ol className={styles.procedure} data-testid="import-procedure">
        {T.procedure.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ol>
      <div className={styles.row}>
        <button type="button" className={styles.button} disabled={busy} onClick={() => void saveTemplate()}>
          {T.templateButton}
        </button>
        <button type="button" className={styles.button} onClick={() => void copyPrompt()}>
          {T.promptButton}
        </button>
      </div>
      <details className={styles.details}>
        <summary>{T.promptButton}</summary>
        <pre className={styles.prompt} data-testid="import-prompt">
          {T.prompt}
        </pre>
      </details>
    </>
  );
}

// ── ② 파일 ───────────────────────────────────────────
function PickSource() {
  const busy = useImport((s) => s.busy);
  const error = useImport((s) => s.error);
  const source = useImport((s) => s.source);
  const table = useImport((s) => s.table);
  const mapping = useImport((s) => s.mapping);
  const headerRow = useImport((s) => s.headerRow);
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const t = source?.tables[table];
  const labels = t ? columnLabels(t.rows, headerRow) : [];

  return (
    <>
      <div className={styles.row}>
        <button
          type="button"
          className={styles.primary}
          data-autofocus
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {T.pickFile}
        </button>
        <span className={styles.hint}>{T.pickFileHint}</span>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.csv,.txt,.tsv"
          className={styles.fileInput}
          data-testid="import-file-input"
          tabIndex={-1}
          aria-label={T.pickFile}
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (f) void loadFile(f);
          }}
        />
      </div>
      <label className={styles.pasteLabel}>
        {T.pasteLabel}
        <textarea
          className={styles.paste}
          value={text}
          placeholder={T.pastePlaceholder}
          rows={5}
          onChange={(e) => setText(e.currentTarget.value)}
        />
      </label>
      <div className={styles.row}>
        <button
          type="button"
          className={styles.button}
          disabled={busy || !text.trim()}
          onClick={() => void loadPaste(text)}
        >
          {T.pasteRead}
        </button>
        {busy && <span className={styles.hint}>{T.reading}</span>}
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {source && t && (
        <fieldset className={styles.mapping} data-testid="import-mapping">
          <legend>
            {source.fileName} — {T.mapTitle}
          </legend>
          {source.tables.length > 1 && (
            <label className={styles.mapRow}>
              <span>{T.sheet}</span>
              <select value={table} onChange={(e) => pickTable(Number(e.currentTarget.value))}>
                {source.tables.map((x, i) => (
                  <option key={x.name} value={i}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {ROLES.map((role) => (
            <label key={role} className={styles.mapRow}>
              <span>{T.roles[role]}</span>
              <select
                value={mapping[role] ?? ""}
                onChange={(e) =>
                  setMapping(role, e.currentTarget.value === "" ? null : Number(e.currentTarget.value))
                }
              >
                <option value="">{T.none}</option>
                {labels.map((l, i) => (
                  <option key={i} value={i}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <div className={styles.row}>
            <button
              type="button"
              className={styles.primary}
              disabled={busy || !mappingReady(mapping)}
              onClick={() => void preview()}
            >
              {T.next}
            </button>
          </div>
        </fieldset>
      )}
    </>
  );
}

// ── ③ 미리보기 ──────────────────────────────────────
function Preview() {
  const plan = useImport((s) => s.plan);
  const parsed = useImport((s) => s.parsed);
  const kind = useImport((s) => s.kind);
  const source = useImport((s) => s.source);
  const reopen = useImport((s) => s.reopen);
  const includeFuture = useImport((s) => s.includeFuture);
  if (!plan || !parsed) return null;
  const dates = parsed.rows.map((r) => r.date).sort();
  const existingWeeks = plan.weeks.filter((w) => w.action !== "import");
  const ended = plan.matched.filter((m) => m.ended);

  return (
    <>
      <p className={styles.summary} data-testid="import-summary">
        <span className={styles.kind}>{T.kinds[kind]}</span> {source?.fileName} ·{" "}
        {dates.length
          ? T.summary(dates[0]!, dates.at(-1)!, plan.weeks.length, parsed.rows.length)
          : T.nothing}
      </p>
      {plan.weeks.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table} data-testid="import-weeks">
            <thead>
              <tr>
                <th>{T.colWeek}</th>
                <th>{T.colFile}</th>
                <th>{T.colExisting}</th>
                <th>{T.colAction}</th>
              </tr>
            </thead>
            <tbody>
              {plan.weeks.map((w) => (
                <tr key={w.weekId} data-week={w.weekId}>
                  <td title={w.byCategory.map((c) => `${c.name}: ${c.file} / ${c.existing}`).join("\n")}>
                    {weekTitle(w.weekId)}
                  </td>
                  <td className={styles.num}>
                    {w.fileItems}
                    {w.fileMemo ? ` ${T.memoMark}` : ""}
                  </td>
                  <td className={styles.num}>
                    {w.existingItems || w.existingMemoBoxes ? (
                      <>
                        {w.existingItems}
                        {w.existingMemoBoxes ? ` ${T.memoMark}` : ""}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {w.action === "import" ? (
                      T.actions.import
                    ) : (
                      <select
                        aria-label={`${w.weekId} ${T.colAction}`}
                        value={w.action}
                        title={T.actionHint[w.action]}
                        onChange={(e) =>
                          setWeekAction(w.weekId, e.currentTarget.value as "merge" | "overwrite" | "skip")
                        }
                      >
                        {(["merge", "overwrite", "skip"] as const).map((a) => (
                          <option key={a} value={a} title={T.actionHint[a]}>
                            {T.actions[a]}
                          </option>
                        ))}
                      </select>
                    )}
                    {w.remove > 0 && <span className={styles.danger}> {T.removeNote(w.remove)}</span>}
                    {w.duplicates > 0 && <span className={styles.hint}> {T.dupNote(w.duplicates)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {existingWeeks.length > 1 && (
        <label className={styles.row}>
          <span>{T.allExisting}</span>
          <select
            aria-label={T.allExisting}
            defaultValue=""
            onChange={(e) =>
              e.currentTarget.value && setAllExisting(e.currentTarget.value as "merge" | "overwrite" | "skip")
            }
          >
            <option value="" disabled>
              —
            </option>
            {(["merge", "overwrite", "skip"] as const).map((a) => (
              <option key={a} value={a}>
                {T.actions[a]}
              </option>
            ))}
          </select>
        </label>
      )}
      <p data-testid="import-categories">{T.categories(plan.matched.length, plan.newCategories.length)}</p>
      {plan.newCategories.length > 0 && (
        <details className={styles.details} open>
          <summary>{T.newCatsTitle}</summary>
          <ul className={styles.list}>
            {plan.newCategories.map((c) => (
              <li key={c.key}>
                {c.name} <span className={styles.hint}>({c.startDate} ~)</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {ended.length > 0 && (
        <details className={styles.details}>
          <summary>{T.endedTitle}</summary>
          <ul className={styles.list}>
            {ended.map((m) => (
              <li key={m.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={reopen.includes(m.id)}
                    onChange={() => toggleReopen(m.id)}
                  />{" "}
                  {m.name} — {T.reopen}
                </label>
              </li>
            ))}
          </ul>
        </details>
      )}
      <IssueList
        title={T.warningsTitle(parsed.warnings.length)}
        issues={parsed.warnings}
        testId="import-warnings"
      />
      <IssueList
        title={T.skippedTitle(parsed.skipped.length)}
        issues={parsed.skipped}
        testId="import-skipped"
      />
      {(parsed.future > 0 || includeFuture) && (
        <label className={styles.row}>
          <input
            type="checkbox"
            checked={includeFuture}
            onChange={(e) => void setIncludeFuture(e.currentTarget.checked)}
          />
          {T.includeFuture} ({parsed.future})
        </label>
      )}
    </>
  );
}

function IssueList({ title, issues, testId }: { title: string; issues: ImportIssue[]; testId: string }) {
  if (!issues.length) return null;
  return (
    <details className={styles.details} data-testid={testId}>
      <summary>{title}</summary>
      <ul className={styles.list}>
        {issues.slice(0, 200).map((i, k) => (
          <li key={k}>
            <span className={styles.line}>{T.line(i.line)}</span> {T.reasons[i.reason]}
            {i.sample && <span className={styles.hint}> — {i.sample}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

function RunButton() {
  const plan = useImport((s) => s.plan);
  const busy = useImport((s) => s.busy);
  const empty = !plan || (!plan.totals.items && !plan.memos.length && !plan.totals.removed);
  return (
    <button
      type="button"
      className={styles.primary}
      data-autofocus
      disabled={busy || empty}
      title={empty ? T.nothing : undefined}
      onClick={() => void runImport()}
    >
      {busy ? T.running : T.run}
    </button>
  );
}

// ── ④ 결과 ───────────────────────────────────────────
function Result({ onClose }: { onClose(): void }) {
  const result = useImport((s) => s.result);
  if (!result) return null;
  return (
    <div className={styles.result} data-testid="import-result">
      <p className={styles.done}>{T.done(result.items, result.weeks)}</p>
      {result.newCategories > 0 && <p>{T.doneNewCats(result.newCategories)}</p>}
      {result.newCategories > 0 && <p className={styles.hint}>{T.doneNudge}</p>}
      <div className={styles.row}>
        {result.firstWeek && (
          <button
            type="button"
            className={styles.primary}
            data-autofocus
            onClick={() => void goFirstImportedWeek()}
          >
            {T.goFirstWeek}
          </button>
        )}
        <button
          type="button"
          className={styles.button}
          onClick={() => {
            openImport();
            setStep(1);
          }}
        >
          {T.again}
        </button>
        <button type="button" className={styles.button} onClick={onClose}>
          {T.close}
        </button>
      </div>
    </div>
  );
}
