// 업무노트 삭제 최종 확인 창(improve-v20-spec 3절) — window.confirm 대신. 처음 초점 = [취소], Enter = 초점 단추, Esc = 닫기.
import { useEffect, useRef, useState } from "react";
import { V20 } from "../../shared/v20Strings";
import styles from "./Cabi.module.css";

export function DeleteNoteDialog({
  title,
  task,
  savedAt,
  images,
  refs,
  onCancel,
  onDelete,
}: {
  title: string;
  task: string;
  savedAt: string;
  images: number;
  refs: number;
  onCancel: () => void;
  onDelete: () => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    cancelRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    cancelRef.current?.focus();
    return () => dialog?.close();
  }, []);
  const saved = savedAt ? `${savedAt.slice(5, 10).replace("-", "/")} ${savedAt.slice(11, 16)}` : "";
  return (
    <dialog
      ref={ref}
      className={styles.deleteDialog}
      aria-label={V20.dialogTitle}
      data-testid="delete-note-dialog"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2>{V20.dialogTitle}</h2>
      <div className={styles.deleteMeta}>
        <strong>{title}</strong>
        <span>{V20.dialogMeta(task, saved, images)}</span>
        <span>{V20.dialogRefs(refs)}</span>
      </div>
      <p className={styles.deleteWarn}>{V20.dialogWarn}</p>
      {error && <p role="alert">{error}</p>}
      <div className={styles.actions}>
        <button ref={cancelRef} onClick={onCancel} disabled={busy} data-testid="delete-note-cancel">
          {V20.cancel}
        </button>
        <button
          className={styles.dangerButton}
          disabled={busy}
          data-testid="delete-note-confirm"
          onClick={() => {
            setBusy(true);
            void onDelete().catch((e) => {
              setError(e instanceof Error ? e.message : String(e));
              setBusy(false);
            });
          }}
        >
          {busy ? V20.deleting : V20.delete}
        </button>
      </div>
    </dialog>
  );
}
