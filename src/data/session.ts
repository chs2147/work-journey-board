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
import { prepareConnection, type SqlDriver } from "./driver";
import { migrate, quickCheck } from "./migrate";

export interface SessionFs {
  join(...parts: string[]): string;
  stat(path: string): Promise<{ exists: boolean; isDir: boolean; size: number | null }>;
  ensureDir(path: string): Promise<void>;
  copyNew(from: string, to: string): Promise<void>;
  openDatabase(path: string): Promise<SqlDriver>;
  verifyCopy: VerifyCopy;
  backupFs: BackupFs;
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
      if (/not a database|malformed|corrupt|disk image/i.test(e instanceof Error ? e.message : String(e)))
        healthy = false;
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

export async function lastBackupOf(fs: SessionFs, dataDir: string): Promise<BackupInfo | null> {
  return latestBackup(await fs.backupFs.list(fs.join(dataDir, BACKUP_DIR)));
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
