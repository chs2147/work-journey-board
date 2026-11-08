import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture18 } from "./fixture18.mjs";
import { capture18, convert18, verifyStage, restore18 } from "./db18.mjs";
import { sourceHash, hash } from "./model.mjs";
function setup(t, n = 17) {
  const dir = mkdtempSync(join(tmpdir(), "wjb-v2-db18-"));
  writeFileSync(join(dir, ".v2-poc-only"), "synthetic DB18 only");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const src = join(dir, "source.db"),
    dest = join(dir, "stage.db");
  fixture18(src, n);
  return { dir, src, dest };
}
function mutate(path, fn) {
  const d = new DatabaseSync(path);
  try {
    fn(d);
  } finally {
    d.close();
  }
}
for (const n of [17, 41, 73]) {
  test(`DB18/${n}: all tables/columns, document/asset/link manifest, two scopes`, (t) => {
    const e = setup(t, n),
      before = sourceHash(e.src),
      expected = capture18(e.src);
    const m = convert18(e.src, e.dest, "u/w"),
      actual = verifyStage(e.dest, "u/w");
    assert.deepEqual(actual.rows, expected.rows);
    const restored = join(e.dir, "restored.db");
    restore18(e.dest, restored, "u/w");
    assert.deepEqual(capture18(restored).rows, expected.rows);
    assert.throws(() => restore18(e.dest, restored, "u/w"), /DESTINATION_EXISTS/);

    assert.equal(sourceHash(e.src), before);
    assert.equal(m.tables.entry_item.count, 8);
    assert.equal(m.tables.week_note.count, 2);
    assert.equal(m.tables.cabi_note.count, 2);
    assert.equal(m.tables.cabi_board.count, 2);
    for (const name of ["note_asset", "cabi_asset", "note_entry_link", "cabi_entry_link", "cabinet_link"])
      assert.equal(m.tables[name].count, 1);
    assert.equal(m.tables.recurrence.count, 1);
    assert.equal(Object.keys(m.blobs).length, 1);
    const second = join(e.dir, "second.db");
    convert18(e.src, second, "u/other");
    assert.throws(() => verifyStage(second, "u/w"), /MANIFEST_SCOPE_FORMAT/);
    assert.deepEqual(verifyStage(second, "u/other").rows, expected.rows);
    t.diagnostic(
      JSON.stringify({
        case: `DB18/${n}`,
        sourceHash: before,
        fixtureHash: hash(expected.rows),
        manifestHash: hash(m),
        tables: Object.keys(m.tables).length,
        entries: 8,
        assets: 2,
        uniqueBlobs: 1,
        status: "PASS",
      }),
    );
  });
}
const invalid = [
  [
    "newer schema",
    (d) => d.exec("UPDATE app_meta SET value='19' WHERE key='schema_version'"),
    /SCHEMA_VERSION/,
  ],
  ["unknown table", (d) => d.exec("CREATE TABLE future_data(id TEXT)"), /SCHEMA_UNSUPPORTED/],
  ["unknown column", (d) => d.exec("ALTER TABLE week_note ADD COLUMN future TEXT"), /SCHEMA_UNSUPPORTED/],
  [
    "missing linked entry",
    (d) => d.exec("PRAGMA foreign_keys=OFF;UPDATE note_entry_link SET entry_id='missing'"),
    /DB_INTEGRITY/,
  ],
  ["missing linked box", (d) => d.exec("UPDATE note_entry_link SET box_id='missing'"), /LINK_REFERENCE/],
  ["wrong image owner", (d) => d.exec("UPDATE note_asset SET week_id='2026-W45'"), /ASSET_OWNER/],
  ["bad base64", (d) => d.exec("UPDATE note_asset SET data='%%%INVALID'"), /ASSET_BYTES/],
  ["wrong image size", (d) => d.exec("UPDATE cabi_asset SET bytes=999"), /ASSET_BYTES/],
  ["bad JSON", (d) => d.exec("UPDATE week_note SET doc='not-json'"), /JSON|Unexpected/],
  [
    "missing image reference",
    (d) => {
      const r = d.prepare("SELECT doc FROM week_note WHERE week_id='2026-W44'").get();
      const doc = JSON.parse(r.doc);
      doc.boxes[1].asset = "gone";
      d.prepare("UPDATE week_note SET doc=? WHERE week_id='2026-W44'").run(JSON.stringify(doc));
    },
    /ASSET_OWNER/,
  ],
  [
    "dangling arrow",
    (d) => {
      const r = d.prepare("SELECT doc FROM week_note WHERE week_id='2026-W44'").get();
      const doc = JSON.parse(r.doc);
      doc.edges[0].to = "gone";
      d.prepare("UPDATE week_note SET doc=? WHERE week_id='2026-W44'").run(JSON.stringify(doc));
    },
    /EDGE_REFERENCE/,
  ],
];
for (const [name, change, error] of invalid)
  test(`DB18 rejects ${name} without publication`, (t) => {
    const e = setup(t);
    mutate(e.src, change);
    const before = sourceHash(e.src);
    assert.throws(() => convert18(e.src, e.dest, "u/w"), error);
    assert.equal(sourceHash(e.src), before);
    assert.equal(existsSync(e.dest), false);
    assert.equal(
      readdirSync(e.dir).some((f) => f.includes(".partial-")),
      false,
    );
  });
test("DB18 exclusive destination and source protection", (t) => {
  const e = setup(t),
    before = sourceHash(e.src);
  assert.throws(() => convert18(e.src, e.src, "u/w"), /DESTINATION_EXISTS/);
  writeFileSync(e.dest, "previous good data");
  assert.throws(() => convert18(e.src, e.dest, "u/w"), /DESTINATION_EXISTS/);
  assert.equal(sourceHash(e.src), before);
  assert.equal(sourceHash(e.dest), hash("previous good data"));
});
for (const variant of ["blob", "row", "table", "scope"])
  test(`stage rejects tampered ${variant}`, (t) => {
    const e = setup(t);
    convert18(e.src, e.dest, "u/w");
    mutate(e.dest, (d) => {
      if (variant === "blob") d.exec("UPDATE blobs SET bytes=x'0001'");
      if (variant === "row") d.exec("UPDATE content SET value='[]' WHERE name='entry_item'");
      if (variant === "table") d.exec("DELETE FROM content WHERE name='category'");
      if (variant === "scope") {
        const m = JSON.parse(d.prepare("SELECT value FROM metadata").get().value);
        m.scope = "foreign/w";
        d.prepare("UPDATE metadata SET value=?").run(JSON.stringify(m));
      }
    });
    assert.throws(() => verifyStage(e.dest, "u/w"), /BLOB_HASH|ROW_HASH|TABLE_SET|MANIFEST_SCOPE_FORMAT/);
  });
