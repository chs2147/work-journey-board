import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { resolve, dirname } from "node:path";
import { existsSync, readFileSync } from "node:fs";

export const hash = (value) =>
  createHash("sha256")
    .update(typeof value === "string" || Buffer.isBuffer(value) ? value : canonical(value))
    .digest("hex");
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function open(path) {
  const target = resolve(path);
  if (!existsSync(resolve(dirname(target), ".v2-poc-only"))) throw Error("POC_DIRECTORY_REQUIRED");
  const db = new DatabaseSync(target, { timeout: 2000 });
  db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS records(scope TEXT,id TEXT,rev INTEGER,body TEXT,PRIMARY KEY(scope,id));
    CREATE TABLE IF NOT EXISTS state(scope TEXT PRIMARY KEY,generation INTEGER DEFAULT 1,cursor INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS ops(scope TEXT,id TEXT,request TEXT,result TEXT,PRIMARY KEY(scope,id));
    CREATE TABLE IF NOT EXISTS changes(scope TEXT,seq INTEGER,change TEXT,PRIMARY KEY(scope,seq));
    CREATE TABLE IF NOT EXISTS pending(scope TEXT,id TEXT,body TEXT,PRIMARY KEY(scope,id));
    CREATE TABLE IF NOT EXISTS working(scope TEXT,id TEXT,body TEXT,PRIMARY KEY(scope,id));
    CREATE TABLE IF NOT EXISTS conflicts(scope TEXT,id TEXT,body TEXT,PRIMARY KEY(scope,id));`);
  return db;
}
export function transaction(db, fn) {
  const point = db.isTransaction ? "poc_" + randomUUID().replaceAll("-", "") : null;
  db.exec(point ? `SAVEPOINT ${point}` : "BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec(point ? `RELEASE ${point}` : "COMMIT");
    return r;
  } catch (e) {
    if (!db.isTransaction) throw e;
    if (point) {
      db.exec(`ROLLBACK TO ${point}`);
      db.exec(`RELEASE ${point}`);
    } else db.exec("ROLLBACK");
    throw e;
  }
}
export function state(db, scope) {
  db.prepare("INSERT OR IGNORE INTO state(scope) VALUES(?)").run(scope);
  return db.prepare("SELECT * FROM state WHERE scope=?").get(scope);
}
export function record(db, scope, id) {
  const r = db.prepare("SELECT * FROM records WHERE scope=? AND id=?").get(scope, id);
  return r ? { ...r, body: JSON.parse(r.body) } : null;
}
export function seed(db, scope, entries) {
  transaction(db, () => {
    state(db, scope);
    for (const [id, body] of entries) write(db, scope, id, 1, body);
  });
}
function write(db, scope, id, rev, body) {
  db.prepare(
    "INSERT INTO records VALUES(?,?,?,?) ON CONFLICT(scope,id) DO UPDATE SET rev=excluded.rev,body=excluded.body",
  ).run(scope, id, rev, JSON.stringify(body));
}
export function operation(db, scope, id, body, opId = randomUUID()) {
  return {
    scope,
    id,
    opId,
    generation: state(db, scope).generation,
    base: record(db, scope, id)?.rev ?? 0,
    baseCursor: state(db, scope).cursor,
    body,
  };
}
export function edit(db, op, fault = () => {}) {
  transaction(db, () => {
    db.prepare(
      "INSERT INTO working VALUES(?,?,?) ON CONFLICT(scope,id) DO UPDATE SET body=excluded.body",
    ).run(op.scope, op.id, JSON.stringify(op.body));
    fault("after-working");
    db.prepare("INSERT INTO pending VALUES(?,?,?)").run(op.scope, op.opId, JSON.stringify(op));
  });
  fault("after-commit");
}
export function working(db, scope, id) {
  const r = db.prepare("SELECT body FROM working WHERE scope=? AND id=?").get(scope, id);
  return r ? JSON.parse(r.body) : record(db, scope, id)?.body;
}
export function pending(db, scope) {
  return db
    .prepare("SELECT body FROM pending WHERE scope=? ORDER BY rowid")
    .all(scope)
    .map((r) => JSON.parse(r.body));
}
export function accept(db, account, op) {
  if (!op.scope.startsWith(`${account}/`)) throw Error("ACCESS_REVOKED");
  return transaction(db, () => {
    const s = state(db, op.scope);
    if (s.generation !== op.generation) throw Error("GENERATION_CHANGED");
    const old = db.prepare("SELECT * FROM ops WHERE scope=? AND id=?").get(op.scope, op.opId);
    if (old) {
      if (old.request !== canonical(op)) throw Error("IDEMPOTENCY_KEY_REUSED");
      return JSON.parse(old.result);
    }
    if (
      op.body?.table === "entry_item" &&
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cell_versions'").get() &&
      db.prepare("SELECT 1 FROM cell_versions WHERE scope=?").get(op.scope)
    )
      throw Error("TYPED_ENTRY_REQUIRED");
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sync_retention'").get()) {
      const floor = db.prepare("SELECT floor FROM sync_retention WHERE scope=?").get(op.scope)?.floor ?? 0;
      if (floor > 0 && (!Number.isSafeInteger(op.baseCursor) || op.baseCursor < floor))
        throw Error("RESYNC_REQUIRED");
    }
    if (
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='compound_documents'").get() &&
      db.prepare("SELECT 1 FROM compound_documents WHERE scope=? AND id=?").get(op.scope, op.id)
    )
      throw Error("COMPOUND_DOCUMENT_REQUIRED");
    if (["note_entry_link", "cabi_entry_link", "cabinet_link"].includes(op.body?.table))
      throw Error("COMPOUND_DOCUMENT_REQUIRED");
    const before = record(db, op.scope, op.id);
    if ((before?.rev ?? 0) !== op.base) throw Error("CONFLICT");
    const rev = op.base + 1,
      seq = s.cursor + 1;
    write(db, op.scope, op.id, rev, op.body);
    const result = { ...op, rev, seq };
    db.prepare("UPDATE state SET cursor=? WHERE scope=?").run(seq, op.scope);
    db.prepare("INSERT INTO changes VALUES(?,?,?)").run(op.scope, seq, JSON.stringify(result));
    db.prepare("INSERT INTO ops VALUES(?,?,?,?)").run(
      op.scope,
      op.opId,
      canonical(op),
      JSON.stringify(result),
    );
    return result;
  });
}
export function changes(db, scope, cursor) {
  return db
    .prepare("SELECT change FROM changes WHERE scope=? AND seq>? ORDER BY seq")
    .all(scope, cursor)
    .map((r) => JSON.parse(r.change));
}
export function receive(db, scope, generation, batch, fault = () => {}) {
  transaction(db, () => {
    const s = state(db, scope);
    if (s.generation !== generation) throw Error("GENERATION_CHANGED");
    for (const c of batch) {
      if (c.scope !== scope || c.generation !== generation) throw Error("SCOPE_MISMATCH");
      if (c.seq <= state(db, scope).cursor) continue;
      if (c.seq !== state(db, scope).cursor + 1) throw Error("CURSOR_GAP");
      const outstanding = pending(db, scope).filter((op) => op.id === c.id);
      const mine = outstanding.find((op) => op.opId === c.opId);
      if (outstanding.length && !mine)
        db.prepare(
          "INSERT INTO conflicts VALUES(?,?,?) ON CONFLICT(scope,id) DO UPDATE SET body=excluded.body",
        ).run(
          scope,
          c.id,
          JSON.stringify({ base: record(db, scope, c.id), local: working(db, scope, c.id), remote: c }),
        );
      write(db, scope, c.id, c.rev, c.body);
      if (mine) db.prepare("DELETE FROM pending WHERE scope=? AND id=?").run(scope, c.opId);
      // Never replace subsequent unacknowledged edits with an earlier ack.
      if (
        !pending(db, scope).some((op) => op.id === c.id) &&
        !outstanding.some((op) => !mine || op.opId !== mine.opId)
      )
        db.prepare("DELETE FROM working WHERE scope=? AND id=?").run(scope, c.id);
      fault("after-data");
      db.prepare("UPDATE state SET cursor=? WHERE scope=?").run(c.seq, scope);
    }
  });
  fault("after-commit");
}
export function restore(db, account, scope, expectedGeneration, opId, snapshot) {
  if (!scope.startsWith(`${account}/`)) throw Error("ACCESS_REVOKED");
  return transaction(db, () => {
    const request = canonical({ scope, expectedGeneration, snapshot });
    const old = db.prepare("SELECT * FROM ops WHERE scope=? AND id=?").get(scope, opId);
    if (old) {
      if (old.request !== request) throw Error("IDEMPOTENCY_KEY_REUSED");
      return JSON.parse(old.result);
    }
    if (state(db, scope).generation !== expectedGeneration) throw Error("GENERATION_CHANGED");
    db.prepare("DELETE FROM records WHERE scope=?").run(scope);
    for (const [id, body] of snapshot) write(db, scope, id, 1, body);
    db.prepare("DELETE FROM changes WHERE scope=?").run(scope);
    const result = { generation: expectedGeneration + 1 };
    db.prepare("UPDATE state SET generation=?,cursor=0 WHERE scope=?").run(result.generation, scope);
    db.prepare("INSERT INTO ops VALUES(?,?,?,?)").run(scope, opId, request, JSON.stringify(result));
    return result;
  });
}
export function sourceHash(path) {
  return hash(readFileSync(path));
}
