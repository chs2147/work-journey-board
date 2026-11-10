import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  symlinkSync,
  readdirSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fixture18 } from "../v2-sync/fixture18.mjs";
import { capture18 } from "../v2-sync/db18.mjs";
import { sourceHash } from "../v2-sync/model.mjs";
import { createConnectedCopy, inspectConnectedCopy } from "./connected-copy.mjs";

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), "wjb-connected-copy-"));
  writeFileSync(join(dir, ".v2-poc-only"), "synthetic data only");
  const localRoot = join(dir, "local-workspace"),
    connectedRoot = join(dir, "connected-root");
  for (const root of [localRoot, connectedRoot]) {
    mkdirSync(root);
    writeFileSync(join(root, ".v2-poc-only"), "synthetic data only");
  }
  const source = join(localRoot, "local.db"),
    destination = join(connectedRoot, "online-copy");
  fixture18(source);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, source, destination, sourceWorkspaceId: randomUUID(), workspaceId: randomUUID() };
}
function mutate(source, fn) {
  const db = new DatabaseSync(source);
  try {
    fn(db);
  } finally {
    db.close();
  }
}
function copy(e, extra = {}) {
  return createConnectedCopy(e.source, e.destination, {
    sourceWorkspaceId: e.sourceWorkspaceId,
    workspaceId: e.workspaceId,
    ...extra,
  });
}
test("primary invariant: source DB retains embedded images, new online DB has references only", (t) => {
  const e = setup(t),
    before = sourceHash(e.source),
    original = capture18(e.source);
  const result = copy(e);
  assert.equal(sourceHash(e.source), before);
  assert.deepEqual(capture18(e.source).rows, original.rows);
  assert.equal(result.manifest.workspaceId, e.workspaceId);
  assert.notEqual(result.manifest.workspaceId, e.sourceWorkspaceId);
  assert.equal(result.manifest.phase, "local-extracted-not-uploaded");
  assert.equal(result.imagePayloadRows, 0);
  assert.equal(result.cloudUploaded, false);
  for (const [table, rows] of Object.entries(original.rows)) {
    const converted = result.records.filter((r) => r.table_name === table).map((r) => JSON.parse(r.value));
    assert.equal(converted.length, rows.length);
    if (!["note_asset", "cabi_asset"].includes(table)) assert.deepEqual(converted, rows);
    else
      for (const [i, row] of converted.entries()) {
        assert.equal("data" in row, false);
        assert.equal("thumb" in row, false);
        const bytes = readFileSync(join(e.destination, "assets", row.dataRef.blob + ".bin"));
        assert.equal(bytes.toString("base64"), rows[i].data);
        const metadata = Object.fromEntries(
          Object.entries(rows[i]).filter(([key]) => !["data", "thumb"].includes(key)),
        );
        const actualMetadata = Object.fromEntries(
          Object.entries(row).filter(([key]) => !["dataRef", "thumbRef"].includes(key)),
        );
        assert.deepEqual(actualMetadata, metadata);
      }
  }
  const db = new DatabaseSync(join(e.destination, "metadata.db"), { readOnly: true });
  try {
    for (const table of ["records", "blob_ref", "copy_info"])
      assert.ok(
        db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .every((c) => c.type !== "BLOB"),
      );
    const values = JSON.stringify(db.prepare("SELECT * FROM records").all());
    assert.ok(!values.includes(original.rows.note_asset[0].data));
    const dbFile = readFileSync(join(e.destination, "metadata.db"));
    assert.equal(dbFile.includes(Buffer.from(original.rows.note_asset[0].data)), false);
    assert.equal(dbFile.includes(Buffer.from(original.rows.note_asset[0].data, "base64")), false);
  } finally {
    db.close();
  }
});
test("same-image Blob sharing is secondary; distinct logical image owners remain", (t) => {
  const e = setup(t),
    r = copy(e);
  assert.equal(r.manifest.assetReferences, 2);
  assert.equal(r.blobs.length, 1);
  assert.equal(r.records.filter((x) => ["note_asset", "cabi_asset"].includes(x.table_name)).length, 2);
});
test("thumbnail is also extracted from both legacy asset tables", (t) => {
  const e = setup(t);
  mutate(e.source, (db) => {
    for (const table of ["note_asset", "cabi_asset"])
      db.exec(`UPDATE ${table} SET thumb=data,thumb_mime=mime`);
  });
  const before = sourceHash(e.source),
    r = copy(e);
  assert.equal(r.manifest.assetReferences, 4);
  assert.equal(r.blobs.length, 1);
  assert.equal(sourceHash(e.source), before);
});
test("task-note image uses its owned asset reference and preserves its binary outside DB", (t) => {
  const e = setup(t);
  mutate(e.source, (db) => {
    db.exec(
      "INSERT INTO cabi_asset(id,owner_kind,owner_id,mime,data,width,height,bytes,created_at) SELECT 'note-image','note','n1',mime,data,width,height,bytes,created_at FROM cabi_asset WHERE id='ca'",
    );
    db.prepare("UPDATE cabi_note SET content=?,revision=revision+1 WHERE id='n1'").run(
      JSON.stringify({ type: "doc", content: [{ type: "image", attrs: { asset: "note-image" } }] }),
    );
  });
  const before = sourceHash(e.source),
    r = copy(e);
  assert.equal(r.manifest.assetReferences, 3);
  assert.equal(r.imagePayloadRows, 0);
  assert.equal(sourceHash(e.source), before);
  assert.ok(r.records.find((x) => x.table_name === "cabi_asset" && JSON.parse(x.value).id === "note-image"));
});
test("original local workspace can continue independently after extraction", (t) => {
  const e = setup(t),
    r = copy(e);
  const oldEntry = r.records.find((x) => x.table_name === "entry_item").value;
  mutate(e.source, (db) => db.exec("UPDATE entry_item SET text='로컬에서 계속 작성' WHERE id='e1'"));
  const unchanged = inspectConnectedCopy(e.destination, e.workspaceId);
  assert.equal(unchanged.records.find((x) => x.table_name === "entry_item").value, oldEntry);
  assert.equal(capture18(e.source).rows.note_asset[0].data.length > 0, true);
});
test("online copy gets a distinct workspace even from same source snapshot", (t) => {
  const e = setup(t),
    first = copy(e);
  const id = randomUUID(),
    second = createConnectedCopy(e.source, join(e.dir, "other-copy"), {
      sourceWorkspaceId: e.sourceWorkspaceId,
      workspaceId: id,
    });
  assert.notEqual(first.blobs[0].object_key, second.blobs[0].object_key);
});
for (const point of ["files-written", "metadata-written"]) {
  test(`failure at ${point} leaves source usable and no published destination`, (t) => {
    const e = setup(t),
      before = sourceHash(e.source);
    assert.throws(
      () =>
        copy(e, {
          checkpoint: (p) => {
            if (p === point) throw Error("INJECTED");
          },
        }),
      /INJECTED/,
    );
    assert.equal(sourceHash(e.source), before);
    assert.equal(existsSync(e.destination), false);
    assert.ok(capture18(e.source).rows.note_asset[0].data);
  });
}
test("source change during extraction rejects publication", (t) => {
  const e = setup(t);
  assert.throws(
    () =>
      copy(e, {
        checkpoint: (p) => {
          if (p === "metadata-written")
            mutate(e.source, (db) => db.exec("UPDATE entry_item SET text='외부 변경' WHERE id='e1'"));
        },
      }),
    /SOURCE_CHANGED/,
  );
  assert.equal(existsSync(e.destination), false);
});
test("original path and existing destination can never be overwritten", (t) => {
  const e = setup(t),
    before = sourceHash(e.source);
  assert.throws(() => createConnectedCopy(e.source, e.source, e), /DESTINATION_EXISTS/);
  writeFileSync(e.destination, "existing user file");
  assert.throws(() => copy(e), /DESTINATION_EXISTS/);
  assert.equal(readFileSync(e.destination, "utf8"), "existing user file");
  assert.equal(sourceHash(e.source), before);
});
test("same source/online identity is rejected", (t) => {
  const e = setup(t);
  assert.throws(() => copy(e, { workspaceId: e.sourceWorkspaceId }), /NEW_WORKSPACE_REQUIRED/);
});
test("online destination cannot add files inside the preserved local workspace", (t) => {
  const e = setup(t),
    localRoot = join(e.dir, "local-workspace");
  const before = sourceHash(e.source),
    files = readdirSync(localRoot);
  assert.throws(() => createConnectedCopy(e.source, join(localRoot, "online-copy"), e), /PATH_OVERLAP/);
  assert.equal(sourceHash(e.source), before);
  assert.deepEqual(readdirSync(localRoot), files);
});
for (const [name, change, error] of [
  ["bad base64", (db) => db.exec("UPDATE note_asset SET data='invalid%%'"), /ASSET_ENCODING/],
  ["byte count mismatch", (db) => db.exec("UPDATE cabi_asset SET bytes=999"), /ASSET_ENCODING/],
  [
    "unrecognized inline image",
    (db) => db.exec("UPDATE entry_item SET text='data:image/png;base64,unknown' WHERE id='e1'"),
    /INLINE_IMAGE_IN_METADATA/,
  ],
  ["unknown future schema", (db) => db.exec("CREATE TABLE future_images(data BLOB)"), /SCHEMA_UNSUPPORTED/],
  [
    "unowned note image node",
    (db) =>
      db.exec(
        `UPDATE cabi_note SET content='{"type":"doc","content":[{"type":"image","attrs":{"asset":"ca"}}]}',revision=revision+1 WHERE id='n1'`,
      ),
    /NOTE_IMAGE_OWNER/,
  ],
]) {
  test(`${name} fails closed without dropping image or modifying original`, (t) => {
    const e = setup(t);
    mutate(e.source, change);
    const before = sourceHash(e.source);
    assert.throws(() => copy(e), error);
    assert.equal(sourceHash(e.source), before);
    assert.equal(existsSync(e.destination), false);
  });
}
test("active journal requires a frozen snapshot", (t) => {
  const e = setup(t);
  writeFileSync(e.source + "-journal", "active");
  assert.throws(() => copy(e), /SOURCE_NOT_FROZEN/);
  assert.equal(existsSync(e.destination), false);
});
test("source symlink is rejected", (t) => {
  const e = setup(t),
    alias = join(e.dir, "alias.db");
  symlinkSync(e.source, alias);
  assert.throws(() => createConnectedCopy(alias, e.destination, e), /SYMLINK_DENIED/);
});
test("missing READY cannot be activated", (t) => {
  const e = setup(t);
  copy(e);
  rmSync(join(e.destination, "READY"));
  assert.throws(() => inspectConnectedCopy(e.destination, e.workspaceId), /COPY_NOT_READY/);
});
test("wrong workspace cannot open a copy", (t) => {
  const e = setup(t);
  copy(e);
  assert.throws(() => inspectConnectedCopy(e.destination, randomUUID()), /MANIFEST_SCOPE/);
});
test("tampered external image is detected", (t) => {
  const e = setup(t);
  copy(e);
  writeFileSync(join(e.destination, "assets", readdirSync(join(e.destination, "assets"))[0]), "corrupt");
  assert.throws(() => inspectConnectedCopy(e.destination, e.workspaceId), /BLOB_INTEGRITY/);
});
test("tampered metadata is detected", (t) => {
  const e = setup(t);
  copy(e);
  mutate(join(e.destination, "metadata.db"), (db) =>
    db.exec("UPDATE records SET value='{}' WHERE table_name='note_asset'"),
  );
  assert.throws(() => inspectConnectedCopy(e.destination, e.workspaceId), /RECORD_CHANGED/);
});
