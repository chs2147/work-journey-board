// 검증된 새 사본을 확보한 뒤에만 자동 백업을 정리한다. 사용자 파일 삭제는 removeGuarded 한 곳뿐.
import { localDate, localMonth, localStamp } from "../domain/localTime";
import type { SqlDriver } from "./driver";
import { readSchemaVersion, LATEST_SCHEMA_VERSION } from "./migrate";
import { parseBackupName, versionedBackupName, BACKUP_APP_VERSION, type BackupKind } from "./backupIdentity";
import { planBackupCleanup, type BackupFile, type BackupPolicy, type CleanupPlan } from "./backupPolicy";
export const DATA_FILE = "work-journey.db";
export const BACKUP_DIR = "backups";
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

export const isRestorableName = (name: string) => parseBackupName(name) !== null;
export const isBeforeRestoreName = (name: string) => {
  const b = parseBackupName(name);
  return (
    b?.kind === "before-restore" &&
    (!b.legacy || /^work-journey_\d{4}-\d{2}-\d{2}_\d{4}_before-restore\.db$/.test(name))
  );
};
export const isDailyBackup = (name: string) => {
  const b = parseBackupName(name);
  return b?.kind === "daily" && (!b.legacy || /^work-journey_\d{4}-\d{2}-\d{2}\.db$/.test(name));
};
export const isMonthlyBackup = (name: string) => {
  const b = parseBackupName(name);
  return b?.kind === "monthly" && (!b.legacy || /^work-journey_\d{4}-\d{2}_monthly\.db$/.test(name));
};
export function isDeletableByApp(name: string) {
  return (
    isDailyBackup(name) ||
    isMonthlyBackup(name) ||
    (name.endsWith(".tmp") &&
      (isRestorableName(name.slice(0, -4)) || /^work-journey_[0-9A-Za-z_-]+\.db\.tmp$/.test(name)))
  );
}
export interface BackupFs {
  join(...parts: string[]): string;
  ensureDir(dir: string): Promise<void>;
  list(dir: string): Promise<string[]>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  stat?(path: string): Promise<{
    exists: boolean;
    isDir: boolean;
    size: number | null;
    modified?: number | null;
    isSymlink?: boolean;
  }>;
  inspect?(path: string): Promise<{ ok: boolean; schema: number | null }>;
  removeChecked?(path: string, size: number, modified: number | null): Promise<void>;
}
export type VerifyCopy = (path: string) => Promise<boolean>;
export class BackupError extends Error {}
export async function removeGuarded(fs: BackupFs, dir: string, name: string, expected?: BackupFile) {
  if (!isDeletableByApp(name)) throw new BackupError(`삭제 금지 파일: ${name}`);
  const path = fs.join(dir, name);
  if (expected && fs.stat) {
    const st = await fs.stat(path);
    if (
      !st.exists ||
      st.isDir ||
      st.isSymlink ||
      st.size !== expected.size ||
      (st.modified ?? null) !== expected.modified
    )
      throw new BackupError("정리 대상이 변경되었습니다. 미리보기를 다시 확인하세요.");
  }
  if (expected && fs.removeChecked) await fs.removeChecked(path, expected.size, expected.modified);
  else await fs.remove(path);
}
export function planRotation(names: string[], keep: { daily: number; monthly: number }) {
  const newest = (kind: BackupKind) =>
    names
      .filter((n) => parseBackupName(n)?.kind === kind)
      .sort((a, b) => parseBackupName(b)!.sortKey.localeCompare(parseBackupName(a)!.sortKey));
  return [
    ...newest("daily").slice(Math.max(keep.daily, 1)),
    ...newest("monthly").slice(Math.max(keep.monthly, 0)),
  ];
}
export async function writeBackup(
  driver: SqlDriver,
  fs: BackupFs,
  dir: string,
  name: string,
  verify?: VerifyCopy,
) {
  if (!isRestorableName(name)) throw new BackupError("허용되지 않은 백업 이름");
  await fs.ensureDir(dir);
  if (fs.stat) {
    const dirStat = await fs.stat(dir);
    if (dirStat.isSymlink) throw new BackupError("링크 경로에는 백업을 생성할 수 없습니다");
  }
  const tmp = name + ".tmp",
    path = fs.join(dir, tmp);
  if ((await fs.list(dir)).includes(tmp)) await removeGuarded(fs, dir, tmp);
  await driver.execute(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
  if (verify && !(await verify(path))) {
    await removeGuarded(fs, dir, tmp);
    throw new BackupError(`백업 사본 검증 실패: ${name}`);
  }
  if (fs.inspect) {
    const copy = await fs.inspect(path),
      expected = parseBackupName(name)?.schemaVersion;
    if (!copy.ok || (expected != null && copy.schema !== expected)) {
      await removeGuarded(fs, dir, tmp);
      throw new BackupError("백업 구조 검사 실패");
    }
  }
  const final = fs.join(dir, name);
  await fs.rename(path, final);
  return final;
}
const queues = new Map<string, Promise<unknown>>();
const keyOf = (dir: string) => dir.replace(/\\/g, "/");
export async function backupExclusive<T>(dir: string, work: () => Promise<T>): Promise<T> {
  const key = keyOf(dir),
    previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(work);
  queues.set(key, next);
  try {
    return await next;
  } finally {
    if (queues.get(key) === next) queues.delete(key);
  }
}
export async function waitBackupIdle(dir: string) {
  await queues.get(keyOf(dir))?.catch(() => undefined);
}
export async function uniqueBackupName(fs: BackupFs, dir: string, name: string) {
  const names = new Set(await fs.list(dir));
  let candidate = name,
    i = 1;
  while (names.has(candidate) || names.has(candidate + ".tmp")) {
    candidate = name.slice(0, -3) + `_c${i++}.db`;
    if (i > 10000) throw new BackupError("백업 이름이 너무 많이 겹칩니다");
  }
  return candidate;
}
async function createVersionedBackup(
  driver: SqlDriver,
  fs: BackupFs,
  dir: string,
  now: Date,
  kind: BackupKind,
  verify?: VerifyCopy,
  to?: number,
  replaceDaily = true,
) {
  const schema = await readSchemaVersion(driver),
    name = await uniqueBackupName(fs, dir, versionedBackupName(now, kind, schema, to));
  const path = await writeBackup(driver, fs, dir, name, verify);
  if (kind === "daily" && replaceDaily)
    for (const old of await fs.list(dir)) {
      const b = parseBackupName(old);
      if (
        old !== name &&
        b?.kind === "daily" &&
        !b.legacy &&
        b.date === localDate(now) &&
        b.appVersion === BACKUP_APP_VERSION &&
        b.schemaVersion === schema
      ) {
        const [f] = await scanBackupFiles(fs, dir, [old]);
        if (f?.safe) await removeGuarded(fs, dir, old, f);
      }
    }
  return path;
}
export interface AutoBackupResult {
  daily: string;
  monthly: string | null;
  deleted: string[];
}
export async function runAutoBackup(
  driver: SqlDriver,
  fs: BackupFs,
  dataDir: string,
  now: Date,
  keep: { daily: number; monthly: number; preserve?: boolean },
  verify?: VerifyCopy,
): Promise<AutoBackupResult> {
  const dir = fs.join(dataDir, BACKUP_DIR);
  return backupExclusive(dir, async () => {
    const daily = await createVersionedBackup(
      driver,
      fs,
      dir,
      now,
      "daily",
      verify,
      undefined,
      !keep.preserve,
    );
    const monthlyNames = (await fs.list(dir)).filter((n) => {
      const b = parseBackupName(n);
      return b?.kind === "monthly" && b.date.slice(0, 7) === localMonth(now);
    });
    const exists = (await scanBackupFiles(fs, dir, monthlyNames)).some((f) => f.safe);
    const monthly =
      keep.monthly > 0 && !exists
        ? await createVersionedBackup(driver, fs, dir, now, "monthly", verify)
        : null;
    return { daily, monthly, deleted: [] };
  });
}
export const MIRROR_KEEP = 3;
export async function runMirrorBackup(
  driver: SqlDriver,
  fs: BackupFs,
  mirrorDir: string,
  now: Date,
  verify?: VerifyCopy,
  preserve = false,
) {
  return backupExclusive(mirrorDir, async () => {
    const path = await createVersionedBackup(
      driver,
      fs,
      mirrorDir,
      now,
      "daily",
      verify,
      undefined,
      !preserve,
    );
    if (preserve) return { path, deleted: [] as string[] };
    const plan = await previewBackupCleanup(
      fs,
      mirrorDir,
      {
        dailyKeep: MIRROR_KEEP,
        monthlyKeep: 120,
        periodicHours: 2,
        retentionMode: "count",
        retentionDays: 30,
        maxBytes: null,
      },
      now,
    );
    const result = await executeBackupCleanup(fs, mirrorDir, plan);
    return { path, deleted: result.deleted };
  });
}
const special = (
  driver: SqlDriver,
  fs: BackupFs,
  dataDir: string,
  now: Date,
  kind: BackupKind,
  verify?: VerifyCopy,
  to?: number,
) => {
  const dir = fs.join(dataDir, BACKUP_DIR);
  return backupExclusive(dir, () => createVersionedBackup(driver, fs, dir, now, kind, verify, to));
};
export const runManualBackup = (d: SqlDriver, f: BackupFs, dir: string, n: Date, v?: VerifyCopy) =>
  special(d, f, dir, n, "manual", v);
export const runPreImportBackup = (d: SqlDriver, f: BackupFs, dir: string, n: Date, v?: VerifyCopy) =>
  special(d, f, dir, n, "pre-import", v);
export const runPreUpdateBackup = (d: SqlDriver, f: BackupFs, dir: string, n: Date, v?: VerifyCopy) =>
  special(d, f, dir, n, "pre-update", v);
export const runPreMigrationBackup = (
  d: SqlDriver,
  f: BackupFs,
  dir: string,
  n: Date,
  to: number,
  v?: VerifyCopy,
) => special(d, f, dir, n, "pre-migration", v, to);
export async function scanBackupFiles(fs: BackupFs, dir: string, only?: string[]): Promise<BackupFile[]> {
  const out: BackupFile[] = [];
  for (const name of only ?? (await fs.list(dir))) {
    if (!fs.stat) {
      out.push({ name, size: 0, modified: null, safe: false });
      continue;
    }
    const path = fs.join(dir, name),
      st = await fs.stat(path);
    if (!st.exists || st.isDir) continue;
    const b = parseBackupName(name);
    let safe = false;
    if (
      !st.isSymlink &&
      st.size != null &&
      b &&
      (isDailyBackup(name) || isMonthlyBackup(name)) &&
      fs.inspect
    ) {
      const copy = await fs.inspect(path).catch(() => ({ ok: false, schema: null }));
      safe =
        copy.ok &&
        copy.schema !== null &&
        copy.schema >= 1 &&
        copy.schema <= LATEST_SCHEMA_VERSION &&
        (b.legacy || b.schemaVersion === copy.schema);
    }
    out.push({ name, size: st.size ?? 0, modified: st.modified ?? null, safe });
  }
  return out;
}
export async function previewBackupCleanup(fs: BackupFs, dir: string, policy: BackupPolicy, now: Date) {
  return { ...planBackupCleanup(await scanBackupFiles(fs, dir), policy, now), scope: dir };
}
export async function executeBackupCleanup(fs: BackupFs, dir: string, plan: CleanupPlan) {
  if (plan.scope !== dir) throw new BackupError("워크스페이스가 변경되었습니다. 다시 확인하세요.");
  const files = await scanBackupFiles(fs, dir);
  const fingerprint = planBackupCleanup(
    files,
    {
      dailyKeep: 3650,
      monthlyKeep: 120,
      periodicHours: 2,
      retentionMode: "count",
      retentionDays: 30,
      maxBytes: null,
    },
    new Date(),
  ).fingerprint;
  if (fingerprint !== plan.fingerprint)
    throw new BackupError("정리 대상이 변경되었습니다. 미리보기를 다시 확인하세요.");
  const deleted: string[] = [],
    failed: string[] = [];
  for (const f of plan.candidates) {
    try {
      await removeGuarded(fs, dir, f.name, f);
      deleted.push(f.name);
    } catch {
      failed.push(f.name);
    }
  }
  return {
    deleted,
    failed,
    freed: plan.candidates.filter((f) => deleted.includes(f.name)).reduce((n, f) => n + f.size, 0),
  };
}
