// 이 계정의 온라인 공간 목록·지금 연 공간(docs/v2-design/95 UX-3). 레일 공간 메뉴·Preview 첫 화면이 함께 쓴다.
// 계정이 바뀌면 목록을 바로 비우고 그 계정 것만 다시 받는다(94 실기 의견: 이전 계정 목록이 화면 전환 뒤에야 빠짐).
// 공간 열기·바꾸기는 일지 전환과 같은 한 길(appController.switchOnlineSpace, CLAUDE.md 4-7).
import { create } from "zustand";
import { isTauri } from "@tauri-apps/api/core";
import {
  loadPreviewSpaces,
  setPlatformOverride,
  type OnlineSpaceInfo,
  type Platform,
  type PreviewSpaces,
} from "../../platform";
import { createOnlinePlatform, destroyChildWindows, within } from "../../platform/onlinePlatform";
import { ensureSpaceJournal, upgradeSyncTables, type CachedHeaderLike } from "../../preview/spaceJournal";
import { loadSql } from "../../preview/migrationSession";
import { parseMeta, type WorkspaceMeta } from "../../domain/workspace";
import { readStoredTheme } from "../../shared/theme";
import { STR } from "../../shared/strings";
import { closeOnlineSpace, switchOnlineSpace } from "../common/appController";
import { useAppStore } from "../common/appStore";
import { markClosing, pushBeforeLeave, schedulePush, startOnlineSync, stopOnlineSync } from "./onlineSync";

export interface OpenedSpace {
  workspaceId: string;
  /** 복제 시각(사람이 읽는 글) */
  label: string;
  stale: boolean;
  /** 이름·색·아이콘(서버 목록 025) — 없으면 null */
  meta: Pick<WorkspaceMeta, "name" | "color" | "icon"> | null;
}

interface State {
  ownerId: string | null;
  email: string | null;
  list: OnlineSpaceInfo[] | null;
  offline: boolean;
  error: string | null;
  /** 여는 중인 공간 */
  busy: string | null;
  current: OpenedSpace | null;
}
export const useOnlineSpaces = create<State>(() => ({
  ownerId: null,
  email: null,
  list: null,
  offline: false,
  error: null,
  busy: null,
  current: null,
}));
const get = useOnlineSpaces.getState;
const set = useOnlineSpaces.setState;

export const errText = (e: unknown) => {
  const code = e instanceof Error ? e.message : String(e);
  return (
    STR.onlineSpaces.errors[code] ??
    STR.connectedPreview.errors[code] ??
    `${STR.connectedPreview.errors.UNKNOWN} (${code})`
  );
};
export const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("ko-KR", {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
export const metaOf = (w: OnlineSpaceInfo) => {
  const m = parseMeta(w.workspace);
  return m ? { name: m.name, color: m.color, icon: m.icon } : null;
};

/** 마지막으로 연 온라인 공간(계정마다, 이 기기 편의값 — 없어도 동작) */
const LAST = (owner: string) => `wjb.preview.lastOnline.${owner}`;
export function lastOpened(owner: string): string | null {
  try {
    return localStorage.getItem(LAST(owner));
  } catch {
    return null;
  }
}
function remember(owner: string | null, ws: string | null) {
  if (!owner) return;
  try {
    if (ws) localStorage.setItem(LAST(owner), ws);
    else localStorage.removeItem(LAST(owner));
  } catch {
    /* 저장소를 못 쓰면 다음 실행에 첫 화면 */
  }
}
/** [목록으로]: 다음 실행에 바로 열지 않는다 */
export const forgetLastOpened = () => remember(get().ownerId, null);

let spaces: PreviewSpaces | null = null;
async function api() {
  spaces ??= await loadPreviewSpaces();
  return spaces;
}

/** 로그인 계정이 정해지거나 바뀔 때. 바뀌면 이전 계정 목록을 즉시 비운다 */
export function setAccount(ownerId: string | null, email: string | null) {
  if (get().ownerId === ownerId) {
    if (get().email !== email) set({ email });
    return;
  }
  set({ ownerId, email, list: null, offline: false, error: null });
  if (ownerId) void refreshSpaces();
}

export async function refreshSpaces() {
  const owner = get().ownerId;
  if (!owner) return;
  set({ error: null });
  try {
    const r = await (await api()).list();
    if (get().ownerId !== owner) return; // 그사이 계정이 바뀜 — 버린다
    set({ list: r.workspaces, offline: !!r.offline });
  } catch (e) {
    if (get().ownerId !== owner) return;
    // 받지 못했으면 이전 목록을 남기지 않는다(다른 계정의 목록이 보이지 않게)
    set({ list: null, error: errText(e) });
  }
}

/** 이 기기 일지를 준비하고(받기·만들기·동기화 표) 그 공간용 플랫폼을 만든다 */
async function prepare(w: OnlineSpaceInfo): Promise<{ platform: Platform; opened: OpenedSpace }> {
  const sp = await api();
  const sync = await sp.sync(w.workspaceId);
  const SQL = await loadSql();
  await ensureSpaceJournal(SQL, sp, sp.journal, w.workspaceId);
  // E-1 때 만든 이 기기 일지면 E-3 동기화 표·트리거를 더한다(한 번, 같은 묶음)
  const head = JSON.parse(
    new TextDecoder().decode(await sp.read(w.workspaceId, "header.json")),
  ) as CachedHeaderLike;
  const d = await sp.journal.open(w.workspaceId);
  try {
    await upgradeSyncTables(d, head.assets, Number(head.header.sourceSchema));
  } finally {
    await d.close();
  }
  // 실앱: 업무노트·메모보드·파일 목록을 정식판과 같은 별도 OS 창으로(Tauri 창 다리)
  const native = isTauri() ? (await import("../../platform/tauri")).tauriPlatform : null;
  const platform = createOnlinePlatform({
    windows: native
      ? { cabi: native.cabi, folderWindows: native.folderWindows, cabinetWindow: native.cabinetWindow }
      : undefined,
    SQL,
    openJournal: () => sp.journal.open(w.workspaceId),
    workspaceId: w.workspaceId,
    theme: readStoredTheme(),
    onWrite: schedulePush,
  });
  return {
    platform,
    opened: { workspaceId: w.workspaceId, label: when(w.createdAt), stale: sync.stale, meta: metaOf(w) },
  };
}

/**
 * 온라인 공간 열기. 아무 공간도 안 열렸으면 플랫폼을 바꿔 두고(앱 화면이 그 플랫폼으로 시작),
 * 이미 열려 있으면 보낼 변경을 먼저 보내고 한 길로 바꾼다. 실패하면 지금 공간은 그대로(새 공간 준비 단계에서 실패).
 */
export async function openOnlineSpace(w: OnlineSpaceInfo): Promise<boolean> {
  const cur = get().current;
  if (cur?.workspaceId === w.workspaceId || get().busy) return true;
  set({ busy: w.workspaceId, error: null });
  try {
    const { platform, opened } = await prepare(w);
    const sp = await api();
    if (cur) {
      await pushBeforeLeave();
      stopOnlineSync();
      if (!(await switchOnlineSpace(platform, setPlatformOverride))) throw new Error("JOURNAL_MISSING");
    } else {
      setPlatformOverride(platform);
    }
    startOnlineSync(w.workspaceId, sp.transport);
    remember(get().ownerId, w.workspaceId);
    set({ current: opened, busy: null });
    return true;
  } catch (e) {
    set({ busy: null, error: errText(e) });
    return false;
  }
}

/** Ctrl+Alt+n — 목록의 n번째 */
export function openOnlineSpaceAt(n: number) {
  const w = get().list?.[n - 1];
  if (w) void openOnlineSpace(w);
}

/**
 * 온라인 공간 목록(Preview 첫 화면)으로: 보낼 변경을 보내고 입력·별도 창 저장 → 일지 닫기(한 길) → 남은 창 정리 →
 * 창을 새로 불러 첫 화면으로(화면 저장소 상태가 남지 않게 — CLAUDE.md 4-7). 다음 실행에 바로 열지 않는다.
 */
export async function closeToList() {
  markClosing("list");
  forgetLastOpened();
  await pushBeforeLeave(2500);
  stopOnlineSync();
  await within(closeOnlineSpace(), 5000);
  const p = useAppStore.getState().platform;
  await Promise.allSettled([destroyChildWindows(), p?.cabi.closeAll()]);
  location.reload();
}

/** 시험·진단용 */
export function resetOnlineSpaces() {
  spaces = null;
  set({ ownerId: null, email: null, list: null, offline: false, error: null, busy: null, current: null });
}
