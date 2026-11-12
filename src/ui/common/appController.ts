import { flushCabiWindows, closeCabiWindows } from "../cabinet/cabiService";
// 앱 흐름(overview 10-8·10-10): 시작 → 첫 실행 / 저장 폴더 없음 / 파일 이상 / 보드, 종료 백업, 저장 위치 전환·옮기기.
import { JournalRepository } from "../../data/repository";
import {
  runMirrorBackup,
  BACKUP_DIR,
  backupExclusive,
  previewBackupCleanup,
  executeBackupCleanup,
} from "../../data/backup";
import {
  sameCleanupPlan,
  normalizeBackupPolicy,
  type BackupPolicy,
  type CleanupPlan,
  type BackupControl,
} from "../../data/backupPolicy";
import { inspectBackup, manualBackup } from "../../data/session";
import {
  integrityCheck,
  LATEST_SCHEMA_VERSION,
  NewerSchemaError,
  readSchemaVersion,
} from "../../data/migrate";
import {
  backupIfFirstToday,
  backupOnExit,
  copyJournalTo,
  FolderMissingError,
  IntegrityError,
  journalPath,
  openJournalAt,
  restoreFromBackup,
} from "../../data/session";
import type { SqlDriver } from "../../data/driver";
import { loadPlatform, type Platform } from "../../platform";
import { STR } from "../../shared/strings";
import { applyTheme, readStoredTheme, storeTheme, type ThemePref } from "../../shared/theme";
import {
  addCategory,
  flushAll,
  focusStartCell,
  detachBoard,
  init as initBoard,
  reload,
  setAddOpen,
  setViewMode,
  toast,
  useBoard,
} from "../board/boardStore";
import { detachSummary, flushDraft, initSummary } from "../summary/summaryStore";
import { detachNote, finishNote, flushNote, initNote, useNote } from "../note/noteStore";
import { detachInsights, initInsights, useInsights } from "../insights/insightsStore";
import { detachKanban, initKanban, openKanban } from "../kanban/kanbanStore";
import { restoreCabinet, shutdownCabinet, suspendCabinet } from "../cabinet/cabinetStore";
import { closeInsights } from "../insights/insightsStore";
import { today as todayOf } from "../../domain/week";
import {
  FIRST_WORKSPACE,
  QUIET_PURPOSES,
  baseName,
  canRemove,
  cleanName,
  moveEntry,
  nextWorkspaceColor,
  readEntries,
  reconcile,
  removeEntry,
  sameDir,
  upsertEntry,
  type WorkspaceEntry,
  type WorkspaceIcon,
  type WorkspaceMeta,
  type WorkspacePurpose,
} from "../../domain/workspace";
import type { CategoryColorKey } from "../../shared/palette";
import type { SettingsCategory } from "../../data/settings";
import { classifyFolder } from "../../data/session";
import { useAppStore, type JournalStatus } from "./appStore";

const set = useAppStore.setState;
const get = useAppStore.getState;

function platform(): Platform {
  const p = get().platform;
  if (!p) throw new Error("플랫폼이 준비되지 않았습니다");
  return p;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function start() {
  const p = await loadPlatform();
  set({ platform: p });
  p.onExit(onExit);
  // 창이 다시 활성화되면 열린 일지를 다른 PC의 최신 앱이 올렸는지 확인(improve-v22-spec 2-1 A2)
  globalThis.addEventListener?.("focus", () => void lockIfIncompatible());
  const config = await p.loadConfig();
  // 테마 정본 = config.json, 없으면 이 창이 이미 적용한 사본(public/theme-early.js).
  // 처음 설치(설정 없음) = 시그니처, 이미 쓰던 사용자가 테마를 고른 적 없으면 = 시스템 설정 그대로(release-phase2-spec 1절)
  adoptTheme(config ? (config.theme ?? readStoredTheme("system")) : readStoredTheme());
  if (!config) return set({ journal: { state: "first-run" } });
  set({ workspaces: readEntries(config) });
  p.splash?.status(STR.splash.opening);
  await openAt(config.dataDir);
}

/** 대기 중인 저장(보드 칸·메모 + 주간 요약 수정본)을 끝낸다 */
async function flushPending() {
  await flushCabiWindows();
  await flushAll();
  await flushDraft();
  await flushNote();
}

// ── 자동 백업(data-spec 7-2, optimize-1031-plan B1~B3·B6·B7) ─────────────
/** 주기 백업을 살펴보는 간격 */
const PERIODIC_CHECK_MS = 5 * 60_000;
/** 마지막 백업 때의 쓰기 횟수·시각 — 그 뒤로 바뀐 게 없으면 주기·종료 백업을 건너뛴다 */
let lastBackup = { writes: -1, at: 0 };
let periodicTimer: ReturnType<typeof setInterval> | null = null;
let backupRunning = false;

/** 마지막 키·마우스 입력 시각 — 자동 백업은 입력이 쉬는 틈에만 시작한다(백업 동안 저장이 기다리므로 입력 흐름을 막지 않게) */
let lastInputAt = 0;
const INPUT_IDLE_MS = 3000;
/** 시작 백업이 입력 쉬는 틈을 기다리는 최대 시간 */
const START_BACKUP_MAX_WAIT_MS = 60_000;
if (typeof window !== "undefined") {
  const mark = () => (lastInputAt = Date.now());
  window.addEventListener("keydown", mark, true);
  window.addEventListener("pointerdown", mark, true);
}
const inputIdle = () => Date.now() - lastInputAt >= INPUT_IDLE_MS;

/** 입력이 INPUT_IDLE_MS 쉴 때까지(최대 maxMs) 기다린다 */
async function waitInputIdle(maxMs: number) {
  const until = Date.now() + maxMs;
  while (!inputIdle() && Date.now() < until) await new Promise((r) => setTimeout(r, 500));
}

type BackupKind = "start" | "periodic" | "exit";

/**
 * 자동 백업 한 번: start = 그날 첫 실행이면, periodic·exit = 그날 일일 사본 덮어쓰기(+ 그 달 첫 월간·롤링).
 * 도는 동안 저장소 쓰기는 기다린다(repo.exclusive). 보조 위치가 정해져 있으면 거기에도 하나 더(B6).
 * 그 달 월간 사본을 만들었으면 일지 전체 검사(B7). exit에서는 알릴 화면이 없어 실패를 삼킨다.
 */
let backupTasks: Promise<unknown> = Promise.resolve();
let closingJournal: SqlDriver | null = null;
async function backupTask<T>(work: () => Promise<T>): Promise<T> {
  const next = backupTasks.catch(() => undefined).then(work);
  backupTasks = next;
  return next;
}
async function readBackupControl(dir: string) {
  return (await platform().loadConfig())?.backupControlBy?.[dir] ?? { paused: false };
}
async function writeBackupControl(dir: string, control: BackupControl) {
  const p = platform(),
    c = await p.loadConfig();
  await p.saveConfig({ backupControlBy: { ...c?.backupControlBy, [dir]: control } });
}
export async function previewRetention(policy: BackupPolicy) {
  const j = get().journal;
  if (j.state !== "ready") throw new Error(STR.restore.notOpen);
  const dir = platform().join(j.dataDir, BACKUP_DIR);
  return backupTask(() =>
    backupExclusive(dir, () => previewBackupCleanup(platform().backupFs, dir, policy, platform().now())),
  );
}
export async function applyRetention(policy: BackupPolicy, expected: CleanupPlan) {
  const j = get().journal;
  if (j.state !== "ready") throw new Error(STR.restore.notOpen);
  const p = platform(),
    dir = p.join(j.dataDir, BACKUP_DIR),
    normalized = normalizeBackupPolicy(policy);
  if (expected.scope !== dir) throw new Error(STR.backupV13.scopeChanged);
  return backupTask(() =>
    j.repo.exclusiveWithSettings((save) =>
      backupExclusive(dir, async () => {
        if (get().journal !== j) throw new Error(STR.restore.notOpen);
        const fresh = await previewBackupCleanup(p.backupFs, dir, normalized, p.now());
        if (!sameCleanupPlan(expected, fresh)) return { changed: fresh };
        await save({ backup: normalized });
        let result: Awaited<ReturnType<typeof executeBackupCleanup>>;
        try {
          result = await executeBackupCleanup(p.backupFs, dir, fresh);
        } catch (e) {
          await writeBackupControl(j.dataDir, { paused: true });
          throw new Error(STR.backupV13.applyDeferred + String(e), { cause: e });
        }
        const lastCleanup = {
          at: p.now().toISOString(),
          deleted: result.deleted.length,
          failed: result.failed.length,
          freed: result.freed,
        };
        let recordingFailed = false;
        try {
          await writeBackupControl(j.dataDir, { paused: false, lastCleanup });
        } catch {
          recordingFailed = true;
        }
        return { result, recordingFailed };
      }),
    ),
  );
}
export async function manualBackupNow() {
  const j = get().journal;
  if (j.state !== "ready") throw new Error(STR.restore.notOpen);
  return backupTask(() =>
    j.repo.exclusive(() => manualBackup(platform(), j.driver, j.dataDir, platform().now())),
  );
}
async function autoBackup(kind: BackupKind): Promise<void> {
  const expected = get().journal;
  return backupTask(() => (get().journal === expected ? autoBackupWork(kind) : Promise.resolve()));
}
async function autoBackupWork(kind: BackupKind): Promise<void> {
  const j = get().journal;
  if (j.state !== "ready" || backupRunning || j.driver === closingJournal) return;
  if (kind !== "exit" && (await lockIfIncompatible())) return;
  const p = platform();
  backupRunning = true;
  if (kind !== "exit") set({ backingUp: true });
  try {
    const s = await j.repo.getSettings();
    const keep = {
      daily: s.backup.dailyKeep,
      monthly: s.backup.monthlyKeep,
      preserve: (await readBackupControl(j.dataDir)).paused,
    };
    const writes = j.repo.writeCount;
    const now = p.now();
    const result = await j.repo.exclusive(() =>
      kind === "start"
        ? backupIfFirstToday(p, j.driver, j.dataDir, now, keep)
        : backupOnExit(p, j.driver, j.dataDir, now, keep),
    );
    if (result) {
      const control = await readBackupControl(j.dataDir);
      if (!control.paused) {
        const dir = p.join(j.dataDir, BACKUP_DIR);
        const cleanup = await backupExclusive(dir, async () =>
          executeBackupCleanup(p.backupFs, dir, await previewBackupCleanup(p.backupFs, dir, s.backup, now)),
        );
        if (cleanup.deleted.length || cleanup.failed.length)
          await writeBackupControl(j.dataDir, {
            ...control,
            lastCleanup: {
              at: now.toISOString(),
              deleted: cleanup.deleted.length,
              failed: cleanup.failed.length,
              freed: cleanup.freed,
            },
          });
        if (cleanup.failed.length && kind !== "exit")
          toast(STR.backupV13.partial(cleanup.deleted.length, cleanup.failed.length));
      }
    }
    lastBackup = { writes, at: now.getTime() };
    const mirror = (await p.loadConfig())?.backupMirror;
    if (mirror && result) {
      try {
        const dir = mirrorDirFor(mirror);
        await j.repo.exclusive(async () =>
          runMirrorBackup(
            j.driver,
            p.backupFs,
            dir,
            now,
            p.verifyCopy,
            (await readBackupControl(j.dataDir)).paused,
          ),
        );
      } catch (e) {
        if (kind !== "exit") toast(STR.backupMore.mirrorFailed(errMsg(e)));
      }
    }
    if (result?.monthly && kind !== "exit" && !(await integrityCheck(j.driver)))
      onCorrupt(new Error("integrity_check"));
  } catch (e) {
    if (kind !== "exit") toast(STR.startBackupFailed(errMsg(e)));
  } finally {
    backupRunning = false;
    set({ backingUp: false });
  }
}

/** 주기 백업(B1): 마지막 백업 뒤 바뀐 게 있고 정한 시간이 지났으면, 저장이 끝난 틈에 */
async function periodicTick() {
  const j = get().journal;
  if (j.state !== "ready") return;
  const { periodicHours } = (await j.repo.getSettings()).backup;
  if (periodicHours <= 0 || j.repo.writeCount === lastBackup.writes) return;
  if (platform().now().getTime() - lastBackup.at < periodicHours * 3_600_000) return;
  if (useBoard.getState().saving > 0 || !inputIdle()) return; // 저장·입력 중이면 다음 차례에
  await autoBackup("periodic");
}

/**
 * 지금 일지와 화면 저장소의 연결을 모두 끊는다 — 일지를 닫기 직전(공간 전환·복원·파손)과 새 일지를 띄우기 직전.
 * 대기 저장은 부르는 쪽이 먼저 끝낸다(flushPending·finishNote). 끊은 뒤에는 어떤 쓰기도 이전·다음 일지에 가지 않는다(v1.8.1).
 */
function detachAll() {
  detachBoard();
  detachSummary();
  detachNote();
  detachInsights();
  detachKanban();
  for (const f of detachList()) f();
}

/**
 * appController를 가져다 쓰는 저장소(Universe·검색 등)가 자기 detach를 등록하는 곳 — 서로 가져오기 고리 없이 detachAll에 들어간다(CLAUDE.md 4-7).
 * 목록은 함수 선언(끌어올림)에 붙여 둔다 — 가져오기 고리에서 이 모듈 본문보다 먼저 불려도 안전하게.
 */
function detachList(): (() => void)[] {
  const holder = detachList as unknown as { fns?: (() => void)[] };
  return (holder.fns ??= []);
}
export function onDetach(f: () => void) {
  const l = detachList();
  if (!l.includes(f)) l.push(f);
}

function stopPeriodic() {
  if (periodicTimer) clearInterval(periodicTimer);
  periodicTimer = null;
}

/** 쓰는 도중 파일 파손으로 보이는 오류(B4) — 더 쓰지 않고 "데이터 파일 문제" 화면으로(복원 안내) */
function onCorrupt(e: unknown) {
  const j = get().journal;
  if (j.state !== "ready") return;
  console.error("데이터 파일 문제", e);
  stopPeriodic();
  detachAll();
  set({ journal: { state: "integrity", dataDir: j.dataDir, path: journalPath(platform(), j.dataDir) } });
  void backupTask(() => j.driver.close().catch(() => undefined));
}

/** 앱 종료 직전: 대기 중인 저장을 끝내고, 마지막 백업 뒤 바뀐 게 있으면 그날 일일 백업을 덮어쓴다(B3). 실패해도 창은 닫힌다. */
async function onExit() {
  await closeCabiWindows();
  // Cabinet: 열린 창 상태를 이 PC 설정에 남기고 폴더 창(별도 OS 창)을 닫는다(F5)
  await shutdownCabinet().catch(() => undefined);
  await flushPending().catch(() => undefined);
  await finishNote().catch(() => undefined);
  stopPeriodic();
  const j = get().journal;
  if (j.state !== "ready") return;
  if (j.repo.writeCount === lastBackup.writes) return;
  await autoBackup("exit");
}

/** 이미 연 드라이버로 보드를 띄운다 — 그날 첫 실행 백업은 보드를 띄운 뒤 뒤에서(B2). */
async function activate(driver: SqlDriver, dataDir: string) {
  const p = platform();
  stopPeriodic();
  detachAll(); // 이전 일지의 문서·예약 저장·그림이 새 일지에 섞이지 않게(v1.8.1)
  const repo = new JournalRepository(driver, () => p.now());
  repo.setCorruptHandler(onCorrupt);
  const control = await readBackupControl(dataDir);
  if (control.pendingPolicy) {
    await repo.updateSettings({ backup: control.pendingPolicy });
    await writeBackupControl(dataDir, { ...control, paused: false, pendingPolicy: undefined });
  }
  const [row] = await driver.select<{ v: string }>("SELECT sqlite_version() AS v");
  p.splash?.status(STR.splash.preparing);
  await initBoard(repo);
  await initSummary(repo);
  await initNote(repo);
  await initInsights(repo);
  await initKanban(repo);
  await syncWorkspace(repo, dataDir);
  set({ journal: { state: "ready", driver, repo, dataDir, sqliteVersion: row?.v ?? "?" } });
  closingJournal = null;
  lastBackup = { writes: repo.writeCount, at: p.now().getTime() };
  // 시작 화면(improve-v21-spec 8절) — 칸반이면 보드 자리에 칸반을 띄운다
  if ((await repo.getSettings()).ui.startView === "kanban") void openKanban();
  void restoreCabinet().catch(() => undefined);
  void waitInputIdle(START_BACKUP_MAX_WAIT_MS).then(() => {
    const current = get().journal;
    if (current.state === "ready" && current.repo === repo) return autoBackup("start");
  });
  periodicTimer = setInterval(() => void periodicTick().catch(() => undefined), PERIODIC_CHECK_MS);
}

/** 백업에서 복원(O5): 지금 일지를 닫고(대기 저장 마무리) → 보존 사본을 남기고 백업을 일지로 → 다시 연다. 실패하면 오류 글 */
export async function restoreBackup(
  name: string,
  expectedFingerprint?: string,
  expectedDataDir?: string,
): Promise<string | null> {
  const current = get().journal;
  const dir =
    expectedDataDir ??
    (current.state === "ready" || current.state === "integrity" ? current.dataDir : undefined);
  return backupTask(() => restoreBackupWork(name, expectedFingerprint, dir));
}
async function restoreBackupWork(
  name: string,
  expectedFingerprint?: string,
  expectedDataDir?: string,
): Promise<string | null> {
  const j = get().journal;
  const dataDir = j.state === "ready" || j.state === "integrity" ? j.dataDir : null;
  if (!dataDir || (j.state === "ready" && j.driver === closingJournal)) return STR.restore.notOpen;
  if (dataDir !== expectedDataDir) return STR.backupV13.scopeChanged;
  const p = platform();
  const checked = await inspectBackup(p, dataDir, name);
  if (!checked.ok) return checked.newer ? STR.restore.newer : STR.restore.bad;
  if (expectedFingerprint && checked.fingerprint !== expectedFingerprint) return STR.backupV13.previewChanged;
  const control = await readBackupControl(dataDir);
  const keepPolicy = j.state === "ready" ? (await j.repo.getSettings()).backup : undefined;
  await writeBackupControl(dataDir, { ...control, paused: true, pendingPolicy: keepPolicy });
  if (j.state === "ready") {
    try {
      await flushPending();
      await finishNote();
    } catch (e) {
      await writeBackupControl(dataDir, control);
      return errMsg(e);
    }
    stopPeriodic();
    set({ journal: { state: "loading" } });
    detachAll();
    await j.driver.close().catch(() => undefined);
  }
  let before: string;
  try {
    before = await restoreFromBackup(p, dataDir, name, p.now(), checked.fingerprint);
  } catch (e) {
    await openAt(dataDir);
    return errMsg(e);
  }
  set({ settingsOpen: false });
  if (await openAt(dataDir))
    toast(STR.restore.done(name), {
      label: STR.restore.undo,
      run: async () => {
        const e = await restoreBackup(before, undefined, dataDir);
        if (e) toast(e);
      },
    });
  return null;
}

function statusFor(e: unknown, dataDir: string): JournalStatus {
  if (e instanceof FolderMissingError) return { state: "missing", dataDir };
  if (e instanceof NewerSchemaError) return { state: "newer", dataDir, fileVersion: e.fileVersion };
  if (e instanceof IntegrityError) return { state: "integrity", dataDir, path: e.path };
  return { state: "error", message: errMsg(e) };
}

/**
 * 열려 있는 일지를 다른 PC(동기화 폴더)의 최신 버전 앱이 올렸는지(improve-v22-spec 2-1 A2) — 가벼운 읽기 1회.
 * 올렸으면 더 쓰지 않고 연결을 끊은 뒤 "앱 업데이트 필요" 화면으로. 돌려주는 값 = 잠갔는지.
 */
export async function lockIfIncompatible(): Promise<boolean> {
  const j = get().journal;
  if (j.state !== "ready" || j.driver === closingJournal) return false;
  let v: number;
  try {
    v = await readSchemaVersion(j.driver);
  } catch {
    return false;
  }
  if (v <= LATEST_SCHEMA_VERSION || get().journal !== j) return false;
  stopPeriodic();
  detachAll();
  await j.driver.close().catch(() => undefined);
  set({ journal: { state: "newer", dataDir: j.dataDir, fileVersion: v }, settingsOpen: false });
  return true;
}

/** 일지가 없어도(앱 업데이트 필요 화면 등) 새 버전 확인 창을 연다 */
async function openUpdateFromAnywhere() {
  const { checkNow, openUpdateDialog } = await import("../update/updateStore");
  await checkNow();
  openUpdateDialog();
}

/** 설정된 폴더의 일지를 연다. 실패하면 상황별 화면으로. */
export async function openAt(dataDir: string): Promise<boolean> {
  set({ journal: { state: "loading" } });
  try {
    const driver = await openJournalAt(platform(), dataDir, () => platform().now());
    await activate(driver, dataDir);
    return true;
  } catch (e) {
    set({ journal: statusFor(e, dataDir) });
    return false;
  }
}

/** 첫 실행·다른 일지 열기: 폴더를 만들고(없으면) 열어서 성공하면 설정에 저장. */
export async function openFolderAsJournal(dataDir: string): Promise<boolean> {
  await platform().ensureDir(dataDir);
  const ok = await openAt(dataDir);
  if (ok) {
    const had = await platform().loadConfig();
    // 첫 일지를 만들 때 지금 테마(처음 설치면 시그니처)를 함께 남긴다
    await platform().saveConfig(had?.theme ? { dataDir } : { dataDir, theme: get().theme });
  }
  return ok;
}

export function goFirstRun() {
  set({ journal: { state: "first-run" } });
}

/** 설정 화면(improve-1027v5-spec 1-2) — 보드 자리를 덮는다. 닫을 때 보드를 다시 읽는다(다시 시작한 업무·반복 수정 반영) */
export function setSettingsOpen(open: boolean) {
  const was = get().settingsOpen;
  if (open && get().journal.state !== "ready") return;
  set({ settingsOpen: open });
  if (was && !open) void reload();
}

/** 설정을 그 분류로 연다(워크스페이스 목록의 [관리…] 등) */
export async function openSettingsAt(cat: SettingsCategory) {
  const j = get().journal;
  if (j.state !== "ready") return;
  await j.repo.updateSettings({ ui: { settingsCategory: cat } }).catch(() => undefined);
  if (get().settingsOpen) {
    set({ settingsOpen: false });
    await new Promise((r) => setTimeout(r, 0)); // 설정 화면을 새로 띄워 그 분류부터
  }
  setSettingsOpen(true);
}

/** 설정에서 나가기(Esc·[← 보드로]·Ctrl+,) — 들어오기 전 화면(보드 또는 인사이트)으로 */
export function leaveSettings() {
  setSettingsOpen(false);
  if (!useInsights.getState().open) focusStartCell();
}

/** 화면 테마를 적용하고 사본·창 제목 표시줄을 맞춘다 */
function adoptTheme(pref: ThemePref) {
  applyTheme(pref);
  storeTheme(pref);
  set({ theme: pref });
  void platform()
    .setWindowTheme(pref)
    .catch(() => undefined);
}

/** 설정 › 화면 › 테마: 바로 적용하고 이 PC 설정(config.json)에 저장 */
export async function setTheme(pref: ThemePref) {
  adoptTheme(pref);
  await platform().saveConfig({ theme: pref });
}

async function closeCurrent() {
  const j = get().journal;
  await flushPending();
  await finishNote().catch(() => undefined);
  stopPeriodic();
  closingJournal = j.state === "ready" ? j.driver : null;
  detachAll();
  if (j.state === "ready") {
    await backupTasks.catch(() => undefined);
    await j.repo.exclusive(() => j.driver.close()).catch(() => undefined);
  }
}

/** 설정 > 저장 위치: 다른 폴더의 기존 일지로 전환(지금 일지는 그대로). 새 일지를 먼저 열어 보고 성공해야 바꾼다. */
export async function switchTo(dataDir: string): Promise<string | null> {
  const p = platform();
  await flushPending();
  let next: SqlDriver;
  try {
    next = await openJournalAt(p, dataDir, () => p.now());
  } catch (e) {
    return errMsg(e);
  }
  const cab = await suspendCabinet();
  await closeCurrent();
  await rememberCabinet(cab, dataDir);
  await p.saveConfig({ dataDir });
  await activate(next, dataDir);
  return null;
}

/** 설정 > 저장 위치: 지금 일지를 새 폴더로 옮긴다. 실패하면 기존 위치를 그대로 쓴다(overview 10-10). */
export async function moveTo(dataDir: string, copyBackups: boolean): Promise<string | null> {
  return backupTask(() => moveToWork(dataDir, copyBackups));
}
async function moveToWork(dataDir: string, copyBackups: boolean): Promise<string | null> {
  const j = get().journal;
  if (j.state !== "ready") return "일지가 열려 있지 않습니다";
  const p = platform();
  await flushPending();
  await finishNote().catch(() => undefined);
  let next: SqlDriver;
  try {
    await j.repo.exclusive(() => copyJournalTo(p, j.driver, j.dataDir, dataDir, copyBackups, p.now()));
    await writeBackupControl(dataDir, await readBackupControl(j.dataDir));
    next = await openJournalAt(p, dataDir, () => p.now());
  } catch (e) {
    return errMsg(e);
  }
  // 목록의 그 줄도 새 위치로(이름·색·아이콘은 그대로)
  const old = get().workspaces;
  await saveEntries(old.map((e) => (sameDir(e.dir, j.dataDir) ? { ...e, dir: dataDir } : e)));
  await p.saveConfig({ dataDir });
  stopPeriodic();
  detachAll();
  await j.driver.close().catch(() => undefined);
  await activate(next, dataDir);
  return null;
}

// ── 워크스페이스(multi-board-spec) ─────────────────────────────────────
/** 목록 저장: 화면 상태 + 이 PC 설정(config.json workspaces) */
async function saveEntries(list: WorkspaceEntry[]) {
  set({ workspaces: list });
  await platform().saveConfig({ workspaces: list });
}

/** 보조 백업 위치 안 이 공간의 자리(spec 6절): 처음부터 쓰던 공간은 바로 아래, 새로 만든 공간은 `<보조 위치>/<폴더 이름>` */
export function mirrorDirFor(mirror: string): string {
  const sub = currentWorkspace()?.mirrorSub;
  return sub ? platform().join(mirror, sub) : mirror;
}

/** 보조 백업 위치로 고를 수 없는 폴더인가 — 어느 공간의 저장 폴더·backups 폴더든(spec 6절) */
export function isWorkspaceFolder(path: string): boolean {
  const p = platform();
  return get().workspaces.some((e) => sameDir(path, e.dir) || sameDir(path, p.join(e.dir, "backups")));
}

/** 내보내기 파일 이름에 넣을 공간 이름 — 공간이 2개 이상일 때만(D8) */
export function workspaceLabel(): string | undefined {
  return get().workspaces.length > 1 ? currentWorkspace()?.name : undefined;
}

/** 지금 연 공간의 목록 줄 */
export function currentWorkspace(): WorkspaceEntry | null {
  const j = get().journal;
  if (j.state !== "ready") return null;
  return get().workspaces.find((e) => sameDir(e.dir, j.dataDir)) ?? null;
}

/** 창 제목: 공간이 2개 이상이면 `Work Journey Board — 개인`(spec 3-1) */
function applyWindowTitle(list: WorkspaceEntry[], name: string) {
  const title = list.length > 1 ? STR.workspace.windowTitle(STR.appName, name) : STR.appName;
  void platform()
    .setWindowTitle?.(title)
    .catch(() => undefined);
}

/**
 * 공간을 열 때: 일지의 이름·색·아이콘과 이 PC 목록 사본을 맞춘다(새것이 이김). 목록에 없던 폴더면 줄을 더한다.
 * 첫 일지(목록이 비어 있음)는 "회사 · 파랑 · 서류 가방"(지금까지 직장용으로 쓰던 일지).
 */
async function syncWorkspace(repo: JournalRepository, dataDir: string) {
  const list = get().workspaces;
  const found = list.find((e) => sameDir(e.dir, dataDir));
  const entry: WorkspaceEntry = found ?? {
    ...(list.length === 0
      ? FIRST_WORKSPACE
      : { name: baseName(dataDir), color: nextWorkspaceColor(list), icon: FIRST_WORKSPACE.icon }),
    updatedAt: 0,
    dir: dataDir,
  };
  const journalMeta = (await repo.getSettings()).workspace;
  const { meta, writeJournal } = reconcile(journalMeta, entry);
  if (writeJournal) await repo.updateSettings({ workspace: meta }).catch(() => undefined);
  const next = upsertEntry(list, { ...entry, ...meta, lastOpened: todayOf(platform().now()) });
  await saveEntries(next);
  applyWindowTitle(next, meta.name);
}

/** 떠나는 공간의 Cabinet 창 상태를 그 공간 몫으로 보관하고, 들어갈 공간의 것을 config.cabinet에 끼운다 */
async function rememberCabinet(leaving: { dir: string; cab: CabinetCfg } | CabinetCfg, nextDir: string) {
  const p = platform();
  const cfg = await p.loadConfig();
  const by = { ...(cfg?.cabinetBy ?? {}) };
  const j = get().journal;
  if ("cab" in leaving) by[leaving.dir] = leaving.cab;
  else if (j.state === "ready" || j.state === "integrity") by[j.dataDir] = leaving;
  const key = Object.keys(by).find((k) => sameDir(k, nextDir));
  await p.saveConfig({ cabinetBy: by, cabinet: (key && by[key]) || { open: false, windows: [] } });
}
type CabinetCfg = { open: boolean; windows: { id: string; sub: string }[] };

/**
 * 공간 전환(spec 3절): 지금 공간 저장·종료 백업·Cabinet 보관 → 다음 공간을 먼저 열어 보고 → 성공하면 바꾼다.
 * 다음 공간을 열 수 없으면 지금 공간을 그대로 두고 오류 글을 돌려준다(R2).
 */
export async function switchWorkspace(dir: string, opts: { quiet?: boolean } = {}): Promise<string | null> {
  const j = get().journal;
  const target = get().workspaces.find((e) => sameDir(e.dir, dir));
  set({ switcherOpen: false });
  if (j.state === "ready" && sameDir(j.dataDir, dir)) return null;
  const p = platform();
  const name = target?.name ?? baseName(dir);
  // 전환해도 보던 보기(주간/오늘)는 그대로(spec 3절) — 날짜는 다음 공간을 열면 오늘로
  const view = j.state === "ready" ? useBoard.getState().viewMode : null;
  let next: SqlDriver;
  if (j.state === "ready") {
    await flushPending();
    await finishNote().catch(() => undefined);
  }
  try {
    next = await openJournalAt(p, dir, () => p.now());
  } catch (e) {
    // 호환되지 않는 공간(improve-v22-spec 2-2): 지금 공간은 그대로 두고 업데이트를 안내
    if (e instanceof NewerSchemaError) {
      const m = STR.incompatible.switchRefused(name);
      toast(m, { label: STR.incompatible.checkUpdate, run: () => void openUpdateFromAnywhere() });
      return m;
    }
    const m = STR.workspace.openFailed(name, errMsg(e));
    toast(m);
    return m;
  }
  if (j.state === "ready") {
    stopPeriodic();
    // 다음 공간을 여는 동안 친 글까지 지금 공간에 저장하고 정리한 뒤 백업 → 연결 끊기 → 닫기(v1.8.1)
    await flushPending().catch(() => undefined);
    await finishNote().catch(() => undefined);
    if (j.repo.writeCount !== lastBackup.writes) await autoBackup("exit");
    const cab = await suspendCabinet();
    detachAll();
    await j.driver.close().catch(() => undefined);
    await rememberCabinet({ dir: j.dataDir, cab }, dir);
  } else await rememberCabinet({ open: false, windows: [] }, dir);
  await p.saveConfig({ dataDir: dir });
  set({ settingsOpen: false });
  closeInsights();
  await activate(next, dir);
  if (view) setViewMode(view);
  if (!opts.quiet) toast(STR.workspace.switched(currentWorkspace()?.name ?? name));
  focusStartCell();
  return null;
}

/** n번째 공간으로(Ctrl+Alt+n) */
export function switchWorkspaceAt(n: number) {
  const e = get().workspaces[n - 1];
  if (e) void switchWorkspace(e.dir);
}

/** 지금 공간의 이름·색·아이콘 바꾸기(다른 공간은 이 PC 사본만 — 그 공간을 열 때 일지에 반영, reconcile) */
export async function updateWorkspaceMeta(
  dir: string,
  patch: Partial<Pick<WorkspaceMeta, "name" | "color" | "icon">>,
): Promise<void> {
  const list = get().workspaces;
  const e = list.find((x) => sameDir(x.dir, dir));
  if (!e) return;
  const name = patch.name !== undefined ? cleanName(patch.name) || e.name : e.name;
  const meta: WorkspaceMeta = {
    name,
    color: patch.color ?? e.color,
    icon: patch.icon ?? e.icon,
    updatedAt: platform().now().getTime(),
  };
  const j = get().journal;
  if (j.state === "ready" && sameDir(j.dataDir, dir)) await j.repo.updateSettings({ workspace: meta });
  const next = upsertEntry(list, { ...e, ...meta });
  await saveEntries(next);
  const cur = currentWorkspace();
  if (cur) applyWindowTitle(next, cur.name);
}

export async function reorderWorkspaces(from: number, to: number) {
  await saveEntries(moveEntry(get().workspaces, from, to));
}

/** 목록에서 빼기(D10) — 파일은 지우지 않는다 */
export async function removeWorkspace(dir: string): Promise<boolean> {
  const j = get().journal;
  const list = get().workspaces;
  if (!canRemove(list, dir, j.state === "ready" ? j.dataDir : null)) return false;
  const next = removeEntry(list, dir);
  await saveEntries(next);
  const cur = currentWorkspace();
  if (cur) applyWindowTitle(next, cur.name);
  return true;
}

export interface NewWorkspace {
  name: string;
  color: CategoryColorKey;
  icon: WorkspaceIcon;
  purpose: WorkspacePurpose;
  dir: string;
  categories: string[];
  copy: { holiday: boolean; tags: boolean; nudge: boolean };
}

/**
 * 새 워크스페이스(spec 4절): 지금 공간에서 가져올 설정을 먼저 읽고 → 새 폴더에 **새 일지 파일**을 만들어 그 공간으로 전환 →
 * 이름·색·아이콘·설정·첫 업무를 채운다. 이미 일지가 있는 폴더는 거부한다(기존 일지 추가는 addExistingWorkspace만).
 */
export async function createWorkspace(w: NewWorkspace): Promise<string | null> {
  const p = platform();
  const name = cleanName(w.name);
  if (!name) return STR.workspace.nameRequired;
  if (get().workspaces.some((e) => sameDir(e.dir, w.dir))) return STR.workspace.folderTaken;
  // 새 워크스페이스 = 늘 새 일지 파일. 이미 일지가 있는 폴더(확인할 수 없으면 그것도)면 만들지 않는다 — 기존 일지를 열거나 덮지 않게
  if ((await classifyFolder(p, null, w.dir).catch(() => "has-journal")) === "has-journal")
    return STR.workspace.folderRefuse;
  // 지금 공간에서 가져올 것
  const j = get().journal;
  const from = j.state === "ready" ? await j.repo.getSettings() : null;
  const tags = j.state === "ready" && w.copy.tags ? (await j.repo.listTags()).map((t) => t.name) : [];
  try {
    await p.ensureDir(w.dir);
  } catch (e) {
    return errMsg(e);
  }
  const meta: WorkspaceMeta = { name, color: w.color, icon: w.icon, updatedAt: p.now().getTime() };
  const entry = { ...meta, dir: w.dir, mirrorSub: baseName(w.dir) };
  await saveEntries(upsertEntry(get().workspaces, entry));
  const err = await switchWorkspace(w.dir, { quiet: true });
  if (err) {
    await saveEntries(removeEntry(get().workspaces, w.dir));
    return err;
  }
  const now = get().journal;
  if (now.state !== "ready") return STR.restore.notOpen;
  await now.repo.updateSettings({
    workspace: meta,
    ...(w.copy.holiday && from ? { holiday: from.holiday } : {}),
    ...(w.copy.nudge && from
      ? { nudgeWeeks: from.nudgeWeeks }
      : QUIET_PURPOSES.includes(w.purpose)
        ? { nudgeWeeks: 0 }
        : {}),
  });
  for (const t of tags) await now.repo.createTag(t).catch(() => undefined);
  for (const c of w.categories.map(cleanName).filter(Boolean)) await addCategory(c);
  await reload();
  if (w.categories.length) setAddOpen(false);
  focusStartCell();
  set({ creatingWorkspace: false });
  toast(STR.workspace.created(name));
  return null;
}

/** 다른 PC에서 가져온 폴더·예전 폴더를 공간으로 추가(일지가 있어야 함)하고 연다 */
export async function addExistingWorkspace(dir: string): Promise<string | null> {
  const p = platform();
  if (get().workspaces.some((e) => sameDir(e.dir, dir))) return switchWorkspace(dir);
  if ((await classifyFolder(p, null, dir).catch(() => "empty")) !== "has-journal")
    return STR.workspace.addExistingNoJournal;
  return switchWorkspace(dir);
}

// 점검 훅(읽기만): 지금 연 공간 일지의 메모 이미지 수 — 공간 전환 무결성 E2E가 화면과 따로 저장소를 확인한다(v1.8.1)
if (typeof window !== "undefined")
  Object.assign(globalThis, {
    __wjbApp: {
      /** 브라우저 E2E 전용: 메모 저장 결과와 실행 취소의 공간 분리 확인(읽기만). */
      async noteSnapshot() {
        const j = get().journal;
        if (j.state !== "ready" || platform().kind !== "browser") return null;
        return {
          doc: (await j.repo.getWeekNote(useBoard.getState().weekId)).doc,
          canUndo: useNote.getState().canUndo,
        };
      },
      /** Read-only browser assertion: copying may grow relations, never shared objects/assets. */
      async journalCounts() {
        const j = get().journal;
        if (j.state !== "ready" || platform().kind !== "browser") return null;
        const tables = [
          "entry_item",
          "week_note",
          "note_entry_link",
          "note_asset",
          "cabinet_item",
          "cabinet_link",
          "cabi_note",
          "cabi_board",
          "cabi_asset",
          "cabi_entry_link",
          "kanban_section",
          "item_status_log",
          "kanban_bulk",
        ] as const;
        const counts: Record<string, number> = {};
        for (const table of tables)
          counts[table] = Number(
            (await j.driver.select<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))[0]?.n ?? 0,
          );
        counts.note_boxes = Number(
          (
            await j.driver.select<{ n: number }>(
              "SELECT COUNT(*) AS n FROM week_note n, json_each(n.doc, '$.boxes')",
            )
          )[0]?.n ?? 0,
        );
        return counts;
      },
      /** 브라우저 모드 시험 전용: 지금 일지의 DB 버전을 99로(다른 PC의 최신 앱이 올린 상황 흉내, improve-v22-spec 2-1) */
      async bumpSchema() {
        const j = get().journal;
        if (j.state !== "ready" || platform().kind !== "browser") return;
        await j.driver.execute("UPDATE app_meta SET value = '99' WHERE key = 'schema_version'");
      },
      async assetCount() {
        const j = get().journal;
        return j.state === "ready" ? (await j.repo.noteAssetStats()).count : -1;
      },
      /**
       * 브라우저 모드 시험 전용: 화면을 거치지 않고 일지의 그 글 항목 끝에 " (가상 고침)"을 붙인다
       * (다른 창에서 고친 것과 같은 상황 — 근거 묶음 복사 직전 재확인 시험, UV4). 실앱에서는 아무것도 하지 않는다.
       */
      async touchEntry(text: string) {
        const j = get().journal;
        if (j.state !== "ready" || platform().kind !== "browser") return;
        await j.driver.execute("UPDATE entry_item SET text = text || ' (가상 고침)' WHERE text = ?", [text]);
      },
      /** 지금 연 공간 일지의 지식 카드 수(UV3) */
      async cardCount() {
        const j = get().journal;
        return j.state === "ready" ? (await j.repo.listCards()).length : -1;
      },
      /** 지금 연 공간 일지에서 마감일이 있는 항목 수(v10) */
      async completedCount(week: string) {
        const j = get().journal;
        if (j.state !== "ready") return -1;
        const view = await j.repo.getWeek(week);
        return Object.values(view.items)
          .flat()
          .filter((item) => !item.flagged && !!item.flagDoneAt).length;
      },
      async dueCount() {
        const j = get().journal;
        if (j.state !== "ready") return -1;
        const r = await j.driver.select<{ n: number }>(
          "SELECT COUNT(*) AS n FROM entry_item WHERE due_date IS NOT NULL",
        );
        return r[0]?.n ?? 0;
      },
      /** 지금 연 공간 일지의 직접 연결 수(UV2) */
      async relationCount() {
        const j = get().journal;
        return j.state === "ready" ? (await j.repo.listRelations()).length : -1;
      },
    },
  });
