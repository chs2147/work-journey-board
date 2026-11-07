// [링크 넣기] 대화상자(improve-1026-spec 10-1): 주소(http/https)·제목(비우면 주소에서)·메모 → 링크 카드.
// 앱은 그 주소에 접속하지 않는다 — 제목·메모는 사용자가 쓴 그대로(13절).
import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { isComposingKey } from "../board/helpers";
import { isOpenableUrl } from "../../domain/links";
import { STR } from "../../shared/strings";
import { addLinkBox, pastePlace } from "./noteStore";
import styles from "./Note.module.css";

export function LinkDialog({ onClose }: { onClose(): void }) {
  const modalRef = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    const modal = modalRef.current!;
    // Native top layer covers every toolbar and makes the rest of this window inert.
    modal.showModal();
    const back = returnFocus.current;
    return () => {
      modal.close();
      if (back?.isConnected) back.focus();
    };
  }, []);
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

  return createPortal(
    <dialog
      ref={modalRef}
      className={styles.linkDialogBackdrop}
      role="dialog"
      aria-modal="true"
      aria-label={STR.links.dialogTitle}
      data-testid="link-dialog"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        // Portal events still bubble through NoteDock: keep zoom/board shortcuts out.
        e.stopPropagation();
        if (e.key === "Tab") {
          const controls = [...e.currentTarget.querySelectorAll<HTMLElement>("input, button")];
          const first = controls[0],
            last = controls.at(-1);
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
        if (e.key === "Escape") {
          e.preventDefault();
          if (!isComposingKey(e)) onClose();
        }
      }}
    >
      <form className={styles.linkDialog} onSubmit={submit}>
        <h3>{STR.links.dialogTitle}</h3>
        <label>
          {STR.links.url}
          <input
            value={url}
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
    </dialog>,
    document.body,
  );
}
