// 열린 온라인 공간의 제품 화면 요소(docs/v2-design/95 UX-3) — onlineSlots로 레일·상단에 끼운다(Preview만).
// S1 레일 공간 메뉴: 구름 표시 모노그램(U8) + 계정 묶음 + 상태. S2·S3 상단 알약 + 동기화 패널(위 띠 대신, U2).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MAX_SHORTCUT } from "../../domain/workspace";
import { osText } from "../../shared/platformText";
import { STR } from "../../shared/strings";
import { useAppStore } from "../common/appStore";
import { SaveStatus } from "../common/SaveStatus";
import type { SaveStatusProps } from "../common/onlineSlots";
import { WorkspaceMark } from "../common/workspaceIcons";
import sw from "../common/WorkspaceSwitcher.module.css";
import {
  closeToList,
  metaOf,
  openOnlineSpace,
  when,
  useOnlineSpaces,
  type OpenedSpace,
} from "./onlineSpaces";
import { applyReceived, loadConflicts, syncNow, useOnlineSync } from "./onlineSync";
import styles from "./OnlineChrome.module.css";

const Y = STR.onlineSpaces.sync;
const M = STR.onlineSpaces.menu;
const P = STR.onlineSpaces.panel;
const setApp = useAppStore.setState;
const clock = (t: number) => new Date(t).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
type Status = ReturnType<typeof useOnlineSync.getState>["status"];

function syncText(s: Status) {
  if (s.phase === "syncing") return Y.syncing;
  if (s.phase === "offline") return Y.offline(s.pending);
  if (s.phase === "error") return Y.error(s.error ?? "UNKNOWN");
  if (s.pending) return Y.pending(s.pending);
  return s.lastSyncedAt ? Y.synced(clock(s.lastSyncedAt)) : Y.saved;
}
/** 상태 점(색 + 글로 함께 — 색만으로 가르지 않음) */
function tone(s: Status): "ok" | "wait" | "off" | "bad" {
  if (s.phase === "error" || s.conflicts > 0) return "bad";
  if (s.phase === "offline") return "off";
  if (s.pending || s.phase === "syncing") return "wait";
  return "ok";
}

const nameOf = (o: OpenedSpace | null) => o?.meta?.name ?? STR.workspace.onlineMark;

function CloudIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path
        d="M4.5 12.5h7.2a2.8 2.8 0 0 0 .3-5.6A4 4 0 0 0 4.3 7.6 2.5 2.5 0 0 0 4.5 12.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** S1 레일 맨 위: 지금 온라인 공간(구름 표시) → 공간 메뉴 */
export function OnlineRailButton() {
  const open = useAppStore((s) => s.switcherOpen);
  const cur = useOnlineSpaces((s) => s.current);
  const m = cur?.meta;
  return (
    <div className={sw.wrap}>
      <button
        type="button"
        className={`${sw.railBtn} ${open ? sw.railOn : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={M.rail(nameOf(cur))}
        title={osText(M.rail(nameOf(cur)))}
        data-testid="workspace-button"
        data-online=""
        onClick={() => setApp({ switcherOpen: !open })}
      >
        <WorkspaceMark icon={m?.icon ?? "folder"} color={m?.color ?? "c1"} size={30} online />
      </button>
      {open && <OnlineMenu />}
    </div>
  );
}

function OnlineMenu() {
  const { list, email, offline, busy, current } = useOnlineSpaces();
  const status = useOnlineSync((s) => s.status);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => setApp({ switcherOpen: false });
  // 목록을 받지 못했어도 지금 연 공간은 보인다
  const items = list ?? [];

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
      const w = items[Number(e.key) - 1];
      if (w) {
        e.preventDefault();
        close();
        void openOnlineSpace(w);
      }
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
      <div className={styles.group}>{email ? M.group(email) : M.groupPlain}</div>
      {offline && <div className={styles.note}>{M.offline}</div>}
      {items.map((w, i) => {
        const isCur = current?.workspaceId === w.workspaceId;
        const m = metaOf(w);
        return (
          <button
            key={w.workspaceId}
            type="button"
            role="menuitem"
            className={`${sw.item} ${isCur ? sw.current : ""}`}
            data-current={isCur || undefined}
            data-testid="workspace-item"
            data-online=""
            aria-current={isCur || undefined}
            disabled={!!busy && busy !== w.workspaceId}
            onClick={() => {
              close();
              if (!isCur) void openOnlineSpace(w);
            }}
          >
            <WorkspaceMark icon={m?.icon ?? "folder"} color={m?.color ?? "c1"} size={26} online />
            <span className={sw.text}>
              <span className={sw.name}>
                {m?.name ?? STR.workspace.onlineMark}
                {isCur && <span className={sw.check}> ✓</span>}
              </span>
              <span className={styles.meta}>
                <span className={styles.type}>
                  <CloudIcon size={11} />
                  {M.type}
                </span>
                {busy === w.workspaceId ? (
                  M.opening
                ) : isCur ? (
                  <>
                    <span className={styles.dot} data-tone={tone(status)} aria-hidden="true" />
                    {syncText(status)}
                  </>
                ) : (
                  M.copied(when(w.createdAt))
                )}
              </span>
            </span>
            {i < MAX_SHORTCUT && <kbd className={sw.kbd}>{osText(STR.workspace.shortcut(i + 1))}</kbd>}
          </button>
        );
      })}
      <div className={sw.sep} />
      <button
        type="button"
        role="menuitem"
        className={`${sw.item} ${sw.action}`}
        data-testid="online-create"
        onClick={() => void closeToList()}
      >
        {M.create}
      </button>
      <button
        type="button"
        role="menuitem"
        className={sw.item}
        data-testid="workspace-manage"
        onClick={() => void closeToList()}
      >
        {M.manage}
      </button>
    </div>
  );
}

/** S2 상단 알약: "저장됨" 자리에 동기화 상태. 이 기기 저장 실패는 지금 알약 그대로(다시 시도) */
export function OnlineStatusPill(props: SaveStatusProps) {
  const { status, runs, refreshed, received } = useOnlineSync();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  if (props.error) return <SaveStatus {...props} />;
  const t = tone(status);
  return (
    <div className={styles.pillWrap} ref={ref}>
      <button
        type="button"
        className={styles.pill}
        data-tone={t}
        data-testid="online-sync-status"
        data-phase={status.phase}
        data-runs={runs}
        data-refreshed={refreshed}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
      >
        <CloudIcon />
        <span>{syncText(status)}</span>
        {status.conflicts > 0 && <span className={styles.badge}>{Y.conflicts(status.conflicts)}</span>}
        {received > 0 && <span className={styles.badge}>{Y.received(received)}</span>}
      </button>
      {open && <SyncPanel saving={props.saving} onDone={() => setOpen(false)} />}
    </div>
  );
}

/** S3 동기화 패널: 이 기기 / 서버를 따로, 보낼 변경·충돌, [지금 동기화] */
function SyncPanel({ saving, onDone }: { saving: boolean; onDone: () => void }) {
  const { status, received } = useOnlineSync();
  const { current, email } = useOnlineSpaces();
  const server =
    status.phase === "offline" || status.phase === "error" || status.phase === "syncing"
      ? syncText(status)
      : status.lastSyncedAt
        ? Y.synced(clock(status.lastSyncedAt))
        : P.serverWaiting;
  const m = current?.meta;
  return (
    <div className={styles.panel} role="dialog" aria-label={P.label} data-testid="online-sync-panel">
      <div className={styles.head}>
        <WorkspaceMark icon={m?.icon ?? "folder"} color={m?.color ?? "c1"} size={26} online />
        <div className={styles.headText}>
          <b>{nameOf(current)}</b>
          <span className={styles.meta}>
            <span className={styles.type}>
              <CloudIcon size={11} />
              {M.type}
            </span>
            {email}
          </span>
        </div>
      </div>
      {current?.stale && (
        <p className={styles.note} data-testid="online-sync-stale">
          {STR.onlineSpaces.stale}
        </p>
      )}
      <dl className={styles.facts}>
        <dt>{P.device}</dt>
        <dd data-testid="online-sync-device">{saving ? P.deviceSaving : P.deviceSaved}</dd>
        <dt>{P.server}</dt>
        <dd data-testid="online-sync-server">
          <span className={styles.dot} data-tone={tone(status)} aria-hidden="true" />
          {server}
        </dd>
        <dt>{P.outbox}</dt>
        <dd>{P.count(status.pending)}</dd>
        <dt>{P.conflicts}</dt>
        <dd>{P.count(status.conflicts)}</dd>
      </dl>
      {received > 0 && (
        <button
          type="button"
          className={styles.wide}
          onClick={() => {
            onDone();
            void applyReceived();
          }}
          data-testid="online-sync-reload"
        >
          {Y.received(received)} · {Y.reload}
        </button>
      )}
      <div className={styles.actions}>
        {status.conflicts > 0 && (
          <button
            type="button"
            className={styles.warn}
            onClick={() => {
              onDone();
              void loadConflicts();
            }}
            data-testid="online-sync-conflicts"
          >
            {P.showConflicts}
          </button>
        )}
        <button
          type="button"
          className={styles.primary}
          disabled={status.phase === "syncing"}
          onClick={() => void syncNow()}
          data-testid="online-sync-now"
        >
          {Y.now}
        </button>
      </div>
      <button
        type="button"
        className={styles.link}
        onClick={() => void closeToList()}
        data-testid="online-workspace-close"
      >
        {P.toList}
      </button>
    </div>
  );
}
