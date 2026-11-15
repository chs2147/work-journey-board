// E-1 온라인 공간 이 기기 일지(Connected Preview, docs/v2-design/88·89).
// 처음 열 때 D단계 캐시(머리·기록·그림)에서 일지를 되살리고, 같은 파일에 동기화 표를 더해 이 기기에 만든다.
// - wjb_sync_meta: 공간 ID·기준 manifest·받은 순번(cursor)
// - wjb_sync_base: 기록별 마지막으로 서버와 맞춘 판(rev)·값 해시·값(정준 JSON, 지움 = NULL) — 충돌 판정·칸 단위 합치기의 기준
// - wjb_sync_asset: 그림 해시 ↔ 서버 객체 ID(올린 그림·받은 그림) — 그림 본문은 일지 표에만, 서버에는 참조만
// - wjb_sync_conflict: 고르기 전까지 보내지 않는 충돌(서버 판·값) — E-3
// - wjb_sync_outbox: 보낼 목록(대기열) — 동기화 대상 표마다 트리거가 같은 트랜잭션 안에서 (표, 기본 키)를 적는다
// - wjb_sync_flag: 서버에서 받은 것을 적용하는 동안(applying=1)은 대기열에 적지 않는다(받은 것을 다시 보내지 않음)
import type { SqlJsStatic, Database } from "sql.js";
import { canonical, hash } from "../../poc/v2-sync/hash-core.mjs";
import type { MappedAsset, MappedRecord } from "../../poc/v2-migration/workspace-map-core.mjs";
import type { SqlDriver } from "../data/driver";
import type { PreviewSpaces } from "../platform";
import { restoreFromCache } from "./onlineWorkspace";

export const SYNC_PREFIX = "wjb_sync_";
/** 온라인으로 보내지 않는 표(이 기기 쓰기 흐름용) */
const LOCAL_ONLY = new Set(["kanban_ctx"]);

const q = (s: string) => '"' + s.replaceAll('"', '""') + '"';

/** 동기화 대상 표와 기본 키 열(일지 구조에서 읽음) */
export function syncedTables(db: Database): { table: string; pk: string[] }[] {
  const names =
    db
      .exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")[0]
      ?.values.map((v) => String(v[0])) ?? [];
  return names
    .filter((t) => !t.startsWith(SYNC_PREFIX) && !LOCAL_ONLY.has(t))
    .map((table) => {
      const cols = db.exec(`PRAGMA table_info(${q(table)})`)[0]?.values ?? [];
      // table_info: cid, name, type, notnull, dflt_value, pk
      const pk = cols
        .filter((c) => Number(c[5]) > 0)
        .sort((a, b) => Number(a[5]) - Number(b[5]))
        .map((c) => String(c[1]));
      if (!pk.length) throw Error("SYNC_TABLE_WITHOUT_KEY");
      return { table, pk };
    });
}

/** 동기화 표·트리거 만들기 — 되살린 일지(sql.js)에. records = 캐시의 서버 기록(기준) */
export function addSyncTables(
  db: Database,
  opts: {
    workspaceId: string;
    manifestHash: string;
    records: MappedRecord[];
    assets?: MappedAsset[];
    sourceSchema?: number;
  },
) {
  db.exec(`
    CREATE TABLE wjb_sync_meta(k TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE TABLE wjb_sync_base(tbl TEXT NOT NULL, key TEXT NOT NULL, rev INTEGER NOT NULL, hash TEXT NOT NULL, value TEXT, PRIMARY KEY(tbl, key));
    CREATE TABLE wjb_sync_outbox(tbl TEXT NOT NULL, pk TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(tbl, pk));
    CREATE TABLE wjb_sync_flag(id INTEGER PRIMARY KEY CHECK(id = 1), applying INTEGER NOT NULL DEFAULT 0);
    INSERT INTO wjb_sync_flag(id, applying) VALUES(1, 0);
    ${SYNC_EXTRA_DDL}
  `);
  const meta = db.prepare("INSERT INTO wjb_sync_meta(k, v) VALUES(?, ?)");
  const rows: [string, string][] = [
    ["workspaceId", opts.workspaceId],
    ["manifestHash", opts.manifestHash],
    ["cursor", "0"],
    ["createdAt", new Date().toISOString()],
    ...(opts.sourceSchema ? ([["sourceSchema", String(opts.sourceSchema)]] as [string, string][]) : []),
  ];
  for (const row of rows) meta.run(row);
  meta.free();
  const base = db.prepare("INSERT INTO wjb_sync_base(tbl, key, rev, hash, value) VALUES(?, ?, 0, ?, ?)");
  for (const r of opts.records) base.run([r.table, r.key, hash(r.value), canonical(r.value)]);
  base.free();
  const asset = db.prepare("INSERT OR IGNORE INTO wjb_sync_asset(sha256, object_id, bytes) VALUES(?, ?, ?)");
  for (const a of opts.assets ?? []) asset.run([a.sha256, a.objectId, a.bytes]);
  asset.free();
  for (const { table, pk } of syncedTables(db)) db.exec(triggerSql(table, pk).join("\n"));
}

/**
 * 대기열 트리거 — 앱의 쓰기와 같은 트랜잭션에서 (표, 기본 키 JSON)을 적는다. 바깥 문이 "있으면 고치기"(upsert)여도
 * 충돌 규칙이 덮이지 않게 트리거 안도 upsert로(E-3에서 발견: INSERT OR REPLACE는 바깥 upsert 안에서 실패).
 */
export function triggerSql(table: string, pk: string[]): string[] {
  const keyOf = (row: "NEW" | "OLD") => `json_array(${pk.map((c) => `${row}.${q(c)}`).join(", ")})`;
  const put = (row: "NEW" | "OLD") =>
    `INSERT INTO wjb_sync_outbox(tbl, pk, at) VALUES('${table.replaceAll("'", "''")}', ${keyOf(row)}, CAST(strftime('%s','now') AS INTEGER) * 1000) ON CONFLICT(tbl, pk) DO UPDATE SET at = excluded.at;`;
  const when = "WHEN (SELECT applying FROM wjb_sync_flag WHERE id = 1) = 0";
  const name = (op: string) => q(`${SYNC_PREFIX}${table}_${op}`);
  return [
    `DROP TRIGGER IF EXISTS ${name("ai")};`,
    `DROP TRIGGER IF EXISTS ${name("au")};`,
    `DROP TRIGGER IF EXISTS ${name("ad")};`,
    `CREATE TRIGGER ${name("ai")} AFTER INSERT ON ${q(table)} ${when} BEGIN ${put("NEW")} END;`,
    `CREATE TRIGGER ${name("au")} AFTER UPDATE ON ${q(table)} ${when} BEGIN ${put("OLD")} ${put("NEW")} END;`,
    `CREATE TRIGGER ${name("ad")} AFTER DELETE ON ${q(table)} ${when} BEGIN ${put("OLD")} END;`,
  ];
}

/** E-3에서 더한 표(E-1 때 만든 일지에도 `upgradeSyncTables`가 더한다) */
const SYNC_EXTRA_DDL = `
    CREATE TABLE IF NOT EXISTS wjb_sync_asset(sha256 TEXT PRIMARY KEY, object_id TEXT NOT NULL UNIQUE, bytes INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS wjb_sync_conflict(tbl TEXT NOT NULL, key TEXT NOT NULL, pk TEXT, server_rev INTEGER, server_value TEXT, at INTEGER NOT NULL, PRIMARY KEY(tbl, key));
`;

/**
 * E-1 때 만든 이 기기 일지를 E-3 모양으로(한 번만, 같은 묶음): 그림 대응표·충돌 표·기준 값 칸.
 * 기준 값이 없던 기록은 비워 둔다(그 기록은 칸 단위 합치기 없이 충돌로만 다룬다). 그림 대응표는 캐시 머리에서 채운다.
 */
export async function upgradeSyncTables(d: SqlDriver, assets: MappedAsset[], sourceSchema: number) {
  const cols = await d.select<{ name: string }>("PRAGMA table_info(wjb_sync_base)");
  const tables = (
    await d.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
  )
    .map((r) => r.name)
    .filter((t) => !t.startsWith(SYNC_PREFIX) && !LOCAL_ONLY.has(t));
  const triggers: { sql: string }[] = [];
  for (const t of tables) {
    const pk = (await d.select<{ name: string; pk: number }>(`PRAGMA table_info(${q(t)})`))
      .filter((c) => Number(c.pk) > 0)
      .sort((a, b) => Number(a.pk) - Number(b.pk))
      .map((c) => c.name);
    if (pk.length) triggers.push(...triggerSql(t, pk).map((sql) => ({ sql })));
  }
  const statements = [
    ...SYNC_EXTRA_DDL.split(";")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((sql) => ({ sql })),
    ...(cols.some((c) => c.name === "value")
      ? []
      : [{ sql: "ALTER TABLE wjb_sync_base ADD COLUMN value TEXT" }]),
    ...assets.map((a) => ({
      sql: "INSERT OR IGNORE INTO wjb_sync_asset(sha256, object_id, bytes) VALUES(?, ?, ?)",
      params: [a.sha256, a.objectId, a.bytes],
    })),
    {
      sql: "INSERT OR IGNORE INTO wjb_sync_meta(k, v) VALUES('sourceSchema', ?)",
      params: [String(sourceSchema)],
    },
    ...triggers,
  ];
  await d.batch(statements);
}

/** 캐시 머리(header.json) 중 동기화가 쓰는 부분 */
export interface CachedHeaderLike {
  assets: MappedAsset[];
  header: { sourceSchema: number };
}

export interface SpaceJournal {
  exists(workspaceId: string): Promise<boolean>;
  /** 처음 만들기(파일이 없을 때만) */
  create(workspaceId: string, bytes: Uint8Array): Promise<void>;
}

/** 이 기기 일지가 없으면 캐시에서 만든다. 있으면 그대로(이 기기에 저장된 편집이 정본) — 만들었으면 true */
export async function ensureSpaceJournal(
  SQL: SqlJsStatic,
  spaces: PreviewSpaces,
  journal: SpaceJournal,
  workspaceId: string,
): Promise<boolean> {
  if (await journal.exists(workspaceId)) return false;
  const restored = await restoreFromCache(SQL, spaces, workspaceId);
  const db = new SQL.Database(restored.bytes);
  try {
    addSyncTables(db, {
      workspaceId,
      manifestHash: restored.head.manifestHash,
      records: restored.list,
      assets: restored.head.assets,
      sourceSchema: restored.head.header.sourceSchema,
    });
    db.exec("PRAGMA journal_mode = DELETE");
    await journal.create(workspaceId, db.export());
  } finally {
    db.close();
  }
  return true;
}
