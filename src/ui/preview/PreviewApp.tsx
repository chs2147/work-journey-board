// Connected Preview 시작 화면(V2 6-B·B단계, docs/v2-design/78·79).
// 기존 앱 시작 흐름(appController.start — 설정 읽기·첫 실행·일지 열기·새 판 확인)을 부르지 않는다.
// 계정: 이메일 인증번호 로그인 → 개발 서버(gateway) 세션 확인. 토큰은 Rust·OS 보안 저장소에만 있다.
import { useEffect, useState } from "react";
import {
  loadPreviewOnline,
  loadSplash,
  type AppProfileInfo,
  type OnlineStatus,
  type PreviewOnline,
} from "../../platform";
import { STR } from "../../shared/strings";
import { applyTheme, readStoredTheme } from "../../shared/theme";
import { finishSplash } from "../splash";
import appStyles from "../App.module.css";
import styles from "../first-run/FirstRun.module.css";

const P = STR.connectedPreview;
const errText = (e: unknown) => {
  const code = e instanceof Error ? e.message : String(e);
  return P.errors[code] ?? P.errors.UNKNOWN ?? code;
};
const clock = (sec: number) =>
  new Date(sec * 1000).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });

export function PreviewApp({ profile }: { profile: AppProfileInfo }) {
  const [online, setOnline] = useState<PreviewOnline | null>(null);
  const [status, setStatus] = useState<OnlineStatus | null>(null);
  const [busy, setBusy] = useState<"send" | "verify" | "check" | "signOut" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");

  useEffect(() => {
    applyTheme(readStoredTheme());
    document.title = profile.productName;
    void loadSplash().then((splash) => finishSplash({ splash }));
    void loadPreviewOnline().then(async (o) => {
      setOnline(o);
      const s = await o.status().catch(() => null);
      setStatus(s);
      if (s?.state === "signedIn") await run(o, "check", () => o.check());
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.productName]);

  async function run(
    o: PreviewOnline,
    what: NonNullable<typeof busy>,
    f: () => Promise<OnlineStatus | void>,
  ) {
    setBusy(what);
    setError(null);
    try {
      const s = await f();
      if (s) setStatus(s);
      return true;
    } catch (e) {
      setError(errText(e));
      // 서버가 로그인을 끝냈으면 화면도 로그아웃 상태로
      setStatus(await o.status().catch(() => null));
      return false;
    } finally {
      setBusy(null);
    }
  }

  const signedIn = status?.state === "signedIn";
  const onlineText = !status
    ? P.onlinePending
    : busy === "check" || busy === "verify"
      ? P.onlineChecking
      : signedIn
        ? status.serverCheckedAt
          ? P.onlineOk(clock(status.serverCheckedAt))
          : P.onlineNotChecked
        : P.onlineSignedOut;

  return (
    <div className={appStyles.shell}>
      <div className={styles.wrap} data-testid="connected-preview">
        <section className={styles.card}>
          <h1 className={styles.title}>{profile.productName}</h1>
          <p className={styles.lead}>{P.lead}</p>
          <dl className={styles.facts}>
            <dt>{P.profile}</dt>
            <dd>{P.profileValue}</dd>
            <dt>{P.appVersion}</dt>
            <dd>{__APP_VERSION__}</dd>
            <dt>{P.updates}</dt>
            <dd data-testid="preview-updates">{P.updatesOff}</dd>
            <dt>{P.localJournal}</dt>
            <dd data-testid="preview-local-journal">{P.localJournalOff}</dd>
            <dt>{P.online}</dt>
            <dd data-testid="preview-online">{onlineText}</dd>
            {signedIn && (
              <>
                <dt>{P.email}</dt>
                <dd data-testid="preview-email">{status.email}</dd>
                <dt>{P.accountId}</dt>
                <dd title={status.accountId ?? undefined}>{status.accountId?.slice(0, 8)}</dd>
              </>
            )}
          </dl>

          {online && status?.state === "vaultUnavailable" && (
            <p className={styles.small}>{P.vaultUnavailable}</p>
          )}

          {online && status && status.state === "signedOut" && !sentTo && (
            <form
              className={styles.stack}
              onSubmit={(e) => {
                e.preventDefault();
                const to = email.trim();
                void run(online, "send", () => online.sendCode(to)).then((ok) => ok && setSentTo(to));
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

          {online && status && status.state === "signedOut" && sentTo && (
            <form
              className={styles.stack}
              onSubmit={(e) => {
                e.preventDefault();
                void run(online, "verify", () => online.verifyCode(sentTo, code.trim())).then((ok) => {
                  if (ok) {
                    setSentTo(null);
                    setCode("");
                  }
                });
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
                  onClick={() => void run(online, "send", () => online.sendCode(sentTo))}
                >
                  {P.resend}
                </button>
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={busy !== null}
                  onClick={() => {
                    setSentTo(null);
                    setCode("");
                  }}
                >
                  {P.otherEmail}
                </button>
              </div>
            </form>
          )}

          {online && signedIn && (
            <div className={styles.row}>
              <button
                type="button"
                className={styles.secondary}
                disabled={busy !== null}
                onClick={() => void run(online, "check", () => online.check())}
                data-testid="preview-recheck"
              >
                {P.recheck}
              </button>
              <button
                type="button"
                className={styles.secondary}
                disabled={busy !== null}
                onClick={() => void run(online, "signOut", () => online.signOut())}
                data-testid="preview-sign-out"
              >
                {P.signOut}
              </button>
            </div>
          )}

          {error && (
            <p className={styles.small} role="alert" data-testid="preview-error">
              {error}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
