// E-1 온라인 공간 이 기기 일지(Connected Preview, docs/v2-design/88·89).
// 처음 열 때 D단계 캐시(머리·기록·그림)에서 일지를 되살리고, 같은 파일에 동기화 표를 더해 이 기기에 만든다.
// - wjb_sync_meta: 공간 ID·기준 manifest·받은 순번(cursor)
// - wjb_sync_base: 기록별 마지막으로 서버와 맞춘 판(rev)·값 해시 — 충돌 판정의 기준
// - wjb_sync_outbox: 보낼 목록(대기열) — 동기화 대상 표마다 트리거가 같은 트랜잭션 안에서 (표, 기본 키)를 적는다
// - wjb_sync_flag: 서버에서 받은 것을 적용하는 동안(applying=1)은 대기열에 적지 않는다(받은 것을 다시 보내지 않음)
import type { SqlJsStatic, Database } from "sql.js";
import { hash } from "../../poc/v2-sync/hash-core.mjs";
import type { MappedRecord } from "../../poc/v2-migration/workspace-map-core.mjs";
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
  opts: { workspaceId: string; manifestHash: string; records: MappedRecord[] },
) {
  db.exec(`
    CREATE TABLE wjb_sync_meta(k TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE TABLE wjb_sync_base(tbl TEXT NOT NULL, key TEXT NOT NULL, rev INTEGER NOT NULL, hash TEXT NOT NULL, PRIMARY KEY(tbl, key));
    CREATE TABLE wjb_sync_outbox(tbl TEXT NOT NULL, pk TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(tbl, pk));
    CREATE TABLE wjb_sync_flag(id INTEGER PRIMARY KEY CHECK(id = 1), applying INTEGER NOT NULL DEFAULT 0);
    INSERT INTO wjb_sync_flag(id, applying) VALUES(1, 0);
  `);
  const meta = db.prepare("INSERT INTO wjb_sync_meta(k, v) VALUES(?, ?)");
  const rows: [string, string][] = [
    ["workspaceId", opts.workspaceId],
    ["manifestHash", opts.manifestHash],
    ["cursor", "0"],
    ["createdAt", new Date().toISOString()],
  ];
  for (const row of rows) meta.run(row);
  meta.free();
  const base = db.prepare("INSERT INTO wjb_sync_base(tbl, key, rev, hash) VALUES(?, ?, 0, ?)");
  for (const r of opts.records) base.run([r.table, r.key, hash(r.value)]);
  base.free();
  for (const { table, pk } of syncedTables(db)) {
    const keyOf = (row: "NEW" | "OLD") => `json_array(${pk.map((c) => `${row}.${q(c)}`).join(", ")})`;
    const put = (row: "NEW" | "OLD") =>
      `INSERT OR REPLACE INTO wjb_sync_outbox(tbl, pk, at) VALUES('${table.replaceAll("'", "''")}', ${keyOf(row)}, CAST(strftime('%s','now') AS INTEGER) * 1000);`;
    const when = "WHEN (SELECT applying FROM wjb_sync_flag WHERE id = 1) = 0";
    const name = (op: string) => q(`${SYNC_PREFIX}${table}_${op}`);
    db.exec(`
      CREATE TRIGGER ${name("ai")} AFTER INSERT ON ${q(table)} ${when} BEGIN ${put("NEW")} END;
      CREATE TRIGGER ${name("au")} AFTER UPDATE ON ${q(table)} ${when} BEGIN ${put("OLD")} ${put("NEW")} END;
      CREATE TRIGGER ${name("ad")} AFTER DELETE ON ${q(table)} ${when} BEGIN ${put("OLD")} END;
    `);
  }
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
    addSyncTables(db, { workspaceId, manifestHash: restored.head.manifestHash, records: restored.list });
    db.exec("PRAGMA journal_mode = DELETE");
    await journal.create(workspaceId, db.export());
  } finally {
    db.close();
  }
  return true;
}
