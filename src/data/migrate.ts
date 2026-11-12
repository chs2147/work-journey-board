import frame0018 from "./migrations/0018_note_frames.sql?raw";
import noteLock0019 from "./migrations/0019_note_delete_lock.sql?raw";
import kanban0020 from "./migrations/0020_kanban.sql?raw";
import live0017 from "./migrations/0017_live_widgets.sql?raw";
import cabi0016 from "./migrations/0016_cabi_net.sql?raw";
// 스키마 마이그레이션(data-spec 7-5): 번호 순 전진 전용, 기존 데이터가 있으면 직전 백업 후 단일 트랜잭션으로 적용.
import { RECOMMENDED_BACKUP_POLICY } from "./backupPolicy";
import type { SqlDriver, SqlStatement } from "./driver";
import init0001 from "./migrations/0001_init.sql?raw";
import importantRepeat0002 from "./migrations/0002_important_repeat.sql?raw";
import weekNote0003 from "./migrations/0003_week_note.sql?raw";
import import0004 from "./migrations/0004_import.sql?raw";
import dayMark0005 from "./migrations/0005_day_mark.sql?raw";
import tags0006 from "./migrations/0006_tags.sql?raw";
import noteThumb0007 from "./migrations/0007_note_thumb.sql?raw";
import dayMarkExt0008 from "./migrations/0008_day_mark_ext.sql?raw";
import cabinet0009 from "./migrations/0009_cabinet.sql?raw";
import startTime0010 from "./migrations/0010_start_time.sql?raw";
import universeRelation0011 from "./migrations/0011_universe_relation.sql?raw";
import knowledgeCard0012 from "./migrations/0012_knowledge_card.sql?raw";
import dueDate0013 from "./migrations/0013_due_date.sql?raw";

import completion0014 from "./migrations/0014_completion_origin.sql?raw";

import noteLinks0015 from "./migrations/0015_note_entry_link.sql?raw";

export interface Migration {
  version: number;
  sql: string;
}

/** 앱이 아는 마이그레이션(오름차순). 새 파일은 끝에만 추가한다. */
export const MIGRATIONS: Migration[] = [
  { version: 1, sql: init0001 },
  { version: 2, sql: importantRepeat0002 },
  { version: 3, sql: weekNote0003 },
  { version: 4, sql: import0004 },
  { version: 5, sql: dayMark0005 },
  { version: 6, sql: tags0006 },
  { version: 7, sql: noteThumb0007 },
  { version: 8, sql: dayMarkExt0008 },
  { version: 9, sql: cabinet0009 },
  { version: 10, sql: startTime0010 },
  { version: 11, sql: universeRelation0011 },
  { version: 12, sql: knowledgeCard0012 },
  { version: 13, sql: dueDate0013 },
  { version: 14, sql: completion0014 },
  { version: 15, sql: noteLinks0015 },
  { version: 16, sql: cabi0016 },
  { version: 17, sql: live0017 },
  { version: 18, sql: frame0018 },
  { version: 19, sql: noteLock0019 },
  { version: 20, sql: kanban0020 },
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
    statements.push({
      sql: "INSERT INTO app_meta (key,value) VALUES ('settings', ?)",
      params: [JSON.stringify({ backup: RECOMMENDED_BACKUP_POLICY })],
    });
  }
  await driver.batch(statements);
  return latest;
}

/** 무결성 검사(data-spec 7-3) */
export async function quickCheck(driver: SqlDriver): Promise<boolean> {
  const rows = await driver.select<{ quick_check: string }>("PRAGMA quick_check");
  return rows.length === 1 && rows[0]?.quick_check === "ok";
}

/** 전체 무결성 검사(optimize-1031-plan B7) — quick_check보다 느려서 월간 사본을 만들 때만 */
export async function integrityCheck(driver: SqlDriver): Promise<boolean> {
  const rows = await driver.select<{ integrity_check: string }>("PRAGMA integrity_check");
  return rows.length === 1 && rows[0]?.integrity_check === "ok";
}

/** 복원·마이그레이션에 필요한 표와 알려진 열도 확인한다. 읽기 전용. */
export async function backupStructureMatches(driver: SqlDriver, version: number): Promise<boolean> {
  if (!Number.isSafeInteger(version) || version < 1) return false;
  if (version > LATEST_SCHEMA_VERSION) return true; // 새 구조는 호출자가 복원/삭제를 거부하며 보호 사본 생성은 허용한다.
  const required: [number, string[]][] = [
    [1, ["app_meta", "category", "category_period", "entry_item", "day_memo", "weekly_summary"]],
    [2, ["recurrence", "recurrence_line", "recurrence_week"]],
    [3, ["week_note", "note_asset"]],
    [4, ["import_batch"]],
    [5, ["day_mark"]],
    [6, ["tag", "category_tag"]],
    [9, ["cabinet_item", "cabinet_link"]],
    [15, ["note_entry_link"]],
    [16, ["cabi_note", "cabi_board", "cabi_asset", "cabi_entry_link"]],
    [11, ["universe_relation"]],
    [12, ["knowledge_card", "knowledge_card_category", "knowledge_card_source"]],
  ];
  const tables = new Set(
    (await driver.select<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'")).map(
      (r) => r.name,
    ),
  );
  if (required.some(([v, names]) => v <= version && names.some((n) => !tables.has(n)))) return false;
  const columns = new Set(
    (await driver.select<{ name: string }>("PRAGMA table_info(entry_item)")).map((r) => r.name),
  );
  if (
    ["id", "date", "category_id", "seq", "depth", "text", "created_at", "updated_at"].some(
      (c) => !columns.has(c),
    )
  )
    return false;
  if (version >= 15) {
    const noteColumns = new Set(
      (await driver.select<{ name: string }>("PRAGMA table_info(note_entry_link)")).map((c) => c.name),
    );
    if (["note_week_id", "box_id", "entry_id", "created_at"].some((c) => !noteColumns.has(c))) return false;
  }
  if (version >= 16) {
    for (const [table, requiredColumns] of [
      ["cabi_note", ["id", "category_id", "title", "content", "plain_text", "format_version", "revision"]],
      ["cabi_board", ["id", "category_id", "doc", "format_version", "revision"]],
      ["cabi_asset", ["id", "owner_kind", "owner_id", "data", "mime"]],
      ["cabi_entry_link", ["board_id", "box_id", "entry_id"]],
    ] as const) {
      const cols = new Set(
        (await driver.select<{ name: string }>(`PRAGMA table_info(${table})`)).map((c) => c.name),
      );
      if (requiredColumns.some((c) => !cols.has(c))) return false;
    }
  }
  const introduced: [number, string[]][] = [
    [2, ["flagged", "flag_done_at", "recurrence_id"]],
    [4, ["import_id"]],
    [10, ["start_time"]],
    [13, ["due_date"]],
    [14, ["completion_was_flagged"]],
  ];
  return introduced.every(([v, names]) => names.every((n) => columns.has(n) === version >= v));
}
