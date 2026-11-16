// 내 온라인 공간(Connected Preview, docs/v2-design/87·89) — 목록 → [열기] → 이 기기 캐시 채우기 →
// (처음이면) 캐시에서 이 기기 일지 만들기 → 그 일지로 지금 앱 화면 그대로(편집 = 이 기기에 저장 + 보낼 목록).
// 닫으면 저장을 마치고 일지를 닫은 뒤 창을 새로 불러 Preview 첫 화면으로(화면 저장소 상태가 남지 않게 — CLAUDE.md 4-7).
import { lazy, useEffect, useState } from "react";
import {
  loadPreviewSpaces,
  setPlatformOverride,
  type OnlineSpaceInfo,
  type PreviewSpaces,
} from "../../platform";
import { createOnlinePlatform, destroyChildWindows, within } from "../../platform/onlinePlatform";
import { isTauri } from "@tauri-apps/api/core";
import { ensureSpaceJournal, upgradeSyncTables, type CachedHeaderLike } from "../../preview/spaceJournal";
import type { ConflictItem } from "../../preview/spaceSync";
import { BOTH_TABLES } from "../../preview/spaceSync";
import {
  applyReceived,
  closeConflicts,
  markClosing,
  loadConflicts,
  resolveConflict,
  schedulePush,
  startOnlineSync,
  stopOnlineSync,
  syncNow,
  useOnlineSync,
} from "./onlineSync";
import { loadSql } from "../../preview/migrationSession";
import { closeOnlineSpace } from "../common/appController";
import { formatBytes, STR } from "../../shared/strings";
import { readStoredTheme } from "../../shared/theme";
import { useAppStore } from "../common/appStore";
import styles from "../first-run/FirstRun.module.css";
import own from "./MigrationCard.module.css";
import shell from "./OnlineSpaces.module.css";

const S = STR.onlineSpaces;
const App = lazy(() => import("../App").then((m) => ({ default: m.App })));
const errText = (e: unknown) => {
  const code = e instanceof Error ? e.message : String(e);
  return (
    S.errors[code] ?? STR.connectedPreview.errors[code] ?? `${STR.connectedPreview.errors.UNKNOWN} (${code})`
  );
};
const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("ko-KR", {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

export interface OpenedSpace {
  workspaceId: string;
  label: string;
  stale: boolean;
}

export function OnlineSpacesCard({
  ownerId,
  onOpened,
  refreshKey = 0,
}: {
  ownerId: string | null;
  onOpened: (s: OpenedSpace) => void;
  /** 바뀌면 목록을 다시 받는다(복제 완료 뒤) */
  refreshKey?: number;
}) {
  const [spaces, setSpaces] = useState<PreviewSpaces | null>(null);
  const [list, setList] = useState<OnlineSpaceInfo[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async (sp: PreviewSpaces) => {
    setError(null);
    try {
      const r = await sp.list();
      setList(r.workspaces);
      setOffline(!!r.offline);
    } catch (e) {
      // 받지 못했으면 이전 목록을 남기지 않는다(다른 계정의 목록이 보이지 않게 — 94문서 실기)
      setList(null);
      setError(errText(e));
    }
  };
  useEffect(() => {
    if (!ownerId) return;
    void loadPreviewSpaces().then((sp) => {
      setSpaces(sp);
      void refresh(sp);
    });
  }, [ownerId]);
  useEffect(() => {
    if (spaces && refreshKey) void Promise.resolve(spaces).then(refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  if (!ownerId) return null;

  async function open(w: OnlineSpaceInfo) {
    if (!spaces) return;
    setBusy(w.workspaceId);
    setError(null);
    try {
      const sync = await spaces.sync(w.workspaceId);
      const SQL = await loadSql();
      await ensureSpaceJournal(SQL, spaces, spaces.journal, w.workspaceId);
      // E-1 때 만든 이 기기 일지면 E-3 동기화 표·트리거를 더한다(한 번, 같은 묶음)
      const head = JSON.parse(
        new TextDecoder().decode(await spaces.read(w.workspaceId, "header.json")),
      ) as CachedHeaderLike;
      const d = await spaces.journal.open(w.workspaceId);
      try {
        await upgradeSyncTables(d, head.assets, Number(head.header.sourceSchema));
      } finally {
        await d.close();
      }
      // 실앱: 업무노트·메모보드·파일 목록을 정식판과 같은 별도 OS 창으로(Tauri 창 다리)
      const native = isTauri() ? (await import("../../platform/tauri")).tauriPlatform : null;
      setPlatformOverride(
        createOnlinePlatform({
          windows: native
            ? { cabi: native.cabi, folderWindows: native.folderWindows, cabinetWindow: native.cabinetWindow }
            : undefined,
          SQL,
          openJournal: () => spaces.journal.open(w.workspaceId),
          workspaceId: w.workspaceId,
          theme: readStoredTheme(),
          onWrite: schedulePush,
        }),
      );
      startOnlineSync(w.workspaceId, spaces.transport);
      onOpened({ workspaceId: w.workspaceId, label: when(w.createdAt), stale: sync.stale });
    } catch (e) {
      setError(errText(e));
      setBusy(null);
    }
  }

  return (
    <section className={styles.card} data-testid="online-spaces">
      <h2 className={own.title}>{S.title}</h2>
      {offline && <p className={styles.small}>{S.offline}</p>}
      {list && list.length === 0 && <p className={styles.small}>{S.empty}</p>}
      {list && list.length > 0 && (
        <div className={own.pending}>
          {list.map((w) => (
            <div key={w.workspaceId} className={own.pendingRow} data-testid="online-space-row">
              <span className={styles.small} title={w.workspaceId}>
                {S.item(
                  when(w.createdAt),
                  w.records,
                  w.assets,
                  formatBytes(w.assetBytes ?? 0),
                  w.sourceSchema,
                )}
              </span>
              <button
                type="button"
                className={styles.primary}
                disabled={busy !== null}
                onClick={() => void open(w)}
                data-testid="online-space-open"
              >
                {busy === w.workspaceId ? S.opening : S.open}
              </button>
            </div>
          ))}
        </div>
      )}
      <div className={styles.row}>
        <button
          type="button"
          className={styles.secondary}
          disabled={busy !== null || !spaces}
          onClick={() => spaces && void refresh(spaces)}
        >
          {S.refresh}
        </button>
      </div>
      {error && (
        <p className={styles.small} role="alert" data-testid="online-spaces-error">
          {error}
        </p>
      )}
    </section>
  );
}

/** 목록으로: 입력 중인 글·별도 창(노트·메모보드) 저장 → 일지 닫기 → 남은 창 정리 → 창을 새로 불러 Preview 첫 화면으로 */
async function closeSpace() {
  markClosing("list");
  stopOnlineSync();
  await within(closeOnlineSpace(), 5000);
  const p = useAppStore.getState().platform;
  await Promise.allSettled([destroyChildWindows(), p?.cabi.closeAll()]);
  location.reload();
}

const Y = S.sync;
const clock = (t: number) => new Date(t).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
function syncText(s: ReturnType<typeof useOnlineSync.getState>["status"]) {
  if (s.phase === "syncing") return Y.syncing;
  if (s.phase === "offline") return Y.offline(s.pending);
  if (s.phase === "error") return Y.error(s.error ?? "UNKNOWN");
  if (s.pending) return Y.pending(s.pending);
  return s.lastSyncedAt ? Y.synced(clock(s.lastSyncedAt)) : Y.saved;
}

/** 열린 온라인 공간: 위 띠(동기화 상태·지금 동기화·충돌·목록으로) + 지금 앱 화면 */
export function OnlineWorkspaceShell({ space }: { space: OpenedSpace }) {
  const { status, received, conflicts, runs, refreshed } = useOnlineSync();
  return (
    <div className={shell.frame} data-testid="online-workspace">
      <div className={shell.band} role="note">
        <span className={shell.label}>{S.bandLabel}</span>
        <span className={shell.meta}>
          {S.bandMeta(space.label)}
          {space.stale ? ` · ${S.stale}` : ""}
        </span>
        <span
          className={shell.status}
          data-testid="online-sync-status"
          data-phase={status.phase}
          data-runs={runs}
          data-refreshed={refreshed}
        >
          {syncText(status)}
        </span>
        {received > 0 && (
          <button
            type="button"
            className={shell.back}
            onClick={() => void applyReceived()}
            data-testid="online-sync-reload"
          >
            {Y.received(received)} · {Y.reload}
          </button>
        )}
        {status.conflicts > 0 && (
          <button
            type="button"
            className={`${shell.back} ${shell.warn}`}
            onClick={() => void loadConflicts()}
            data-testid="online-sync-conflicts"
          >
            {Y.conflicts(status.conflicts)}
          </button>
        )}
        <button
          type="button"
          className={shell.back}
          disabled={status.phase === "syncing"}
          onClick={() => void syncNow()}
          data-testid="online-sync-now"
        >
          {Y.now}
        </button>
        <button
          type="button"
          className={shell.back}
          onClick={() => void closeSpace()}
          data-testid="online-workspace-close"
        >
          {S.close}
        </button>
      </div>
      <div className={shell.app}>
        <App />
      </div>
      {conflicts && <ConflictPanel items={conflicts} />}
    </div>
  );
}

/** 문서·기록을 짧은 글로(나란히 보기) */
function summary(table: string, v: Record<string, unknown> | null): string {
  if (!v) return Y.deleted;
  const text = (node: unknown): string => {
    if (!node || typeof node !== "object") return "";
    const n = node as { text?: string; content?: unknown[] };
    return (n.text ?? "") + (n.content ?? []).map(text).join(" ");
  };
  try {
    if (table === "entry_item") return String(v.text ?? "");
    if (table === "week_note" || table === "cabi_board") {
      const doc = JSON.parse(String(v.doc)) as {
        boxes: { content?: unknown; title?: string; url?: string }[];
      };
      const words = doc.boxes
        .map((b) => text(b.content) || b.title || b.url || "")
        .filter(Boolean)
        .join(" / ");
      return `${Y.boxes(doc.boxes.length)}${words ? ` — ${words}` : ""}`;
    }
    if (table === "cabi_note") return `${String(v.title ?? "")} — ${text(JSON.parse(String(v.content)))}`;
    if (table === "category") return String(v.name ?? "");
  } catch {
    /* 아래 일반 표시 */
  }
  return JSON.stringify(v).slice(0, 300);
}

function ConflictPanel({ items }: { items: ConflictItem[] }) {
  const [busy, setBusy] = useState(false);
  const act = async (c: ConflictItem, choice: "mine" | "server" | "both") => {
    setBusy(true);
    try {
      await resolveConflict(c, choice);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={shell.panel} role="dialog" aria-label={Y.panelTitle} data-testid="online-conflicts">
      <div className={shell.panelHead}>
        <strong>{Y.panelTitle}</strong>
        <button
          type="button"
          className={shell.back}
          onClick={closeConflicts}
          data-testid="online-conflicts-close"
        >
          {Y.close}
        </button>
      </div>
      {items.length === 0 && <p className={shell.panelEmpty}>{Y.panelEmpty}</p>}
      {items.map((c) => (
        <div key={`${c.table}:${c.key}`} className={shell.item} data-testid="online-conflict">
          <div className={shell.itemTitle}>{Y.tables[c.table] ?? Y.other(c.table)}</div>
          <div className={shell.sides}>
            <div>
              <div className={shell.side}>{Y.mine}</div>
              <div className={shell.body}>{summary(c.table, c.local)}</div>
            </div>
            <div>
              <div className={shell.side}>{Y.server}</div>
              <div className={shell.body}>{summary(c.table, c.server)}</div>
            </div>
          </div>
          <div className={shell.actions}>
            <button
              type="button"
              className={shell.back}
              disabled={busy}
              onClick={() => void act(c, "mine")}
              data-testid="conflict-mine"
            >
              {Y.keepMine}
            </button>
            <button
              type="button"
              className={shell.back}
              disabled={busy}
              onClick={() => void act(c, "server")}
              data-testid="conflict-server"
            >
              {Y.keepServer}
            </button>
            {BOTH_TABLES.has(c.table) && c.local && c.server && (
              <button
                type="button"
                className={shell.back}
                disabled={busy}
                onClick={() => void act(c, "both")}
                data-testid="conflict-both"
              >
                {Y.keepBoth}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
