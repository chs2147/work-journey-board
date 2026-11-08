import { transaction, record, hash, working } from "./model.mjs";
import { rowId } from "./stage-import.mjs";
export const cellKey = (date, categoryId) => JSON.stringify([date, categoryId]);
export function initCells(db) {
  db.exec(`PRAGMA busy_timeout=2000;
CREATE TABLE IF NOT EXISTS cell_versions(scope TEXT,g INTEGER,id TEXT,rev INTEGER,PRIMARY KEY(scope,g,id));
CREATE TABLE IF NOT EXISTS content_versions(scope TEXT,g INTEGER,id TEXT,rev INTEGER,PRIMARY KEY(scope,g,id));`);
}
function epoch(db, scope) {
  const s = db.prepare("SELECT * FROM state WHERE scope=?").get(scope);
  if (!s) throw Error("WORKSPACE_REQUIRED");
  return s;
}
function entries(db, scope) {
  return db
    .prepare("SELECT * FROM records WHERE scope=?")
    .all(scope)
    .map((r) => ({ ...r, body: JSON.parse(r.body) }))
    .filter((r) => r.body.table === "entry_item");
}
function bootstrap(db, scope, g) {
  for (const r of entries(db, scope)) {
    const key = cellKey(r.body.row.date, r.body.row.category_id);
    db.prepare("INSERT OR IGNORE INTO cell_versions VALUES(?,?,?,1)").run(scope, g, key);
    db.prepare("INSERT OR IGNORE INTO content_versions VALUES(?,?,?,1)").run(scope, g, r.id);
  }
}
export function cellVersion(db, scope, key) {
  initCells(db);
  const g = epoch(db, scope).generation;
  return (
    db.prepare("SELECT rev FROM cell_versions WHERE scope=? AND g=? AND id=?").get(scope, g, key)?.rev ??
    (entries(db, scope).some((r) => cellKey(r.body.row.date, r.body.row.category_id) === key) ? 1 : 0)
  );
}
export function contentVersion(db, scope, id) {
  initCells(db);
  const g = epoch(db, scope).generation;
  return (
    db.prepare("SELECT rev FROM content_versions WHERE scope=? AND g=? AND id=?").get(scope, g, id)?.rev ??
    (record(db, scope, id) ? 1 : 0)
  );
}
export function cellRows(db, scope, key) {
  const list = entries(db, scope)
    .filter((r) => cellKey(r.body.row.date, r.body.row.category_id) === key)
    .sort((a, b) => a.body.row.seq - b.body.row.seq);
  for (const [i, r] of list.entries())
    if (
      r.id !== rowId("entry_item", [r.body.row.id]) ||
      r.body.row.seq !== i + 1 ||
      ![0, 1].includes(r.body.row.depth) ||
      (i === 0 && r.body.row.depth !== 0)
    )
      throw Error("CELL_INTEGRITY");
  return list;
}
function commitRow(db, scope, r, rows) {
  db.prepare("UPDATE records SET rev=?,body=? WHERE scope=? AND id=?").run(
    r.rev,
    JSON.stringify(r.body),
    scope,
    r.id,
  );
  rows.push(r);
}
export function applyCommand(db, account, cmd, fault = () => {}) {
  initCells(db);
  if (!cmd.scope.startsWith(account + "/")) throw Error("ACCESS_REVOKED");
  const answer = transaction(db, () => {
    const st = epoch(db, cmd.scope);
    if (st.generation !== cmd.generation) throw Error("GENERATION_CHANGED");
    const previous = db.prepare("SELECT * FROM ops WHERE scope=? AND id=?").get(cmd.scope, cmd.opId);
    if (previous) {
      if (previous.request !== hash(cmd)) throw Error("IDEMPOTENCY_KEY_REUSED");
      return JSON.parse(previous.result);
    }
    bootstrap(db, cmd.scope, st.generation);
    const rows = [],
      cells = [],
      contents = [];
    if (cmd.kind === "patch-entry") {
      const r = record(db, cmd.scope, cmd.id);
      if (!r || r.body.table !== "entry_item") throw Error("ENTRY_REQUIRED");
      if (contentVersion(db, cmd.scope, cmd.id) !== cmd.contentVersion) throw Error("CONTENT_CONFLICT");
      const keys = Object.keys(cmd.patch);
      if (!keys.length || keys.some((k) => !["text", "flagged", "flag_done_at"].includes(k)))
        throw Error("PATCH_FIELDS");
      const next = { ...r.body.row, ...cmd.patch };
      if (
        typeof next.text !== "string" ||
        next.text.length < 1 ||
        next.text.length > 2000 ||
        ![0, 1].includes(next.flagged) ||
        (next.flag_done_at !== null && typeof next.flag_done_at !== "string")
      )
        throw Error("PATCH_VALUE");
      const result = { id: r.id, rev: r.rev + 1, body: { table: "entry_item", row: next } };
      commitRow(db, cmd.scope, result, rows);
      db.prepare("UPDATE content_versions SET rev=rev+1 WHERE scope=? AND g=? AND id=?").run(
        cmd.scope,
        st.generation,
        cmd.id,
      );
      contents.push({ id: cmd.id, rev: cmd.contentVersion + 1 });
      fault("after-patch");
    } else if (cmd.kind === "move-subtree") {
      const from = cellKey(cmd.from.date, cmd.from.categoryId),
        to = cellKey(cmd.to.date, cmd.to.categoryId);
      if (
        cellVersion(db, cmd.scope, from) !== cmd.from.version ||
        cellVersion(db, cmd.scope, to) !== cmd.to.version
      )
        throw Error("CELL_CONFLICT");
      if (!record(db, cmd.scope, rowId("category", [cmd.to.categoryId]))) throw Error("CATEGORY_REQUIRED");
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(cmd.to.date) ||
        !Number.isFinite(Date.parse(cmd.to.date + "T00:00:00Z")) ||
        new Date(cmd.to.date + "T00:00:00Z").toISOString().slice(0, 10) !== cmd.to.date
      )
        throw Error("DATE_REQUIRED");
      const source = cellRows(db, cmd.scope, from),
        start = source.findIndex((r) => r.id === cmd.id);
      if (start < 0 || source[start].body.row.depth !== 0) throw Error("ROOT_REQUIRED");
      let end = start + 1;
      while (end < source.length && source[end].body.row.depth === 1) end++;
      const moved = source.slice(start, end),
        remaining = [...source.slice(0, start), ...source.slice(end)];
      const target = from === to ? remaining : cellRows(db, cmd.scope, to);
      const position = cmd.beforeId == null ? target.length : target.findIndex((r) => r.id === cmd.beforeId);
      if (position < 0 || (position < target.length && target[position].body.row.depth !== 0))
        throw Error("DESTINATION_REQUIRED");
      const combined = [...target.slice(0, position), ...moved, ...target.slice(position)];
      function save(list, date, category) {
        for (const [i, r] of list.entries()) {
          const body = {
            table: "entry_item",
            row: { ...r.body.row, date, category_id: category, seq: i + 1 },
          };
          if (hash(body) !== hash(r.body)) commitRow(db, cmd.scope, { id: r.id, rev: r.rev + 1, body }, rows);
        }
      }
      if (from !== to) {
        save(remaining, cmd.from.date, cmd.from.categoryId);
        fault("after-source");
      }
      save(combined, cmd.to.date, cmd.to.categoryId);
      fault("after-target");
      for (const key of new Set([from, to])) {
        // Read old version before UPDATE; empty new cells must advance from 0, not derived membership.
        const expected = key === from ? cmd.from.version : cmd.to.version;
        const next = expected + 1;
        db.prepare(
          "INSERT INTO cell_versions VALUES(?,?,?,?) ON CONFLICT(scope,g,id) DO UPDATE SET rev=excluded.rev",
        ).run(cmd.scope, st.generation, key, next);
        cells.push({ id: key, rev: next });
      }
      for (const r of rows) contents.push({ id: r.id, rev: contentVersion(db, cmd.scope, r.id) });
    } else throw Error("COMMAND_KIND");
    const result = {
      kind: "entry-batch",
      scope: cmd.scope,
      generation: st.generation,
      opId: cmd.opId,
      seq: st.cursor + 1,
      rows,
      cells,
      contents,
    };
    db.prepare("INSERT INTO changes VALUES(?,?,?)").run(cmd.scope, result.seq, JSON.stringify(result));
    db.prepare("UPDATE state SET cursor=? WHERE scope=?").run(result.seq, cmd.scope);
    db.prepare("INSERT INTO ops VALUES(?,?,?,?)").run(cmd.scope, cmd.opId, hash(cmd), JSON.stringify(result));
    fault("before-commit");
    return result;
  });
  fault("after-commit");
  return answer;
}
export function receiveBatches(db, scope, generation, batches, fault = () => {}) {
  initCells(db);
  transaction(db, () => {
    if (epoch(db, scope).generation !== generation) throw Error("GENERATION_CHANGED");
    bootstrap(db, scope, generation);
    for (const batch of batches) {
      if (batch.kind !== "entry-batch" || batch.scope !== scope || batch.generation !== generation)
        throw Error("BATCH_SCOPE_KIND");
      const cursor = epoch(db, scope).cursor;
      if (batch.seq <= cursor) continue;
      if (batch.seq !== cursor + 1) throw Error("CURSOR_GAP");
      for (const r of batch.rows) {
        const dirty = db.prepare("SELECT 1 FROM working WHERE scope=? AND id=?").get(scope, r.id);
        if (dirty) {
          const old = db.prepare("SELECT body FROM conflicts WHERE scope=? AND id=?").get(scope, r.id);
          const base = old ? JSON.parse(old.body).base : record(db, scope, r.id);
          db.prepare(
            "INSERT INTO conflicts VALUES(?,?,?) ON CONFLICT(scope,id) DO UPDATE SET body=excluded.body",
          ).run(
            scope,
            r.id,
            JSON.stringify({
              base,
              local: working(db, scope, r.id),
              remote: r,
              reason: "TYPED_BATCH_PENDING",
            }),
          );
        }
        db.prepare(
          "INSERT INTO records VALUES(?,?,?,?) ON CONFLICT(scope,id) DO UPDATE SET rev=excluded.rev,body=excluded.body",
        ).run(scope, r.id, r.rev, JSON.stringify(r.body));
        fault("after-row");
      }
      for (const [table, values] of [
        ["cell_versions", batch.cells],
        ["content_versions", batch.contents],
      ])
        for (const v of values)
          db.prepare(
            `INSERT INTO ${table} VALUES(?,?,?,?) ON CONFLICT(scope,g,id) DO UPDATE SET rev=excluded.rev`,
          ).run(scope, generation, v.id, v.rev);
      db.prepare("UPDATE state SET cursor=? WHERE scope=?").run(batch.seq, scope);
    }
  });
  fault("after-commit");
}
