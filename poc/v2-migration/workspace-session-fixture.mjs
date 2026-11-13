// Synthetic fixture for local unit/HTTP-PG tests only. Does not touch user data.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fixture18 } from "../v2-sync/fixture18.mjs";
import { createConnectedCopy } from "../v2-assets/connected-copy.mjs";
import { sourceHash } from "../v2-sync/model.mjs";
import { upgradeFixture } from "./fixture-db20.mjs";
export function workspaceSessionFixture(
  root,
  { ownerId = randomUUID(), deviceId = randomUUID(), withoutImages = false, version = 19, textSize = 0 } = {},
) {
  const localRoot = join(root, "original"),
    stateRoot = join(root, "connected");
  for (const p of [localRoot, stateRoot]) {
    mkdirSync(p);
    writeFileSync(join(p, ".v2-poc-only"), "synthetic");
  }
  const source = join(localRoot, "source.db");
  fixture18(source);
  const db = new DatabaseSync(source);
  try {
    if (version === 19) {
      db.exec(
        readFileSync(new URL("../../src/data/migrations/0019_note_delete_lock.sql", import.meta.url), "utf8"),
      );
      db.exec(
        "UPDATE app_meta SET value='19' WHERE key='schema_version'; UPDATE cabi_note SET delete_locked=1 WHERE id='n1'",
      );
    }
    if (version === 20) upgradeFixture(db, 20);
    if (textSize)
      db.prepare("UPDATE cabi_note SET plain_text=?,revision=revision+1 WHERE id='n1'").run(
        "가".repeat(textSize),
      );
    if (withoutImages) {
      for (const table of ["week_note", "cabi_board"])
        for (const row of db.prepare(`SELECT * FROM ${table}`).all()) {
          const d = JSON.parse(row.doc);
          for (const b of d.boxes)
            if (b.asset) {
              delete b.asset;
              b.kind = "text";
              b.content = { type: "doc", content: [{ type: "paragraph" }] };
            }
          db.prepare(
            table === "week_note"
              ? "UPDATE week_note SET doc=? WHERE week_id=?"
              : "UPDATE cabi_board SET doc=?,revision=revision+1 WHERE id=?",
          ).run(JSON.stringify(d), table === "week_note" ? row.week_id : row.id);
        }
      db.exec("DELETE FROM note_asset; DELETE FROM cabi_asset");
    }
  } finally {
    db.close();
  }
  const directory = join(stateRoot, "copy"),
    workspaceId = randomUUID();
  createConnectedCopy(source, directory, { workspaceId, sourceWorkspaceId: randomUUID() });
  return {
    source,
    directory,
    workspaceId,
    localRoot,
    stateRoot,
    path: join(stateRoot, "migration.db"),
    actor: { ownerId, deviceId },
    before: sourceHash(source),
  };
}
