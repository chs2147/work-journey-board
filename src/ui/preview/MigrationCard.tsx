// C-4 온라인 사본 만들기(Connected Preview, docs/v2-design/85).
// 로컬 일지 폴더 고르기 → 읽기 전용 사본(Rust) → 이관 자료(sql.js) 미리 보기 → 올리기·이어하기·멈추기·취소 → 게시.
// 화면은 네트워크를 쓰지 않는다(통신은 Rust). 로컬 일지는 읽기만 하고, 실패·취소와 무관하게 그대로다.
import { useEffect, useRef, useState } from "react";
import {
  loadPreviewMigration,
  loadPreviewSource,
  type MigrationJournal,
  type PreviewMigration,
  type PreviewSource,
} from "../../platform";
import type { PreparedCopy } from "../../preview/migrationEngine";
import {
  cancelMigration,
  MigrationAborted,
  runMigration,
  type MigrationStep,
} from "../../preview/migrationRunner";
import { prepareFromSnapshot, summarize, type CopySummary } from "../../preview/migrationSession";
import { formatBytes, STR } from "../../shared/strings";
import styles from "../first-run/FirstRun.module.css";
import own from "./MigrationCard.module.css";

const C = STR.previewCopy;
const errText = (e: unknown) => {
  const code = e instanceof Error ? e.message : String(e);
  return (
    C.errors[code] ?? STR.connectedPreview.errors[code] ?? `${STR.connectedPreview.errors.UNKNOWN} (${code})`
  );
};

type Phase =
  | { kind: "idle" }
  | { kind: "copying" | "preparing"; folder: string }
  | { kind: "choose"; parent: string; folders: string[] }
  | {
      kind: "ready";
      folder: string;
      jobId: string;
      snapshotId: string;
      copy: PreparedCopy;
      summary: CopySummary;
    }
  | { kind: "running"; jobId: string; step: MigrationStep | null; summary: CopySummary }
  | { kind: "paused"; jobId: string; snapshotId: string; summary: CopySummary | null; error: string | null }
  | { kind: "canceling"; jobId: string; step: MigrationStep | null }
  | { kind: "done"; workspaceId: string; summary: CopySummary }
  | { kind: "canceled" };

/** 진행 막대: 기록 30% · 그림 60%(용량 기준) · 확인 8% · 게시 2% */
function percent(step: MigrationStep | null): number {
  if (!step) return 0;
  switch (step.kind) {
    case "records":
      return (30 * step.sent) / Math.max(1, step.total);
    case "assets":
      return 30 + (60 * step.bytes) / Math.max(1, step.totalBytes);
    case "verify":
      return 90 + (8 * step.done) / Math.max(1, step.total);
    case "publish":
      return 98;
    case "cancel":
      return (100 * step.done) / Math.max(1, step.total);
  }
}
function stepText(step: MigrationStep | null): string {
  if (!step) return C.stepStart;
  switch (step.kind) {
    case "records":
      return C.stepRecords(step.sent, step.total);
    case "assets":
      return C.stepAssets(
        step.done,
        step.total,
        `${formatBytes(step.bytes)} / ${formatBytes(step.totalBytes)}`,
      );
    case "verify":
      return C.stepVerify(step.done, step.total);
    case "publish":
      return C.stepPublish;
    case "cancel":
      return C.stepCancel(step.done, step.total);
  }
}
const when = (ms: number) =>
  new Date(ms).toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

function Summary({ s, folder }: { s: CopySummary; folder?: string }) {
  return (
    <dl className={styles.facts} data-testid="copy-summary">
      {folder && (
        <>
          <dt>{C.source}</dt>
          <dd className={own.path} title={folder}>
            {folder}
          </dd>
        </>
      )}
      <dt>{C.sourceSchema}</dt>
      <dd>{C.schemaValue(s.sourceSchema)}</dd>
      <dt>{C.categories}</dt>
      <dd>{C.count(s.categories)}</dd>
      <dt>{C.entries}</dt>
      <dd data-testid="copy-entries">{C.count(s.entries)}</dd>
      <dt>{C.images}</dt>
      <dd data-testid="copy-images">{C.imagesValue(s.images, formatBytes(s.imageBytes))}</dd>
      <dt>{C.records}</dt>
      <dd>{C.count(s.records)}</dd>
      <dt>{C.pages}</dt>
      <dd>{C.count(s.pages)}</dd>
      {s.excluded > 0 && (
        <>
          <dt>{C.excluded}</dt>
          <dd>{C.count(s.excluded)}</dd>
        </>
      )}
    </dl>
  );
}

export function MigrationCard({ ownerId }: { ownerId: string | null }) {
  const [source, setSource] = useState<PreviewSource | null>(null);
  const [mig, setMig] = useState<PreviewMigration | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<MigrationJournal[]>([]);
  const abort = useRef<AbortController | null>(null);
  // 이어하기·취소용: 작업 ID → 준비된 자료(메모리에만)
  const prepared = useRef(new Map<string, { copy: PreparedCopy; summary: CopySummary }>());

  const refresh = async (m: PreviewMigration) => {
    const list = await m.journals().catch(() => []);
    setPending(list.filter((j) => j.phase !== "published" && j.phase !== "canceled"));
  };
  useEffect(() => {
    if (!ownerId) return;
    void Promise.all([loadPreviewSource(), loadPreviewMigration()]).then(([s, m]) => {
      setSource(s);
      setMig(m);
      void refresh(m);
    });
  }, [ownerId]);

  if (!ownerId)
    return (
      <section className={styles.card} data-testid="preview-copy">
        <h2 className={own.title}>{C.title}</h2>
        <p className={styles.small}>{C.signInFirst}</p>
      </section>
    );

  async function pick() {
    if (!source) return;
    setError(null);
    const parent = await source.pickFolder(C.pickTitle);
    if (!parent) return;
    // 고른 폴더에 일지가 없으면 바로 아래 하위 폴더(공간 폴더 등)에서 찾는다 — 하나면 그대로, 여럿이면 고르기
    let found: string[];
    try {
      found = await source.candidates(parent);
    } catch (e) {
      setError(errText(e));
      return;
    }
    if (found.length === 0) {
      setError(`${C.errors.SOURCE_NOT_JOURNAL} (${parent})`);
      return;
    }
    if (found.length > 1) {
      setPhase({ kind: "choose", parent, folders: found });
      return;
    }
    await copyFrom(found[0]!);
  }

  async function copyFrom(folder: string) {
    if (!source) return;
    setError(null);
    setPhase({ kind: "copying", folder });
    try {
      const snap = await source.snapshot(folder);
      setPhase({ kind: "preparing", folder });
      const jobId = crypto.randomUUID();
      const copy = await prepareFromSnapshot(source, snap.snapshotId, jobId);
      const summary = summarize(copy);
      prepared.current.set(jobId, { copy, summary });
      setPhase({ kind: "ready", folder, jobId, snapshotId: snap.snapshotId, copy, summary });
    } catch (e) {
      // 어느 폴더에서 실패했는지 함께(실기 진단)
      // 구조가 다르면 다른 곳 이름(표·색인 이름만, 기록 내용 없음)을 함께 — 실기 진단용
      const details = (e as { details?: unknown }).details;
      const more =
        Array.isArray(details) && details.length ? ` — ${C.schemaDiff}: ${details.join(", ")}` : "";
      setError(`${errText(e)} (${folder})${more}`);
      setPhase({ kind: "idle" });
    }
  }

  async function start(jobId: string, snapshotId: string) {
    if (!mig || !source || !ownerId) return;
    setError(null);
    let entry = prepared.current.get(jobId);
    try {
      if (!entry) {
        // 앱을 다시 켠 뒤 이어하기: 같은 사본·같은 작업 ID → 같은 자료
        const copy = await prepareFromSnapshot(source, snapshotId, jobId);
        entry = { copy, summary: summarize(copy) };
        prepared.current.set(jobId, entry);
      }
    } catch (e) {
      setError(errText(e));
      setPhase({ kind: "paused", jobId, snapshotId, summary: null, error: null });
      return;
    }
    const { copy, summary } = entry;
    const ac = new AbortController();
    abort.current = ac;
    setPhase({ kind: "running", jobId, step: null, summary });
    try {
      await runMigration(mig, copy, {
        jobId,
        ownerId,
        snapshotId,
        signal: ac.signal,
        onProgress: (step) => setPhase({ kind: "running", jobId, step, summary }),
      });
      await source.remove(snapshotId).catch(() => {});
      prepared.current.delete(jobId);
      setPhase({ kind: "done", workspaceId: copy.workspaceId, summary });
    } catch (e) {
      setPhase({
        kind: "paused",
        jobId,
        snapshotId,
        summary,
        error: e instanceof MigrationAborted ? null : errText(e),
      });
    } finally {
      abort.current = null;
      void refresh(mig);
    }
  }

  async function cancel(jobId: string, snapshotId?: string) {
    if (!mig) return;
    setError(null);
    const j = (await mig.journals()).find((x) => x.jobId === jobId);
    const snap = j?.snapshotId ?? snapshotId;
    if (!j) {
      // 서버와 한 번도 통신하기 전에 멈춘 작업 — 이 기기 사본만 지운다
      if (snap) await source?.remove(snap).catch(() => {});
      prepared.current.delete(jobId);
      setPhase({ kind: "canceled" });
      return;
    }
    setPhase({ kind: "canceling", jobId, step: null });
    try {
      await cancelMigration(mig, jobId, {
        onProgress: (step) => setPhase({ kind: "canceling", jobId, step }),
      });
      if (snap) await source?.remove(snap).catch(() => {});
      prepared.current.delete(jobId);
      setPhase({ kind: "canceled" });
    } catch (e) {
      setError(errText(e));
      setPhase({
        kind: "paused",
        jobId,
        snapshotId: snap ?? "",
        summary: prepared.current.get(jobId)?.summary ?? null,
        error: null,
      });
    } finally {
      void refresh(mig);
    }
  }

  async function discard(snapshotId: string, jobId: string) {
    await source?.remove(snapshotId).catch(() => {});
    prepared.current.delete(jobId);
    setPhase({ kind: "idle" });
  }

  const busy =
    phase.kind === "copying" ||
    phase.kind === "preparing" ||
    phase.kind === "running" ||
    phase.kind === "canceling";
  return (
    <section className={styles.card} data-testid="preview-copy" aria-busy={busy}>
      <h2 className={own.title}>{C.title}</h2>
      <p className={styles.small}>{C.lead}</p>

      {phase.kind === "idle" && (
        <>
          <div className={styles.row}>
            <button
              type="button"
              className={styles.primary}
              onClick={() => void pick()}
              data-testid="copy-pick"
            >
              {C.pick}
            </button>
          </div>
          {pending.length > 0 && (
            <div className={own.pending} data-testid="copy-pending">
              <p className={own.label}>{C.unfinished}</p>
              {pending.map((j) => (
                <div key={j.jobId} className={own.pendingRow}>
                  <span className={styles.small}>{C.unfinishedItem(when(j.updatedAt), j.records)}</span>
                  <div className={styles.row}>
                    <button
                      type="button"
                      className={styles.secondary}
                      onClick={() => void start(j.jobId, j.snapshotId)}
                    >
                      {C.resume}
                    </button>
                    <button type="button" className={styles.secondary} onClick={() => void cancel(j.jobId)}>
                      {C.cancelJob}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {phase.kind === "choose" && (
        <div className={own.pending} data-testid="copy-choose">
          <p className={own.label}>{C.chooseFolder}</p>
          {phase.folders.map((f) => (
            <div key={f} className={own.pendingRow}>
              <span className={own.path} title={f}>
                {f.startsWith(phase.parent) ? f.slice(phase.parent.length).replace(/^[\\/]/, "") : f}
              </span>
              <button type="button" className={styles.secondary} onClick={() => void copyFrom(f)}>
                {C.chooseThis}
              </button>
            </div>
          ))}
          <div className={styles.row}>
            <button type="button" className={styles.secondary} onClick={() => setPhase({ kind: "idle" })}>
              {C.discard}
            </button>
          </div>
        </div>
      )}

      {(phase.kind === "copying" || phase.kind === "preparing") && (
        <div className={own.progressBox}>
          <p className={styles.small} role="status">
            {phase.kind === "copying" ? C.copying : C.preparing}
          </p>
          <div className={own.bar} data-indeterminate>
            <span />
          </div>
        </div>
      )}

      {phase.kind === "ready" && (
        <>
          <Summary s={phase.summary} folder={phase.folder} />
          <div className={styles.row}>
            <button
              type="button"
              className={styles.primary}
              onClick={() => void start(phase.jobId, phase.snapshotId)}
              data-testid="copy-start"
            >
              {C.start}
            </button>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => void discard(phase.snapshotId, phase.jobId)}
            >
              {C.discard}
            </button>
          </div>
        </>
      )}

      {(phase.kind === "running" || phase.kind === "canceling") && (
        <div className={own.progressBox}>
          {phase.kind === "running" && <Summary s={phase.summary} />}
          <p className={styles.small} role="status" data-testid="copy-step">
            {stepText(phase.step)}
          </p>
          <div
            className={own.bar}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percent(phase.step))}
          >
            <span style={{ width: `${percent(phase.step)}%` }} />
          </div>
          {phase.kind === "running" && (
            <div className={styles.row}>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => abort.current?.abort()}
                disabled={phase.step?.kind === "publish"}
                data-testid="copy-stop"
              >
                {C.stop}
              </button>
            </div>
          )}
        </div>
      )}

      {phase.kind === "paused" && (
        <>
          {phase.summary && <Summary s={phase.summary} />}
          <p className={styles.small} data-testid="copy-paused">
            {phase.error ?? C.paused}
          </p>
          <div className={styles.row}>
            <button
              type="button"
              className={styles.primary}
              onClick={() => void start(phase.jobId, phase.snapshotId)}
              disabled={!phase.snapshotId}
              data-testid="copy-resume"
            >
              {C.resume}
            </button>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => void cancel(phase.jobId, phase.snapshotId)}
              data-testid="copy-cancel"
            >
              {C.cancelJob}
            </button>
          </div>
        </>
      )}

      {phase.kind === "done" && (
        <div className={styles.ok} data-testid="copy-done">
          <p>{C.done}</p>
          <p className={styles.small}>
            {C.workspace} <code title={phase.workspaceId}>{phase.workspaceId.slice(0, 8)}</code> · {C.entries}{" "}
            {C.count(phase.summary.entries)} · {C.images} {C.count(phase.summary.images)}
          </p>
          <div className={styles.row}>
            <button type="button" className={styles.secondary} onClick={() => setPhase({ kind: "idle" })}>
              {C.again}
            </button>
          </div>
        </div>
      )}

      {phase.kind === "canceled" && (
        <div className={styles.warn} data-testid="copy-canceled">
          <p>{C.canceled}</p>
          <div className={styles.row}>
            <button type="button" className={styles.secondary} onClick={() => setPhase({ kind: "idle" })}>
              {C.again}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className={styles.small} role="alert" data-testid="copy-error">
          {error}
        </p>
      )}
    </section>
  );
}
