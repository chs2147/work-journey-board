import { Buffer } from "node:buffer";
import { verifyStage, create18 } from "./db18.mjs";
import { hash, transaction } from "./model.mjs";

export const rowId = (table, values) => JSON.stringify([table, values]);
export function importStage(db, path, scope) {
  const verified = verifyStage(path, scope),
    schema = create18(":memory:");
  const records = [],
    assets = [];
  try {
    const allowed = new Set(
      schema
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((r) => r.name),
    );
    for (const [table, rows] of Object.entries(verified.rows)) {
      if (!allowed.has(table)) throw Error("TABLE_UNSUPPORTED");
      if (table === "app_meta") continue; // local schema metadata is not sync content
      const keys = schema
        .prepare(`PRAGMA table_info("${table}")`)
        .all()
        .filter((c) => c.pk)
        .sort((a, b) => a.pk - b.pk)
        .map((c) => c.name);
      if (!keys.length) throw Error("PRIMARY_KEY_REQUIRED");
      for (const source of rows) {
        const row = { ...source };
        if (table === "note_asset" || table === "cabi_asset")
          for (const field of ["data", "thumb"]) {
            if (row[field] === null) continue;
            const bytes = Buffer.from(row[field], "base64"),
              id = hash(bytes);
            assets.push([id, bytes]);
            delete row[field];
            row[field + "Ref"] = { hash: id, bytes: bytes.length };
          }
        records.push([
          rowId(
            table,
            keys.map((k) => row[k]),
          ),
          { table, row },
        ]);
      }
    }
  } finally {
    schema.close();
  }
  db.exec(
    "CREATE TABLE IF NOT EXISTS imported(scope TEXT PRIMARY KEY,manifest TEXT);CREATE TABLE IF NOT EXISTS local_assets(scope TEXT,hash TEXT,bytes BLOB,PRIMARY KEY(scope,hash));",
  );
  transaction(db, () => {
    for (const table of ["records", "pending", "working", "conflicts", "imported"])
      if (db.prepare(`SELECT 1 FROM ${table} WHERE scope=?`).get(scope)) throw Error("TARGET_NOT_EMPTY");
    const st = db.prepare("SELECT * FROM state WHERE scope=?").get(scope);
    if (st && (st.generation !== 1 || st.cursor !== 0)) throw Error("TARGET_NOT_EMPTY");
    db.prepare("INSERT OR IGNORE INTO state(scope) VALUES(?)").run(scope);
    for (const [id, body] of records)
      db.prepare("INSERT INTO records VALUES(?,?,1,?)").run(scope, id, JSON.stringify(body));
    for (const [id, bytes] of assets)
      db.prepare("INSERT OR IGNORE INTO local_assets VALUES(?,?,?)").run(scope, id, bytes);
    db.prepare("INSERT INTO imported VALUES(?,?)").run(scope, JSON.stringify(verified.manifest));
  });
  return { records: records.length, uniqueAssets: new Set(assets.map((a) => a[0])).size };
}
