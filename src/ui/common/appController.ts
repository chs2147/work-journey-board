// 앱 흐름(overview 10-8·10-10): 시작 → 첫 실행 / 저장 폴더 없음 / 파일 이상 / 보드, 종료 백업, 저장 위치 전환·옮기기.
import { DEFAULT_SETTINGS } from "../../data/settings";
import { JournalRepository } from "../../data/repository";
import {
  backupIfFirstToday,
  backupOnExit,
  copyJournalTo,
  FolderMissingError,
  IntegrityError,
  openJournalAt,
} from "../../data/session";
import type { SqlDriver } from "../../data/driver";
import { loadPlatform, type Platform } from "../../platform";
import { STR } from "../../shared/strings";
import { flushAll, init as initBoard, toast } from "../board/boardStore";
import { flushDraft, initSummary } from "../summary/summaryStore";
import { finishNote, flushNote, initNote } from "../note/noteStore";
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

/** 앱 종료 직전: 대기 중인 저장을 끝내고 그날 일일 백업을 덮어쓴다. 실패해도 창은 닫힌다. */
async function onExit() {
  await flushPending().catch(() => undefined);
  await finishNote().catch(() => undefined);
  const j = get().journal;
  if (j.state !== "ready") return;
  try {
    const s = await j.repo.getSettings();
    await backupOnExit(platform(), j.driver, j.dataDir, platform().now(), {
      daily: s.backup.dailyKeep,
      monthly: s.backup.monthlyKeep,
    });
  } catch {
    // 종료 중이라 알릴 화면이 없다. 다음 실행의 첫 백업이 다시 만든다.
  }
}

/** 이미 연 드라이버로 보드를 띄운다(+ 그날 첫 실행 백업). */
async function activate(driver: SqlDriver, dataDir: string) {
  const p = platform();
  const repo = new JournalRepository(driver, () => p.now());
  const [row] = await driver.select<{ v: string }>("SELECT sqlite_version() AS v");
  const settings = await repo.getSettings().catch(() => DEFAULT_SETTINGS);
  p.splash?.status(STR.splash.backingUp);
  try {
    await backupIfFirstToday(p, driver, dataDir, p.now(), {
      daily: settings.backup.dailyKeep,
      monthly: settings.backup.monthlyKeep,
    });
  } catch (e) {
    toast(STR.startBackupFailed(errMsg(e)));
  }
  p.splash?.status(STR.splash.preparing);
  await initBoard(repo);
  await initSummary(repo);
  await initNote(repo);
  set({ journal: { state: "ready", driver, repo, dataDir, sqliteVersion: row?.v ?? "?" } });
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
  if (ok) await platform().saveConfig({ dataDir });
  return ok;
}

export function goFirstRun() {
  set({ journal: { state: "first-run" } });
}

export function setSettingsOpen(open: boolean) {
  set({ settingsOpen: open });
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
