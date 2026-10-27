// 새 판 화면 조각(improve-1027v4-spec 1-2): 설정 "업데이트" 절 · 보드 위 띠 · [자세히·설치] 창.
import { useEffect, useRef } from "react";
import { STR } from "../../shared/strings";
import {
  checkNow,
  closeUpdateDialog,
  dismissBanner,
  hasUpdate,
  installUpdate,
  noteLines,
  openUpdateDialog,
  useUpdate,
} from "./updateStore";
import styles from "./Update.module.css";

/** 저장된 UTC 시각 → 이 PC 시각 `2026-10-27 09:12` */
function localWhen(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 설정 › 업데이트: 지금 판 · [업데이트 확인] · 마지막 확인 결과 · (새 판) [자세히·설치] */
export function UpdateSettings() {
  const s = useUpdate();
  const available = hasUpdate(s);
  return (
    <section className={styles.section} aria-labelledby="s-update" data-testid="update-settings">
      <h3 id="s-update">{STR.update.section}</h3>
      <p className={styles.line}>
        <span className={styles.label}>{STR.update.current}</span>
        <b>{__APP_VERSION__}</b>
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primary}
          disabled={s.phase === "checking" || s.phase === "downloading" || s.phase === "installing"}
          onClick={() => void checkNow()}
        >
          {s.phase === "checking" ? STR.update.checking : STR.update.check}
        </button>
        {available && (
          <button type="button" className={styles.button} onClick={openUpdateDialog}>
            {STR.update.details}
          </button>
        )}
      </div>
      <p className={styles.status} role="status" data-testid="update-status">
        {s.phase === "failed" && s.error
          ? STR.update.failed(s.error)
          : available && s.info
            ? STR.update.available(s.info.version)
            : s.phase === "none"
              ? STR.update.latest
              : ""}
        {s.checkedAt && s.phase !== "checking" && (
          <span className={styles.when}> · {STR.update.lastCheck(localWhen(s.checkedAt))}</span>
        )}
      </p>
      <p className={styles.note}>{STR.update.network}</p>
    </section>
  );
}

/** 보드 위 띠 "새 판 0.2.19가 있습니다 [자세히·설치] [나중에]" */
export function UpdateBanner() {
  const s = useUpdate();
  if (!hasUpdate(s) || s.dismissed || !s.info) return null;
  return (
    <div className={styles.banner} role="status" data-testid="update-banner">
      <b>{STR.update.banner(s.info.version)}</b>
      <span className={styles.grow} />
      <button type="button" className={styles.primary} onClick={openUpdateDialog}>
        {STR.update.details}
      </button>
      <button type="button" className={styles.button} onClick={dismissBanner}>
        {STR.update.later}
      </button>
    </div>
  );
}

/** [자세히·설치] 창: 릴리스 노트 · 설치 단계 · 진행 막대 · [내려받고 설치] */
export function UpdateDialog() {
  const s = useUpdate();
  const ref = useRef<HTMLDivElement>(null);
  // 처음 열 때와 실패한 뒤에는 [내려받고 설치]/[다시 시도]에 포커스(내려받는 동안 단추가 꺼져 포커스가 빠지므로)
  const phase = s.phase;
  useEffect(() => {
    if (phase === "downloading" || phase === "installing") return;
    ref.current?.querySelector<HTMLButtonElement>("[data-primary]")?.focus();
  }, [phase]);
  if (!s.info) return null;
  const busy = s.phase === "downloading" || s.phase === "installing";
  const pct = Math.round(s.progress * 100);
  return (
    <div className={styles.backdrop} onMouseDown={(e) => e.target === e.currentTarget && closeUpdateDialog()}>
      <div
        ref={ref}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-title"
        data-testid="update-dialog"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            closeUpdateDialog();
          }
        }}
      >
        <h2 id="update-title" className={styles.title}>
          {STR.update.dialogTitle(s.info.version)}
        </h2>
        <p className={styles.meta}>
          {STR.update.from(__APP_VERSION__, s.info.version)} ·{" "}
          {STR.update.size((s.info.size / 1_000_000).toFixed(1))}
        </p>
        <div className={styles.notes} data-testid="update-notes">
          {noteLines(s.info.notes).map((l, i) =>
            l.kind === "head" ? (
              <h3 key={i} className={styles.noteHead}>
                {l.text}
              </h3>
            ) : l.kind === "item" ? (
              <p key={i} className={styles.noteItem}>
                · {l.text}
              </p>
            ) : (
              <p key={i} className={styles.noteText}>
                {l.text}
              </p>
            ),
          )}
        </div>
        <ol className={styles.steps}>
          {STR.update.steps.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ol>
        {!s.info.hasHash && <p className={styles.warn}>{STR.update.noHash}</p>}
        {busy && (
          <div className={styles.progress} data-testid="update-progress">
            <div className={styles.bar}>
              <div className={styles.fill} style={{ width: `${pct}%` }} />
            </div>
            <span>{s.phase === "installing" ? STR.update.installing : STR.update.downloading(pct)}</span>
          </div>
        )}
        {s.phase === "error" && s.error && (
          <p className={styles.error} role="alert">
            {STR.update.error(s.error)}
          </p>
        )}
        <div className={styles.footer}>
          <button type="button" className={styles.button} onClick={closeUpdateDialog} disabled={busy}>
            {STR.update.cancel}
          </button>
          <button
            type="button"
            className={styles.primary}
            data-primary
            disabled={busy}
            onClick={() => void installUpdate()}
          >
            {s.phase === "error" ? STR.update.retry : STR.update.install}
          </button>
        </div>
      </div>
    </div>
  );
}
