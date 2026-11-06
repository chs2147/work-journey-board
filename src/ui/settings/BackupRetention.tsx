import { useEffect, useState } from "react";
import {
  normalizeBackupPolicy,
  RECOMMENDED_BACKUP_POLICY,
  type BackupPolicy,
  type CleanupPlan,
  type BackupControl,
} from "../../data/backupPolicy";
import type { Settings } from "../../data/settings";
import { STR } from "../../shared/strings";
import { applyRetention, previewRetention } from "../common/appController";
import { useAppStore } from "../common/appStore";
import { BackupDialog } from "../common/BackupDialog";
import { backupBytes } from "../common/backupUi";
import { IconTune, IconTrash, IconList, IconCompleteItem } from "../common/icons";
import { CardMessage, Row } from "./SettingsCard";
import styles from "./BackupRetention.module.css";
const B = STR.backupV13;
export function BackupRetention({
  settings,
  onChanged,
}: {
  settings: Settings | null;
  onChanged: () => Promise<void>;
}) {
  const platform = useAppStore((s) => s.platform)!,
    journal = useAppStore((s) => s.journal);
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState<BackupPolicy>(settings?.backup ?? RECOMMENDED_BACKUP_POLICY),
    [plan, setPlan] = useState<CleanupPlan | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [message, setMessage] = useState<string | null>(null),
    [control, setControl] = useState<BackupControl | null>(null);
  useEffect(() => {
    let alive = true;
    if (journal.state === "ready")
      void platform.loadConfig().then((c) => {
        if (alive) setControl(c?.backupControlBy?.[journal.dataDir] ?? null);
      });
    return () => {
      alive = false;
    };
  }, [platform, journal, open]);
  if (!settings || journal.state !== "ready") return null;
  const current = settings.backup;
  const summary = B.policySummary(
    current.retentionMode,
    current.retentionMode === "days" ? current.retentionDays : current.dailyKeep,
    current.monthlyKeep,
    current.maxBytes ? backupBytes(current.maxBytes) : null,
  );
  const begin = () => {
    setDraft({ ...current });
    setPlan(null);
    setError(null);
    setMessage(null);
    setOpen(true);
  };
  const changed = (p: Partial<BackupPolicy>) => {
    setDraft((d) => ({ ...d, ...p }));
    setPlan(null);
    setError(null);
    setMessage(null);
  };
  const valid =
    Number.isInteger(draft.dailyKeep) &&
    draft.dailyKeep >= 1 &&
    draft.dailyKeep <= 3650 &&
    Number.isInteger(draft.retentionDays) &&
    draft.retentionDays >= 1 &&
    draft.retentionDays <= 3650 &&
    Number.isInteger(draft.monthlyKeep) &&
    draft.monthlyKeep >= 0 &&
    draft.monthlyKeep <= 120 &&
    (draft.maxBytes === null ||
      (Number.isSafeInteger(draft.maxBytes) &&
        draft.maxBytes >= 256 * 1024 ** 2 &&
        draft.maxBytes <= 100 * 1024 ** 3));
  const preview = async (policy = draft) => {
    setBusy(true);
    setError(null);
    try {
      setPlan(await previewRetention(policy));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Row label={STR.settings.policyLabel} desc={summary}>
        <button type="button" onClick={begin} data-testid="backup-policy-open">
          <IconTune />
          {B.edit}
        </button>
        <button
          type="button"
          onClick={() => {
            begin();
            void preview(current);
          }}
        >
          <IconTrash />
          {B.clean}
        </button>
      </Row>
      <CardMessage>
        <div className={styles.hints}>
          <p>{B.protectHint}</p>
          {control?.paused && <p className={styles.warning}>{B.paused}</p>}
          {control?.lastCleanup && (
            <p>
              {B.cleanupLast(
                new Date(control.lastCleanup.at).toLocaleString(),
                control.lastCleanup.deleted,
                control.lastCleanup.failed,
                backupBytes(control.lastCleanup.freed),
              )}
            </p>
          )}
        </div>
      </CardMessage>
      {open && (
        <BackupDialog title={B.policy} busy={busy} onClose={() => setOpen(false)}>
          <p className={styles.muted}>
            {B.scope}
            <br />
            {journal.dataDir}
          </p>
          <div className={styles.grid}>
            <div>
              <label htmlFor="backup-mode">{B.daily}</label>
              <div className={styles.line}>
                <select
                  id="backup-mode"
                  disabled={busy}
                  value={draft.retentionMode}
                  onChange={(e) =>
                    changed({ retentionMode: e.target.value as BackupPolicy["retentionMode"] })
                  }
                >
                  <option value="days">{B.days}</option>
                  <option value="count">{B.count}</option>
                </select>
                <input
                  aria-label={B.daily}
                  type="number"
                  min={1}
                  max={3650}
                  disabled={busy}
                  value={draft.retentionMode === "days" ? draft.retentionDays : draft.dailyKeep}
                  onChange={(e) =>
                    changed(
                      draft.retentionMode === "days"
                        ? { retentionDays: Number(e.target.value) }
                        : { dailyKeep: Number(e.target.value) },
                    )
                  }
                />
                <span>{draft.retentionMode === "days" ? B.daysUnit : B.countUnit}</span>
              </div>
              <p className={styles.muted}>
                {draft.retentionMode === "days"
                  ? B.daysHint(draft.retentionDays)
                  : B.countHint(draft.dailyKeep)}
              </p>
              <label htmlFor="backup-monthly">{B.monthly}</label>
              <input
                id="backup-monthly"
                type="number"
                min={0}
                max={120}
                value={draft.monthlyKeep}
                disabled={busy}
                onChange={(e) => changed({ monthlyKeep: Number(e.target.value) })}
              />
              <p className={styles.muted}>{B.monthlyHint}</p>
            </div>
            <div>
              <label>
                <input
                  type="checkbox"
                  checked={draft.maxBytes !== null}
                  disabled={busy}
                  onChange={(e) => changed({ maxBytes: e.target.checked ? 2 * 1024 ** 3 : null })}
                />
                {B.capacityOn}
              </label>
              <div className={styles.line}>
                <input
                  aria-label={B.capacity}
                  type="number"
                  min={0.25}
                  max={100}
                  step={0.25}
                  disabled={busy || draft.maxBytes === null}
                  value={draft.maxBytes === null ? 2 : draft.maxBytes / 1024 ** 3}
                  onChange={(e) => changed({ maxBytes: Math.round(Number(e.target.value) * 1024 ** 3) })}
                />
                <span>GiB</span>
              </div>
              <p className={styles.muted}>{B.capacityHint}</p>
              <p className={styles.warning}>{B.protectHint}</p>
            </div>
          </div>
          <div className={styles.actions}>
            <button
              disabled={busy}
              onClick={() => {
                setDraft({ ...RECOMMENDED_BACKUP_POLICY, periodicHours: current.periodicHours });
                setPlan(null);
                setMessage(null);
              }}
            >
              {B.recommend}
            </button>
            <button disabled={busy || !valid} onClick={() => void preview()}>
              <IconList />
              {busy ? B.checking : B.preview}
            </button>
          </div>
          {!valid && (
            <p role="alert" className={styles.warning}>
              {B.invalidInput}
            </p>
          )}
          {plan && (
            <section className={styles.preview} data-testid="backup-cleanup-preview">
              <div className={styles.metrics}>
                <strong>{B.candidateCount(plan.candidates.length)}</strong>
                <strong>{B.freed(backupBytes(plan.freed))}</strong>
                <strong>{B.after(backupBytes(plan.after))}</strong>
              </div>
              <p>{B.protectedCount(plan.protectedCount)}</p>
              {plan.overBudget && <p className={styles.warning}>{B.overBudget}</p>}
              <div className={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th>{B.file}</th>
                      <th>{B.reason}</th>
                      <th>{B.size}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.candidates.map((f) => (
                      <tr key={f.name}>
                        <td>{f.name}</td>
                        <td>{B.reasonLabel[f.reason]}</td>
                        <td>{backupBytes(f.size)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className={styles.warning}>{plan.candidates.length ? B.deleteWarning : B.noDelete}</p>
              <div className={styles.actions}>
                <button disabled={busy} onClick={() => setPlan(null)}>
                  {B.cancel}
                </button>
                <button
                  disabled={busy || !valid}
                  data-testid="backup-policy-apply"
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      const result = await applyRetention(normalizeBackupPolicy(draft), plan);
                      if (result.changed) {
                        setPlan(result.changed);
                        setMessage(B.previewChanged);
                      } else if (result.result) {
                        setPlan(null);
                        setMessage(
                          result.recordingFailed
                            ? B.recordingFailed
                            : result.result.failed.length
                              ? B.partial(result.result.deleted.length, result.result.failed.length)
                              : B.done(result.result.deleted.length),
                        );
                        await onChanged();
                        const c = await platform.loadConfig();
                        setControl(c?.backupControlBy?.[journal.dataDir] ?? null);
                      }
                    } catch (e) {
                      setError(String(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <IconCompleteItem />
                  {plan.candidates.length ? B.applyCount(plan.candidates.length) : B.apply}
                </button>
              </div>
            </section>
          )}
          {message && <p role="status">{message}</p>}
          {error && (
            <p role="alert" className={styles.warning}>
              {error}
            </p>
          )}
        </BackupDialog>
      )}
    </>
  );
}
