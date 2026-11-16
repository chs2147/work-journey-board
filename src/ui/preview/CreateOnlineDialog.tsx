// 온라인 워크스페이스 만들기 4단계(Connected Preview, docs/v2-design/85·95 S6·U4):
// ① 시작 방식(새로 시작하기 / 오프라인 기록으로 시작) ② 원본(이름·색·아이콘 / 로컬 일지 폴더) ③ 확인(원본 그대로 ↔ 새 공간)
// ④ 올리기(진행·멈추기·이어서·취소 → [온라인 워크스페이스 열기]). 화면은 네트워크를 쓰지 않는다(통신은 Rust).
// 로컬 일지는 읽기만 하고(읽기 전용 사본), 실패·취소와 무관하게 그대로다. 새로 시작하기 = 메모리의 빈 일지(이 PC에 아무것도 만들지 않음).
import { useEffect, useRef, useState } from "react";
import { WorkspaceLook } from "../common/WorkspaceFields";
import { WorkspaceMark } from "../common/workspaceIcons";
import { FIRST_WORKSPACE, isColor, isIcon, type WorkspaceIcon } from "../../domain/workspace";
import type { CategoryColorKey } from "../../shared/palette";
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
import {
  derivedId,
  labelOf,
  prepareEmpty,
  prepareFromSnapshot,
  summarize,
  type CopySummary,
} from "../../preview/migrationSession";
import { formatBytes, STR } from "../../shared/strings";
import styles from "../first-run/FirstRun.module.css";
import own from "./MigrationCard.module.css";
import dlg from "./CreateOnlineDialog.module.css";

const C = STR.previewCopy;
const errText = (e: unknown) => {
  const code = e instanceof Error ? e.message : String(e);
  return (
    C.errors[code] ?? STR.connectedPreview.errors[code] ?? `${STR.connectedPreview.errors.UNKNOWN} (${code})`
  );
};

const W = C.wizard;
/**
 * 새로 시작하기 작업 = 원본 사본 없음. 작업 기록(Rust migration.rs)은 사본 ID도 UUID만 받으므로 작업마다 정해진 UUID를 쓰고,
 * 이 화면이 만든 것만 기억한다(실기: "new:…"를 넣어 게시 전에 거절됨). 앱을 다시 켜면 사본이 없어 이어 갈 수 없다(취소 안내)
 */
const freshSnapshots = new Set<string>();
const isFresh = (id: string) => freshSnapshots.has(id);
type Label = { name: string; color: CategoryColorKey; icon: WorkspaceIcon };

type Phase =
  | { kind: "start" }
  | { kind: "fresh" }
  | { kind: "idle" }
  | { kind: "copying" | "preparing"; folder: string }
  | { kind: "choose"; parent: string; folders: string[] }
  | {
      kind: "ready";
      /** 오프라인 기록 = 폴더, 새로 시작하기 = null */
      folder: string | null;
      jobId: string;
      snapshotId: string;
      copy: PreparedCopy;
      summary: CopySummary;
    }
  | { kind: "running"; jobId: string; step: MigrationStep | null; summary: CopySummary }
  | { kind: "paused"; jobId: string; snapshotId: string; summary: CopySummary | null; error: string | null }
  | { kind: "canceling"; jobId: string; step: MigrationStep | null }
  | { kind: "done"; workspaceId: string; summary: CopySummary; label: Label | null }
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

const toLabel = (v: { name: string; color: string; icon: string } | null): Label | null =>
  v
    ? { name: v.name, color: isColor(v.color) ? v.color : "c1", icon: isIcon(v.icon) ? v.icon : "folder" }
    : null;

function stepOf(p: Phase): number {
  switch (p.kind) {
    case "start":
      return 0;
    case "fresh":
    case "idle":
    case "choose":
    case "copying":
    case "preparing":
      return 1;
    case "ready":
      return 2;
    default:
      return 3;
  }
}

export function CreateOnlineDialog({
  ownerId,
  email,
  onPublished,
  onOpen,
  onClose,
}: {
  ownerId: string;
  email: string | null;
  onPublished?: () => void;
  /** 다 만든 공간 바로 열기 */
  onOpen?: (workspaceId: string) => void;
  onClose: () => void;
}) {
  const [source, setSource] = useState<PreviewSource | null>(null);
  const [mig, setMig] = useState<PreviewMigration | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "start" });
  const [mode, setMode] = useState<"fresh" | "local">("local");
  const [look, setLook] = useState<Label>({ ...FIRST_WORKSPACE, name: "" });
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
    void Promise.all([loadPreviewSource(), loadPreviewMigration()]).then(([s, m]) => {
      setSource(s);
      setMig(m);
      void refresh(m);
    });
  }, [ownerId]);

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
      // 어느 폴더에서 실패했는지 함께. 구조가 다르면 다른 곳 이름(표·색인 이름만, 기록 내용 없음) — 실기 진단용
      const details = (e as { details?: unknown }).details;
      const more =
        Array.isArray(details) && details.length ? ` — ${C.schemaDiff}: ${details.join(", ")}` : "";
      setError(`${errText(e)} (${folder})${more}`);
      setPhase({ kind: "idle" });
    }
  }

  async function prepareFresh() {
    setError(null);
    setPhase({ kind: "preparing", folder: "" });
    try {
      const jobId = crypto.randomUUID();
      const copy = await prepareEmpty(jobId, { ...look, name: look.name.trim() });
      const summary = summarize(copy);
      prepared.current.set(jobId, { copy, summary });
      const snapshotId = derivedId(jobId, "empty-source");
      freshSnapshots.add(snapshotId);
      setPhase({ kind: "ready", folder: null, jobId, snapshotId, copy, summary });
    } catch (e) {
      setError(errText(e));
      setPhase({ kind: "fresh" });
    }
  }

  async function start(jobId: string, snapshotId: string) {
    if (!mig || !source) return;
    setError(null);
    let entry = prepared.current.get(jobId);
    try {
      if (!entry) {
        // 새로 시작한 작업은 사본이 없어 앱을 다시 켠 뒤 이어 갈 수 없다
        if (isFresh(snapshotId)) throw new Error("RESUME_NEW");
        // 앱을 다시 켠 뒤 이어하기: 같은 사본·같은 작업 ID → 같은 자료
        const copy = await prepareFromSnapshot(source, snapshotId, jobId);
        entry = { copy, summary: summarize(copy) };
        prepared.current.set(jobId, entry);
      }
    } catch (e) {
      setError(e instanceof Error && e.message === "RESUME_NEW" ? W.resumeNew : errText(e));
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
      if (!isFresh(snapshotId)) await source.remove(snapshotId).catch(() => {});
      prepared.current.delete(jobId);
      setPhase({ kind: "done", workspaceId: copy.workspaceId, summary, label: toLabel(labelOf(copy)) });
      onPublished?.();
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
    const removeSnap = async () => {
      if (snap && !isFresh(snap)) await source?.remove(snap).catch(() => {});
    };
    if (!j) {
      // 서버와 한 번도 통신하기 전에 멈춘 작업 — 이 기기 사본만 지운다
      await removeSnap();
      prepared.current.delete(jobId);
      setPhase({ kind: "canceled" });
      return;
    }
    setPhase({ kind: "canceling", jobId, step: null });
    try {
      await cancelMigration(mig, jobId, {
        onProgress: (step) => setPhase({ kind: "canceling", jobId, step }),
      });
      await removeSnap();
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
    if (!isFresh(snapshotId)) await source?.remove(snapshotId).catch(() => {});
    prepared.current.delete(jobId);
    setPhase({ kind: mode === "fresh" ? "fresh" : "idle" });
  }

  const busy =
    phase.kind === "copying" ||
    phase.kind === "preparing" ||
    phase.kind === "running" ||
    phase.kind === "canceling";
  const step = stepOf(phase);
  const readyLabel = phase.kind === "ready" ? toLabel(labelOf(phase.copy)) : null;

  return (
    <div className={dlg.dim} data-testid="create-online-dim">
      <section
        className={dlg.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={W.title}
        data-testid="preview-copy"
        aria-busy={busy}
      >
        <div className={dlg.head}>
          <b className={dlg.title}>{W.title}</b>
          <button
            type="button"
            className={styles.secondary}
            onClick={onClose}
            disabled={busy}
            data-testid="create-online-close"
          >
            {W.close}
          </button>
        </div>
        <ol className={dlg.steps} aria-label={W.title}>
          {W.steps.map((s, i) => (
            <li key={s} data-on={i === step || undefined} data-done={i < step || undefined}>
              {s}
            </li>
          ))}
        </ol>

        {phase.kind === "start" && (
          <>
            <div className={dlg.choices} role="radiogroup" aria-label={W.steps[0]}>
              {(
                [
                  ["fresh", W.fresh, W.freshSub],
                  ["local", W.fromLocal, W.fromLocalSub],
                ] as const
              ).map(([k, t, sub]) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={mode === k}
                  className={dlg.choice}
                  data-testid={`create-mode-${k}`}
                  onClick={() => setMode(k)}
                >
                  <b>{t}</b>
                  <span className={styles.small}>{sub}</span>
                </button>
              ))}
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
            <div className={dlg.foot}>
              <button
                type="button"
                className={styles.primary}
                data-testid="create-next"
                onClick={() => setPhase({ kind: mode === "fresh" ? "fresh" : "idle" })}
              >
                {W.next}
              </button>
            </div>
          </>
        )}

        {phase.kind === "fresh" && (
          <>
            <p className={own.label}>{W.nameTitle}</p>
            <WorkspaceLook
              name={look.name}
              color={look.color}
              icon={look.icon}
              autoFocus
              onName={(name) => setLook({ ...look, name })}
              onColor={(color) => setLook({ ...look, color })}
              onIcon={(icon) => setLook({ ...look, icon })}
            />
            <div className={dlg.foot}>
              <button type="button" className={styles.secondary} onClick={() => setPhase({ kind: "start" })}>
                {W.back}
              </button>
              <button
                type="button"
                className={styles.primary}
                disabled={!look.name.trim()}
                data-testid="create-fresh-next"
                onClick={() => void prepareFresh()}
              >
                {W.next}
              </button>
            </div>
          </>
        )}

        {phase.kind === "idle" && (
          <>
            <p className={styles.small}>{C.lead}</p>
            <div className={dlg.foot}>
              <button type="button" className={styles.secondary} onClick={() => setPhase({ kind: "start" })}>
                {W.back}
              </button>
              <button
                type="button"
                className={styles.primary}
                onClick={() => void pick()}
                data-testid="copy-pick"
              >
                {C.pick}
              </button>
            </div>
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
            <div className={dlg.sides} data-testid="create-confirm">
              <div className={dlg.side}>
                <div className={dlg.sideHead}>
                  <span>{W.sourceSide}</span>
                  {phase.folder && <span className={dlg.keep}>{W.sourceKeep}</span>}
                </div>
                <b className={own.path} title={phase.folder ?? undefined}>
                  {phase.folder ?? W.sourceEmpty}
                </b>
              </div>
              <div className={dlg.side}>
                <div className={dlg.sideHead}>
                  <span>{W.newSide}</span>
                </div>
                <span className={dlg.newName}>
                  <WorkspaceMark
                    icon={readyLabel?.icon ?? "folder"}
                    color={readyLabel?.color ?? "c1"}
                    size={26}
                    online
                  />
                  <b>{readyLabel?.name ?? STR.workspace.onlineMark}</b>
                </span>
                {email && <span className={styles.small}>{email}</span>}
              </div>
            </div>
            <Summary s={phase.summary} />
            <div className={dlg.foot}>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => void discard(phase.snapshotId, phase.jobId)}
              >
                {W.back}
              </button>
              <button
                type="button"
                className={styles.primary}
                onClick={() => void start(phase.jobId, phase.snapshotId)}
                data-testid="copy-start"
              >
                {C.start}
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
              {C.workspace} <code title={phase.workspaceId}>{phase.workspaceId.slice(0, 8)}</code> ·{" "}
              {C.entries} {C.count(phase.summary.entries)} · {C.images} {C.count(phase.summary.images)}
            </p>
            <div className={styles.row}>
              {onOpen && (
                <button
                  type="button"
                  className={styles.primary}
                  onClick={() => onOpen(phase.workspaceId)}
                  data-testid="create-open"
                >
                  {W.open}
                </button>
              )}
              <button type="button" className={styles.secondary} onClick={() => setPhase({ kind: "start" })}>
                {C.again}
              </button>
            </div>
          </div>
        )}

        {phase.kind === "canceled" && (
          <div className={styles.warn} data-testid="copy-canceled">
            <p>{C.canceled}</p>
            <div className={styles.row}>
              <button type="button" className={styles.secondary} onClick={() => setPhase({ kind: "start" })}>
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
    </div>
  );
}
