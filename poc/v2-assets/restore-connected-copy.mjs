// Synthetic round-trip verifier, not a product restore command. Never overwrites a DB.
import { existsSync, readFileSync, linkSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { inspectConnectedCopy } from "./connected-copy.mjs";
import { createWorkspaceDB, captureWorkspace, guard } from "../v2-sync/db18.mjs";
import { hash, transaction } from "../v2-sync/model.mjs";
import { mapWorkspace } from "../v2-migration/workspace-map.mjs";

export function restoreConnectedCopy(directory, destination, workspaceId) {
  guard(destination);
  if (existsSync(destination)) throw Error("DESTINATION_EXISTS");
  const copy = inspectConnectedCopy(directory, workspaceId);
  // Validate source-version contracts before creating any output.
  mapWorkspace(directory, workspaceId);
  const data = {};
  for (const r of copy.records) {
    const row = JSON.parse(r.value);
    if (["note_asset", "cabi_asset"].includes(r.table_name))
      for (const field of ["data", "thumb"]) {
        const ref = row[field + "Ref"];
        row[field] =
          ref === null ? null : readFileSync(join(directory, "assets", ref.blob + ".bin")).toString("base64");
        delete row[field + "Ref"];
      }
    (data[r.table_name] ??= []).push(row);
  }
  const temp = destination + ".partial-" + randomUUID();
  const quote = (s) => '"' + s.replaceAll('"', '""') + '"';
  let db;
  try {
    db = createWorkspaceDB(temp, copy.manifest.sourceSchema);
    const tables = db
      // sqlite_sequence (DB20 AUTOINCREMENT) is SQLite-internal: explicit ids keep it at max(id).
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => r.name);
    for (const t of tables) data[t] ??= [];
    const triggers = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'").all();
    db.exec("PRAGMA foreign_keys=OFF");
    transaction(db, () => {
      for (const t of triggers) db.exec(`DROP TRIGGER ${quote(t.name)}`);
      for (const t of tables) {
        db.exec(`DELETE FROM ${quote(t)}`);
        for (const r of data[t]) {
          const keys = Object.keys(r);
          db.prepare(
            `INSERT INTO ${quote(t)}(${keys.map(quote).join(",")}) VALUES(${keys.map(() => "?").join(",")})`,
          ).run(...keys.map((k) => r[k]));
        }
      }
      for (const t of triggers) db.exec(t.sql);
      if (db.prepare("PRAGMA foreign_key_check").all().length) throw Error("DB_INTEGRITY");
    });
    db.close();
    db = null;
    const restored = captureWorkspace(temp, {
      expectedVersion: copy.manifest.sourceSchema,
      allowNoteImages: true,
    });
    const sorted = (rows) => rows.map(hash).sort();
    for (const t of tables)
      if (hash(sorted(restored.rows[t])) !== hash(sorted(data[t]))) throw Error("ROUNDTRIP_MISMATCH");
    linkSync(temp, destination);
    return { sourceSchema: copy.manifest.sourceSchema, cloudUploaded: false };
  } finally {
    db?.close();
    if (existsSync(temp)) unlinkSync(temp);
  }
}
