// Schema metadata only; no user file or network access.
import { create18 } from "../v2-sync/db18.mjs";
import { writeFileSync } from "node:fs";
import { hash } from "../v2-sync/model.mjs";
const db = create18(":memory:");
try {
  const tables = {};
  for (const { name } of db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()) {
    tables[name] = {
      columns: db
        .prepare(`PRAGMA table_info("${name}")`)
        .all()
        .map((c) => ({ name: c.name, type: c.type, nullable: !c.notnull, pk: c.pk })),
      foreignKeys: db
        .prepare(`PRAGMA foreign_key_list("${name}")`)
        .all()
        .map((f) => ({ id: f.id, seq: f.seq, table: f.table, from: f.from, to: f.to })),
    };
  }
  const body = { sourceSchema: 18, tables };
  writeFileSync(
    new URL("./db18-contract.json", import.meta.url),
    JSON.stringify({ ...body, fingerprint: hash(body) }, null, 2) + "\n",
  );
} finally {
  db.close();
}
