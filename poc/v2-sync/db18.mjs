import { URL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { Buffer } from "node:buffer";
import { readFileSync, readdirSync, existsSync, linkSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { hash, transaction, sourceHash } from "./model.mjs";
const migrations = new URL("../../src/data/migrations/", import.meta.url);
/** Journal schema versions whose copy contract has been verified (DB18 base, DB19 delete lock, DB20 kanban). */
export const SUPPORTED_SCHEMAS = Object.freeze([18, 19, 20]);
/** The only resting state of the DB20 write-source row; anything else means a kanban write was interrupted. */
export const KANBAN_CTX_REST = Object.freeze({ id: 1, source: "board", batch_id: null, at: null });
export function guard(path) {
  if (!existsSync(resolve(dirname(path), ".v2-poc-only"))) throw Error("POC_DIRECTORY_REQUIRED");
}
export function create18(path) {
  return createWorkspaceDB(path, 18);
}
export function createWorkspaceDB(path, version) {
  if (!SUPPORTED_SCHEMAS.includes(version)) throw Error("SCHEMA_VERSION");
  if (path !== ":memory:") {
    guard(path);
    if (existsSync(path)) throw Error("DESTINATION_EXISTS");
  }
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE;");
  transaction(db, () => {
    for (const f of readdirSync(migrations)
      .filter((f) => /^00\d\d_.*\.sql$/.test(f))
      .sort()) {
      if (Number(f.slice(0, 4)) > version) continue;
      db.exec(readFileSync(new URL(f, migrations), "utf8"));
    }
    db.prepare("INSERT INTO app_meta(key,value) VALUES('schema_version',?)").run(String(version));
  });
  return db;
}
function schema(db) {
  return db
    .prepare(
      "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name",
    )
    .all();
}
function rows(db) {
  const out = {};
  for (const { name } of db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()) {
    const q = '"' + name.replaceAll('"', '""') + '"';
    out[name] = db
      .prepare(`SELECT * FROM ${q}`)
      .all()
      .map((r) => ({ ...r }))
      .sort((a, b) => hash(a).localeCompare(hash(b)));
  }
  return out;
}
function validate(data, { allowNoteImages = false } = {}) {
  const entries = new Set(data.entry_item.map((r) => r.id));
  function board(row, kind) {
    const doc = JSON.parse(kind === "week" ? row.doc : row.doc);
    if (doc.v !== 1 || !Array.isArray(doc.boxes)) throw Error("DOCUMENT_FORMAT");
    const ids = new Set(doc.boxes.map((b) => b.id));
    if (ids.size !== doc.boxes.length) throw Error("DUPLICATE_BOX");
    for (const b of doc.boxes) {
      if (b.asset) {
        const a = (kind === "week" ? data.note_asset : data.cabi_asset).find((a) => a.id === b.asset);
        if (
          !a ||
          (kind === "week" ? a.week_id !== row.week_id : a.owner_kind !== "board" || a.owner_id !== row.id)
        )
          throw Error("ASSET_OWNER");
      }
    }
    for (const e of doc.edges ?? []) if (!ids.has(e.from) || !ids.has(e.to)) throw Error("EDGE_REFERENCE");
    const links =
      kind === "week"
        ? data.note_entry_link.filter((l) => l.note_week_id === row.week_id)
        : data.cabi_entry_link.filter((l) => l.board_id === row.id);
    for (const l of links) if (!ids.has(l.box_id) || !entries.has(l.entry_id)) throw Error("LINK_REFERENCE");
  }
  for (const r of data.week_note) board(r, "week");
  for (const r of data.cabi_board) board(r, "board");
  // Historical staging defaults remain text-only. The connected-copy PoC can
  // explicitly validate the product's asset-id image nodes without inline bytes.
  function note(n, ownerId) {
    if (n.type === "image") {
      if (!allowNoteImages) throw Error("NOTE_IMAGE_UNSUPPORTED");
      const asset = data.cabi_asset.find((a) => a.id === n.attrs?.asset);
      if (!asset || asset.owner_kind !== "note" || asset.owner_id !== ownerId)
        throw Error("NOTE_IMAGE_OWNER");
    }
    for (const c of n.content ?? []) note(c, ownerId);
  }
  for (const r of data.cabi_note) note(JSON.parse(r.content), r.id);
}
export function capture18(path, options = {}) {
  return captureWorkspace(path, { ...options, expectedVersion: 18 });
}
export function captureWorkspace(path, { expectedVersion, ...options } = {}) {
  guard(path);
  const before = sourceHash(path);
  const db = new DatabaseSync(path, { readOnly: true });
  let result;
  try {
    const rawVersion = db.prepare("SELECT value FROM app_meta WHERE key='schema_version'").get()?.value;
    const version = SUPPORTED_SCHEMAS.map(String).includes(rawVersion) ? Number(rawVersion) : NaN;
    if (
      !SUPPORTED_SCHEMAS.includes(version) ||
      (expectedVersion !== undefined && expectedVersion !== version)
    )
      throw Error("SCHEMA_VERSION");
    const expected = createWorkspaceDB(":memory:", version);
    try {
      if (hash(schema(db)) !== hash(schema(expected))) throw Error("SCHEMA_UNSUPPORTED");
    } finally {
      expected.close();
    }
    if (db.prepare("PRAGMA journal_mode").get().journal_mode !== "delete") throw Error("SOURCE_NOT_FROZEN");
    if (
      db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok" ||
      db.prepare("PRAGMA foreign_key_check").all().length
    )
      throw Error("DB_INTEGRITY");
    result = rows(db);
    if (version >= 19 && result.cabi_note.some((r) => ![0, 1].includes(r.delete_locked)))
      throw Error("DB_INTEGRITY");
    if (version >= 20) {
      const ctx = result.kanban_ctx;
      if (ctx.length !== 1 || hash(ctx[0]) !== hash({ ...KANBAN_CTX_REST }))
        throw Error("KANBAN_WRITE_IN_PROGRESS");
    }
    validate(result, options);
  } finally {
    db.close();
  }
  if (sourceHash(path) !== before) throw Error("SOURCE_CHANGED");
  return { sourceHash: before, rows: result };
}
function encode(data) {
  const result = globalThis.structuredClone(data),
    blobs = {};
  for (const table of ["note_asset", "cabi_asset"])
    for (const r of result[table])
      for (const field of ["data", "thumb"]) {
        if (r[field] === null) continue;
        const b = Buffer.from(r[field], "base64");
        if (b.toString("base64") !== r[field] || (field === "data" && b.length !== r.bytes))
          throw Error("ASSET_BYTES");
        const id = hash(b);
        blobs[id] = b;
        r[field] = { blob: id, bytes: b.length };
      }
  return { rows: result, blobs };
}
export function convert18(source, destination, scope) {
  guard(destination);
  if (resolve(source) === resolve(destination) || existsSync(destination)) throw Error("DESTINATION_EXISTS");
  if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(scope)) throw Error("SCOPE_REQUIRED");
  const original = capture18(source),
    encoded = encode(original.rows);
  const manifest = {
    format: "v2-poc-staging-1",
    appVersion: "1.23.0",
    sourceSchema: 18,
    scope,
    sourceHash: original.sourceHash,
    tables: Object.fromEntries(
      Object.entries(original.rows).map(([t, r]) => [t, { count: r.length, hash: hash(r) }]),
    ),
    blobs: Object.fromEntries(Object.entries(encoded.blobs).map(([k, v]) => [k, { bytes: v.length }])),
  };
  const temp = destination + ".partial-" + randomUUID();
  let db;
  try {
    db = new DatabaseSync(temp);
    db.exec(
      "PRAGMA synchronous=FULL; CREATE TABLE metadata(value TEXT);CREATE TABLE content(name TEXT PRIMARY KEY,value TEXT);CREATE TABLE blobs(hash TEXT PRIMARY KEY,bytes BLOB);",
    );
    transaction(db, () => {
      db.prepare("INSERT INTO metadata VALUES(?)").run(JSON.stringify(manifest));
      for (const [name, value] of Object.entries(encoded.rows))
        db.prepare("INSERT INTO content VALUES(?,?)").run(name, JSON.stringify(value));
      for (const [id, b] of Object.entries(encoded.blobs))
        db.prepare("INSERT INTO blobs VALUES(?,?)").run(id, b);
    });
    db.close();
    db = null;
    verifyStage(temp, scope);
    if (sourceHash(source) !== original.sourceHash) throw Error("SOURCE_CHANGED");
    linkSync(temp, destination); // exclusive publication: never overwrite an existing destination
    return manifest;
  } finally {
    if (db) db.close();
    if (existsSync(temp)) unlinkSync(temp);
  }
}
export function verifyStage(path, scope) {
  guard(path);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") throw Error("STAGE_INTEGRITY");
    const metaRows = db.prepare("SELECT value FROM metadata").all();
    if (metaRows.length !== 1) throw Error("MANIFEST_COUNT");
    const m = JSON.parse(metaRows[0].value);
    if (m.format !== "v2-poc-staging-1" || m.sourceSchema !== 18 || m.scope !== scope)
      throw Error("MANIFEST_SCOPE_FORMAT");
    const data = Object.fromEntries(
      db
        .prepare("SELECT * FROM content")
        .all()
        .map((r) => [r.name, JSON.parse(r.value)]),
    );
    if (hash(Object.keys(data).sort()) !== hash(Object.keys(m.tables).sort())) throw Error("TABLE_SET");
    const blobs = Object.fromEntries(
      db
        .prepare("SELECT * FROM blobs")
        .all()
        .map((r) => [r.hash, Buffer.from(r.bytes)]),
    );
    if (hash(Object.keys(blobs).sort()) !== hash(Object.keys(m.blobs).sort())) throw Error("BLOB_SET");
    for (const [id, b] of Object.entries(blobs))
      if (hash(b) !== id || b.length !== m.blobs[id].bytes) throw Error("BLOB_HASH");
    for (const table of ["note_asset", "cabi_asset"])
      for (const r of data[table])
        for (const field of ["data", "thumb"]) {
          if (r[field] === null) continue;
          const ref = r[field],
            b = blobs[ref.blob];
          if (!b || b.length !== ref.bytes) throw Error("BLOB_REFERENCE");
          r[field] = b.toString("base64");
        }
    for (const [t, r] of Object.entries(data))
      if (r.length !== m.tables[t].count || hash(r) !== m.tables[t].hash) throw Error("ROW_HASH");
    validate(data);
    return { manifest: m, rows: data };
  } finally {
    db.close();
  }
}

/** Rebuild a NEW DB18 file for round-trip evidence, never overwrite a workspace. */
export function restore18(stage, destination, scope) {
  guard(destination);
  if (existsSync(destination) || resolve(stage) === resolve(destination)) throw Error("DESTINATION_EXISTS");
  const { rows: data } = verifyStage(stage, scope),
    temp = destination + ".partial-" + randomUUID();
  let db;
  try {
    db = create18(temp);
    if (hash(Object.keys(rows(db)).sort()) !== hash(Object.keys(data).sort())) throw Error("TABLE_SET");
    const triggers = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'").all();
    const quote = (s) => '"' + s.replaceAll('"', '""') + '"';
    db.exec("PRAGMA foreign_keys=OFF");
    transaction(db, () => {
      for (const t of triggers) db.exec(`DROP TRIGGER ${quote(t.name)}`);
      for (const [table, records] of Object.entries(data)) {
        const columns = db
          .prepare(`PRAGMA table_info(${quote(table)})`)
          .all()
          .map((c) => c.name)
          .sort();
        db.exec(`DELETE FROM ${quote(table)}`);
        for (const r of records) {
          const keys = Object.keys(r);
          if (hash(keys.toSorted()) !== hash(columns)) throw Error("COLUMN_SET");
          db.prepare(
            `INSERT INTO ${quote(table)}(${keys.map(quote).join(",")}) VALUES(${keys.map(() => "?").join(",")})`,
          ).run(...keys.map((k) => r[k]));
        }
      }
      for (const t of triggers) db.exec(t.sql);
      if (db.prepare("PRAGMA foreign_key_check").all().length) throw Error("DB_INTEGRITY");
    });
    db.close();
    db = null;
    if (hash(capture18(temp).rows) !== hash(data)) throw Error("ROUNDTRIP_MISMATCH");
    linkSync(temp, destination);
  } finally {
    if (db) db.close();
    if (existsSync(temp)) unlinkSync(temp);
  }
}
