// 백업에서 복원(optimize-1031-plan O5, data-spec 7-3): 백업 목록 → 고르면 사본을 따로 열어 검사·요약 → [이 사본으로 복원].
// "데이터 파일 문제" 화면과 설정 › 데이터·백업 [백업에서 복원…] 대화상자가 함께 쓴다. 지금 파일은 지우지 않고 보관한다.
import { useEffect, useState } from "react";
import { inspectBackup, listRestorable, type BackupSummary, type RestorableBackup } from "../../data/session";
import { formatBytes, STR } from "../../shared/strings";
import { restoreBackup } from "./appController";
import { useAppStore } from "./appStore";
import styles from "./RestorePanel.module.css";

export function RestorePanel({ dataDir }: { dataDir: string }) {
  const platform = useAppStore((s) => s.platform)!;
  const [list, setList] = useState<RestorableBackup[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ name: string; s: BackupSummary } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void listRestorable(platform, dataDir).then((l) => alive && setList(l));
    return () => {
      alive = false;
    };
  }, [platform, dataDir]);

  const pick = async (name: string) => {
    setPicked(name);
    setError(null);
    setSummary(null);
    const s = await inspectBackup(platform, dataDir, name);
    setSummary({ name, s });
  };

  if (!list) return <p className={styles.note}>{STR.restore.checking}</p>;
  if (!list.length) return <p className={styles.note}>{STR.restore.empty}</p>;
  const current = summary && summary.name === picked ? summary.s : null;
  return (
    <div className={styles.panel} data-testid="restore-panel">
      <ul className={styles.list} role="listbox" aria-label={STR.restore.listLabel}>
        {list.map((b) => (
          <li key={b.name}>
            <button
              type="button"
              role="option"
              aria-selected={picked === b.name}
              className={`${styles.item} ${picked === b.name ? styles.on : ""}`}
              onClick={() => void pick(b.name)}
              data-testid="restore-item"
            >
              <span className={styles.when}>{b.when}</span>
              <span className={styles.kind}>{STR.restore.kind(b.name)}</span>
              <span className={styles.size}>{b.size === null ? "" : formatBytes(b.size)}</span>
            </button>
          </li>
        ))}
      </ul>
      {picked && (
        <div className={styles.detail} data-testid="restore-detail">
          {!current ? (
            <p className={styles.note}>{STR.restore.checking}</p>
          ) : current.newer ? (
            <p className={styles.error}>{STR.restore.newer}</p>
          ) : !current.ok ? (
            <p className={styles.error}>{STR.restore.bad}</p>
          ) : (
            <>
              <p className={styles.summary}>
                {STR.restore.summary(current.categories, current.items, current.lastDate)}
              </p>
              <button
                type="button"
                className={styles.primary}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const e = await restoreBackup(picked);
                  setBusy(false);
                  if (e) setError(STR.restore.failed(e));
                }}
              >
                {STR.restore.confirm}
              </button>
            </>
          )}
          {error && <p className={styles.error}>{error}</p>}
        </div>
      )}
    </div>
  );
}
