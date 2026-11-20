// Connected Preview 시작 화면(V2 6-B·B단계, docs/v2-design/78·79·95).
// 기존 앱 시작 흐름(appController.start — 설정 읽기·첫 실행·일지 열기·새 판 확인)을 부르지 않는다.
// 계정: 이메일 인증번호 로그인 → 개발 서버(gateway) 세션 확인. 토큰은 Rust·OS 보안 저장소에만 있다.
import { useEffect, useRef, useState } from "react";
import { loadSplash, type AppProfileInfo } from "../../platform";
import { STR } from "../../shared/strings";
import { applyTheme, readStoredTheme } from "../../shared/theme";
import { finishSplash } from "../splash";
import { CreateOnlineDialog } from "./CreateOnlineDialog";
import { OnlineSpacesCard, OnlineWorkspaceShell } from "./OnlineSpaces";
import {
  lastOpened,
  openOnlineSpace,
  refreshSpaces,
  setAccount,
  takeCreateRequest,
  useOnlineSpaces,
} from "./onlineSpaceStore";
import { initAccount, loadUsage, useOnlineAccount } from "./onlineAccount";
import { AccountCard } from "./AccountPanel";
import { AdminCard, UsageCard } from "./AccountUsage";
import { Card, Row } from "../settings/SettingsCard";
import own from "./PreviewApp.module.css";
import appStyles from "../App.module.css";
import topStyles from "../common/TopBar.module.css";
import { BrandLockup } from "../common/Brand";

const P = STR.connectedPreview;

export function PreviewApp({ profile }: { profile: AppProfileInfo }) {
  const status = useOnlineAccount((s) => s.status);
  const opened = useOnlineSpaces((s) => s.current);
  const list = useOnlineSpaces((s) => s.list);
  const autoTried = useRef(false);
  const [published, setPublished] = useState(0);
  // 공간 메뉴·설정의 [온라인 워크스페이스 만들기…]로 왔으면 바로 연다
  const [creating, setCreating] = useState(() => takeCreateRequest());

  useEffect(() => {
    applyTheme(readStoredTheme());
    document.title = profile.productName;
    void loadSplash().then((splash) => finishSplash({ splash }));
    void initAccount();
  }, [profile.productName]);

  const signedIn = status?.state === "signedIn";
  const accountId = signedIn ? (status.accountId ?? null) : null;
  const email = signedIn ? (status.email ?? null) : null;
  // 계정이 정해지거나 바뀌면 목록을 바로 그 계정 것으로(이전 계정 목록은 즉시 비움 — 94 실기 의견)
  useEffect(() => {
    setAccount(accountId, email);
  }, [accountId, email]);
  // 마지막으로 연 온라인 공간이 목록에 있으면 바로 연다(U1 — [목록으로]로 나왔으면 열지 않음). 한 번만
  useEffect(() => {
    if (autoTried.current || !accountId || !list) return;
    autoTried.current = true;
    const last = lastOpened(accountId);
    const w = last ? list.find((x) => x.workspaceId === last) : undefined;
    if (w) void openOnlineSpace(w);
  }, [accountId, list]);

  // 온라인 공간을 열면 지금 앱 화면 그대로 — 닫으면 창을 새로 불러 이 화면으로
  if (opened) return <OnlineWorkspaceShell />;

  // 다 만든 공간 바로 열기(목록을 새로 받아 그 공간)
  const openCreated = async (workspaceId: string) => {
    setCreating(false);
    await refreshSpaces();
    const w = useOnlineSpaces.getState().list?.find((x) => x.workspaceId === workspaceId);
    if (w) await openOnlineSpace(w);
  };

  // S4·S5: 설정과 같은 모양 — 위 한 줄(이름·DEV) + 가운데 카드(계정 · 내 온라인 공간 · 검증 정보)
  return (
    <div className={appStyles.shell}>
      <header className={topStyles.brandRow}>
        <BrandLockup size="bar" />
        <span className={topStyles.devBadge} title={STR.devChannel.badgeTitle} data-testid="dev-badge">
          {STR.devChannel.badge}
        </span>
      </header>
      <main className={own.page} data-testid="connected-preview">
        <div className={own.inner}>
          <div className={own.head}>
            <h1>{profile.productName}</h1>
            <p>{P.lead}</p>
          </div>
          <AccountCard />
          <UsageCard />
          <AdminCard />
          <OnlineSpacesCard ownerId={accountId} refreshKey={published} onCreate={() => setCreating(true)} />
          <Card id="preview-about" title={P.about}>
            <Row label={P.profile} desc={P.profileValue} />
            <Row label={P.appVersion} desc={__APP_VERSION_LABEL__} />
            <Row label={P.updates} desc={<span data-testid="preview-updates">{P.updatesOff}</span>} />
            <Row
              label={P.localJournal}
              desc={<span data-testid="preview-local-journal">{P.localJournalOff}</span>}
            />
          </Card>
        </div>
      </main>
      {creating && accountId && (
        <CreateOnlineDialog
          ownerId={accountId}
          email={email}
          onPublished={() => {
            setPublished((n) => n + 1);
            void loadUsage(); // 공간 수·용량 바로
          }}
          onOpen={(ws) => void openCreated(ws)}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}
