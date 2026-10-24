// 스키마 마이그레이션(data-spec 7-5): 번호 순 전진 전용, 기존 데이터가 있으면 직전 백업 후 단일 트랜잭션으로 적용.
import type { SqlDriver, SqlStatement } from "./driver";
import init0001 from "./migrations/0001_init.sql?raw";
import importantRepeat0002 from "./migrations/0002_important_repeat.sql?raw";

export interface Migration {
  version: number;
  sql: string;
}

/** 앱이 아는 마이그레이션(오름차순). 새 파일은 끝에만 추가한다. */
export const MIGRATIONS: Migration[] = [
  { version: 1, sql: init0001 },
  { version: 2, sql: importantRepeat0002 },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS.at(-1)!.version;

/** 주석을 지우고 줄 끝 세미콜론 기준으로 문장을 나눈다. */
export function splitSql(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function readSchemaVersion(driver: SqlDriver): Promise<number> {
  const [t] = await driver.select<{ n: number }>(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'app_meta'",
  );
  if (!t?.n) return 0;
  const [row] = await driver.select<{ value: string }>(
    "SELECT value FROM app_meta WHERE key = 'schema_version'",
  );
  return row ? Number(row.value) : 0;
}

export class NewerSchemaError extends Error {
  constructor(readonly fileVersion: number) {
    super(
      `이 데이터 파일은 더 새 버전의 앱(스키마 v${fileVersion})에서 만들어졌습니다. 앱을 업데이트하세요.`,
    );
  }
}

export interface MigrateOptions {
  /** 기존 데이터가 있는 파일을 올리기 직전에 호출(마이그레이션 직전 백업) */
  beforeMigrate?: (from: number, to: number) => Promise<void>;
  migrations?: Migration[];
  /** app_meta 초기값 등에 쓰는 시각 */
  now?: () => Date;
}

/** 필요한 만큼 올리고 최종 스키마 버전을 돌려준다. 앱보다 높은 버전이면 NewerSchemaError(쓰기 금지). */
export async function migrate(driver: SqlDriver, opts: MigrateOptions = {}): Promise<number> {
  const migrations = opts.migrations ?? MIGRATIONS;
  const latest = migrations.at(-1)?.version ?? 0;
  const from = await readSchemaVersion(driver);
  if (from > latest) throw new NewerSchemaError(from);
  if (from === latest) return from;

  if (from > 0) await opts.beforeMigrate?.(from, latest);

  const now = (opts.now ?? (() => new Date()))().toISOString();
  const statements: SqlStatement[] = [];
  for (const m of migrations.filter((x) => x.version > from)) {
    for (const sql of splitSql(m.sql)) statements.push({ sql });
  }
  statements.push({
    sql: "INSERT INTO app_meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    params: [String(latest)],
  });
  if (from === 0) {
    statements.push({ sql: "INSERT INTO app_meta (key, value) VALUES ('created_at', ?)", params: [now] });
  }
  await driver.batch(statements);
  return latest;
}

/** 무결성 검사(data-spec 7-3) */
export async function quickCheck(driver: SqlDriver): Promise<boolean> {
  const rows = await driver.select<{ quick_check: string }>("PRAGMA quick_check");
  return rows.length === 1 && rows[0]?.quick_check === "ok";
}
