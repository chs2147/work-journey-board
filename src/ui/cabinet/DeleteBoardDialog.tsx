import { useEffect, useRef, useState } from "react";
import { V17 } from "../../shared/v17Strings";
import { CABI } from "../../shared/cabiStrings";
import styles from "./Cabi.module.css";
export function DeleteBoardDialog({
  title,
  count,
  onCancel,
  onDelete,
}: {
  title: string;
  count: number;
  onCancel: () => void;
  onDelete: () => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [word, setWord] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={styles.deleteDialog}
      aria-label={V17.deleteTitle}
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onCancel();
      }}
    >
      <h2>{V17.deleteTitle}</h2>
      <p>
        {title} · {count}개
      </p>
      <p>{V17.deleteImpact}</p>
      <p className={styles.message}>{V17.originalsKept}</p>
      <label>
        {V17.deletePrompt}
        <input
          autoFocus
          value={word}
          onChange={(e) => setWord(e.target.value)}
          disabled={busy}
          aria-label={V17.deletePrompt}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <div className={styles.actions}>
        <button onClick={onCancel} disabled={busy}>
          {V17.cancel}
        </button>
        <button
          disabled={word.trim() !== V17.deleteWord || busy}
          onClick={() => {
            setBusy(true);
            void onDelete().catch((e) => {
              setError(String(e));
              setBusy(false);
            });
          }}
        >
          {CABI.deleteBoard}
        </button>
      </div>
    </dialog>
  );
}
