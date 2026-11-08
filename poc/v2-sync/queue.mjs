import { randomUUID } from "node:crypto";
import { transaction, record, working, hash, state, accept, changes } from "./model.mjs";
export function initQueue(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS drafts(scope TEXT,id TEXT,base INTEGER,base_hash TEXT,body TEXT,PRIMARY KEY(scope,id));
CREATE TABLE IF NOT EXISTS flights(scope TEXT,id TEXT,op TEXT,PRIMARY KEY(scope,id));
CREATE TABLE IF NOT EXISTS queue_errors(scope TEXT PRIMARY KEY,code TEXT);`);
}
function draft(db, s, id) {
  return db.prepare("SELECT * FROM drafts WHERE scope=? AND id=?").get(s, id);
}
export function flight(db, s, id) {
  const r = db.prepare("SELECT op FROM flights WHERE scope=? AND id=?").get(s, id);
  return r ? JSON.parse(r.op) : null;
}
function conflict(db, s, id, remote, reason = "CONFLICT") {
  const old = db.prepare("SELECT body FROM conflicts WHERE scope=? AND id=?").get(s, id);
  const base = old ? JSON.parse(old.body).base : record(db, s, id);
  db.prepare(
    "INSERT INTO conflicts VALUES(?,?,?) ON CONFLICT(scope,id) DO UPDATE SET body=excluded.body",
  ).run(s, id, JSON.stringify({ reason, base, local: working(db, s, id), remote }));
}
export function enqueue(db, scope, id, body, fault = () => {}) {
  initQueue(db);
  transaction(db, () => {
    const d = draft(db, scope, id),
      f = flight(db, scope, id),
      r = record(db, scope, id);
    if (!r) throw Error("ENTITY_REQUIRED");
    if (db.prepare("SELECT 1 FROM conflicts WHERE scope=? AND id=?").get(scope, id))
      throw Error("RESOLUTION_REQUIRED");
    db.prepare(
      "INSERT INTO working VALUES(?,?,?) ON CONFLICT(scope,id) DO UPDATE SET body=excluded.body",
    ).run(scope, id, JSON.stringify(body));
    fault("after-working");
    db.prepare(
      "INSERT INTO drafts VALUES(?,?,?,?,?) ON CONFLICT(scope,id) DO UPDATE SET body=excluded.body",
    ).run(
      scope,
      id,
      d?.base ?? (f ? f.base + 1 : r.rev),
      d?.base_hash ?? hash(f ? f.body : r.body),
      JSON.stringify(body),
    );
  });
  fault("after-draft");
}
export function prepare(db, scope, id, fault = () => {}) {
  initQueue(db);
  const result = transaction(db, () => {
    if (db.prepare("SELECT 1 FROM conflicts WHERE scope=? AND id=?").get(scope, id)) return null;
    const f = flight(db, scope, id);
    if (f) return f;
    const d = draft(db, scope, id);
    if (!d) return null;
    const r = record(db, scope, id);
    if (!r || r.rev !== d.base || hash(r.body) !== d.base_hash) {
      conflict(db, scope, id, r);
      return null;
    }
    const op = {
      scope,
      id,
      opId: randomUUID(),
      generation: state(db, scope).generation,
      base: r.rev,
      body: JSON.parse(d.body),
    };
    db.prepare("INSERT INTO pending VALUES(?,?,?)").run(scope, op.opId, JSON.stringify(op));
    db.prepare("INSERT INTO flights VALUES(?,?,?)").run(scope, id, JSON.stringify(op));
    db.prepare("DELETE FROM drafts WHERE scope=? AND id=?").run(scope, id);
    return op;
  });
  fault("after-freeze");
  return result;
}
export function applyPage(db, scope, generation, batch) {
  initQueue(db);
  transaction(db, () => {
    if (state(db, scope).generation !== generation) throw Error("GENERATION_CHANGED");
    for (const c of batch) {
      if (c.kind === "entry-batch") throw Error("BATCH_ADAPTER_REQUIRED");
      if (c.scope !== scope || c.generation !== generation) throw Error("SCOPE_MISMATCH");
      const cursor = state(db, scope).cursor;
      if (c.seq <= cursor) continue;
      if (c.seq !== cursor + 1) throw Error("CURSOR_GAP");
      const f = flight(db, scope, c.id),
        d = draft(db, scope, c.id),
        mine = f?.opId === c.opId;
      if ((d || f) && !mine) conflict(db, scope, c.id, c);
      db.prepare(
        "INSERT INTO records VALUES(?,?,?,?) ON CONFLICT(scope,id) DO UPDATE SET rev=excluded.rev,body=excluded.body",
      ).run(scope, c.id, c.rev, JSON.stringify(c.body));
      if (mine) {
        db.prepare("DELETE FROM pending WHERE scope=? AND id=?").run(scope, c.opId);
        db.prepare("DELETE FROM flights WHERE scope=? AND id=?").run(scope, c.id);
      }
      if (!d && (!f || mine)) db.prepare("DELETE FROM working WHERE scope=? AND id=?").run(scope, c.id);
      db.prepare("UPDATE state SET cursor=? WHERE scope=?").run(c.seq, scope);
    }
  });
}
function pull(db, server, scope) {
  const generation = state(server, scope).generation;
  if (state(db, scope).generation !== generation) throw Error("GENERATION_CHANGED");
  let page;
  do {
    page = changes(server, scope, state(db, scope).cursor).slice(0, 2);
    applyPage(db, scope, generation, page);
  } while (page.length === 2);
}
export function tick(db, server, account, scope, { loseAck = false } = {}) {
  initQueue(db);
  // Authorize before touching even the mock server's scope state.
  if (!scope.startsWith(account + "/")) throw Error("ACCESS_REVOKED");
  try {
    pull(db, server, scope);
    const ids = db
      .prepare("SELECT id FROM drafts WHERE scope=? UNION SELECT id FROM flights WHERE scope=? ORDER BY id")
      .all(scope, scope);
    for (const { id } of ids) {
      const op = prepare(db, scope, id);
      if (!op) continue;
      try {
        accept(server, account, op);
      } catch (e) {
        if (e.message !== "CONFLICT") throw e;
        pull(db, server, scope);
        transaction(db, () => conflict(db, scope, id, record(server, scope, id)));
        continue;
      }
      if (loseAck) return "ack-lost";
      pull(db, server, scope);
      return "sent";
    }
    return db.prepare("SELECT 1 FROM conflicts WHERE scope=?").get(scope) ? "conflict" : "idle";
  } catch (e) {
    db.prepare(
      "INSERT INTO queue_errors VALUES(?,?) ON CONFLICT(scope) DO UPDATE SET code=excluded.code",
    ).run(scope, e.message);
    throw e;
  }
}
export function queueState(db, scope) {
  initQueue(db);
  return Object.fromEntries(
    ["drafts", "flights", "conflicts"].map((t) => [
      t,
      db.prepare(`SELECT count(*) AS n FROM ${t} WHERE scope=?`).get(scope).n,
    ]),
  );
}
