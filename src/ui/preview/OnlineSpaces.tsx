// 내 온라인 공간(Connected Preview, docs/v2-design/87·89·95) — 첫 화면 목록 → [열기] → 이 기기 캐시·일지 준비 →
// 그 일지로 지금 앱 화면 그대로(편집 = 이 기기에 저장 + 보낼 목록). 열린 뒤 상태·전환은 제품 화면 안(UX-3):
// 레일 공간 메뉴(구름 표시)·상단 동기화 알약·패널 — onlineSlots로 끼운다(정식판·DEV는 그대로).
import { lazy, useEffect, useState } from "react";
import type { OnlineSpaceInfo } from "../../platform";
import type { ConflictItem } from "../../preview/spaceSync";
import { BOTH_TABLES } from "../../preview/spaceSync";
import { closeConflicts, resolveConflict, useOnlineSync } from "./onlineSync";
import { formatBytes, STR } from "../../shared/strings";
import { setOnlineSlots } from "../common/onlineSlots";
import { WorkspaceMark } from "../common/workspaceIcons";
import { OnlineRailButton, OnlineStatusPill, OnlineWorkspaceSettings } from "./OnlineChrome";
import { AccountSettingsCard } from "./AccountPanel";
import {
  metaOf,
  openOnlineSpace,
  openOnlineSpaceAt,
  refreshSpaces,
  useOnlineSpaces,
  when,
  type OpenedSpace,
} from "./onlineSpaceStore";
import styles from "../first-run/FirstRun.module.css";
import own from "./MigrationCard.module.css";
import shell from "./OnlineSpaces.module.css";

const S = STR.onlineSpaces;
const App = lazy(() => import("../App").then((m) => ({ default: m.App })));
export type { OpenedSpace };

export function OnlineSpacesCard({
  ownerId,
  refreshKey = 0,
}: {
  ownerId: string | null;
  /** 바뀌면 목록을 다시 받는다(복제 완료 뒤) */
  refreshKey?: number;
}) {
  const { list, offline, busy, error } = useOnlineSpaces();
  useEffect(() => {
    if (ownerId && refreshKey) void refreshSpaces();
  }, [ownerId, refreshKey]);

  if (!ownerId) return null;

  return (
    <section className={styles.card} data-testid="online-spaces">
      <h2 className={own.title}>{S.title}</h2>
      {offline && <p className={styles.small}>{S.offline}</p>}
      {list && list.length === 0 && <p className={styles.small}>{S.empty}</p>}
      {list && list.length > 0 && (
        <div className={own.pending}>
          {list.map((w) => (
            <div key={w.workspaceId} className={own.pendingRow} data-testid="online-space-row">
              <SpaceName w={w} />
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
                onClick={() => void openOnlineSpace(w)}
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
          disabled={busy !== null}
          onClick={() => void refreshSpaces()}
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

/** 공간 이름표: 구름 표시 모노그램 + 이름(서버 목록 025, 없으면 기본 모양과 "온라인 워크스페이스") */
function SpaceName({ w }: { w: OnlineSpaceInfo }) {
  const m = metaOf(w);
  return (
    <span className={own.spaceName} data-testid="online-space-name">
      <WorkspaceMark icon={m?.icon ?? "folder"} color={m?.color ?? "c1"} size={26} online />
      <b>{m?.name ?? STR.workspace.onlineMark}</b>
    </span>
  );
}

const Y = S.sync;
const onlineChrome = {
  RailButton: OnlineRailButton,
  StatusPill: OnlineStatusPill,
  WorkspaceSettings: OnlineWorkspaceSettings,
  workspaceIntro: STR.onlineSpaces.settings.intro,
  account: {
    Component: AccountSettingsCard,
    ...STR.onlineSpaces.account.cat,
    icon: "M9 8.2a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3.2 15.8a5.8 5.8 0 0 1 11.6 0",
  },
  switchAt: openOnlineSpaceAt,
};

/** 열린 온라인 공간: 지금 앱 화면 그대로 + 레일 공간 메뉴·상단 동기화 알약(onlineSlots, 위 띠 없음 — U2) */
export function OnlineWorkspaceShell() {
  const conflicts = useOnlineSync((s) => s.conflicts);
  // 앱 화면이 그리기 전에 끼움 자리를 채운다(같은 값이라 여러 번 불러도 됨)
  setOnlineSlots(onlineChrome);
  return (
    <div className={shell.frame} data-testid="online-workspace">
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
  const time = (t: number) =>
    new Date(t).toLocaleString("ko-KR", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  // U5: 설정과 같은 전체 화면(← 주간 보드로) — 항목마다 이 기기 / 서버 나란히
  return (
    <section className={shell.page} role="dialog" aria-label={Y.panelTitle} data-testid="online-conflicts">
      <header className={shell.pageHead}>
        <button
          type="button"
          className={shell.back}
          onClick={closeConflicts}
          data-testid="online-conflicts-close"
        >
          {Y.backToBoard}
        </button>
        <strong>{Y.panelTitle}</strong>
      </header>
      <div className={shell.pageBody}>
        <div className={shell.pageInner}>
          <p className={shell.pageLead}>{items.length ? Y.pageLead(items.length) : Y.panelEmpty}</p>
          {items.map((c) => (
            <div key={`${c.table}:${c.key}`} className={shell.item} data-testid="online-conflict">
              <div className={shell.itemTitle}>{Y.tables[c.table] ?? Y.other(c.table)}</div>
              <div className={shell.sides}>
                <div className={shell.sideBox}>
                  <div className={shell.side}>
                    {Y.mine} · {time(c.at)}
                  </div>
                  <div className={shell.body}>{summary(c.table, c.local)}</div>
                </div>
                <div className={shell.sideBox}>
                  <div className={shell.side}>
                    {Y.server}
                    {c.serverRev !== null ? ` · ${Y.rev(c.serverRev)}` : ""}
                  </div>
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
      </div>
    </section>
  );
}
