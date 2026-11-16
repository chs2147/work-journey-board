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
import { flushAll, refreshImportant, refreshTags, reload } from "../board/boardStore";
import { flushNote, reloadNote } from "../note/noteStore";
import { flushDraft } from "../summary/summaryStore";
import { cabiWindowsOpen, flushCabiWindows } from "../cabinet/cabiService";
import { load as loadKanban, useKanban } from "../kanban/kanbanStore";
import { loadInsights, useInsights } from "../insights/insightsStore";
import { useUniverse } from "../universe/universeStore";
import { ONLINE_ROOT, rawJournalDriver, showClosingOverlay } from "../../platform/onlinePlatform";
import { useAppStore } from "../common/appStore";
import { STR } from "../../shared/strings";

export const PUSH_DELAY_MS = 1000;
/** 받기 간격: 창이 활성일 때 30초에서 시작, 받을 것이 없으면 두 배씩 최대 5분. 고치거나 받으면 다시 30초(E+, 비용) */
export const PULL_EVERY_MS = 30_000;
export const PULL_MAX_MS = 5 * 60_000;
/** 창으로 돌아올 때 받기 — 바로 전에 받았으면(10초 안) 건너뜀 */
export const FOCUS_GAP_MS = 10_000;

interface State {
  status: SyncStatus;
  /** 동기화를 실제로 돌린 횟수(시험·진단용 — 화면 글에는 쓰지 않음) */
  runs: number;
  /** 받은 변경을 화면만 새로 고쳐 반영한 횟수(시험·진단용) */
  refreshed: number;
  /** 지금 받기 간격(ms, 시험·진단용) */
  pullDelay: number;
  /** 닫는 중(앱 종료·목록으로) — 화면을 막는다 */
  closing: "exit" | "list" | null;
  /** 받아서 적용했지만 화면에 아직 반영하지 않은 기록 수 */
  received: number;
  conflicts: ConflictItem[] | null;
}
export const useOnlineSync = create<State>(() => ({
  status: { phase: "idle", pending: 0, conflicts: 0, lastSyncedAt: null, error: null },
  runs: 0,
  refreshed: 0,
  pullDelay: 30_000,
  closing: null,
  received: 0,
  conflicts: null,
}));

let engine: SpaceSync | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pullTimer: ReturnType<typeof setTimeout> | null = null;
let pullDelay = PULL_EVERY_MS;
let lastPull = 0;
function schedulePull() {
  if (pullTimer) clearTimeout(pullTimer);
  pullTimer = setTimeout(() => {
    pullTimer = null;
    if (!engine) return;
    if (document.hasFocus()) void run();
    else schedulePull(); // 창이 비활성이면 받지 않고 다음 차례만
  }, pullDelay);
  useOnlineSync.setState({ pullDelay });
}
const editing = () => {
  const a = document.activeElement as HTMLElement | null;
  return !!a && (a.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(a.tagName));
};

/**
 * 화면에 아직 저장 안 된 입력(칸·메모·요약 초안·별도 창)을 일지에 먼저 — 받기 전에 대기열에 들어가 있어야
 * 받은 값이 그 위를 덮지 않고(엔진은 대기열에 있는 기록에는 받은 값을 바로 적용하지 않음) 충돌 규칙을 탄다
 */
async function flushUi() {
  await flushAll().catch(() => undefined);
  await flushDraft().catch(() => undefined);
  await flushNote().catch(() => undefined);
  await flushCabiWindows().catch(() => undefined);
}

async function run(opts: { pull?: boolean } = {}) {
  if (!engine || !onlineJournal()) return;
  useOnlineSync.setState((s) => ({ runs: s.runs + 1 }));
  const pulling = opts.pull !== false;
  if (pulling) await flushUi();
  const got = await engine.syncNow(opts);
  if (pulling) {
    lastPull = Date.now();
    // 받을 것이 없으면 간격을 늘리고, 받았으면 처음 간격으로
    pullDelay = got > 0 ? PULL_EVERY_MS : Math.min(pullDelay * 2, PULL_MAX_MS);
    if (engine) schedulePull();
  }
  if (got > 0) {
    const received = useOnlineSync.getState().received + got;
    // 입력 중이거나 별도 창(노트·메모보드)이 열려 있으면 띠의 [화면 새로 고침]으로 미룬다
    if (editing() || (await cabiWindowsOpen())) useOnlineSync.setState({ received });
    else await applyReceived();
  }
  if (useOnlineSync.getState().conflicts) await loadConflicts();
}
/**
 * 받은 변경을 화면에 반영(E+, docs/v2-design/93). 데이터는 이미 이 기기 일지에 들어가 있으므로 보고 있는 화면만 다시 읽는다
 * (가져오기 뒤와 같은 길 — 보드·메모·중요 업무·태그, 열려 있으면 칸반·인사이트). 일지를 다시 열지 않아 깜박임·입력 끊김이 없다.
 * Universe를 보고 있거나 별도 창(노트·메모보드)이 열려 있으면 예전처럼 일지를 같은 길로 다시 연다(별도 창은 저장 후 닫힘).
 */
export async function applyReceived() {
  useOnlineSync.setState({ received: 0 });
  if (useUniverse.getState().open || (await cabiWindowsOpen())) {
    await reloadOnlineSpace();
    return;
  }
  await flushUi();
  await reload();
  await reloadNote();
  await refreshImportant();
  await refreshTags();
  if (useKanban.getState().open) await loadKanban();
  if (useInsights.getState().open) await loadInsights();
  useOnlineSync.setState((s) => ({ refreshed: s.refreshed + 1 }));
}

/** "동기화 중…"은 0.6초 넘게 걸릴 때만 보인다(짧은 동기화마다 띠가 깜박이지 않게 — E-3 실기) */
const SYNCING_SHOW_MS = 600;
let syncingTimer: ReturnType<typeof setTimeout> | null = null;
function showStatus(status: SyncStatus) {
  if (syncingTimer) clearTimeout(syncingTimer);
  syncingTimer = null;
  if (status.phase === "syncing") {
    syncingTimer = setTimeout(() => {
      syncingTimer = null;
      useOnlineSync.setState({ status });
    }, SYNCING_SHOW_MS);
    return;
  }
  useOnlineSync.setState({ status });
}

export function startOnlineSync(workspaceId: string, transport: SyncTransport) {
  stopOnlineSync();
  engine = createSpaceSync({
    workspaceId,
    transport,
    // 엔진은 안쪽 드라이버로 쓴다 — 엔진 자신의 쓰기가 "앱이 고침" 신호(보내기 예약)를 내지 않게
    // 지금 열린 일지가 이 공간의 이 기기 일지일 때만(다른 일지로 바뀌었으면 손대지 않음 — CLAUDE.md 4-7)
    journal: () => {
      const st = useAppStore.getState().journal;
      if (st.state !== "ready" || st.dataDir !== `${ONLINE_ROOT}/${workspaceId}`) return null;
      const j = onlineJournal();
      return j && { driver: rawJournalDriver(j.driver), exclusive: j.exclusive };
    },
    randomUUID: () => crypto.randomUUID(),
    onStatus: showStatus,
  });
  pullDelay = PULL_EVERY_MS;
  lastPull = 0;
  // 다른 공간으로 바꾼 뒤에도 이전 공간의 받은 수·충돌 목록이 남지 않게
  useOnlineSync.setState({ received: 0, conflicts: null });
  globalThis.addEventListener?.("focus", onFocus);
  // 앱 닫기(플랫폼 쪽)가 가져오기 없이 바로 멈출 수 있게
  (globalThis as { __wjbStopOnlineSync?: () => void }).__wjbStopOnlineSync = stopOnlineSync;
  void engine.refresh().then(() => run());
}
const onFocus = () => {
  if (Date.now() - lastPull >= FOCUS_GAP_MS) void run();
};
export function stopOnlineSync() {
  if (pushTimer) clearTimeout(pushTimer);
  if (pullTimer) clearTimeout(pullTimer);
  pushTimer = pullTimer = null;
  globalThis.removeEventListener?.("focus", onFocus);
  if (syncingTimer) clearTimeout(syncingTimer);
  syncingTimer = null;
  engine = null;
}
/** 이 기기 일지에 쓰기가 있을 때 — 약 1초 묶어 보내기 */
export function schedulePush() {
  // 고치는 중이면 받기도 다시 자주(다른 기기와 함께 쓰는 중일 가능성)
  if (pullDelay !== PULL_EVERY_MS) {
    pullDelay = PULL_EVERY_MS;
    if (engine) schedulePull();
  }
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    // 고친 뒤에는 보내기만(받기는 주기·창 복귀·[지금 동기화]) — 서버 호출 수를 줄인다
    void engine?.refresh().then(() => run({ pull: false }));
  }, PUSH_DELAY_MS);
}
export const syncNow = () => run();
/** 다른 공간으로 바꾸기·로그아웃 전: 입력을 저장하고 보낼 변경을 보낸다(최대 limit ms — 못 보내면 이 기기 사본에 남아 다음에 이어서) */
export async function pushBeforeLeave(limit = 4000) {
  if (!engine) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = null;
  await flushUi();
  const e = engine;
  await Promise.race([
    e
      .refresh()
      .then(() => run({ pull: false }))
      .catch(() => undefined),
    new Promise((r) => setTimeout(r, limit)),
  ]);
}

/** 앱을 닫거나 [목록으로] 중 — 화면을 막고 "저장하고 닫는 중"을 보인다 */
export function markClosing(kind: "exit" | "list" | "signOut") {
  useOnlineSync.setState({ closing: kind === "exit" ? "exit" : "list" });
  const Y = STR.onlineSpaces.sync;
  showClosingOverlay(kind === "exit" ? Y.closingExit : kind === "signOut" ? Y.closingSignOut : Y.closingList);
}

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
