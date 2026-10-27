// 백업(data-spec 7절). `VACUUM INTO`로 열린 DB의 일관된 사본을 만들고, 파일명은 로컬 시각 기준.
// ⚠ 사용자 폴더의 파일을 지우는 코드는 이 모듈의 `removeGuarded` 한 곳뿐이다(CLAUDE.md 4-3).
//   지울 수 있는 것: 일일·월간 자동 백업 파일, 그리고 이 모듈이 만든 임시 사본(*.db.tmp)뿐.
import { localDate, localMonth, localStamp } from "../domain/localTime";
import type { SqlDriver } from "./driver";

export const DATA_FILE = "work-journey.db";
export const BACKUP_DIR = "backups";

const DAILY_RE = /^work-journey_\d{4}-\d{2}-\d{2}\.db$/;
const MONTHLY_RE = /^work-journey_\d{4}-\d{2}_monthly\.db$/;
const TEMP_RE = /^work-journey_[0-9A-Za-z_-]+\.db\.tmp$/;

export const backupNames = {
  daily: (now: Date) => `work-journey_${localDate(now)}.db`,
  monthly: (now: Date) => `work-journey_${localMonth(now)}_monthly.db`,
  manual: (now: Date) => `work-journey_${localStamp(now)}_manual.db`,
  preMigration: (now: Date, toVersion: number) =>
    `work-journey_${localStamp(now)}_pre-migration-v${toVersion}.db`,
  beforeRestore: (now: Date) => `work-journey_${localStamp(now)}_before-restore.db`,
  preImport: (now: Date) => `work-journey_${localStamp(now)}_pre-import.db`,
  /** 새 판 설치 직전(improve-1027v4-spec 1-3) */
  preUpdate: (now: Date) => `work-journey_${localStamp(now)}_pre-update.db`,
};

export const isDailyBackup = (name: string) => DAILY_RE.test(name);
export const isMonthlyBackup = (name: string) => MONTHLY_RE.test(name);

/** 자동 삭제가 허용된 이름인가 — 일일·월간 자동 백업과 이 모듈의 임시 사본만 */
export function isDeletableByApp(name: string): boolean {
  return DAILY_RE.test(name) || MONTHLY_RE.test(name) || TEMP_RE.test(name);
}

/** 백업 폴더에서 다룰 파일 시스템 동작(플랫폼이 구현, S4). 경로 조합도 플랫폼 규칙을 따른다. */
export interface BackupFs {
  join(...parts: string[]): string;
  ensureDir(dir: string): Promise<void>;
  /** 폴더 안 파일 이름 목록 */
  list(dir: string): Promise<string[]>;
  /** 같은 이름이 있으면 덮어쓴다 */
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}

/** 사본 검증(사본을 따로 열어 quick_check). 플랫폼이 제공. */
export type VerifyCopy = (path: string) => Promise<boolean>;

export class BackupError extends Error {}

async function removeGuarded(fs: BackupFs, dir: string, name: string): Promise<void> {
  if (!isDeletableByApp(name)) throw new BackupError(`삭제 금지 파일: ${name}`);
  await fs.remove(fs.join(dir, name));
}

/** 롤링: 최신 keep개만 남기고 지울 일일·월간 파일 이름(패턴에 맞는 것만 대상) */
export function planRotation(names: string[], keep: { daily: number; monthly: number }): string[] {
  const newestFirst = (re: RegExp) =>
    names
      .filter((n) => re.test(n))
      .sort()
      .reverse();
  return [
    ...newestFirst(DAILY_RE).slice(Math.max(keep.daily, 1)),
    ...newestFirst(MONTHLY_RE).slice(Math.max(keep.monthly, 0)),
  ];
}

const sqlQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * 사본 1개 쓰기: 임시 이름으로 VACUUM INTO → 검증 → 최종 이름으로 바꿈(같은 이름이면 덮어씀).
 * 검증 실패 시 임시 사본만 지우고 예외. 기존 백업은 건드리지 않는다.
 */
export async function writeBackup(
  driver: SqlDriver,
  fs: BackupFs,
  dir: string,
  name: string,
  verify?: VerifyCopy,
): Promise<string> {
  await fs.ensureDir(dir);
  const tmpName = `${name}.tmp`;
  if ((await fs.list(dir)).includes(tmpName)) await removeGuarded(fs, dir, tmpName); // 이전 실패의 잔여물
  const tmpPath = fs.join(dir, tmpName);
  await driver.execute(`VACUUM INTO ${sqlQuote(tmpPath)}`);
  if (verify && !(await verify(tmpPath))) {
    await removeGuarded(fs, dir, tmpName);
    throw new BackupError(`백업 사본 검증 실패: ${name}`);
  }
  const finalPath = fs.join(dir, name);
  await fs.rename(tmpPath, finalPath);
  return finalPath;
}

export interface AutoBackupResult {
  daily: string;
  monthly: string | null;
  deleted: string[];
}

/**
 * 자동 백업: 그날 일일 사본(같은 날이면 덮어씀) + 그 달 첫 월간 사본 + 롤링 삭제.
 * 앱 시작(그날 첫 실행)과 종료 시 호출한다.
 */
export async function runAutoBackup(
  driver: SqlDriver,
  fs: BackupFs,
  dataDir: string,
  now: Date,
  keep: { daily: number; monthly: number },
  verify?: VerifyCopy,
): Promise<AutoBackupResult> {
  const dir = fs.join(dataDir, BACKUP_DIR);
  const daily = await writeBackup(driver, fs, dir, backupNames.daily(now), verify);
  const monthlyName = backupNames.monthly(now);
  const monthly = (await fs.list(dir)).includes(monthlyName)
    ? null
    : await writeBackup(driver, fs, dir, monthlyName, verify);
  const deleted = planRotation(await fs.list(dir), keep);
  for (const name of deleted) await removeGuarded(fs, dir, name);
  return { daily, monthly, deleted };
}

/** 수동 "지금 백업"(자동 삭제 대상 아님) */
export function runManualBackup(
  driver: SqlDriver,
  fs: BackupFs,
  dataDir: string,
  now: Date,
  verify?: VerifyCopy,
) {
  return writeBackup(driver, fs, fs.join(dataDir, BACKUP_DIR), backupNames.manual(now), verify);
}

/** 기존 일지 가져오기 직전 백업(자동 삭제 대상 아님, i-m3-plan 3-9) */
export function runPreImportBackup(
  driver: SqlDriver,
  fs: BackupFs,
  dataDir: string,
  now: Date,
  verify?: VerifyCopy,
) {
  return writeBackup(driver, fs, fs.join(dataDir, BACKUP_DIR), backupNames.preImport(now), verify);
}

/** 새 판 설치 직전 백업(자동 삭제 대상 아님, improve-1027v4-spec 1-3) */
export function runPreUpdateBackup(
  driver: SqlDriver,
  fs: BackupFs,
  dataDir: string,
  now: Date,
  verify?: VerifyCopy,
) {
  return writeBackup(driver, fs, fs.join(dataDir, BACKUP_DIR), backupNames.preUpdate(now), verify);
}

/** 마이그레이션 직전 백업(자동 삭제 대상 아님) */
export function runPreMigrationBackup(
  driver: SqlDriver,
  fs: BackupFs,
  dataDir: string,
  now: Date,
  toVersion: number,
  verify?: VerifyCopy,
) {
  return writeBackup(
    driver,
    fs,
    fs.join(dataDir, BACKUP_DIR),
    backupNames.preMigration(now, toVersion),
    verify,
  );
}
