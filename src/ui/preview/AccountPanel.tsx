// 온라인 계정 카드(docs/v2-design/95 S4, U3) — Preview 첫 화면과 설정 › 계정이 같은 카드를 쓴다.
// 설정 공용 부품(Card·Row·CardMessage)과 같은 모양: 행 = 왼쪽 이름·값 / 오른쪽 조작, 행 사이 선, 같은 좌우 여백.
// 로그인 전 = 이메일 → 인증번호, 로그인 후 = 이메일·서버·온라인 공간·계정 ID + [다시 확인]·[로그아웃…].
// 가입은 지금 초대 전용 — 제목 옆 배지만(설명 글 없음). 온라인 공간을 연 동안의 로그아웃은 보내고 저장한 뒤 닫는다(U6).
// G-8(104): 처음 [인증번호 받기] 전에 개인정보·이용 안내 동의 한 번(이 기기 설정), 그 뒤 "온라인 기능 안내" 줄에서 다시 보기.
import { useEffect, useState } from "react";
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
import { UsageCard } from "./AccountUsage";
import { TermsDialog } from "./TermsDialog";
import { acceptTerms, loadTermsConsent, openTerms, useOnlineTerms } from "./onlineTermsStore";

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
  const accepted = useOnlineTerms((s) => s.accepted);
  const acceptedAt = useOnlineTerms((s) => s.acceptedAt);
  const [agree, setAgree] = useState(false);
  useEffect(() => void loadTermsConsent(), []);
  // 처음 로그인(이메일 단계)이고 이 판에 동의하기 전이면 동의 줄, 아니면 다시 보기 줄
  const askConsent = status?.state === "signedOut" && !sentTo && accepted === false;
  const termsButtons = (
    <>
      <button type="button" onClick={() => openTerms("privacy")} data-testid="terms-open-privacy">
        {A.privacy}
      </button>
      <button type="button" onClick={() => openTerms("terms")} data-testid="terms-open-terms">
        {A.terms}
      </button>
    </>
  );

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
    <>
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
                if (askConsent && !agree) return;
                void (askConsent ? acceptTerms() : Promise.resolve()).then(() => sendCode(email));
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
                <button
                  type="submit"
                  className={settings.primary}
                  disabled={!email.trim() || busy !== null || accepted === null || (askConsent && !agree)}
                  title={askConsent && !agree ? A.agreeNeeded : undefined}
                >
                  {busy === "send" ? P.sending : P.sendCode}
                </button>
              </Row>
              {askConsent && (
                <Row
                  label={
                    <label className={own.agree}>
                      <input
                        type="checkbox"
                        checked={agree}
                        onChange={(e) => setAgree(e.target.checked)}
                        data-testid="terms-agree"
                      />
                      {A.agree}
                    </label>
                  }
                >
                  {termsButtons}
                </Row>
              )}
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
                <button
                  type="submit"
                  className={settings.primary}
                  disabled={code.length < 6 || busy !== null}
                >
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

          {status && status.state !== "vaultUnavailable" && !askConsent && (
            <Row
              label={A.termsRow}
              desc={
                <span data-testid="terms-state">
                  {accepted && acceptedAt
                    ? A.acceptedOn(new Date(acceptedAt).toLocaleDateString("ko-KR"))
                    : A.notAccepted}
                </span>
              }
            >
              {termsButtons}
            </Row>
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
      {/* 카드 밖(카드 단추 모양을 물려받지 않게) — 최상위 레이어로 뜬다 */}
      <TermsDialog />
    </>
  );
}

/** 설정 › 계정: 로그인 · 사용량. 로그아웃은 온라인 공간을 연 동안이면 보내고 닫은 뒤(G-1 통합 앱은 이 PC 공간에서도 이 분류) */
export function AccountSettingsCard() {
  const inSpace = useOnlineSpaces((s) => s.current !== null);
  return (
    <>
      <AccountCard inSpace={inSpace} />
      <UsageCard />
    </>
  );
}
