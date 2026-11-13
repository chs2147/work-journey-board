// Schema metadata only; no user file or network access.
import { createWorkspaceDB, SUPPORTED_SCHEMAS } from "../v2-sync/db18.mjs";
import { writeFileSync } from "node:fs";
import { hash } from "../v2-sync/model.mjs";
for (const version of SUPPORTED_SCHEMAS) {
  const db = createWorkspaceDB(":memory:", version);
  try {
    const tables = {};
    for (const { name } of db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
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
    const body = { sourceSchema: version, tables };
    writeFileSync(
      new URL(`./db${version}-contract.json`, import.meta.url),
      JSON.stringify({ ...body, fingerprint: hash(body) }, null, 2) + "\n",
    );
  } finally {
    db.close();
  }
}
