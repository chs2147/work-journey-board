// 이 계정의 온라인 공간 목록·지금 연 공간(docs/v2-design/95 UX-3). 레일 공간 메뉴·Preview 첫 화면이 함께 쓴다.
// 계정이 바뀌면 목록을 바로 비우고 그 계정 것만 다시 받는다(94 실기 의견: 이전 계정 목록이 화면 전환 뒤에야 빠짐).
// 공간 열기·바꾸기는 일지 전환과 같은 한 길(appController.switchOnlineSpace, CLAUDE.md 4-7).
import { create } from "zustand";
import { isTauri } from "@tauri-apps/api/core";
import {
  loadPreviewOnline,
  loadPreviewSpaces,
  setPlatformOverride,
  type OnlineSpaceInfo,
  type Platform,
  type PreviewSpaces,
} from "../../platform";
import { createOnlinePlatform, destroyChildWindows, within } from "../../platform/onlinePlatform";
import { ensureSpaceJournal, upgradeSyncTables, type CachedHeaderLike } from "../../preview/spaceJournal";
import { createSpaceSync } from "../../preview/spaceSync";
import type { SqlDriver } from "../../data/driver";
import { JournalRepository } from "../../data/repository";
import { hideClosingOverlay, showClosingOverlay } from "../common/closingOverlay";
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
  /** G-1 통합 앱: 앱 안에서 만들기 대화상자(Preview는 첫 화면에서) */
  creating: boolean;
}
export const useOnlineSpaces = create<State>(() => ({
  ownerId: null,
  email: null,
  list: null,
  offline: false,
  error: null,
  busy: null,
  current: null,
  creating: false,
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
  publishedLooks.clear();
  listRequest++;
  set({ ownerId, email, list: null, offline: false, error: null });
  if (ownerId) void refreshSpaces();
}

let listRequest = 0;
const publishedLooks = new Map<string, Pick<WorkspaceMeta, "name" | "color" | "icon">>();

export function rememberPublishedLook(
  owner: string,
  id: string,
  look: Pick<WorkspaceMeta, "name" | "color" | "icon"> | null,
) {
  if (!look || get().ownerId !== owner) return;
  publishedLooks.set(id, look);
}

export async function refreshSpaces() {
  const owner = get().ownerId;
  if (!owner) return;
  const request = ++listRequest;
  set({ error: null });
  try {
    const r = await (await api()).list();
    if (get().ownerId !== owner || request !== listRequest) return;
    const list = r.workspaces.map((space) => {
      const pending = publishedLooks.get(space.workspaceId);
      if (metaOf(space)) {
        publishedLooks.delete(space.workspaceId);
        return space;
      }
      return pending ? { ...space, workspace: pending } : space;
    });
    set({ list, offline: !!r.offline });
  } catch (e) {
    if (get().ownerId !== owner || request !== listRequest) return;
    // 받지 못했으면 이전 목록을 남기지 않는다(다른 계정의 목록이 보이지 않게)
    set({ list: null, error: errText(e) });
  }
}

/** 열 때 첫 동기화를 기다리는 최대 시간(2026-11-16 사용자 결정 10초) — 넘으면 이 기기 내용으로 열고 뒤에서 이어서 */
export const FIRST_SYNC_MS = 10_000;

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
  let meta = metaOf(w);
  try {
    await upgradeSyncTables(d, head.assets, Number(head.header.sourceSchema));
    // 첫 동기화(실기: 다른 기기에서 고친 것이 열 때 바로 보이지 않고, 이 기기에서 고친 뒤에야 충돌로 나타남):
    // 화면을 그리기 전에 이 기기 일지에서 받기 → 보내기를 한 번 끝낸다. 서버에 닿지 못하면 받아 둔 내용으로 연다.
    // 연결이 불안정해 FIRST_SYNC_MS 안에 끝나지 않으면 기다리지 않고 연다 — 이 엔진은 일지에서 손을 떼고(늦게 온 응답도 쓰지 않음)
    // 이어서는 앱의 동기화가 맡는다(보내던 묶음은 pendingPush로 같은 번호 재전송 — 중복 적용 없음)
    let abandoned = false;
    // 손을 뗀 뒤에는 이 손잡이로 어떤 읽기·쓰기도 하지 않는다(실앱 손잡이는 공간 ID로 연결을 찾으므로, 앱이 다시 연 연결에 늦게 쓰지 않게)
    const gone = () => Promise.reject(new Error("SYNC_JOURNAL_CLOSED"));
    const guarded: SqlDriver = {
      label: d.label,
      select: (q, p) => (abandoned ? gone() : d.select(q, p)),
      execute: (q, p) => (abandoned ? gone() : d.execute(q, p)),
      batch: (st) => (abandoned ? gone() : d.batch(st)),
      close: async () => undefined,
    };
    const first = createSpaceSync({
      workspaceId: w.workspaceId,
      transport: sp.transport,
      journal: () => (abandoned ? null : { driver: guarded, exclusive: (work) => work() }),
      randomUUID: () => crypto.randomUUID(),
    });
    const done = await Promise.race([
      first
        .syncNow()
        .catch(() => 0)
        .then(() => true),
      new Promise<false>((r) => setTimeout(() => r(false), FIRST_SYNC_MS)),
    ]);
    if (!done) abandoned = true;
    const settings = await new JournalRepository(d, () => new Date()).getSettings().catch(() => null);
    const local = settings?.workspace;
    if (local) meta = { name: local.name, color: local.color, icon: local.icon };
  } finally {
    await d.close();
  }
  // 실앱: 업무노트·메모보드·파일 목록을 정식판과 같은 별도 OS 창으로(Tauri 창 다리)
  const native = isTauri() ? (await import("../../platform/tauri")).tauriPlatform : null;
  const platform = createOnlinePlatform({
    nativeCabinet: native ?? undefined,
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
    opened: { workspaceId: w.workspaceId, label: when(w.createdAt), stale: sync.stale, meta },
  };
}

/**
 * 온라인 공간 열기. 아무 공간도 안 열렸으면 플랫폼을 바꿔 두고(앱 화면이 그 플랫폼으로 시작),
 * 이미 열려 있으면 보낼 변경을 먼저 보내고 한 길로 바꾼다. 실패하면 지금 공간은 그대로(새 공간 준비 단계에서 실패).
 */
export async function openOnlineSpace(w: OnlineSpaceInfo): Promise<boolean> {
  const cur = get().current;
  if (cur?.workspaceId === w.workspaceId || get().busy) return true;
  // 앱 화면이 이미 돌고 있으면(온라인 공간, 또는 G-1 통합 앱의 이 PC 공간) 한 길로 바꾼다
  const running = useAppStore.getState().platform !== null;
  set({ busy: w.workspaceId, error: null });
  // 열고 첫 동기화가 끝날 때까지 화면을 막는다(받기 전에 고치면 충돌이 되므로)
  showClosingOverlay(STR.onlineSpaces.sync.opening);
  try {
    const { platform, opened } = await prepare(w);
    const sp = await api();
    if (cur || running) {
      if (cur) {
        await pushBeforeLeave();
        stopOnlineSync();
      }
      if (!(await switchOnlineSpace(platform, setPlatformOverride, { leavingLocal: !cur })))
        throw new Error("JOURNAL_MISSING");
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
  } finally {
    hideClosingOverlay();
  }
}

/**
 * G-1 통합 앱(docs/v2-design/98): 열린 온라인 공간 → 이 PC 공간(dir). 보낼 변경을 보내고(못 보내면 이 기기 사본에 남음)
 * 동기화를 멈춘 뒤 한 길(appController.switchOnlineSpace)로 이 PC 플랫폼·그 폴더를 연다.
 */
export async function leaveToLocal(base: Platform, dir: string): Promise<boolean> {
  if (get().busy) return false;
  set({ busy: dir, error: null });
  showClosingOverlay(STR.onlineSpaces.sync.toLocal);
  try {
    if (get().current) {
      await pushBeforeLeave(2500);
      stopOnlineSync();
    }
    set({ current: null });
    const ok = await switchOnlineSpace(base, setPlatformOverride, { dataDir: dir });
    return ok;
  } finally {
    set({ busy: null });
    hideClosingOverlay();
  }
}

let unified = false;
/** G-1 통합 앱(DEV)이면 true — 만들기는 앱 안 대화상자, [목록으로]는 없음 */
export function setUnified(v: boolean) {
  unified = v;
}
export const isUnified = () => unified;
/** [온라인 워크스페이스 만들기…] */
export function startCreate() {
  if (unified) set({ creating: true });
  else void closeToList({ create: true });
}
export const endCreate = () => set({ creating: false });

let leaveHook: (() => Promise<void>) | null = null;
/** 로그아웃으로 창을 새로 부르기 직전(통합 앱: 마지막 공간 = 이 PC) */
export function setLeaveHook(h: (() => Promise<void>) | null) {
  leaveHook = h;
}

/** 지금 공간의 이름·색·아이콘을 고친 뒤(설정) — 레일·메뉴에 바로. 서버 목록은 보낸 뒤 다음 목록에서 같은 값 */
export function patchCurrentMeta(meta: NonNullable<OpenedSpace["meta"]>) {
  const cur = get().current;
  if (!cur) return;
  set({
    current: { ...cur, meta },
    list:
      get().list?.map((w) => (w.workspaceId === cur.workspaceId ? { ...w, workspace: { ...meta } } : w)) ??
      null,
  });
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
export async function closeToList(opts: { create?: boolean } = {}) {
  if (opts.create) requestCreate();
  markClosing("list");
  forgetLastOpened();
  await pushBeforeLeave(2500);
  stopOnlineSync();
  await within(closeOnlineSpace(), 5000);
  const p = useAppStore.getState().platform;
  await Promise.allSettled([destroyChildWindows(), p?.cabi.closeAll()]);
  location.reload();
}

/**
 * 로그아웃(U6): 열린 온라인 공간의 보낼 변경을 보내고(못 보내면 이 기기 사본에 남아 다음 로그인 때 이어서) 저장 → 일지 닫기(한 길) →
 * 로그아웃 → 창을 새로 불러 첫 화면으로. 다음 실행에 그 공간을 바로 열지 않는다.
 */
export async function signOutFromSpace(signOut: () => Promise<unknown>) {
  markClosing("signOut");
  forgetLastOpened();
  await pushBeforeLeave(4000);
  stopOnlineSync();
  await within(closeOnlineSpace(), 5000);
  const p = useAppStore.getState().platform;
  await Promise.allSettled([destroyChildWindows(), p?.cabi.closeAll()]);
  await within(signOut(), 5000);
  if (leaveHook) await within(leaveHook(), 2000);
  location.reload();
}

/**
 * G-5(docs/v2-design/100): 공간을 서버에서 지운다(소유자). 지금 연 공간은 지우지 않는다(다른 공간으로 바꾼 뒤).
 * 서버가 받으면 이 기기 사본도 지우고 목록을 새로 받는다. 실패하면 오류 글(아무것도 지우지 않음).
 */
export async function deleteSpaceOnServer(w: OnlineSpaceInfo): Promise<string | null> {
  if (get().current?.workspaceId === w.workspaceId) return STR.onlineSpaces.remove.openNow;
  try {
    await (await loadPreviewOnline()).account("delete_space", { workspaceId: w.workspaceId });
  } catch (e) {
    return errText(e);
  }
  await (await api()).remove(w.workspaceId).catch(() => undefined);
  if (lastOpened(get().ownerId ?? "") === w.workspaceId) forgetLastOpened();
  await refreshSpaces();
  return null;
}

/**
 * G-5: 내 계정 삭제 — 서버가 받으면 이 기기의 온라인 공간 사본을 모두 지우고 로그아웃(연 공간은 보내고 닫은 뒤 그 사본까지).
 * 이 PC(로컬) 공간은 건드리지 않는다.
 */
export async function deleteAccountAndSignOut(inSpace: boolean): Promise<string | null> {
  const online = await loadPreviewOnline();
  try {
    await online.account("delete_account", {});
  } catch (e) {
    return errText(e);
  }
  const sp = await api();
  const keep = get().current?.workspaceId;
  for (const w of get().list ?? [])
    if (w.workspaceId !== keep) await sp.remove(w.workspaceId).catch(() => undefined);
  // 연 공간은 보내고 닫은 뒤(일지를 닫은 다음) 그 사본도 지운다
  if (inSpace)
    await signOutFromSpace(async () => {
      await online.signOut();
      if (keep) await sp.remove(keep).catch(() => undefined);
    });
  else {
    await online.signOut().catch(() => undefined);
    location.reload();
  }
  return null;
}

/** 첫 화면에서 만들기 대화상자를 바로 열기(창을 새로 부르는 사이에 남기는 한 번짜리 표시 — 탭마다, 없어도 동작) */
const CREATE = "wjb.preview.openCreate";
function requestCreate() {
  try {
    sessionStorage.setItem(CREATE, "1");
  } catch {
    /* 못 쓰면 첫 화면에서 직접 */
  }
}
export function takeCreateRequest(): boolean {
  try {
    const v = sessionStorage.getItem(CREATE) === "1";
    sessionStorage.removeItem(CREATE);
    return v;
  } catch {
    return false;
  }
}

/** 시험·진단용 */
export function resetOnlineSpaces() {
  spaces = null;
  publishedLooks.clear();
  listRequest++;
  set({
    ownerId: null,
    email: null,
    list: null,
    offline: false,
    error: null,
    busy: null,
    current: null,
    creating: false,
  });
}
