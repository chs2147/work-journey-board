// 앱 흐름(overview 10-8·10-10): 시작 → 첫 실행 / 저장 폴더 없음 / 파일 이상 / 보드, 종료 백업, 저장 위치 전환·옮기기.
import { JournalRepository } from "../../data/repository";
import { runMirrorBackup } from "../../data/backup";
import { integrityCheck } from "../../data/migrate";
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
import { flushAll, focusStartCell, init as initBoard, reload, toast, useBoard } from "../board/boardStore";
import { flushDraft, initSummary } from "../summary/summaryStore";
import { finishNote, flushNote, initNote } from "../note/noteStore";
import { initInsights, useInsights } from "../insights/insightsStore";
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
  const config = await p.loadConfig();
  // 테마 정본 = config.json, 없으면 이 창이 이미 적용한 사본(public/theme-early.js).
  // 처음 설치(설정 없음) = 시그니처, 이미 쓰던 사용자가 테마를 고른 적 없으면 = 시스템 설정 그대로(release-phase2-spec 1절)
  adoptTheme(config ? (config.theme ?? readStoredTheme("system")) : readStoredTheme());
  if (!config) return set({ journal: { state: "first-run" } });
  p.splash?.status(STR.splash.opening);
  await openAt(config.dataDir);
}

/** 대기 중인 저장(보드 칸·메모 + 주간 요약 수정본)을 끝낸다 */
async function flushPending() {
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
async function autoBackup(kind: BackupKind): Promise<void> {
  const j = get().journal;
  if (j.state !== "ready" || backupRunning) return;
  const p = platform();
  backupRunning = true;
  if (kind !== "exit") set({ backingUp: true });
  try {
    const s = await j.repo.getSettings();
    const keep = { daily: s.backup.dailyKeep, monthly: s.backup.monthlyKeep };
    const writes = j.repo.writeCount;
    const now = p.now();
    const result = await j.repo.exclusive(() =>
      kind === "start"
        ? backupIfFirstToday(p, j.driver, j.dataDir, now, keep)
        : backupOnExit(p, j.driver, j.dataDir, now, keep),
    );
    lastBackup = { writes, at: now.getTime() };
    const mirror = (await p.loadConfig())?.backupMirror;
    if (mirror && result) {
      try {
        await j.repo.exclusive(() => runMirrorBackup(j.driver, p.backupFs, mirror, now, p.verifyCopy));
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
  set({ journal: { state: "integrity", dataDir: j.dataDir, path: journalPath(platform(), j.dataDir) } });
  void j.driver.close().catch(() => undefined);
}

/** 앱 종료 직전: 대기 중인 저장을 끝내고, 마지막 백업 뒤 바뀐 게 있으면 그날 일일 백업을 덮어쓴다(B3). 실패해도 창은 닫힌다. */
async function onExit() {
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
  const repo = new JournalRepository(driver, () => p.now());
  repo.setCorruptHandler(onCorrupt);
  const [row] = await driver.select<{ v: string }>("SELECT sqlite_version() AS v");
  p.splash?.status(STR.splash.preparing);
  await initBoard(repo);
  await initSummary(repo);
  await initNote(repo);
  await initInsights(repo);
  set({ journal: { state: "ready", driver, repo, dataDir, sqliteVersion: row?.v ?? "?" } });
  lastBackup = { writes: repo.writeCount, at: p.now().getTime() };
  void waitInputIdle(START_BACKUP_MAX_WAIT_MS).then(() => autoBackup("start"));
  periodicTimer = setInterval(() => void periodicTick().catch(() => undefined), PERIODIC_CHECK_MS);
}

/** 백업에서 복원(O5): 지금 일지를 닫고(대기 저장 마무리) → 보존 사본을 남기고 백업을 일지로 → 다시 연다. 실패하면 오류 글 */
export async function restoreBackup(name: string): Promise<string | null> {
  const j = get().journal;
  const dataDir = j.state === "ready" || j.state === "integrity" ? j.dataDir : null;
  if (!dataDir) return STR.restore.notOpen;
  const p = platform();
  if (j.state === "ready") {
    await flushPending().catch(() => undefined);
    await finishNote().catch(() => undefined);
    stopPeriodic();
    await j.driver.close().catch(() => undefined);
  }
  let before: string;
  try {
    before = await restoreFromBackup(p, dataDir, name, p.now());
  } catch (e) {
    await openAt(dataDir);
    return errMsg(e);
  }
  set({ settingsOpen: false });
  if (await openAt(dataDir))
    toast(STR.restore.done(name), { label: STR.restore.undo, run: () => void restoreBackup(before) });
  return null;
}

function statusFor(e: unknown, dataDir: string): JournalStatus {
  if (e instanceof FolderMissingError) return { state: "missing", dataDir };
  if (e instanceof IntegrityError) return { state: "integrity", dataDir, path: e.path };
  return { state: "error", message: errMsg(e) };
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
  if (j.state === "ready") await j.driver.close().catch(() => undefined);
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
  await closeCurrent();
  await p.saveConfig({ dataDir });
  await activate(next, dataDir);
  return null;
}

/** 설정 > 저장 위치: 지금 일지를 새 폴더로 옮긴다. 실패하면 기존 위치를 그대로 쓴다(overview 10-10). */
export async function moveTo(dataDir: string, copyBackups: boolean): Promise<string | null> {
  const j = get().journal;
  if (j.state !== "ready") return "일지가 열려 있지 않습니다";
  const p = platform();
  await flushPending();
  let next: SqlDriver;
  try {
    await copyJournalTo(p, j.driver, j.dataDir, dataDir, copyBackups, p.now());
    next = await openJournalAt(p, dataDir, () => p.now());
  } catch (e) {
    return errMsg(e);
  }
  await p.saveConfig({ dataDir });
  await j.driver.close().catch(() => undefined);
  await activate(next, dataDir);
  return null;
}
