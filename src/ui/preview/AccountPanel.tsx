// 온라인 계정 패널(docs/v2-design/95 S4, U3) — Preview 첫 화면 카드와 설정 › 계정이 같은 내용을 쓴다.
// 로그인 전 = 이메일 → 인증번호, 로그인 후 = 이메일·서버 확인·온라인 공간 수 + [다시 확인]·[로그아웃…].
// 온라인 공간을 연 동안의 로그아웃은 보낼 변경을 보내고 저장한 뒤 닫는다(U6).
import { useState } from "react";
import { STR } from "../../shared/strings";
import { loadPreviewOnline } from "../../platform";
import {
  otherEmail,
  recheck,
  resendCode,
  sendCode,
  signOutOnly,
  useOnlineAccount,
  verifyCode,
} from "./onlineAccount";
import { signOutFromSpace, useOnlineSpaces } from "./onlineSpaceStore";
import { Card } from "../settings/SettingsCard";
import styles from "../first-run/FirstRun.module.css";
import own from "./AccountPanel.module.css";

const P = STR.connectedPreview;
const A = STR.onlineSpaces.account;
const clock = (sec: number) =>
  new Date(sec * 1000).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });

export function AccountPanel({ inSpace = false }: { inSpace?: boolean }) {
  const { status, busy, error, sentTo } = useOnlineAccount();
  const spaces = useOnlineSpaces((s) => s.list);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [confirm, setConfirm] = useState(false);
  const signedIn = status?.state === "signedIn";

  const server = !status
    ? P.onlinePending
    : busy === "check" || busy === "verify"
      ? P.onlineChecking
      : signedIn
        ? status.serverCheckedAt
          ? P.onlineOk(clock(status.serverCheckedAt))
          : P.onlineNotChecked
        : P.onlineSignedOut;

  const doSignOut = () => {
    setConfirm(false);
    if (inSpace) void signOutFromSpace(async () => (await loadPreviewOnline()).signOut());
    else void signOutOnly();
  };

  return (
    <div className={own.panel} data-testid="account-panel">
      <dl className={styles.facts}>
        <dt>{P.online}</dt>
        <dd data-testid="preview-online">{server}</dd>
        {signedIn && (
          <>
            <dt>{P.email}</dt>
            <dd data-testid="preview-email">{status.email}</dd>
            <dt>{A.spaces}</dt>
            <dd data-testid="account-spaces">{spaces ? A.spacesValue(spaces.length) : "—"}</dd>
            <dt>{P.accountId}</dt>
            <dd title={status.accountId ?? undefined}>{status.accountId?.slice(0, 8)}</dd>
          </>
        )}
      </dl>

      {status?.state === "vaultUnavailable" && <p className={styles.small}>{P.vaultUnavailable}</p>}

      {status?.state === "signedOut" && !sentTo && (
        <form
          className={styles.stack}
          onSubmit={(e) => {
            e.preventDefault();
            void sendCode(email);
          }}
        >
          <label className={styles.small} htmlFor="preview-email-input">
            {P.email}
          </label>
          <input
            id="preview-email-input"
            className={styles.input}
            type="email"
            autoComplete="email"
            placeholder={P.emailPlaceholder}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid="preview-email-input"
          />
          <button type="submit" className={styles.primary} disabled={!email.trim() || busy !== null}>
            {busy === "send" ? P.sending : P.sendCode}
          </button>
        </form>
      )}

      {status?.state === "signedOut" && sentTo && (
        <form
          className={styles.stack}
          onSubmit={(e) => {
            e.preventDefault();
            void verifyCode(code).then(() => setCode(""));
          }}
        >
          <p className={styles.small}>{P.sentTo(sentTo)}</p>
          <label className={styles.small} htmlFor="preview-code-input">
            {P.code}
          </label>
          <input
            id="preview-code-input"
            className={styles.input}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={10}
            placeholder={P.codePlaceholder}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            data-testid="preview-code-input"
          />
          <button type="submit" className={styles.primary} disabled={code.length < 6 || busy !== null}>
            {busy === "verify" ? P.verifying : P.verify}
          </button>
          <div className={styles.row}>
            <button
              type="button"
              className={styles.secondary}
              disabled={busy !== null}
              onClick={() => void resendCode()}
            >
              {P.resend}
            </button>
            <button
              type="button"
              className={styles.secondary}
              disabled={busy !== null}
              onClick={() => {
                otherEmail();
                setCode("");
              }}
            >
              {P.otherEmail}
            </button>
          </div>
        </form>
      )}

      {signedIn && !confirm && (
        <div className={styles.row}>
          <button
            type="button"
            className={styles.secondary}
            disabled={busy !== null}
            onClick={() => void recheck()}
            data-testid="preview-recheck"
          >
            {P.recheck}
          </button>
          <button
            type="button"
            className={styles.secondary}
            disabled={busy !== null}
            onClick={() => (inSpace ? setConfirm(true) : doSignOut())}
            data-testid="preview-sign-out"
          >
            {inSpace ? A.signOutDots : P.signOut}
          </button>
        </div>
      )}
      {signedIn && confirm && (
        <div
          className={own.confirm}
          role="alertdialog"
          aria-label={A.signOutTitle}
          data-testid="sign-out-confirm"
        >
          <b>{A.signOutTitle}</b>
          <p className={styles.small}>{A.signOutBody}</p>
          <div className={styles.row}>
            <button type="button" className={styles.secondary} onClick={() => setConfirm(false)}>
              {STR.workspace.cancel}
            </button>
            <button
              type="button"
              className={styles.primary}
              onClick={doSignOut}
              data-testid="sign-out-confirm-ok"
            >
              {P.signOut}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className={styles.small} role="alert" data-testid="preview-error">
          {error}
        </p>
      )}
    </div>
  );
}

/** 설정 › 계정(온라인 공간을 연 동안) */
export function AccountSettingsCard() {
  return (
    <Card id="account" title={STR.onlineSpaces.account.cardTitle} testId="account-settings">
      <div className={own.inset}>
        <AccountPanel inSpace />
      </div>
    </Card>
  );
}
