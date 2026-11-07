import { useEffect, useState } from "react";
import { STR } from "../../shared/strings";
import styles from "./TopBar.module.css";
export function SaveStatus({
  saving,
  error,
  onRetry,
  savedAt,
}: {
  saving: boolean;
  error?: string;
  onRetry?: () => void;
  savedAt?: string | null;
}) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!saving) return;
    const id = setTimeout(() => setLate(true), 400);
    return () => {
      clearTimeout(id);
      setLate(false);
    };
  }, [saving]);
  if (error)
    return (
      <button className={styles.saveFailed} onClick={onRetry} title={error} data-testid="save-failed">
        <span role="alert">{STR.save.failed}</span>
      </button>
    );
  const pending = saving && late;
  return (
    <span
      className={`${styles.savePill} ${pending ? styles.saving : styles.saved}`}
      role="status"
      data-testid="save-state"
      data-state={pending ? "saving" : "saved"}
      data-idle={!saving}
      title={STR.save.savedTitle(savedAt ?? null)}
    >
      <svg
        className={pending ? styles.spin : undefined}
        width="14"
        height="14"
        viewBox="0 0 14 14"
        aria-hidden="true"
      >
        <circle cx="7" cy="7" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
        {!pending && (
          <path
            d="M4.2 7.2 6.1 9.1 9.9 5.2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
      {pending ? STR.save.saving : STR.save.saved}
    </span>
  );
}
