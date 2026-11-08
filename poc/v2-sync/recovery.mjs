import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { transaction, state, hash } from "./model.mjs";
import { initLifecycle, allRecords, validateGraph } from "./lifecycle.mjs";
export function initRecovery(db) {
  initLifecycle(db);
  db.exec(`CREATE TABLE IF NOT EXISTS snapshots(scope TEXT,id TEXT,manifest TEXT,payload TEXT,pinned INTEGER DEFAULT 0,PRIMARY KEY(scope,id));
CREATE TABLE IF NOT EXISTS snapshot_blobs(scope TEXT,id TEXT,hash TEXT,bytes BLOB,PRIMARY KEY(scope,id,hash));
CREATE TABLE IF NOT EXISTS recovery_archives(scope TEXT,id TEXT,reason TEXT,payload TEXT,PRIMARY KEY(scope,id));
CREATE TABLE IF NOT EXISTS archive_blobs(scope TEXT,id TEXT,hash TEXT,bytes BLOB,PRIMARY KEY(scope,id,hash));`);
}
function table(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}
function refs(value, out = new Map()) {
  if (value && typeof value === "object")
    for (const [key, v] of Object.entries(value)) {
      if (["dataRef", "thumbRef"].includes(key) && v) {
        if (typeof v.hash !== "string" || !Number.isSafeInteger(v.bytes) || v.bytes < 0)
          throw Error("BLOB_REFERENCE");
        if (out.has(v.hash) && out.get(v.hash) !== v.bytes) throw Error("BLOB_REFERENCE");
        out.set(v.hash, v.bytes);
      } else refs(v, out);
    }
  return out;
}
function assets(db, s, records) {
  const found = [];
  for (const [id, size] of refs(records)) {
    const r = db.prepare("SELECT bytes FROM local_assets WHERE scope=? AND hash=?").get(s, id);
    if (!r) throw Error("ASSET_MISSING");
    const b = Buffer.from(r.bytes);
    if (hash(b) !== id || b.length !== size) throw Error("ASSET_HASH");
    found.push({ id, bytes: b });
  }
  return found.sort((a, b) => a.id.localeCompare(b.id));
}
function hasPending(db, s) {
  if (table(db, "recovered_copies") && db.prepare("SELECT 1 FROM recovered_copies WHERE scope=?").get(s))
    return true;
  for (const name of ["pending", "drafts", "flights", "typed_drafts", "move_intents"])
    if (
      table(db, name) &&
      db
        .prepare(
          `SELECT 1 FROM ${name} WHERE scope=?${name === "move_intents" ? " AND status IN ('queued','blocked')" : ""}`,
        )
        .get(s)
    )
      return true;
  return (
    table(db, "typed_jobs") &&
    !!db.prepare("SELECT 1 FROM typed_jobs WHERE scope=? AND status!='done'").get(s)
  );
}
export function createSnapshot(
  db,
  s,
  { id = randomUUID(), maxBytes = Number.MAX_SAFE_INTEGER, pinned = false } = {},
) {
  initRecovery(db);
  return transaction(db, () => {
    if (hasPending(db, s)) throw Error("PENDING_EDITS");
    if (db.prepare("SELECT 1 FROM snapshots WHERE scope=? AND id=?").get(s, id))
      throw Error("SNAPSHOT_EXISTS");
    validateGraph(db, s);
    const rows = allRecords(db, s),
      blobs = assets(db, s, rows),
      st = state(db, s),
      size = Buffer.byteLength(JSON.stringify(rows)) + blobs.reduce((n, b) => n + b.bytes.length, 0);
    if (size > maxBytes) throw Error("SNAPSHOT_QUOTA");
    const versions = {
      cells: db
        .prepare("SELECT id,rev FROM cell_versions WHERE scope=? AND g=? ORDER BY id")
        .all(s, st.generation)
        .map((r) => ({ ...r })),
      contents: db
        .prepare("SELECT id,rev FROM content_versions WHERE scope=? AND g=? ORDER BY id")
        .all(s, st.generation)
        .map((r) => ({ ...r })),
    };
    const manifest = {
      versions,
      versionsHash: hash(versions),
      format: "local-snapshot-1",
      appVersion: "1.23.0",
      sourceSchema: 18,
      scope: s,
      id,
      generation: st.generation,
      cursor: st.cursor,
      recordHash: hash(rows),
      records: rows.length,
      blobs: blobs.map((b) => ({ hash: b.id, bytes: b.bytes.length })),
      size,
    };
    db.prepare("INSERT INTO snapshots VALUES(?,?,?,?,?)").run(
      s,
      id,
      JSON.stringify(manifest),
      JSON.stringify(rows),
      pinned ? 1 : 0,
    );
    for (const b of blobs) db.prepare("INSERT INTO snapshot_blobs VALUES(?,?,?,?)").run(s, id, b.id, b.bytes);
    return manifest;
  });
}
export function verifySnapshot(db, s, id) {
  initRecovery(db);
  const r = db.prepare("SELECT * FROM snapshots WHERE scope=? AND id=?").get(s, id);
  if (!r) throw Error("SNAPSHOT_MISSING");
  const m = JSON.parse(r.manifest),
    rows = JSON.parse(r.payload);
  if (
    m.format !== "local-snapshot-1" ||
    m.scope !== s ||
    m.id !== id ||
    hash(rows) !== m.recordHash ||
    rows.length !== m.records ||
    hash(m.versions) !== m.versionsHash
  )
    throw Error("SNAPSHOT_HASH");
  const blobs = db
    .prepare("SELECT hash,bytes FROM snapshot_blobs WHERE scope=? AND id=? ORDER BY hash")
    .all(s, id)
    .map((b) => ({ hash: b.hash, bytes: Buffer.from(b.bytes) }));
  if (hash(blobs.map((b) => ({ hash: b.hash, bytes: b.bytes.length }))) !== hash(m.blobs))
    throw Error("SNAPSHOT_BLOBS");
  for (const b of blobs) if (hash(b.bytes) !== b.hash) throw Error("ASSET_HASH");
  for (const [h, size] of refs(rows)) {
    const b = blobs.find((b) => b.hash === h);
    if (!b || b.bytes.length !== size) throw Error("ASSET_MISSING");
  }
  return { manifest: m, rows, blobs };
}
export function restoreSnapshot(db, account, s, expectedGeneration, opId, id, fault = () => {}) {
  initRecovery(db);
  if (!s.startsWith(account + "/")) throw Error("ACCESS_REVOKED");
  const result = transaction(db, () => {
    const request = hash({ s, expectedGeneration, id, kind: "restore-snapshot" }),
      old = db.prepare("SELECT * FROM ops WHERE scope=? AND id=?").get(s, opId);
    if (old) {
      if (old.request !== request) throw Error("IDEMPOTENCY_KEY_REUSED");
      return JSON.parse(old.result);
    }
    if (state(db, s).generation !== expectedGeneration) throw Error("GENERATION_CHANGED");
    const snap = verifySnapshot(db, s, id),
      before = createSnapshot(db, s, { pinned: true });
    db.prepare("DELETE FROM records WHERE scope=?").run(s);
    db.prepare("DELETE FROM local_assets WHERE scope=?").run(s);
    fault("after-clear");
    for (const r of snap.rows)
      db.prepare("INSERT INTO records VALUES(?,?,1,?)").run(s, r.id, JSON.stringify(r.body));
    for (const b of snap.blobs) db.prepare("INSERT INTO local_assets VALUES(?,?,?)").run(s, b.hash, b.bytes);
    db.prepare("DELETE FROM changes WHERE scope=?").run(s);
    db.prepare("DELETE FROM sync_retention WHERE scope=?").run(s);
    db.prepare("UPDATE state SET generation=?,cursor=0 WHERE scope=?").run(expectedGeneration + 1, s);
    validateGraph(db, s);
    const result = { generation: expectedGeneration + 1, beforeSnapshot: before.id, restoredSnapshot: id };
    db.prepare("INSERT INTO ops VALUES(?,?,?,?)").run(s, opId, request, JSON.stringify(result));
    fault("before-commit");
    return result;
  });
  fault("after-commit");
  return result;
}
export function readChanges(db, s, g, cursor, limit = 2) {
  initRecovery(db);
  const st = state(db, s),
    floor = db.prepare("SELECT floor FROM sync_retention WHERE scope=?").get(s)?.floor ?? 0;
  if (st.generation !== g) throw Error("GENERATION_CHANGED");
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > st.cursor) throw Error("CURSOR_INVALID");
  if (cursor < floor) throw Error("CURSOR_EXPIRED");
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw Error("PAGE_LIMIT");
  return db
    .prepare("SELECT change FROM changes WHERE scope=? AND seq>? ORDER BY seq LIMIT ?")
    .all(s, cursor, limit)
    .map((r) => JSON.parse(r.change));
}
export function compact(db, s, floor) {
  initRecovery(db);
  return transaction(db, () => {
    const st = state(db, s),
      old = db.prepare("SELECT floor FROM sync_retention WHERE scope=?").get(s)?.floor ?? 0;
    if (!Number.isSafeInteger(floor) || floor < old || floor > st.cursor) throw Error("COMPACTION_RANGE");
    const candidates = db
      .prepare("SELECT id FROM snapshots WHERE scope=?")
      .all(s)
      .map((r) => verifySnapshot(db, s, r.id));
    if (!candidates.some((r) => r.manifest.generation === st.generation && r.manifest.cursor >= floor))
      throw Error("CHECKPOINT_REQUIRED");
    const changes = db.prepare("DELETE FROM changes WHERE scope=? AND seq<=?").run(s, floor).changes;
    db.prepare("DELETE FROM ops WHERE scope=? AND json_extract(result,'$.seq')<=?").run(s, floor);
    db.prepare("DELETE FROM tombstones WHERE scope=? AND g=? AND seq<=?").run(s, st.generation, floor);
    db.prepare(
      "INSERT INTO sync_retention VALUES(?,?) ON CONFLICT(scope) DO UPDATE SET floor=excluded.floor",
    ).run(s, floor);
    return { floor, changes };
  });
}
export function reconcile(db, server, s, { decision, reason = "resync" } = {}) {
  if (decision !== "archive-and-refresh") throw Error("RECONCILE_CONFIRMATION");
  initRecovery(db);
  initRecovery(server);
  const transfer = createSnapshot(server, s),
    verified = verifySnapshot(server, s, transfer.id);
  return transaction(db, () => {
    const archive = randomUUID(),
      payload = {};
    for (const name of [
      "records",
      "working",
      "pending",
      "drafts",
      "flights",
      "conflicts",
      "typed_jobs",
      "typed_drafts",
      "queue_errors",
      "move_intents",
    ])
      if (table(db, name)) payload[name] = db.prepare(`SELECT * FROM ${name} WHERE scope=?`).all(s);
    db.prepare("INSERT INTO recovery_archives VALUES(?,?,?,?)").run(
      s,
      archive,
      reason,
      JSON.stringify(payload),
    );
    for (const b of db.prepare("SELECT * FROM local_assets WHERE scope=?").all(s))
      db.prepare("INSERT INTO archive_blobs VALUES(?,?,?,?)").run(s, archive, b.hash, b.bytes);
    for (const name of Object.keys(payload)) db.prepare(`DELETE FROM ${name} WHERE scope=?`).run(s);
    db.prepare("DELETE FROM local_assets WHERE scope=?").run(s);
    for (const r of verified.rows)
      db.prepare("INSERT INTO records VALUES(?,?,?,?)").run(s, r.id, r.rev, JSON.stringify(r.body));
    for (const b of verified.blobs)
      db.prepare("INSERT INTO local_assets VALUES(?,?,?)").run(s, b.hash, b.bytes);
    db.prepare("UPDATE state SET generation=?,cursor=? WHERE scope=?").run(
      verified.manifest.generation,
      verified.manifest.cursor,
      s,
    );
    // Clear derived versions; they are reconstructed below from the server's accepted epoch.
    for (const [name, values] of [
      ["cell_versions", verified.manifest.versions.cells],
      ["content_versions", verified.manifest.versions.contents],
    ]) {
      db.prepare(`DELETE FROM ${name} WHERE scope=?`).run(s);
      for (const r of values)
        db.prepare(`INSERT INTO ${name} VALUES(?,?,?,?)`).run(s, verified.manifest.generation, r.id, r.rev);
    }
    return { archive, generation: verified.manifest.generation, cursor: verified.manifest.cursor };
  });
}
export function gcAssets(db, s) {
  initRecovery(db);
  return transaction(db, () => {
    if (
      hasPending(db, s) ||
      db.prepare("SELECT 1 FROM working WHERE scope=?").get(s) ||
      (table(db, "recovered_copies") && db.prepare("SELECT 1 FROM recovered_copies WHERE scope=?").get(s))
    )
      return { removed: 0, reason: "PENDING_EDITS" };
    const keep = new Set(refs(allRecords(db, s)).keys());
    for (const { id } of db.prepare("SELECT id FROM snapshots WHERE scope=?").all(s))
      for (const b of verifySnapshot(db, s, id).blobs) keep.add(b.hash);
    for (const r of db.prepare("SELECT DISTINCT hash FROM archive_blobs WHERE scope=?").all(s))
      keep.add(r.hash);
    let removed = 0;
    for (const b of db.prepare("SELECT hash FROM local_assets WHERE scope=?").all(s))
      if (!keep.has(b.hash))
        removed += db.prepare("DELETE FROM local_assets WHERE scope=? AND hash=?").run(s, b.hash).changes;
    return { removed, protected: keep.size };
  });
}
export function snapshotPlan(db, s, keep = 3) {
  initRecovery(db);
  if (!Number.isInteger(keep) || keep < 1) throw Error("KEEP_LIMIT");
  const rows = db
    .prepare("SELECT id,manifest,pinned FROM snapshots WHERE scope=? ORDER BY rowid DESC")
    .all(s);
  for (const r of rows) verifySnapshot(db, s, r.id);
  const preserved = new Set(rows.slice(0, keep).map((r) => r.id));
  for (const r of rows) if (r.pinned) preserved.add(r.id);
  return { inventory: hash(rows), remove: rows.filter((r) => !preserved.has(r.id)).map((r) => r.id) };
}
export function pruneSnapshots(db, s, plan, keep = 3) {
  return transaction(db, () => {
    const current = snapshotPlan(db, s, keep);
    if (hash(current) !== hash(plan)) throw Error("SNAPSHOT_PLAN_CHANGED");
    for (const id of current.remove) {
      db.prepare("DELETE FROM snapshot_blobs WHERE scope=? AND id=?").run(s, id);
      db.prepare("DELETE FROM snapshots WHERE scope=? AND id=?").run(s, id);
    }
    return current.remove.length;
  });
}
