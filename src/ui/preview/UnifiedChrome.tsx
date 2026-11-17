// G-1 로컬·온라인 통합 앱(A안, docs/v2-design/98) — DEV 판(온라인 가능 판)에서만 설치한다. 정식판은 부르지 않는다.
// 로그인 전 = 지금 앱 그대로 + 설정 › 계정 · 공간 메뉴 [온라인 로그인…]. 로그인 후 = 공간 메뉴·설정 › 워크스페이스에
// "이 PC" 묶음 + "온라인 · 이메일" 묶음. 공간 바꾸기는 모두 한 길(appController.switchOnlineSpace — CLAUDE.md 4-7).
// 앱을 켜면 마지막 공간(이 PC 설정 config.json `lastWorkspace`)으로 — 온라인을 열 수 없으면 이 PC 마지막 공간.
import { useEffect, useLayoutEffect, useRef } from "react";
import { create } from "zustand";
import {
  loadBasePlatform,
  setPlatformOverride,
  type AppConfig,
  type OnlineSpaceInfo,
  type Platform,
} from "../../platform";
import { MAX_SHORTCUT, sameDir, type WorkspaceEntry } from "../../domain/workspace";
import { osText } from "../../shared/platformText";
import { STR } from "../../shared/strings";
import { useAppStore } from "../common/appStore";
import {
  onBeforeExit,
  openSettingsAt,
  setSettingsOpen,
  setStartHook,
  switchWorkspace,
} from "../common/appController";
import { requestAccountSettings, setOnlineSlots, type SaveStatusProps } from "../common/onlineSlots";
import { SaveStatus } from "../common/SaveStatus";
import { WorkspaceMark } from "../common/workspaceIcons";
import { setImageProfile } from "../note/imageProcess";
import { Card } from "../settings/SettingsCard";
import { WorkspaceSettings } from "../settings/WorkspaceSettings";
import settingsStyles from "../settings/Settings.module.css";
import sw from "../common/WorkspaceSwitcher.module.css";
import { AccountSettingsCard } from "./AccountPanel";
import { CreateOnlineDialog } from "./CreateOnlineDialog";
import { OnlineMenuItem, OnlineStatusPill, OnlineWorkspaceSettings } from "./OnlineChrome";
import { initAccount, loadUsage, useOnlineAccount } from "./onlineAccount";
import {
  endCreate,
  leaveToLocal,
  openOnlineSpace,
  refreshSpaces,
  setAccount,
  setLeaveHook,
  setUnified,
  startCreate,
  useOnlineSpaces,
} from "./onlineSpaceStore";
import { pushBeforeLeave, stopOnlineSync } from "./onlineSync";
import styles from "./OnlineChrome.module.css";

const M = STR.onlineSpaces.menu;
const setApp = useAppStore.setState;

/** 이 PC 공간 목록·지금 이 PC 폴더(온라인 공간을 연 동안에도 남아 있게 — 앱 저장소의 목록은 그 공간 것으로 바뀐다) */
const useLocal = create<{ list: WorkspaceEntry[]; dir: string | null }>(() => ({ list: [], dir: null }));

let base: Platform | null = null;
/** 지금 앱이 이 PC 플랫폼으로 돌고 있나(온라인 공간 플랫폼이 아니라) */
const onLocal = () => base !== null && useAppStore.getState().platform === base;

/** 이 PC 마지막 공간 기억(config.json) — 이 PC 플랫폼으로만 쓴다 */
async function rememberLast(v: AppConfig["lastWorkspace"]) {
  await base?.saveConfig({ lastWorkspace: v }).catch(() => undefined);
}

/** 이 PC 공간으로(온라인을 연 동안이면 보내고 한 길로, 아니면 지금 공간 전환) */
async function openLocal(dir: string) {
  setApp({ switcherOpen: false });
  if (onLocal()) {
    await switchWorkspace(dir);
    return;
  }
  if (!base) return;
  await leaveToLocal(base, dir);
}

/** 온라인 공간으로 — 열지 못하고 앱이 공간 없이 남으면 이 PC 마지막 공간으로 돌아간다 */
async function openOnline(w: OnlineSpaceInfo) {
  setApp({ switcherOpen: false });
  const ok = await openOnlineSpace(w);
  if (!ok && !useOnlineSpaces.getState().current && !onLocal() && base) {
    const dir = useLocal.getState().dir;
    if (dir) await leaveToLocal(base, dir);
  }
}

/** 메뉴 순서(이 PC → 온라인)로 n번째 */
function openAt(n: number) {
  const local = useLocal.getState().list;
  if (n <= local.length) {
    const e = local[n - 1];
    if (e) void openLocal(e.dir);
    return;
  }
  const w = useOnlineSpaces.getState().list?.[n - local.length - 1];
  if (w) void openOnline(w);
}

/** 설정 › 계정으로 */
async function openAccount() {
  setApp({ switcherOpen: false });
  requestAccountSettings();
  if (useAppStore.getState().settingsOpen) {
    setSettingsOpen(false);
    await new Promise((r) => setTimeout(r, 0));
  }
  setSettingsOpen(true);
}

/** 레일 맨 위 단추: 지금 공간(이 PC 또는 구름 표시 온라인) → 통합 공간 메뉴 */
function UnifiedRailButton() {
  const open = useAppStore((s) => s.switcherOpen);
  const online = useOnlineSpaces((s) => s.current);
  const local = useLocal();
  const cur = online ? null : local.list.find((e) => local.dir && sameDir(e.dir, local.dir));
  if (!online && !cur) return null;
  const name = online ? (online.meta?.name ?? STR.workspace.onlineMark) : cur!.name;
  const label = online ? M.rail(name) : STR.workspace.rail(name);
  return (
    <div className={sw.wrap}>
      <button
        type="button"
        className={`${sw.railBtn} ${open ? sw.railOn : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={osText(label)}
        data-testid="workspace-button"
        data-online={online ? "" : undefined}
        onClick={() => setApp({ switcherOpen: !open })}
      >
        {online ? (
          <WorkspaceMark
            icon={online.meta?.icon ?? "folder"}
            color={online.meta?.color ?? "c1"}
            size={30}
            online
          />
        ) : (
          <WorkspaceMark icon={cur!.icon} color={cur!.color} size={30} />
        )}
      </button>
      {open && <UnifiedMenu />}
    </div>
  );
}

function UnifiedMenu() {
  const local = useLocal();
  const { list, email, offline, current, ownerId } = useOnlineSpaces();
  const signedIn = useOnlineAccount((s) => s.status?.state === "signedIn");
  const ref = useRef<HTMLDivElement>(null);
  const close = () => setApp({ switcherOpen: false });
  const online = signedIn && ownerId ? (list ?? []) : [];
  const localOpen = !current;

  useLayoutEffect(() => {
    const el = ref.current;
    const cur =
      el?.querySelector<HTMLElement>("[data-current]") ?? el?.querySelector<HTMLElement>("[role=menuitem]");
    cur?.focus();
  }, []);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest("[data-testid=workspace-button]")) close();
    };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, []);

  const onKey = (e: React.KeyboardEvent) => {
    const els = [...(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = els.length;
      els[(i + (e.key === "ArrowDown" ? 1 : -1) + n) % n]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      document.querySelector<HTMLElement>("[data-testid=workspace-button]")?.focus();
    } else if (/^[1-9]$/.test(e.key) && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      openAt(Number(e.key));
    }
  };

  return (
    <div
      ref={ref}
      className={`${sw.menu} ${styles.menuWide}`}
      role="menu"
      aria-label={STR.workspace.menuLabel}
      data-testid="workspace-menu"
      onKeyDown={onKey}
    >
      {signedIn && <div className={styles.group}>{M.localGroup}</div>}
      {local.list.map((w, i) => {
        const isCur = localOpen && !!local.dir && sameDir(w.dir, local.dir);
        return (
          <button
            key={w.dir}
            type="button"
            role="menuitem"
            className={`${sw.item} ${isCur ? sw.current : ""}`}
            data-current={isCur || undefined}
            data-testid="workspace-item"
            aria-current={isCur || undefined}
            onClick={() => (isCur ? close() : void openLocal(w.dir))}
          >
            <WorkspaceMark icon={w.icon} color={w.color} size={26} />
            <span className={sw.text}>
              <span className={sw.name}>
                {w.name}
                {isCur && <span className={sw.check}> ✓</span>}
              </span>
              <span className={sw.path} title={w.dir}>
                {w.dir}
              </span>
            </span>
            {i < MAX_SHORTCUT && <kbd className={sw.kbd}>{osText(STR.workspace.shortcut(i + 1))}</kbd>}
          </button>
        );
      })}
      {signedIn && (
        <>
          <div className={styles.group} data-testid="online-group">
            {email ? M.group(email) : M.groupPlain}
          </div>
          {offline && <div className={styles.note}>{M.offline}</div>}
          {online.map((w, i) => (
            <OnlineMenuItem
              key={w.workspaceId}
              w={w}
              shortcut={local.list.length + i + 1}
              onPick={() => {
                if (current?.workspaceId === w.workspaceId) close();
                else void openOnline(w);
              }}
            />
          ))}
        </>
      )}
      <div className={sw.sep} />
      {localOpen && (
        <button
          type="button"
          role="menuitem"
          className={`${sw.item} ${sw.action}`}
          data-testid="workspace-new"
          onClick={() => setApp({ switcherOpen: false, creatingWorkspace: true })}
        >
          {STR.workspace.create}
        </button>
      )}
      {signedIn ? (
        <button
          type="button"
          role="menuitem"
          className={`${sw.item} ${sw.action}`}
          data-testid="online-create"
          onClick={() => {
            close();
            startCreate();
          }}
        >
          {M.create}
        </button>
      ) : (
        <button
          type="button"
          role="menuitem"
          className={`${sw.item} ${sw.action}`}
          data-testid="online-sign-in"
          onClick={() => void openAccount()}
        >
          {M.signIn}
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        className={sw.item}
        data-testid="workspace-manage"
        onClick={() => {
          close();
          void openSettingsAt("workspace");
        }}
      >
        {STR.workspace.manage}
      </button>
    </div>
  );
}

/** 상단 저장 알약: 온라인 공간을 연 동안만 동기화 알약 */
function UnifiedStatusPill(props: SaveStatusProps) {
  const online = useOnlineSpaces((s) => s.current !== null);
  return online ? <OnlineStatusPill {...props} /> : <SaveStatus {...props} />;
}

/** 설정 › 워크스페이스: 이 PC 목록 + (로그인했으면) 온라인 목록 */
function UnifiedWorkspaceSettings() {
  const online = useOnlineSpaces((s) => s.current !== null);
  const email = useOnlineSpaces((s) => s.email);
  const signedIn = useOnlineAccount((s) => s.status?.state === "signedIn");
  const localCount = useLocal((s) => s.list.length);
  const onlineTitle = email ? M.group(email) : M.groupPlain;
  return (
    <>
      {online ? <LocalListCard /> : <WorkspaceSettings title={signedIn ? M.localGroup : undefined} />}
      {signedIn && (
        <OnlineWorkspaceSettings id="ws-online" title={onlineTitle} shortcutFrom={localCount + 1} />
      )}
    </>
  );
}

/** 온라인 공간을 연 동안의 이 PC 목록 — [열기]만(고치기·빼기·새로 만들기는 이 PC 공간에서) */
function LocalListCard() {
  const { list } = useLocal();
  const busy = useOnlineSpaces((s) => s.busy);
  return (
    <Card id="ws-list" title={M.localGroup} desc={STR.workspace.listLead} testId="workspace-settings">
      <ul className={settingsStyles.wsList} data-testid="workspace-list">
        {list.map((w, i) => (
          <li key={w.dir} className={settingsStyles.wsRow} data-testid="workspace-row">
            <div className={settingsStyles.wsMain}>
              <WorkspaceMark icon={w.icon} color={w.color} size={30} />
              <span className={settingsStyles.wsText}>
                <span className={settingsStyles.wsName}>{w.name}</span>
                <code className={settingsStyles.wsDir} title={w.dir}>
                  {w.dir}
                </code>
              </span>
              <span className={settingsStyles.wsMeta}>
                {i < MAX_SHORTCUT ? osText(STR.workspace.shortcut(i + 1)) : ""}
              </span>
              <span className={settingsStyles.wsActions}>
                <button
                  type="button"
                  data-testid="ws-open"
                  disabled={!!busy}
                  onClick={() => void openLocal(w.dir)}
                >
                  {STR.workspace.open}
                </button>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** 앱 안 만들기 대화상자(Preview는 첫 화면에서) — 다 만들면 바로 그 공간으로 */
function UnifiedOverlay() {
  const creating = useOnlineSpaces((s) => s.creating);
  const ownerId = useOnlineSpaces((s) => s.ownerId);
  const email = useOnlineSpaces((s) => s.email);
  if (!creating || !ownerId) return null;
  return (
    <CreateOnlineDialog
      ownerId={ownerId}
      email={email}
      onPublished={() => {
        void refreshSpaces();
        void loadUsage();
      }}
      onOpen={(ws) => {
        endCreate();
        void (async () => {
          await refreshSpaces();
          const w = useOnlineSpaces.getState().list?.find((x) => x.workspaceId === ws);
          if (w) await openOnline(w);
        })();
      }}
      onClose={endCreate}
    />
  );
}

/** 마지막 공간이 온라인이면 로그인 확인 → 목록(오프라인이면 이 기기에 받아 둔 목록) → 첫 동기화 후 열기 */
async function startFromLast(config: AppConfig): Promise<boolean> {
  // 온라인으로 바로 열어도 이 PC 마지막 공간은 메뉴에서 돌아갈 자리
  useLocal.setState({ dir: config.dataDir });
  const last = config.lastWorkspace;
  if (!last) return false;
  await accountReady;
  const s = useOnlineAccount.getState().status;
  if (s?.state !== "signedIn" || s.accountId !== last.ownerId) return false;
  setAccount(s.accountId, s.email);
  await refreshSpaces();
  const w = useOnlineSpaces.getState().list?.find((x) => x.workspaceId === last.workspaceId);
  if (!w) return false;
  const ok = await openOnlineSpace(w);
  if (!ok && base) {
    // 열지 못했으면 이 PC 플랫폼으로 되돌리고 앱이 dataDir(이 PC 마지막 공간)을 연다
    setPlatformOverride(base);
    setApp({ platform: base });
  }
  return ok;
}

let accountReady: Promise<void> = Promise.resolve();
let installed = false;

/** DEV(온라인 가능 판) 메인 창에서 1번 — 정식판·Preview는 부르지 않는다 */
export async function installUnified() {
  if (installed) return;
  installed = true;
  base = await loadBasePlatform();
  setUnified(true);
  setOnlineSlots({
    RailButton: UnifiedRailButton,
    StatusPill: UnifiedStatusPill,
    WorkspaceSettings: UnifiedWorkspaceSettings,
    account: {
      Component: AccountSettingsCard,
      ...STR.onlineSpaces.account.cat,
      icon: "M9 8.2a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3.2 15.8a5.8 5.8 0 0 1 11.6 0",
    },
    switchAt: openAt,
    Overlay: UnifiedOverlay,
  });
  // 계정: 앱을 켤 때 한 번 확인, 바뀌면 그 계정 목록(로그아웃하면 온라인 묶음이 사라짐)
  accountReady = initAccount().catch(() => undefined);
  const follow = (s: ReturnType<typeof useOnlineAccount.getState>) => {
    const st = s.status;
    const signedIn = st?.state === "signedIn";
    setAccount(signedIn ? (st.accountId ?? null) : null, signedIn ? (st.email ?? null) : null);
  };
  useOnlineAccount.subscribe(follow);
  // 이 PC 목록 사본: 앱이 이 PC 플랫폼으로 돌 때의 목록·폴더
  useAppStore.subscribe((s) => {
    if (s.platform !== base) return;
    const dir = s.journal.state === "ready" ? s.journal.dataDir : useLocal.getState().dir;
    const l = useLocal.getState();
    if (l.list !== s.workspaces || l.dir !== dir) useLocal.setState({ list: s.workspaces, dir });
  });
  // 연 공간에 맞춰: 그림 줄이기(온라인 = 글씨가 읽히는 크기, 96) · 마지막 공간 기억
  useOnlineSpaces.subscribe((s, prev) => {
    if (s.current?.workspaceId === prev.current?.workspaceId) return;
    setImageProfile(s.current ? "online" : "local");
    if (s.current && s.ownerId)
      void rememberLast({ kind: "online", workspaceId: s.current.workspaceId, ownerId: s.ownerId });
    else if (!s.current && prev.current) void rememberLast(null);
  });
  setLeaveHook(() => rememberLast(null));
  setStartHook(startFromLast);
  // 앱 닫기: 온라인 공간을 연 동안이면 보낼 변경을 보내고(짧게) 동기화를 멈춘 뒤 지금 닫기 흐름
  onBeforeExit(async () => {
    if (!useOnlineSpaces.getState().current) return;
    await pushBeforeLeave(2000);
    stopOnlineSync();
  });
}
