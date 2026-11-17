// 온라인 계정 카드(docs/v2-design/95 S4, U3) — Preview 첫 화면과 설정 › 계정이 같은 카드를 쓴다.
// 설정 공용 부품(Card·Row·CardMessage)과 같은 모양: 행 = 왼쪽 이름·값 / 오른쪽 조작, 행 사이 선, 같은 좌우 여백.
// 로그인 전 = 이메일 → 인증번호, 로그인 후 = 이메일·서버·온라인 공간·계정 ID + [다시 확인]·[로그아웃…].
// 가입은 지금 초대 전용 — 제목 옆 배지만(설명 글 없음). 온라인 공간을 연 동안의 로그아웃은 보내고 저장한 뒤 닫는다(U6).
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
import { deleteAccountAndSignOut, signOutFromSpace, useOnlineSpaces } from "./onlineSpaceStore";
import { DeleteConfirm } from "./DeleteConfirm";
import { openSettingsAt } from "../common/appController";
import { Card, CardMessage, Row } from "../settings/SettingsCard";
import settings from "../settings/Settings.module.css";
import own from "./AccountPanel.module.css";
import { AdminCard, UsageCard } from "./AccountUsage";

const P = STR.connectedPreview;
const A = STR.onlineSpaces.account;
const clock = (sec: number) =>
  new Date(sec * 1000).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });

export function AccountCard({ inSpace = false }: { inSpace?: boolean }) {
  const { status, busy, error, sentTo, usage } = useOnlineAccount();
  const [deleting, setDeleting] = useState(false);
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
    <Card
      id="online-account"
      title={A.cardTitle}
      desc={
        <span className={own.badge} data-testid="invite-only-badge">
          {A.inviteOnly}
        </span>
      }
      testId={inSpace ? "account-settings" : "account-card"}
    >
      <div data-testid="account-panel">
        {status?.state === "vaultUnavailable" && <CardMessage>{P.vaultUnavailable}</CardMessage>}

        {status?.state === "signedOut" && !sentTo && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendCode(email);
            }}
          >
            <Row
              label={<label htmlFor="preview-email-input">{P.email}</label>}
              desc={<span data-testid="preview-online">{server}</span>}
            >
              <input
                id="preview-email-input"
                className={own.input}
                type="email"
                autoComplete="email"
                placeholder={P.emailPlaceholder}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="preview-email-input"
              />
              <button type="submit" className={settings.primary} disabled={!email.trim() || busy !== null}>
                {busy === "send" ? P.sending : P.sendCode}
              </button>
            </Row>
          </form>
        )}

        {status?.state === "signedOut" && sentTo && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void verifyCode(code).then(() => setCode(""));
            }}
          >
            <Row label={<label htmlFor="preview-code-input">{P.code}</label>} desc={P.sentTo(sentTo)}>
              <input
                id="preview-code-input"
                className={own.input}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={10}
                placeholder={P.codePlaceholder}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                data-testid="preview-code-input"
              />
              <button type="submit" className={settings.primary} disabled={code.length < 6 || busy !== null}>
                {busy === "verify" ? P.verifying : P.verify}
              </button>
            </Row>
            <Row label={P.email} desc={sentTo}>
              <button type="button" disabled={busy !== null} onClick={() => void resendCode()}>
                {P.resend}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  otherEmail();
                  setCode("");
                }}
              >
                {P.otherEmail}
              </button>
            </Row>
          </form>
        )}

        {signedIn && (
          <>
            <Row label={P.email} desc={<span data-testid="preview-email">{status.email}</span>}>
              {!confirm && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => (inSpace ? setConfirm(true) : doSignOut())}
                  data-testid="preview-sign-out"
                >
                  {inSpace ? A.signOutDots : P.signOut}
                </button>
              )}
            </Row>
            {confirm && (
              <div
                className={own.confirm}
                role="alertdialog"
                aria-label={A.signOutTitle}
                data-testid="sign-out-confirm"
              >
                <span className={settings.rowText}>
                  <span className={settings.rowLabel}>{A.signOutTitle}</span>
                  <span className={settings.rowDesc}>{A.signOutBody}</span>
                </span>
                <span className={own.confirmButtons}>
                  <button type="button" onClick={() => setConfirm(false)}>
                    {STR.workspace.cancel}
                  </button>
                  <button
                    type="button"
                    className={settings.primary}
                    onClick={doSignOut}
                    data-testid="sign-out-confirm-ok"
                  >
                    {P.signOut}
                  </button>
                </span>
              </div>
            )}
            <Row label={P.online} desc={<span data-testid="preview-online">{server}</span>}>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void recheck()}
                data-testid="preview-recheck"
              >
                {P.recheck}
              </button>
            </Row>
            <Row
              label={A.spaces}
              desc={<span data-testid="account-spaces">{spaces ? A.spacesValue(spaces.length) : "—"}</span>}
            >
              {inSpace && (
                <button type="button" onClick={() => void openSettingsAt("workspace")}>
                  {STR.workspace.manage}
                </button>
              )}
            </Row>
            <Row
              label={P.accountId}
              desc={<span title={status.accountId ?? undefined}>{status.accountId?.slice(0, 8)}</span>}
            >
              {/* G-5: 관리자 계정은 고정(서버도 거절) — 사용량을 받은 뒤 일반 계정만 */}
              {usage && !usage.admin && !deleting && (
                <button
                  type="button"
                  className={settings.danger}
                  disabled={busy !== null}
                  onClick={() => setDeleting(true)}
                  data-testid="account-delete"
                >
                  {A.deleteAccount}
                </button>
              )}
            </Row>
            {deleting && (
              <DeleteConfirm
                title={A.deleteAccountTitle}
                body={A.deleteAccountBody}
                expect={status.email ?? ""}
                okLabel={A.deleteOk}
                testId="account-delete-confirm"
                onCancel={() => setDeleting(false)}
                onConfirm={() => deleteAccountAndSignOut(inSpace)}
              />
            )}
          </>
        )}

        {error && (
          <CardMessage>
            <p className={own.error} role="alert" data-testid="preview-error">
              {error}
            </p>
          </CardMessage>
        )}
      </div>
    </Card>
  );
}

/** 설정 › 계정: 로그인 · 사용량 · 관리(관리자만). 로그아웃은 온라인 공간을 연 동안이면 보내고 닫은 뒤(G-1 통합 앱은 이 PC 공간에서도 이 분류) */
export function AccountSettingsCard() {
  const inSpace = useOnlineSpaces((s) => s.current !== null);
  return (
    <>
      <AccountCard inSpace={inSpace} />
      <UsageCard />
      <AdminCard />
    </>
  );
}
