// Candidate metadata-only online cache. Synthetic guard remains mandatory; no Classic wiring.
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  realpathSync,
  openSync,
  closeSync,
  linkSync,
  unlinkSync,
  fsyncSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { guard } from "../v2-sync/db18.mjs";
import { hash } from "../v2-sync/model.mjs";
import { assertSeparateWorkspacePaths } from "./isolation.mjs";
export const ONLINE_CACHE = Object.freeze({
  family: "wjb-online-cache",
  version: 1,
  applicationId: 1464487221,
  fileName: "online-cache.sqlite",
});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sha = /^[0-9a-f]{64}$/;
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const generation = (v) =>
  typeof v === "string" && /^[1-9][0-9]*$/.test(v) && v.length <= 19 && BigInt(v) <= 9223372036854775807n;
const identifier = (v) => typeof v === "string" && /^[a-zA-Z0-9_:-]{1,128}$/.test(v);
const schema = `
CREATE TABLE cache_info(singleton INTEGER PRIMARY KEY CHECK(singleton=1),manifest TEXT NOT NULL CHECK(json_valid(manifest))) STRICT;
CREATE TABLE records(entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,revision TEXT NOT NULL,body TEXT NOT NULL CHECK(json_valid(body)),PRIMARY KEY(entity_type,entity_id)) STRICT;
CREATE TABLE assets(object_id TEXT PRIMARY KEY,sha256 TEXT NOT NULL,bytes INTEGER NOT NULL CHECK(bytes>0)) STRICT;
CREATE TABLE envelopes(stream TEXT NOT NULL CHECK(stream IN ('outbox','inbox','conflict')),envelope_id TEXT NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload)),PRIMARY KEY(stream,envelope_id)) STRICT;
`;
function schemaSignature(db) {
  return hash(
    db
      .prepare(
        "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name",
      )
      .all(),
  );
}
let expectedSchema;
function expectedSignature() {
  if (!expectedSchema) {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(schema);
      expectedSchema = schemaSignature(db);
    } finally {
      db.close();
    }
  }
  return expectedSchema;
}
function exact(object, keys) {
  return (
    object &&
    Object.getPrototypeOf(object) === Object.prototype &&
    Object.keys(object).sort().join("\0") === [...keys].sort().join("\0")
  );
}
function scope(value) {
  if (
    !exact(value, ["ownerId", "workspaceId", "deviceId", "generation"]) ||
    ![value.ownerId, value.workspaceId, value.deviceId].every((v) => typeof v === "string" && uuid.test(v)) ||
    !generation(value.generation)
  )
    throw Error("CACHE_SCOPE_REQUIRED");
  return { ...value };
}
function metadata(value, depth = 0) {
  if (depth > 64) throw Error("CACHE_METADATA_DEPTH");
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw Error("CACHE_JSON_REQUIRED");
    return;
  }
  if (typeof value === "string") {
    if (
      /\bdata\s*:/i.test(value) ||
      /(iVBORw0KGgo|\/9j\/|R0lGOD|UklGR[A-Za-z0-9+/]{6}XRUJQ|Qk[A-Za-z0-9+/]{10,}|SUkqAA|TU0AKg|\x89PNG|GIF8[79]a|<svg(?:\s|>))/.test(
        value,
      )
    )
      throw Error("CACHE_IMAGE_BODY_FORBIDDEN");
    // Rich documents/undo payloads may themselves be JSON strings. Inspect decoded escapes too.
    if (/^\s*[[{"]/.test(value)) {
      let decoded;
      try {
        decoded = JSON.parse(value);
      } catch {
        return;
      }
      metadata(decoded, depth + 1);
    }
    return;
  }
  if (
    !value ||
    typeof value !== "object" ||
    (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype)
  )
    throw Error("CACHE_JSON_REQUIRED");
  if (
    Object.keys(value).some((k) =>
      [
        "data",
        "thumb",
        "base64",
        "binary",
        "dataUrl",
        "imageData",
        "access_token",
        "refresh_token",
        "service_role",
      ].includes(k),
    )
  )
    throw Error("CACHE_PAYLOAD_FIELD_FORBIDDEN");
  if (Object.values(Object.getOwnPropertyDescriptors(value)).some((d) => d.get || d.set))
    throw Error("CACHE_JSON_REQUIRED");
  if (Object.hasOwn(value, "toJSON")) throw Error("CACHE_JSON_REQUIRED");
  for (const child of Object.values(value)) metadata(child, depth + 1);
}
function json(value) {
  metadata(value);
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw Error("CACHE_JSON_TOO_LARGE");
  return text;
}
function references(value, assets, hashes = new Set([...assets.values()].map((a) => a.sha256)), depth = 0) {
  if (depth > 64) throw Error("CACHE_METADATA_DEPTH");
  if (typeof value === "string") {
    if (hashes.size)
      for (const candidate of value.matchAll(/[A-Za-z0-9+/]{32,}={0,2}/g)) {
        if (hashes.has(hash(Buffer.from(candidate[0], "base64")))) throw Error("CACHE_IMAGE_BODY_FORBIDDEN");
      }
    if (/^\s*[[{"]/.test(value)) {
      let decoded;
      try {
        decoded = JSON.parse(value);
      } catch {
        return;
      }
      references(decoded, assets, hashes, depth + 1);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Object.hasOwn(value, "objectId")) {
    if (!exact(value, ["objectId", "sha256", "bytes"])) throw Error("CACHE_ASSET_REFERENCE");
    const asset = assets.get(value.objectId);
    if (!asset || asset.sha256 !== value.sha256 || asset.bytes !== value.bytes)
      throw Error("CACHE_ASSET_REFERENCE");
  }
  for (const child of Object.values(value)) references(child, assets, hashes, depth + 1);
}

function snapshot(value) {
  if (
    !exact(value, ["records", "assets"]) ||
    !Array.isArray(value.records) ||
    !Array.isArray(value.assets) ||
    value.records.length > 100000 ||
    value.assets.length > 100000
  )
    throw Error("CACHE_SNAPSHOT_REQUIRED");
  const byAsset = new Map(),
    records = [],
    assets = [];
  for (const a of value.assets) {
    if (
      !exact(a, ["objectId", "sha256", "bytes"]) ||
      !uuid.test(a.objectId ?? "") ||
      !sha.test(a.sha256 ?? "") ||
      !Number.isSafeInteger(a.bytes) ||
      a.bytes < 1 ||
      a.bytes > 536870912 ||
      byAsset.has(a.objectId)
    )
      throw Error("CACHE_ASSET_DESCRIPTOR");
    byAsset.set(a.objectId, a);
    assets.push({ ...a });
  }
  const seen = new Set(),
    assetHashes = new Set(assets.map((a) => a.sha256));
  for (const r of value.records) {
    if (
      !exact(r, ["entityType", "entityId", "revision", "body"]) ||
      !identifier(r.entityType) ||
      !identifier(r.entityId) ||
      !generation(r.revision)
    )
      throw Error("CACHE_RECORD_REQUIRED");
    const key = r.entityType + "\0" + r.entityId;
    if (seen.has(key)) throw Error("CACHE_DUPLICATE_RECORD");
    seen.add(key);
    const body = JSON.parse(json(r.body));
    references(body, byAsset, assetHashes);
    records.push({ ...r, body });
  }
  assets.sort((a, b) => compare(a.objectId, b.objectId));
  records.sort((a, b) => compare(a.entityType, b.entityType) || compare(a.entityId, b.entityId));
  return { records, assets };
}
function guardedPath(root, protectedLocalRoots) {
  const path = join(root, ONLINE_CACHE.fileName);
  guard(path);
  if (!Array.isArray(protectedLocalRoots) || !protectedLocalRoots.length)
    throw Error("CACHE_PROTECTED_ROOTS_REQUIRED");
  const actual = realpathSync(root);
  if (actual !== resolve(root) || lstatSync(root).isSymbolicLink()) throw Error("CACHE_PATH_ALIAS");
  for (const local of protectedLocalRoots)
    assertSeparateWorkspacePaths(process.platform, realpathSync(local), actual);
  return path;
}
function regular(path) {
  const s = lstatSync(path);
  if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1) throw Error("CACHE_FILE_ALIAS");
  return s;
}
function sameFile(a, b) {
  if (a.ino !== b.ino || a.dev !== b.dev) throw Error("CACHE_FILE_CHANGED");
}
function inspect(db, expected) {
  if (
    db.prepare("PRAGMA application_id").get().application_id !== ONLINE_CACHE.applicationId ||
    db.prepare("PRAGMA user_version").get().user_version !== ONLINE_CACHE.version
  )
    throw Error("CACHE_FORMAT_REQUIRED");
  if (schemaSignature(db) !== expectedSignature()) throw Error("CACHE_SCHEMA_CHANGED");
  if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") throw Error("CACHE_INTEGRITY");
  const rows = db.prepare("SELECT manifest FROM cache_info").all();
  if (rows.length !== 1) throw Error("CACHE_MANIFEST_REQUIRED");
  const m = JSON.parse(rows[0].manifest);
  if (
    !exact(m, [
      "family",
      "version",
      "cacheId",
      "ownerId",
      "workspaceId",
      "deviceId",
      "generation",
      "snapshotHash",
    ]) ||
    m.family !== ONLINE_CACHE.family ||
    m.version !== ONLINE_CACHE.version ||
    !uuid.test(m.cacheId ?? "") ||
    !sha.test(m.snapshotHash ?? "")
  )
    throw Error("CACHE_MANIFEST_REQUIRED");
  const identity = scope({
    ownerId: m.ownerId,
    workspaceId: m.workspaceId,
    deviceId: m.deviceId,
    generation: m.generation,
  });
  if (Object.keys(expected).some((k) => expected[k] !== identity[k])) throw Error("CACHE_SCOPE_MISMATCH");
  const data = snapshot({
    records: db
      .prepare("SELECT entity_type,entity_id,revision,body FROM records")
      .all()
      .map((r) => ({
        entityType: r.entity_type,
        entityId: r.entity_id,
        revision: r.revision,
        body: JSON.parse(r.body),
      })),
    assets: db
      .prepare("SELECT object_id,sha256,bytes FROM assets")
      .all()
      .map((a) => ({ objectId: a.object_id, sha256: a.sha256, bytes: a.bytes })),
  });
  if (hash(data) !== m.snapshotHash) throw Error("CACHE_SNAPSHOT_CHANGED");
  const envelopes = db.prepare("SELECT stream,envelope_id,payload FROM envelopes").all(),
    byAsset = new Map(data.assets.map((a) => [a.objectId, a]));
  for (const e of envelopes) {
    if (!["outbox", "inbox", "conflict"].includes(e.stream) || !uuid.test(e.envelope_id))
      throw Error("CACHE_ENVELOPE_REQUIRED");
    const payload = JSON.parse(e.payload);
    json(payload);
    references(payload, byAsset);
  }
  return { manifest: m, data, pendingCount: envelopes.length };
}
export function createOnlineCache(root, { identity, snapshot: input, protectedLocalRoots }) {
  const expected = scope(identity),
    data = snapshot(input),
    path = guardedPath(root, protectedLocalRoots);
  if (existsSync(path)) throw Error("CACHE_ALREADY_EXISTS");
  const manifest = {
    family: ONLINE_CACHE.family,
    version: ONLINE_CACHE.version,
    cacheId: randomUUID(),
    ...expected,
    snapshotHash: hash(data),
  };
  const stage = join(root, "." + randomUUID() + ".cache-stage");
  let db,
    created = false;
  try {
    closeSync(openSync(stage, "wx", 0o600));
    created = true;
    db = new DatabaseSync(stage);
    db.exec(
      `PRAGMA journal_mode=DELETE;PRAGMA synchronous=FULL;BEGIN IMMEDIATE;PRAGMA application_id=${ONLINE_CACHE.applicationId};PRAGMA user_version=${ONLINE_CACHE.version};` +
        schema,
    );
    db.prepare("INSERT INTO cache_info VALUES(1,?)").run(JSON.stringify(manifest));
    for (const r of data.records)
      db.prepare("INSERT INTO records VALUES(?,?,?,?)").run(
        r.entityType,
        r.entityId,
        r.revision,
        JSON.stringify(r.body),
      );
    for (const a of data.assets)
      db.prepare("INSERT INTO assets VALUES(?,?,?)").run(a.objectId, a.sha256, a.bytes);
    db.exec("COMMIT");
    inspect(db, expected);
    db.close();
    db = null;
    const fd = openSync(stage, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    linkSync(stage, path); // Exclusive publication. Never rename over an existing cache or original.
    return Object.freeze({ ...manifest, productActivationAllowed: false });
  } finally {
    db?.close();
    if (created) {
      unlinkSync(stage);
      const directoryFd = openSync(root, "r");
      try {
        fsyncSync(directoryFd);
      } finally {
        closeSync(directoryFd);
      }
    }
  }
}
export function openOnlineCache(root, { identity, protectedLocalRoots }) {
  const expected = scope(identity),
    path = guardedPath(root, protectedLocalRoots),
    before = regular(path);
  const db = new DatabaseSync(path, { readOnly: true });
  let closed = false;
  try {
    sameFile(before, regular(path));
    db.exec("BEGIN");
    const result = inspect(db, expected);
    const alive = () => {
      if (closed) throw Error("CACHE_CLOSED");
    };
    return Object.freeze({
      manifest: Object.freeze(result.manifest),
      pendingCount: result.pendingCount,
      productActivationAllowed: false,
      readRecords() {
        alive();
        return structuredClone(result.data.records);
      },
      readAssets() {
        alive();
        return result.data.assets.map((a) => ({
          ...a,
          storeId: "supabase-private",
          objectKey: `${expected.workspaceId}/${a.objectId}`,
        }));
      },
      close() {
        if (!closed) {
          closed = true;
          db.close();
        }
      },
    });
  } catch (e) {
    db.close();
    throw e;
  }
}
export function appendCacheEnvelope(root, { identity, protectedLocalRoots, stream, envelopeId, payload }) {
  if (!["outbox", "inbox", "conflict"].includes(stream) || !uuid.test(envelopeId ?? ""))
    throw Error("CACHE_ENVELOPE_REQUIRED");
  const text = json(payload),
    expected = scope(identity);
  const prior = openOnlineCache(root, { identity: expected, protectedLocalRoots });
  prior.close();
  const path = guardedPath(root, protectedLocalRoots),
    before = regular(path),
    db = new DatabaseSync(path);
  try {
    sameFile(before, regular(path));
    db.exec("BEGIN IMMEDIATE");
    const current = inspect(db, expected);
    references(JSON.parse(text), new Map(current.data.assets.map((a) => [a.objectId, a])));
    db.prepare("INSERT INTO envelopes VALUES(?,?,?)").run(stream, envelopeId, text);
    db.exec("COMMIT");
  } finally {
    db.close();
  }
}
