// Synthetic DB18/19 local PoC. No network, app integration or source writes.
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  lstatSync,
  rmSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { captureWorkspace, guard } from "../v2-sync/db18.mjs";
import { hash, sourceHash } from "../v2-sync/model.mjs";
import { assertSeparateWorkspacePaths } from "../v2-runtime/isolation.mjs";

const format = "v2-connected-copy-poc-1";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sha = /^[0-9a-f]{64}$/;
function noInlineImages(value, knownPayloads = []) {
  if (value instanceof Uint8Array) throw Error("BINARY_IN_METADATA");
  if (typeof value === "string") {
    if (/data\s*:\s*image\//i.test(value) || knownPayloads.some((data) => value.includes(data)))
      throw Error("INLINE_IMAGE_IN_METADATA");
  } else if (value && typeof value === "object") {
    for (const child of Object.values(value)) noInlineImages(child, knownPayloads);
  }
}
function inspect(directory, workspaceId, requireReady) {
  if (!uuid.test(workspaceId)) throw Error("WORKSPACE_ID_REQUIRED");
  if (lstatSync(directory).isSymbolicLink()) throw Error("SYMLINK_DENIED");
  for (const name of ["metadata.db", "manifest.json", "assets"])
    if (lstatSync(join(directory, name)).isSymbolicLink()) throw Error("SYMLINK_DENIED");
  if (requireReady && !existsSync(join(directory, "READY"))) throw Error("COPY_NOT_READY");
  const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
  if (
    manifest.format !== format ||
    manifest.workspaceId !== workspaceId ||
    ![18, 19].includes(manifest.sourceSchema)
  )
    throw Error("MANIFEST_SCOPE");
  const db = new DatabaseSync(join(directory, "metadata.db"), { readOnly: true });
  try {
    if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") throw Error("DB_INTEGRITY");
    if (db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get().n !== 3)
      throw Error("METADATA_SCHEMA");
    for (const table of ["records", "blob_ref", "copy_info"])
      if (
        db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .some((c) => c.type === "BLOB")
      )
        throw Error("BINARY_COLUMN");
    const info = JSON.parse(db.prepare("SELECT value FROM copy_info").get().value);
    if (hash(info) !== hash(manifest)) throw Error("MANIFEST_CHANGED");
    const records = db.prepare("SELECT * FROM records ORDER BY table_name,ordinal").all();
    if (hash(records) !== manifest.recordHash) throw Error("RECORD_CHANGED");
    const blobs = db.prepare("SELECT * FROM blob_ref ORDER BY id").all();
    if (hash(blobs) !== manifest.blobHash) throw Error("BLOB_REFERENCE_CHANGED");
    const payloads = [];
    for (const blob of blobs) {
      if (
        !sha.test(blob.id) ||
        blob.object_key !== `${workspaceId}/${blob.object_id}` ||
        !uuid.test(blob.object_id)
      )
        throw Error("BLOB_SCOPE");
      const file = join(directory, "assets", blob.id + ".bin");
      if (lstatSync(file).isSymbolicLink()) throw Error("SYMLINK_DENIED");
      const bytes = readFileSync(file);
      if (hash(bytes) !== blob.id || bytes.length !== blob.bytes) throw Error("BLOB_INTEGRITY");
      payloads.push(bytes.toString("base64"));
    }
    const expectedFiles = blobs.map((b) => b.id + ".bin").sort();
    if (JSON.stringify(readdirSync(join(directory, "assets")).sort()) !== JSON.stringify(expectedFiles))
      throw Error("UNEXPECTED_ASSET_FILE");
    const byHash = new Map(blobs.map((b) => [b.id, b]));
    let references = 0;
    for (const record of records) {
      const row = JSON.parse(record.value);
      noInlineImages(row, payloads);
      if (["note_asset", "cabi_asset"].includes(record.table_name)) {
        if ("data" in row || "thumb" in row || !row.dataRef) throw Error("LEGACY_IMAGE_COLUMN");
        for (const field of ["dataRef", "thumbRef"]) {
          if (row[field] === null) continue;
          const ref = row[field],
            blob = byHash.get(ref?.blob);
          if (
            !blob ||
            ref.bytes !== blob.bytes ||
            ref.storeId !== "supabase-private" ||
            ref.objectKey !== blob.object_key
          )
            throw Error("ASSET_REFERENCE");
          references++;
        }
      }
    }
    if (references !== manifest.assetReferences) throw Error("ASSET_REFERENCE_COUNT");
    // Inspect raw logical values including manifest; not just removed asset columns.
    noInlineImages({ manifest, records, blobs }, payloads);
    return { manifest, records, blobs, imagePayloadRows: 0, cloudUploaded: false };
  } finally {
    db.close();
  }
}

export function inspectConnectedCopy(directory, workspaceId) {
  return inspect(directory, workspaceId, true);
}

export function createConnectedCopy(
  source,
  destination,
  { sourceWorkspaceId, workspaceId, checkpoint = () => {} },
) {
  guard(source);
  guard(destination);
  if (!uuid.test(sourceWorkspaceId) || !uuid.test(workspaceId) || sourceWorkspaceId === workspaceId)
    throw Error("NEW_WORKSPACE_REQUIRED");
  if (resolve(source) === resolve(destination) || existsSync(destination)) throw Error("DESTINATION_EXISTS");
  if (lstatSync(source).isSymbolicLink() || lstatSync(dirname(destination)).isSymbolicLink())
    throw Error("SYMLINK_DENIED");
  assertSeparateWorkspacePaths(
    process.platform,
    realpathSync(dirname(source)),
    join(realpathSync(dirname(destination)), basename(destination)),
  );
  for (const suffix of ["-journal", "-wal", "-shm"])
    if (existsSync(source + suffix)) throw Error("SOURCE_NOT_FROZEN");
  const captured = captureWorkspace(source, { allowNoteImages: true }),
    rows = structuredClone(captured.rows),
    blobs = new Map();
  const knownPayloads = [];
  let references = 0,
    ownsDestination = false,
    db;
  for (const table of ["note_asset", "cabi_asset"])
    for (const row of rows[table]) {
      for (const field of ["data", "thumb"]) {
        const encoded = row[field];
        delete row[field];
        row[field + "Ref"] = null;
        if (encoded === null) continue;
        if (typeof encoded !== "string") throw Error("ASSET_ENCODING");
        const bytes = Buffer.from(encoded, "base64");
        if (
          !bytes.length ||
          bytes.toString("base64") !== encoded ||
          (field === "data" && bytes.length !== row.bytes)
        )
          throw Error("ASSET_ENCODING");
        knownPayloads.push(encoded);
        const id = hash(bytes);
        if (!blobs.has(id)) blobs.set(id, { bytes, objectId: randomUUID() });
        const objectKey = `${workspaceId}/${blobs.get(id).objectId}`;
        row[field + "Ref"] = { blob: id, bytes: bytes.length, storeId: "supabase-private", objectKey };
        references++;
      }
    }
  noInlineImages(rows, knownPayloads);
  try {
    mkdirSync(destination, { mode: 0o700 });
    ownsDestination = true;
    mkdirSync(join(destination, "assets"), { mode: 0o700 });
    for (const [id, blob] of blobs)
      writeFileSync(join(destination, "assets", id + ".bin"), blob.bytes, { flag: "wx", mode: 0o600 });
    checkpoint("files-written");
    db = new DatabaseSync(join(destination, "metadata.db"));
    db.exec(
      "PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; CREATE TABLE records(table_name TEXT,ordinal INTEGER,value TEXT NOT NULL,PRIMARY KEY(table_name,ordinal)); CREATE TABLE blob_ref(id TEXT PRIMARY KEY,bytes INTEGER NOT NULL,object_id TEXT NOT NULL,object_key TEXT NOT NULL); CREATE TABLE copy_info(value TEXT NOT NULL);",
    );
    db.exec("BEGIN IMMEDIATE");
    for (const table of Object.keys(rows).sort())
      rows[table].forEach((row, i) =>
        db.prepare("INSERT INTO records VALUES(?,?,?)").run(table, i, JSON.stringify(row)),
      );
    for (const [id, blob] of [...blobs].sort(([a], [b]) => a.localeCompare(b)))
      db.prepare("INSERT INTO blob_ref VALUES(?,?,?,?)").run(
        id,
        blob.bytes.length,
        blob.objectId,
        `${workspaceId}/${blob.objectId}`,
      );
    const manifest = {
      format,
      sourceSchema: Number(rows.app_meta.find((r) => r.key === "schema_version").value),
      sourceWorkspaceId,
      workspaceId,
      sourceHash: captured.sourceHash,
      phase: "local-extracted-not-uploaded",
      sourceRows: Object.fromEntries(Object.entries(rows).map(([t, r]) => [t, r.length])),
      assetReferences: references,
      uniqueFiles: blobs.size,
      recordHash: hash(db.prepare("SELECT * FROM records ORDER BY table_name,ordinal").all()),
      blobHash: hash(db.prepare("SELECT * FROM blob_ref ORDER BY id").all()),
    };
    db.prepare("INSERT INTO copy_info VALUES(?)").run(JSON.stringify(manifest));
    db.exec("COMMIT");
    db.close();
    db = null;
    writeFileSync(join(destination, "manifest.json"), JSON.stringify(manifest), { flag: "wx", mode: 0o600 });
    checkpoint("metadata-written");
    inspect(destination, workspaceId, false);
    if (sourceHash(source) !== captured.sourceHash) throw Error("SOURCE_CHANGED");
    writeFileSync(join(destination, "READY"), format, { flag: "wx", mode: 0o600 });
    // READY means this isolated local extraction is verified, not cloud connected.
    return inspectConnectedCopy(destination, workspaceId);
  } catch (error) {
    db?.close();
    if (ownsDestination) rmSync(destination, { recursive: true, force: true });
    throw error;
  }
}
