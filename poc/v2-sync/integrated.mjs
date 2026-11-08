import { randomUUID } from "node:crypto";
import { transaction, record, working, state, changes, accept } from "./model.mjs";
import { initQueue, applyPage, prepare as prepareLegacy } from "./queue.mjs";
import {
  initCells,
  planMove,
  patchRow,
  cellKey,
  cellVersion,
  contentVersion,
  applyCommand,
  receiveBatches,
} from "./cells.mjs";
export function initIntegrated(db) {
  initQueue(db);
  initCells(db);
  db.exec(`CREATE TABLE IF NOT EXISTS typed_jobs(scope TEXT,opid TEXT,command TEXT,meta TEXT,status TEXT,error TEXT,PRIMARY KEY(scope,opid));
CREATE TABLE IF NOT EXISTS typed_drafts(scope TEXT,id TEXT,version INTEGER,patch TEXT,before TEXT,PRIMARY KEY(scope,id));`);
}
export function jobs(db, s) {
  initIntegrated(db);
  return db
    .prepare("SELECT * FROM typed_jobs WHERE scope=? ORDER BY rowid")
    .all(s)
    .map((r) => ({ ...r, command: JSON.parse(r.command), meta: JSON.parse(r.meta) }));
}
function drafts(db, s) {
  return db
    .prepare("SELECT * FROM typed_drafts WHERE scope=? ORDER BY rowid")
    .all(s)
    .map((r) => ({ ...r, patch: JSON.parse(r.patch), before: JSON.parse(r.before) }));
}
function legacyDirty(db, s, id) {
  return db
    .prepare("SELECT 1 FROM drafts WHERE scope=? AND id=? UNION SELECT 1 FROM flights WHERE scope=? AND id=?")
    .get(s, id, s, id);
}
function blocked(db, s, id) {
  return (
    db.prepare("SELECT 1 FROM conflicts WHERE scope=? AND id=?").get(s, id) ||
    jobs(db, s).some((j) => j.status === "conflict" && j.meta.positions?.some((p) => p.id === id))
  );
}
function active(j) {
  return j.status !== "done";
}
function rebuild(db, s, cleanup = []) {
  const list = jobs(db, s).filter(active),
    ds = drafts(db, s),
    ids = new Set([
      ...cleanup,
      ...ds.map((d) => d.id),
      ...list.flatMap((j) => j.meta.positions?.map((p) => p.id) ?? [j.command.id]),
    ]);
  for (const id of ids) {
    if (legacyDirty(db, s, id)) continue;
    const r = record(db, s, id);
    if (!r) continue;
    let row = { ...r.body.row },
      owned = false;
    for (const j of list.filter((j) => j.command.kind === "move-subtree")) {
      const p = j.meta.positions.find((p) => p.id === id);
      if (p) {
        row = { ...row, ...p.fields };
        owned = true;
      }
    }
    for (const j of list.filter((j) => j.command.kind === "patch-entry" && j.command.id === id)) {
      row = patchRow(row, j.command.patch);
      owned = true;
    }
    for (const d of ds.filter((d) => d.id === id)) {
      row = patchRow(row, d.patch);
      owned = true;
    }
    if (owned)
      db.prepare(
        "INSERT INTO working VALUES(?,?,?) ON CONFLICT(scope,id) DO UPDATE SET body=excluded.body",
      ).run(s, id, JSON.stringify({ table: "entry_item", row }));
    else db.prepare("DELETE FROM working WHERE scope=? AND id=?").run(s, id);
  }
}
function remember(db, s, id, before, remote, reason) {
  const old = db.prepare("SELECT body FROM conflicts WHERE scope=? AND id=?").get(s, id);
  db.prepare(
    "INSERT INTO conflicts VALUES(?,?,?) ON CONFLICT(scope,id) DO UPDATE SET body=excluded.body",
  ).run(
    s,
    id,
    JSON.stringify({
      base: old ? JSON.parse(old.body).base : before,
      local: working(db, s, id),
      remote,
      reason,
    }),
  );
}
function markJob(db, s, j, remote, reason) {
  db.prepare("UPDATE typed_jobs SET status='conflict',error=? WHERE scope=? AND opid=?").run(
    reason,
    s,
    j.opid,
  );
  remember(db, s, j.command.id, j.meta.before, remote, reason);
}
function saveJob(db, s, cmd, meta) {
  db.prepare("INSERT INTO typed_jobs VALUES(?,?,?,?,'queued',NULL)").run(
    s,
    cmd.opId,
    JSON.stringify(cmd),
    JSON.stringify(meta),
  );
}
export function enqueueMove(db, s, id, target, beforeId = null, fault = () => {}) {
  initIntegrated(db);
  let cmd;
  transaction(db, () => {
    if (jobs(db, s).some((j) => active(j) && j.command.kind === "move-subtree")) throw Error("MOVE_PENDING");
    const r = record(db, s, id);
    if (!r || r.body.table !== "entry_item") throw Error("ENTRY_REQUIRED");
    if (blocked(db, s, id) || legacyDirty(db, s, id)) throw Error("RESOLUTION_REQUIRED");
    const from = { date: r.body.row.date, categoryId: r.body.row.category_id };
    const to = { date: target.date, categoryId: target.categoryId };
    cmd = {
      kind: "move-subtree",
      scope: s,
      generation: state(db, s).generation,
      opId: randomUUID(),
      id,
      from: { ...from, version: cellVersion(db, s, cellKey(from.date, from.categoryId)) },
      to: { ...to, version: cellVersion(db, s, cellKey(to.date, to.categoryId)) },
      beforeId,
    };
    const plan = planMove(db, cmd);
    for (const p of plan.rows)
      if (legacyDirty(db, s, p.id) || blocked(db, s, p.id)) throw Error("RESOLUTION_REQUIRED");
    const positions = plan.rows.map((r) => ({
      id: r.id,
      fields: Object.fromEntries(["date", "category_id", "seq", "depth"].map((k) => [k, r.body.row[k]])),
    }));
    saveJob(db, s, cmd, { before: r, originals: plan.rows.map((p) => record(db, s, p.id)), positions });
    fault("after-job");
    rebuild(db, s);
    fault("after-projection");
  });
  fault("after-queued");
  return cmd;
}
export function enqueuePatch(db, s, id, patch, fault = () => {}) {
  initIntegrated(db);
  transaction(db, () => {
    if (legacyDirty(db, s, id) || blocked(db, s, id)) throw Error("RESOLUTION_REQUIRED");
    const r = record(db, s, id);
    if (!r || r.body.table !== "entry_item") throw Error("ENTRY_REQUIRED");
    patchRow(working(db, s, id).row, patch);
    const d = drafts(db, s).find((d) => d.id === id),
      f = jobs(db, s).find((j) => active(j) && j.command.kind === "patch-entry" && j.command.id === id);
    db.prepare(
      "INSERT INTO typed_drafts VALUES(?,?,?,?,?) ON CONFLICT(scope,id) DO UPDATE SET patch=excluded.patch",
    ).run(
      s,
      id,
      d?.version ?? (f ? f.command.contentVersion + 1 : contentVersion(db, s, id)),
      JSON.stringify({ ...d?.patch, ...patch }),
      JSON.stringify(d?.before ?? r),
    );
    fault("after-draft");
    rebuild(db, s);
    fault("after-working");
  });
  fault("after-queued");
}
export function freezePatches(db, s, fault = () => {}) {
  initIntegrated(db);
  transaction(db, () => {
    for (const d of drafts(db, s)) {
      if (
        blocked(db, s, d.id) ||
        jobs(db, s).some((j) => active(j) && j.command.kind === "patch-entry" && j.command.id === d.id)
      )
        continue;
      if (contentVersion(db, s, d.id) !== d.version) {
        remember(db, s, d.id, d.before, record(db, s, d.id), "CONTENT_CONFLICT");
        continue;
      }
      const cmd = {
        kind: "patch-entry",
        scope: s,
        generation: state(db, s).generation,
        opId: randomUUID(),
        id: d.id,
        contentVersion: d.version,
        patch: d.patch,
      };
      saveJob(db, s, cmd, { before: d.before });
      db.prepare("DELETE FROM typed_drafts WHERE scope=? AND id=?").run(s, d.id);
    }
  });
  fault("after-freeze");
}
export function applyMixed(db, s, generation, page, fault = () => {}) {
  initIntegrated(db);
  transaction(db, () => {
    if (state(db, s).generation !== generation) throw Error("GENERATION_CHANGED");
    for (const c of page) {
      if (c.scope !== s || c.generation !== generation) throw Error("SCOPE_MISMATCH");
      const cursor = state(db, s).cursor;
      if (c.seq <= cursor) continue;
      if (c.seq !== cursor + 1) throw Error("CURSOR_GAP");
      if (c.kind !== "entry-batch") {
        if (c.body?.table === "entry_item") throw Error("LEGACY_ENTRY_UPGRADE_REQUIRED");
        applyPage(db, s, generation, [c]);
        fault("after-event");
        continue;
      }
      const cleanup = c.rows.map((r) => r.id),
        beforeJobs = jobs(db, s),
        own = beforeJobs.find((j) => j.opid === c.opId && active(j));
      if (own) {
        db.prepare("UPDATE typed_jobs SET status='done',error=NULL WHERE scope=? AND opid=?").run(s, c.opId);
        if (own.command.kind === "patch-entry") {
          const r = c.rows.find((r) => r.id === own.command.id);
          if (!r) throw Error("ACK_SHAPE");
          db.prepare("UPDATE typed_drafts SET before=? WHERE scope=? AND id=?").run(
            JSON.stringify(r),
            s,
            r.id,
          );
        }
      }
      for (const j of jobs(db, s).filter(active)) {
        if (j.command.kind === "move-subtree") {
          const keys = [
            ["from", cellKey(j.command.from.date, j.command.from.categoryId)],
            ["to", cellKey(j.command.to.date, j.command.to.categoryId)],
          ];
          if (keys.some(([k, key]) => c.cells.some((v) => v.id === key && v.rev !== j.command[k].version)))
            markJob(db, s, j, c, "CELL_CONFLICT");
        } else if (c.contents.some((v) => v.id === j.command.id && v.rev !== j.command.contentVersion))
          markJob(db, s, j, c, "CONTENT_CONFLICT");
      }
      for (const d of drafts(db, s)) {
        const waiting = jobs(db, s).find(
          (j) => active(j) && j.command.kind === "patch-entry" && j.command.id === d.id,
        );
        const expected = waiting ? waiting.command.contentVersion : d.version;
        if (c.contents.some((v) => v.id === d.id && v.rev !== expected))
          remember(db, s, d.id, d.before, c, "CONTENT_CONFLICT");
      }
      // Our typed overlays are rebuilt after the shadow update; the older adapter must
      // not mistake them for generic whole-row edits and manufacture a conflict.
      const owned = new Set([
        ...beforeJobs.filter(active).flatMap((j) => j.meta.positions?.map((p) => p.id) ?? [j.command.id]),
        ...drafts(db, s).map((d) => d.id),
      ]);
      for (const r of c.rows)
        if (owned.has(r.id) && !legacyDirty(db, s, r.id))
          db.prepare("DELETE FROM working WHERE scope=? AND id=?").run(s, r.id);
      receiveBatches(db, s, generation, [c], (p) => {
        if (p === "after-row") fault("after-row");
      });
      rebuild(db, s, cleanup);
      fault("after-event");
    }
  });
  if (page.length) fault("after-apply");
}
function pullMixed(db, server, s, fault) {
  const g = state(server, s).generation;
  if (state(db, s).generation !== g) throw Error("GENERATION_CHANGED");
  let page;
  do {
    page = changes(server, s, state(db, s).cursor).slice(0, 2);
    applyMixed(db, s, g, page, fault);
  } while (page.length === 2);
}
export function integratedState(db, s) {
  initIntegrated(db);
  return {
    typedJobs: jobs(db, s).filter((j) => j.status === "queued" || j.status === "sent").length,
    typedDrafts: drafts(db, s).length,
    legacyDrafts: db.prepare("SELECT count(*) n FROM drafts WHERE scope=?").get(s).n,
    legacyFlights: db.prepare("SELECT count(*) n FROM flights WHERE scope=?").get(s).n,
    conflicts: db.prepare("SELECT count(*) n FROM conflicts WHERE scope=?").get(s).n,
  };
}
export function integratedTick(db, server, account, s, { loseAck = false, fault = () => {} } = {}) {
  initIntegrated(db);
  if (!s.startsWith(account + "/")) throw Error("ACCESS_REVOKED");
  try {
    pullMixed(db, server, s, fault);
    freezePatches(db, s);
    for (const j of jobs(db, s).filter((j) => j.status === "queued" || j.status === "sent")) {
      if (blocked(db, s, j.command.id)) continue;
      transaction(db, () =>
        db.prepare("UPDATE typed_jobs SET status='sent' WHERE scope=? AND opid=?").run(s, j.opid),
      );
      fault("after-sent");
      try {
        applyCommand(server, account, j.command);
      } catch (e) {
        if (
          !["CONTENT_CONFLICT", "CELL_CONFLICT", "ROOT_REQUIRED", "DESTINATION_REQUIRED"].includes(e.message)
        )
          throw e;
        pullMixed(db, server, s, fault);
        transaction(db, () => markJob(db, s, j, record(server, s, j.command.id), e.message));
        continue;
      }
      fault("after-server");
      if (loseAck) return "ack-lost";
      pullMixed(db, server, s, fault);
      db.prepare("DELETE FROM queue_errors WHERE scope=?").run(s);
      return "sent";
    }
    const ids = db
      .prepare("SELECT id FROM drafts WHERE scope=? UNION SELECT id FROM flights WHERE scope=? ORDER BY id")
      .all(s, s);
    for (const { id } of ids) {
      if (record(db, s, id)?.body.table === "entry_item") throw Error("LEGACY_ENTRY_UPGRADE_REQUIRED");
      const op = prepareLegacy(db, s, id);
      if (!op) continue;
      try {
        accept(server, account, op);
      } catch (e) {
        if (e.message !== "CONFLICT") throw e;
        pullMixed(db, server, s, fault);
        continue;
      }
      fault("after-server");
      if (loseAck) return "ack-lost";
      pullMixed(db, server, s, fault);
      return "sent";
    }
    db.prepare("DELETE FROM queue_errors WHERE scope=?").run(s);
    const st = integratedState(db, s);
    return st.conflicts
      ? "conflict"
      : st.typedJobs || st.typedDrafts || st.legacyDrafts || st.legacyFlights
        ? "waiting"
        : "idle";
  } catch (e) {
    db.prepare(
      "INSERT INTO queue_errors VALUES(?,?) ON CONFLICT(scope) DO UPDATE SET code=excluded.code",
    ).run(s, e.message);
    throw e;
  }
}
