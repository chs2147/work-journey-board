import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture18 } from "../v2-sync/fixture18.mjs";
import { capture18, captureWorkspace, createWorkspaceDB } from "../v2-sync/db18.mjs";
import { hash, sourceHash } from "../v2-sync/model.mjs";
import { createConnectedCopy } from "../v2-assets/connected-copy.mjs";
import { restoreConnectedCopy } from "../v2-assets/restore-connected-copy.mjs";
import { mapWorkspace } from "./workspace-map.mjs";
import contract19 from "./db19-contract.json" with { type: "json" };
function setup(t, version = 19) {
  const dir = mkdtempSync(join(tmpdir(), "wjb-db19-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const local = join(dir, "original"),
    target = join(dir, "target");
  for (const p of [local, target]) {
    mkdirSync(p);
    writeFileSync(join(p, ".v2-poc-only"), "synthetic");
  }
  const source = join(local, "source.db"),
    destination = join(target, "copy");
  fixture18(source);
  if (version === 19) {
    const db = new DatabaseSync(source);
    db.exec(readFileSync("src/data/migrations/0019_note_delete_lock.sql", "utf8"));
    db.prepare("UPDATE app_meta SET value='19' WHERE key='schema_version'").run();
    const notes = db.prepare("SELECT id,revision FROM cabi_note ORDER BY id").all();
    db.prepare("UPDATE cabi_note SET delete_locked=1 WHERE id=?").run(notes[0].id);
    assert.deepEqual(db.prepare("SELECT id,revision FROM cabi_note ORDER BY id").all(), notes);
    db.close();
  }
  return {
    dir,
    local,
    target,
    source,
    destination,
    sourceWorkspaceId: randomUUID(),
    workspaceId: randomUUID(),
  };
}
for (const version of [18, 19]) {
  test(`DB${version}: extract/map/restore preserves all rows, images, schema and original`, (t) => {
    const e = setup(t, version),
      before = sourceHash(e.source),
      files = readdirSync(e.local);
    const original = captureWorkspace(e.source, { allowNoteImages: true });
    const copy = createConnectedCopy(e.source, e.destination, e);
    assert.equal(copy.manifest.sourceSchema, version);
    assert.equal(copy.imagePayloadRows, 0);
    const mapped = mapWorkspace(e.destination, e.workspaceId);
    assert.equal(mapped.envelope.sourceSchema, version);
    assert.equal(mapped.envelope.profile, `workspace-db${version}-map-poc-1`);
    const notes = mapped.envelope.records.filter((r) => r.table === "cabi_note");
    if (version === 19) assert.deepEqual(notes.map((r) => r.value.delete_locked).sort(), [0, 1]);
    else assert.ok(notes.every((r) => !("delete_locked" in r.value)));
    const restored = join(e.target, "restored.db");
    restoreConnectedCopy(e.destination, restored, e.workspaceId);
    assert.deepEqual(captureWorkspace(restored, { allowNoteImages: true }).rows, original.rows);
    assert.equal(sourceHash(e.source), before);
    assert.deepEqual(readdirSync(e.local), files);
    assert.throws(() => restoreConnectedCopy(e.destination, e.source, e.workspaceId), /DESTINATION_EXISTS/);
    assert.equal(sourceHash(e.source), before);
  });
}
test("DB18-specific reader refuses DB19 without downgrading source", (t) => {
  const e = setup(t),
    before = sourceHash(e.source);
  assert.throws(() => capture18(e.source), /SCHEMA_VERSION/);
  assert.equal(sourceHash(e.source), before);
});
test("DB19 restored trigger allows lock-only changes and still rejects stale body revision", (t) => {
  const e = setup(t);
  createConnectedCopy(e.source, e.destination, e);
  const dest = join(e.target, "restored.db");
  restoreConnectedCopy(e.destination, dest, e.workspaceId);
  const db = new DatabaseSync(dest);
  try {
    const n = db.prepare("SELECT id,revision FROM cabi_note LIMIT 1").get();
    db.prepare("UPDATE cabi_note SET delete_locked=1-delete_locked WHERE id=?").run(n.id);
    assert.equal(db.prepare("SELECT revision FROM cabi_note WHERE id=?").get(n.id).revision, n.revision);
    assert.throws(
      () => db.prepare("UPDATE cabi_note SET title='stale' WHERE id=?").run(n.id),
      /CABI_CONFLICT/,
    );
    assert.throws(() => db.prepare("UPDATE cabi_note SET delete_locked=2 WHERE id=?").run(n.id), /CHECK/);
  } finally {
    db.close();
  }
});
for (const mode of ["unknown-version", "wrong-schema", "invalid-lock"])
  test(`${mode} refuses extraction without output or source mutation`, (t) => {
    const e = setup(t),
      db = new DatabaseSync(e.source);
    if (mode === "unknown-version")
      db.prepare("UPDATE app_meta SET value='20' WHERE key='schema_version'").run();
    if (mode === "wrong-schema") db.exec("ALTER TABLE cabi_note ADD COLUMN unexpected TEXT");
    if (mode === "invalid-lock") {
      db.exec("PRAGMA ignore_check_constraints=ON");
      db.exec("UPDATE cabi_note SET delete_locked=2");
    }
    db.close();
    const before = sourceHash(e.source);
    assert.throws(
      () => createConnectedCopy(e.source, e.destination, e),
      /SCHEMA_VERSION|SCHEMA_UNSUPPORTED|DB_INTEGRITY/,
    );
    assert.equal(sourceHash(e.source), before);
    assert.equal(existsSync(e.destination), false);
  });
test("DB19 contract matches actual generated schema and includes delete lock", () => {
  const { fingerprint, ...body } = contract19;
  assert.equal(hash(body), fingerprint);
  const db = createWorkspaceDB(":memory:", 19);
  try {
    for (const [t, s] of Object.entries(contract19.tables))
      assert.deepEqual(
        db
          .prepare(`PRAGMA table_info("${t}")`)
          .all()
          .map((c) => ({ name: c.name, type: c.type, nullable: !c.notnull, pk: c.pk })),
        s.columns,
      );
    assert.ok(contract19.tables.cabi_note.columns.some((c) => c.name === "delete_locked"));
  } finally {
    db.close();
  }
});
test("corrupt detached image refuses restore before output creation", (t) => {
  const e = setup(t);
  const copy = createConnectedCopy(e.source, e.destination, e);
  writeFileSync(join(e.destination, "assets", copy.blobs[0].id + ".bin"), "bad");
  const dest = join(e.target, "restored.db");
  assert.throws(() => restoreConnectedCopy(e.destination, dest, e.workspaceId), /BLOB_INTEGRITY/);
  assert.equal(existsSync(dest), false);
});
