// E-3·E-5 열린 온라인 공간의 동기화 조정(Connected Preview, docs/v2-design/91).
// 시점(88문서 E3 추천안, 개발 검증용): 고친 뒤 약 1초 묶어 보내기 + 창이 활성일 때 30초마다 · 창으로 돌아올 때 · [지금 동기화].
// 다른 기기 변경을 이 기기 일지에 적용하면 화면을 새로(입력 중이면 띠의 [화면 새로 고침]으로 미룸).
import { create } from "zustand";
import {
  createSpaceSync,
  type ConflictItem,
  type Resolution,
  type SpaceSync,
  type SyncStatus,
  type SyncTransport,
} from "../../preview/spaceSync";
import { onlineJournal, reloadOnlineSpace } from "../common/appController";

export const PUSH_DELAY_MS = 1000;
export const PULL_EVERY_MS = 30_000;

interface State {
  status: SyncStatus;
  /** 받아서 적용했지만 화면에 아직 반영하지 않은 기록 수 */
  received: number;
  conflicts: ConflictItem[] | null;
}
export const useOnlineSync = create<State>(() => ({
  status: { phase: "idle", pending: 0, conflicts: 0, lastSyncedAt: null, error: null },
  received: 0,
  conflicts: null,
}));

let engine: SpaceSync | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pullTimer: ReturnType<typeof setInterval> | null = null;
const editing = () => {
  const a = document.activeElement as HTMLElement | null;
  return !!a && (a.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(a.tagName));
};

async function run() {
  if (!engine || !onlineJournal()) return;
  const got = await engine.syncNow();
  if (got > 0) {
    const received = useOnlineSync.getState().received + got;
    if (editing()) useOnlineSync.setState({ received });
    else await applyReceived();
  }
  if (useOnlineSync.getState().conflicts) await loadConflicts();
}
/** 받은 변경을 화면에 반영(일지를 같은 길로 다시 연다) */
export async function applyReceived() {
  useOnlineSync.setState({ received: 0 });
  await reloadOnlineSpace();
}

export function startOnlineSync(workspaceId: string, transport: SyncTransport) {
  stopOnlineSync();
  engine = createSpaceSync({
    workspaceId,
    transport,
    journal: onlineJournal,
    randomUUID: () => crypto.randomUUID(),
    onStatus: (status) => useOnlineSync.setState({ status }),
  });
  pullTimer = setInterval(() => {
    if (document.hasFocus()) void run();
  }, PULL_EVERY_MS);
  globalThis.addEventListener?.("focus", onFocus);
  void engine.refresh().then(run);
}
const onFocus = () => void run();
export function stopOnlineSync() {
  if (pushTimer) clearTimeout(pushTimer);
  if (pullTimer) clearInterval(pullTimer);
  pushTimer = pullTimer = null;
  globalThis.removeEventListener?.("focus", onFocus);
  engine = null;
}
/** 이 기기 일지에 쓰기가 있을 때 — 약 1초 묶어 보내기 */
export function schedulePush() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void engine?.refresh().then(run);
  }, PUSH_DELAY_MS);
}
export const syncNow = () => run();

export async function loadConflicts() {
  if (!engine) return;
  useOnlineSync.setState({ conflicts: await engine.conflicts() });
}
export function closeConflicts() {
  useOnlineSync.setState({ conflicts: null });
}
export async function resolveConflict(c: ConflictItem, choice: Resolution) {
  if (!engine) return;
  await engine.resolve(c.table, c.key, choice);
  await engine.refresh();
  await loadConflicts();
  // 고른 결과를 화면에 반영하고 보낸다
  await applyReceived();
  await run();
}
