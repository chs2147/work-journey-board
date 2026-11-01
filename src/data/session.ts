// 일지 파일 열기·자동 백업·저장 위치 옮기기(data-spec 7절, overview 10-8·10-10).
// 파일 동작은 주입받은 SessionFs(플랫폼 구현)만 쓴다 — 이 모듈은 어떤 파일도 직접 지우지 않는다.
import {
  BACKUP_DIR,
  DATA_FILE,
  backupNames,
  runAutoBackup,
  runManualBackup,
  runPreImportBackup,
  runPreUpdateBackup,
  runPreMigrationBackup,
  type BackupFs,
  type VerifyCopy,
} from "./backup";
import { isCorruptError, prepareConnection, type SqlDriver } from "./driver";
import { LATEST_SCHEMA_VERSION, migrate, quickCheck, readSchemaVersion } from "./migrate";

export interface SessionFs {
  join(...parts: string[]): string;
  stat(path: string): Promise<{ exists: boolean; isDir: boolean; size: number | null }>;
  ensureDir(path: string): Promise<void>;
  copyNew(from: string, to: string): Promise<void>;
  openDatabase(path: string): Promise<SqlDriver>;
  verifyCopy: VerifyCopy;
  backupFs: BackupFs;
  /**
   * 복원(optimize-1031-plan O5, data-spec 7-3): ① 지금 일지(있으면)를 `backups\<beforeName>`으로 옮겨 보존 →
   * ② `backups\<backupName>`을 일지 이름으로 새 파일 복사. 일지가 닫혀 있어야 한다. 실앱은 Rust가 이름·위치를 한 번 더 검사.
   */
  restoreJournal(dataDir: string, backupName: string, beforeName: string): Promise<void>;
}

export class FolderMissingError extends Error {
  constructor(readonly dataDir: string) {
    super(`저장 폴더를 찾을 수 없습니다: ${dataDir}`);
  }
}

export class IntegrityError extends Error {
  constructor(readonly path: string) {
    super(`데이터 파일 검사에 실패했습니다: ${path}`);
  }
}

export const journalPath = (fs: SessionFs, dataDir: string) => fs.join(dataDir, DATA_FILE);

/** 저장 폴더의 일지를 연다: 폴더 확인 → 연결 설정 → 무결성 검사 → 마이그레이션(기존 데이터면 직전 백업). */
export async function openJournalAt(fs: SessionFs, dataDir: string, now: () => Date): Promise<SqlDriver> {
  const dir = await fs.stat(dataDir);
  if (!dir.isDir) throw new FolderMissingError(dataDir);
  const path = journalPath(fs, dataDir);
  const driver = await fs.openDatabase(path);
  try {
    let healthy: boolean;
    try {
      await prepareConnection(driver);
      healthy = await quickCheck(driver);
    } catch (e) {
      if (isCorruptError(e)) healthy = false;
      else throw e;
    }
    if (!healthy) throw new IntegrityError(path);
    await migrate(driver, {
      now,
      beforeMigrate: async (_from, to) => {
        await runPreMigrationBackup(driver, fs.backupFs, dataDir, now(), to, fs.verifyCopy);
      },
    });
  } catch (e) {
    await driver.close().catch(() => undefined);
    throw e;
  }
  return driver;
}

/** 그날 첫 실행이면 자동 백업(일일·월간·롤링). 오늘 일일 사본이 이미 있으면 건너뛴다. */
export async function backupIfFirstToday(
  fs: SessionFs,
  driver: SqlDriver,
  dataDir: string,
  now: Date,
  keep: { daily: number; monthly: number },
) {
  const names = await fs.backupFs.list(fs.join(dataDir, BACKUP_DIR));
  if (names.includes(backupNames.daily(now))) return null;
  return runAutoBackup(driver, fs.backupFs, dataDir, now, keep, fs.verifyCopy);
}

/** 앱 종료 시 백업(같은 날 일일 사본을 덮어써 그날 마지막 상태를 남긴다). */
export function backupOnExit(
  fs: SessionFs,
  driver: SqlDriver,
  dataDir: string,
  now: Date,
  keep: { daily: number; monthly: number },
) {
  return runAutoBackup(driver, fs.backupFs, dataDir, now, keep, fs.verifyCopy);
}

export function manualBackup(fs: SessionFs, driver: SqlDriver, dataDir: string, now: Date) {
  return runManualBackup(driver, fs.backupFs, dataDir, now, fs.verifyCopy);
}

export function preImportBackup(fs: SessionFs, driver: SqlDriver, dataDir: string, now: Date) {
  return runPreImportBackup(driver, fs.backupFs, dataDir, now, fs.verifyCopy);
}

export function preUpdateBackup(fs: SessionFs, driver: SqlDriver, dataDir: string, now: Date) {
  return runPreUpdateBackup(driver, fs.backupFs, dataDir, now, fs.verifyCopy);
}

export interface BackupInfo {
  name: string;
  /** `2026-10-23` 또는 `2026-10-23 08:31` */
  when: string;
  kind: "daily" | "monthly" | "manual" | "pre-migration" | "other";
}

/** 백업 파일 이름에서 시각·종류를 읽어 가장 최근 것을 고른다. */
export function latestBackup(names: string[]): BackupInfo | null {
  const parsed = names
    .map((name) => {
      const m =
        /^work-journey_(\d{4}-\d{2})(?:-(\d{2}))?(?:_(\d{2})(\d{2}))?(?:_(monthly|manual|pre-migration-v\d+|before-restore|pre-import|pre-update))?\.db$/.exec(
          name,
        );
      if (!m) return null;
      const [, ym, d, hh, mm, tag] = m;
      const sortKey = `${ym}-${d ?? "00"} ${hh ?? "00"}:${mm ?? "00"}`; // 시각 없는 일일 사본은 그날 첫 실행(0시)으로 본다
      const when = d ? `${ym}-${d}${hh ? ` ${hh}:${mm}` : ""}` : ym!;
      const kind: BackupInfo["kind"] = !tag
        ? "daily"
        : tag === "monthly"
          ? "monthly"
          : tag === "manual"
            ? "manual"
            : tag.startsWith("pre-migration")
              ? "pre-migration"
              : "other";
      return { name, when, kind, sortKey };
    })
    .filter((x): x is BackupInfo & { sortKey: string } => x !== null)
    .sort((a, b) => (a.sortKey < b.sortKey ? 1 : -1));
  const top = parsed[0];
  return top ? { name: top.name, when: top.when, kind: top.kind } : null;
}

export interface BackupFolderStats {
  count: number;
  bytes: number;
  /** 종류별 개수·크기 */
  byKind: Record<BackupInfo["kind"], { count: number; bytes: number }>;
}

/** 백업 폴더 용량(optimize-1031-plan B5·O1 진단) — `.db` 파일만 센다(임시 사본 제외) */
export async function backupFolderStats(fs: SessionFs, dataDir: string): Promise<BackupFolderStats> {
  const dir = fs.join(dataDir, BACKUP_DIR);
  const empty = () => ({ count: 0, bytes: 0 });
  const out: BackupFolderStats = {
    count: 0,
    bytes: 0,
    byKind: { daily: empty(), monthly: empty(), manual: empty(), "pre-migration": empty(), other: empty() },
  };
  if (!(await fs.stat(dir)).isDir) return out;
  for (const name of await fs.backupFs.list(dir)) {
    if (!name.endsWith(".db")) continue;
    const size = (await fs.stat(fs.join(dir, name))).size ?? 0;
    const kind = latestBackup([name])?.kind ?? "other";
    out.count++;
    out.bytes += size;
    out.byKind[kind].count++;
    out.byKind[kind].bytes += size;
  }
  return out;
}

export async function lastBackupOf(fs: SessionFs, dataDir: string): Promise<BackupInfo | null> {
  return latestBackup(await fs.backupFs.list(fs.join(dataDir, BACKUP_DIR)));
}

export interface RestorableBackup extends BackupInfo {
  size: number | null;
}

/** 복원할 수 있는 백업(최근 순) — 임시 사본 제외 */
export async function listRestorable(fs: SessionFs, dataDir: string): Promise<RestorableBackup[]> {
  const dir = fs.join(dataDir, BACKUP_DIR);
  if (!(await fs.stat(dir)).isDir) return [];
  const out: RestorableBackup[] = [];
  for (const name of await fs.backupFs.list(dir)) {
    const info = latestBackup([name]);
    if (info) out.push({ ...info, size: (await fs.stat(fs.join(dir, name))).size });
  }
  // 월간(`2026-10`)은 그 달 0일로 보고 시각 순으로
  const key = (b: RestorableBackup) => `${b.when.length === 7 ? `${b.when}-00` : b.when} ${b.name}`;
  return out.sort((a, b) => (key(a) < key(b) ? 1 : -1));
}

export interface BackupSummary {
  ok: boolean;
  /** 앱보다 새 판에서 만든 사본(열 수 없음) */
  newer: boolean;
  categories: number;
  items: number;
  lastDate: string | null;
}

/** 복원 전에 백업 사본을 따로 열어 검사하고 요약(업무 수·항목 수·마지막 기록일)을 만든다 — 사본은 고치지 않는다 */
export async function inspectBackup(fs: SessionFs, dataDir: string, name: string): Promise<BackupSummary> {
  const path = fs.join(dataDir, BACKUP_DIR, name);
  const bad: BackupSummary = { ok: false, newer: false, categories: 0, items: 0, lastDate: null };
  if (!(await fs.verifyCopy(path).catch(() => false))) return bad;
  const d = await fs.openDatabase(path);
  try {
    const version = await readSchemaVersion(d);
    if (version > LATEST_SCHEMA_VERSION) return { ...bad, newer: true };
    const [c] = await d.select<{ n: number }>("SELECT COUNT(*) AS n FROM category");
    const [i] = await d.select<{ n: number; last: string | null }>(
      "SELECT COUNT(*) AS n, MAX(date) AS last FROM entry_item WHERE trim(text) <> ''",
    );
    return {
      ok: true,
      newer: false,
      categories: Number(c?.n ?? 0),
      items: Number(i?.n ?? 0),
      lastDate: i?.last ?? null,
    };
  } catch {
    return bad;
  } finally {
    await d.close().catch(() => undefined);
  }
}

/** 복원 실행 — 열려 있던 일지는 부르는 쪽이 먼저 닫는다. 보존 사본 이름을 돌려준다(되돌리기용) */
export async function restoreFromBackup(
  fs: SessionFs,
  dataDir: string,
  name: string,
  now: Date,
): Promise<string> {
  if (!latestBackup([name])) throw new Error(`백업 파일이 아닙니다: ${name}`);
  // 같은 분에 다시 복원(되돌리기)해도 보존 사본 이름이 겹치지 않게 1분씩 뒤로
  const taken = new Set(await fs.backupFs.list(fs.join(dataDir, BACKUP_DIR)));
  let before = backupNames.beforeRestore(now);
  for (let i = 1; taken.has(before) && i < 1440; i++)
    before = backupNames.beforeRestore(new Date(now.getTime() + i * 60_000));
  await fs.restoreJournal(dataDir, name, before);
  return before;
}

export type FolderKind = "same" | "has-journal" | "empty";

/** 저장 위치로 고른 폴더의 상태(overview 10-10 분기). OneDrive 여부는 플랫폼이 따로 판정한다. */
export async function classifyFolder(
  fs: SessionFs,
  currentDir: string | null,
  picked: string,
): Promise<FolderKind> {
  const norm = (p: string) => p.replace(/[\\/]+$/, "").toLowerCase();
  if (currentDir && norm(currentDir) === norm(picked)) return "same";
  return (await fs.stat(journalPath(fs, picked))).exists ? "has-journal" : "empty";
}

export type MoveStep = "backup" | "copy" | "verify" | "backups";

export class MoveError extends Error {
  constructor(
    readonly step: MoveStep,
    readonly target: string,
    cause: unknown,
  ) {
    super(`${step} 단계 실패(${target}): ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

/**
 * 지금 일지를 새 폴더로 옮긴다(overview 10-10): ① 현재 위치 수동 백업 → ② 새 폴더에 VACUUM INTO →
 * ③ 새 파일 검사 → ④ (선택) backups 복사. 설정 변경·다시 열기는 호출하는 쪽이 성공 후에 한다.
 * 어느 단계든 실패하면 MoveError — 이전 폴더·새 폴더의 어떤 파일도 지우지 않는다.
 */
export async function copyJournalTo(
  fs: SessionFs,
  driver: SqlDriver,
  fromDir: string,
  toDir: string,
  copyBackups: boolean,
  now: Date,
): Promise<{ copiedBackups: number; skippedBackups: number }> {
  const target = journalPath(fs, toDir);
  const step = async <T>(s: MoveStep, fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (e) {
      throw new MoveError(s, target, e);
    }
  };

  await step("backup", () => manualBackup(fs, driver, fromDir, now));
  await step("copy", async () => {
    await fs.ensureDir(toDir);
    if ((await fs.stat(target)).exists) throw new Error("대상 폴더에 이미 일지 파일이 있습니다");
    await driver.execute(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  });
  await step("verify", async () => {
    if (!(await fs.verifyCopy(target))) throw new Error("새 파일 검사 실패");
  });

  let copiedBackups = 0;
  let skippedBackups = 0;
  if (copyBackups) {
    await step("backups", async () => {
      const src = fs.join(fromDir, BACKUP_DIR);
      const dst = fs.join(toDir, BACKUP_DIR);
      await fs.ensureDir(dst);
      const existing = new Set(await fs.backupFs.list(dst));
      for (const name of await fs.backupFs.list(src)) {
        if (!name.endsWith(".db") || existing.has(name)) {
          skippedBackups++;
          continue;
        }
        await fs.copyNew(fs.join(src, name), fs.join(dst, name));
        copiedBackups++;
      }
    });
  }
  return { copiedBackups, skippedBackups };
}
