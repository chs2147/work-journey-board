// D-4 내 온라인 공간(Connected Preview, docs/v2-design/87) — 목록 → [열기] → 이 기기 캐시 채우기 → 메모리 일지로 되살려
// 지금 앱 화면 그대로(읽기 전용). 닫으면 창을 새로 불러 Preview 첫 화면으로(화면 저장소 상태가 남지 않게 — CLAUDE.md 4-7).
import { lazy, useEffect, useState } from "react";
import {
  loadPreviewSpaces,
  setPlatformOverride,
  type OnlineSpaceInfo,
  type PreviewSpaces,
} from "../../platform";
import { createOnlinePlatform } from "../../platform/onlinePlatform";
import { restoreFromCache, readOnlyGate } from "../../preview/onlineWorkspace";
import { loadSql } from "../../preview/migrationSession";
import { formatBytes, STR } from "../../shared/strings";
import { readStoredTheme } from "../../shared/theme";
import { useAppStore } from "../common/appStore";
import { toast } from "../board/boardStore";
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
    if (spaces && refreshKey) void refresh(spaces);
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
      const restored = await restoreFromCache(SQL, spaces, w.workspaceId);
      const gate = readOnlyGate(() => toast(S.readOnlyToast));
      setPlatformOverride(
        createOnlinePlatform({
          SQL,
          journal: restored.bytes,
          workspaceId: w.workspaceId,
          theme: readStoredTheme(),
          wrap: gate.wrap,
        }),
      );
      // 앱이 공간을 다 띄우면 그때부터 쓰기를 막는다
      const stop = useAppStore.subscribe((s) => {
        if (s.journal.state === "ready") {
          gate.lock();
          stop();
        }
      });
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

/** 열린 온라인 공간: 위 띠(읽기 전용·목록으로) + 지금 앱 화면 */
export function OnlineWorkspaceShell({ space }: { space: OpenedSpace }) {
  return (
    <div className={shell.frame} data-testid="online-workspace">
      <div className={shell.band} role="note">
        <span className={shell.label}>{S.bandLabel}</span>
        <span className={shell.meta}>
          {S.bandMeta(space.label)}
          {space.stale ? ` · ${S.stale}` : ""}
        </span>
        <button
          type="button"
          className={shell.back}
          onClick={() => location.reload()}
          data-testid="online-workspace-close"
        >
          {S.close}
        </button>
      </div>
      <div className={shell.app}>
        <App />
      </div>
    </div>
  );
}
