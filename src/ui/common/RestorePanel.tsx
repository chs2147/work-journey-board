// 설정·파손 화면 공통 이력과 복원. 선택 시와 실행 직전에 실제 DB를 검사한다.
import { useEffect, useRef, useState } from "react";
import { inspectBackup, listRestorable, type BackupSummary, type RestorableBackup } from "../../data/session";
import { parseBackupName, protectedBackup, BACKUP_APP_VERSION } from "../../data/backupIdentity";
import { LATEST_SCHEMA_VERSION } from "../../data/migrate";
import { STR } from "../../shared/strings";
import { restoreBackup } from "./appController";
import { useAppStore } from "./appStore";
import { IconBackupHistory } from "./icons";
import { backupBytes } from "./backupUi";
import styles from "./RestorePanel.module.css";
export function RestorePanel({
  dataDir,
  onBusyChange,
}: {
  dataDir: string;
  onBusyChange?: (busy: boolean) => void;
}) {
  const platform = useAppStore((s) => s.platform)!;
  const journal = useAppStore((s) => s.journal);
  const [list, setList] = useState<RestorableBackup[] | null>(null),
    [picked, setPicked] = useState<string | null>(null),
    [summary, setSummary] = useState<BackupSummary | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [filter, setFilter] = useState("all");
  const alive = useRef(false),
    seq = useRef(0);
  const B = STR.backupV13;
  useEffect(() => {
    onBusyChange?.(busy);
    return () => {
      onBusyChange?.(false);
    };
  }, [busy, onBusyChange]);
  useEffect(() => {
    alive.current = true;
    ++seq.current;
    void listRestorable(platform, dataDir)
      .then((l) => {
        if (alive.current) setList(l);
      })
      .catch((e) => {
        if (alive.current) {
          setError(String(e));
          setList([]);
        }
      });
    return () => {
      alive.current = false;
    };
  }, [platform, dataDir]);
  const pick = async (name: string) => {
    const id = ++seq.current;
    setPicked(name);
    setSummary(null);
    setError(null);
    const result = await inspectBackup(platform, dataDir, name);
    if (alive.current && id === seq.current) setSummary(result);
  };
  if (!list) return <p className={styles.note}>{B.checking}</p>;
  const newest = list.find(
    (b) =>
      parseBackupName(b.name)?.kind === "daily" &&
      b.schemaVersion != null &&
      b.schemaVersion <= LATEST_SCHEMA_VERSION,
  )?.name;
  const shown = list.filter((b) => {
    const id = parseBackupName(b.name)!;
    return (
      filter === "all" || (filter === "protected" ? protectedBackup(id.kind) : !protectedBackup(id.kind))
    );
  });
  const identity = picked ? parseBackupName(picked) : null;
  const problem =
    summary?.reason === "mismatch" ? B.mismatch : summary?.newer ? STR.restore.newer : B.invalid;
  return (
    <div className={styles.panel} data-testid="restore-panel">
      <p className={styles.note}>{B.historyHint}</p>
      <label className={styles.filter}>
        {B.filter}
        <select
          aria-label={B.filter}
          value={filter}
          disabled={busy}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">{B.all}</option>
          <option value="auto">{B.auto}</option>
          <option value="protected">{B.protected}</option>
        </select>
      </label>
      <div className={styles.tableHead} aria-hidden="true">
        <span>{B.when}</span>
        <span>{B.kind}</span>
        <span>{B.app}</span>
        <span>{B.schema}</span>
        <span>{B.size}</span>
        <span>{B.protection}</span>
      </div>
      <ul className={styles.list} aria-label={STR.restore.listLabel}>
        {shown.map((b) => {
          const id = parseBackupName(b.name)!;
          return (
            <li key={b.name}>
              <button
                type="button"
                aria-pressed={picked === b.name}
                disabled={busy}
                className={`${styles.item} ${picked === b.name ? styles.on : ""}`}
                onClick={() => void pick(b.name)}
                data-testid="restore-item"
              >
                <span className={styles.when}>{b.when}</span>
                <span className={styles.kind}>{B.kindLabel[id.kind]}</span>
                <span>{b.appVersion ?? B.unknown}</span>
                <span>{b.schemaVersion ? `v${b.schemaVersion}` : B.afterInspection}</span>
                <span className={styles.size}>{b.size === null ? "—" : backupBytes(b.size)}</span>
                <span>
                  {protectedBackup(id.kind)
                    ? B.protectedShort
                    : b.schemaVersion == null || b.schemaVersion > LATEST_SCHEMA_VERSION
                      ? B.checkNeeded
                      : b.name === newest
                        ? B.latest
                        : B.automatic}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {!shown.length && <p className={styles.note}>{STR.restore.empty}</p>}
      <p className={styles.note}>{B.recordedHint}</p>
      {picked && (
        <div className={styles.detail} data-testid="restore-detail">
          {!summary ? (
            <p className={styles.note}>{B.checking}</p>
          ) : (
            <>
              <p className={summary.ok ? styles.status : styles.error}>
                {summary.ok
                  ? summary.schemaVersion! < LATEST_SCHEMA_VERSION
                    ? B.migration(summary.schemaVersion!, LATEST_SCHEMA_VERSION)
                    : B.canRestore
                  : problem}
              </p>
              <div className={styles.compare}>
                <div>
                  <h4>{B.compare}</h4>
                  <dl>
                    <dt>{B.currentApp}</dt>
                    <dd>{BACKUP_APP_VERSION}</dd>
                    <dt>{B.currentSchema}</dt>
                    <dd>{journal.state === "ready" ? `v${LATEST_SCHEMA_VERSION}` : B.checkFailed}</dd>
                    <dt>{B.supported}</dt>
                    <dd>{B.supportedValue(LATEST_SCHEMA_VERSION)}</dd>
                    <dt>{B.app}</dt>
                    <dd>{identity?.appVersion ?? B.unknown}</dd>
                    <dt>{B.actualSchema}</dt>
                    <dd>{summary.schemaVersion ? `v${summary.schemaVersion}` : "—"}</dd>
                  </dl>
                </div>
                <div>
                  <h4>{B.file}</h4>
                  <p className={styles.filename}>{picked}</p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void platform.writeClipboard(picked).catch((e) => setError(String(e)))}
                  >
                    {B.copyName}
                  </button>
                  <p className={styles.note}>{identity?.legacy ? B.legacyHint : B.recordedHint}</p>
                  {summary.ok && (
                    <p className={styles.summary}>
                      {STR.restore.summary(summary.categories, summary.items, summary.lastDate)}
                    </p>
                  )}
                </div>
              </div>
              <div className={styles.actions}>
                <p className={styles.note}>{B.preserve}</p>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={busy || !summary.ok}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const checked = await inspectBackup(platform, dataDir, picked);
                      if (!checked.ok || checked.fingerprint !== summary.fingerprint) {
                        setSummary(checked);
                        setError(B.previewChanged);
                        return;
                      }
                      const e = await restoreBackup(picked, summary.fingerprint, dataDir);
                      if (e) setError(STR.restore.failed(e));
                    } catch (e) {
                      setError(String(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <IconBackupHistory />
                  {busy ? B.checking : STR.restore.confirm}
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
