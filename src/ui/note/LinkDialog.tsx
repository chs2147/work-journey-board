// [링크 넣기] 대화상자(improve-1026-spec 10-1): 주소(http/https)·제목(비우면 주소에서)·메모 → 링크 카드.
// 앱은 그 주소에 접속하지 않는다 — 제목·메모는 사용자가 쓴 그대로(13절).
import { useState, type FormEvent } from "react";
import { isOpenableUrl } from "../../domain/links";
import { STR } from "../../shared/strings";
import { addLinkBox, pastePlace } from "./noteStore";
import styles from "./Note.module.css";

export function LinkDialog({ onClose }: { onClose(): void }) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const u = url.trim();
    if (!isOpenableUrl(u)) return setError(true);
    addLinkBox(u, pastePlace(), title, note);
    onClose();
  };

  return (
    <div
      className={styles.linkDialogBackdrop}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <form
        className={styles.linkDialog}
        role="dialog"
        aria-modal="true"
        aria-label={STR.links.dialogTitle}
        data-testid="link-dialog"
        onSubmit={submit}
      >
        <h3>{STR.links.dialogTitle}</h3>
        <label>
          {STR.links.url}
          <input
            value={url}
            autoFocus
            inputMode="url"
            placeholder="https://"
            maxLength={2048}
            aria-invalid={error}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(false);
            }}
          />
        </label>
        {error && (
          <p className={styles.linkDialogError} role="alert">
            {STR.links.badUrl}
          </p>
        )}
        <label>
          {STR.links.title}
          <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          {STR.links.note}
          <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
        </label>
        <p className={styles.linkDialogHint}>{STR.links.dialogHint}</p>
        <div className={styles.linkDialogActions}>
          <button type="button" className={styles.headButton} onClick={onClose}>
            {STR.links.cancel}
          </button>
          <button type="submit" className={`${styles.headButton} ${styles.primary}`}>
            {STR.links.ok}
          </button>
        </div>
      </form>
    </div>
  );
}
