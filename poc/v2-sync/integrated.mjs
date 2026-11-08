import { readChanges } from "./recovery.mjs";
import { rowId as rowIdFor } from "./stage-import.mjs";
const rowIdForEntry = (id) => rowIdFor("entry_item", [id]);
import { applyLifecycle, validateDocument, initLifecycle, documentLinks } from "./lifecycle.mjs";
import { randomUUID } from "node:crypto";
import { transaction, record, working, state, accept, hash } from "./model.mjs";
import { initQueue, applyPage, prepare as prepareLegacy } from "./queue.mjs";
import {
  cellRows as cellRowsFor,
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
  initLifecycle(db);
  db.exec(`CREATE TABLE IF NOT EXISTS typed_jobs(scope TEXT,opid TEXT,command TEXT,meta TEXT,status TEXT,error TEXT,PRIMARY KEY(scope,opid));
CREATE TABLE IF NOT EXISTS move_intents(scope TEXT,id TEXT,entry_id TEXT,payload TEXT,after_id TEXT,status TEXT,error TEXT,PRIMARY KEY(scope,id));
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
    let r = record(db, s, id);
    if (!r) {
      const conflict = db.prepare("SELECT body FROM conflicts WHERE scope=? AND id=?").get(s, id);
      const local = conflict ? JSON.parse(conflict.body).local : null;
      const source =
        list.flatMap((j) => j.meta.originals ?? [j.meta.before]).find((v) => v?.id === id) ??
        ds.find((d) => d.id === id)?.before;
      r = local ? { id, body: local } : source;
    }
    if (!r) continue;
    let row = { ...r.body.row },
      owned = false;
    for (const j of list.filter((j) => ["move-subtree", "delete-subtree"].includes(j.command.kind))) {
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
    for (const j of list.filter((j) => j.command.kind === "save-document" && j.command.id === id)) {
      row = { ...j.command.body.row };
      owned = true;
    }
    if (owned)
      db.prepare(
        "INSERT INTO working VALUES(?,?,?) ON CONFLICT(scope,id) DO UPDATE SET body=excluded.body",
      ).run(s, id, JSON.stringify({ table: r.body.table, row }));
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
export function enqueueMove(db, s, id, target, beforeId = null, fault = () => {}, reservedId = null) {
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
      baseCursor: state(db, s).cursor,
      opId: reservedId ?? randomUUID(),
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
        baseCursor: state(db, s).cursor,
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
      const cleanup = [...c.rows.map((r) => r.id), ...(c.deletes ?? []).map((d) => d.id)],
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
        if (["delete-subtree", "insert-child"].includes(j.command.kind)) {
          if (
            c.cells.some(
              (v) =>
                v.id === cellKey(j.command.cell.date, j.command.cell.categoryId) &&
                v.rev !== j.command.cell.version,
            ) ||
            c.contents.some(
              (v) =>
                Object.hasOwn(j.command.expectedContent ?? {}, v.id) &&
                v.rev !== j.command.expectedContent[v.id],
            ) ||
            (c.deletes ?? []).some((d) => d.id === j.command.id)
          )
            markJob(db, s, j, c, "DELETE_OR_CELL_CONFLICT");
        } else if (j.command.kind === "save-document") {
          if (
            c.rows.some((r) => r.id === j.command.id) ||
            (c.deletes ?? []).some(
              (d) => d.id === j.command.id || j.command.links.some((l) => rowIdForEntry(l.entryId) === d.id),
            )
          )
            markJob(db, s, j, c, "DOCUMENT_CONFLICT");
        } else if (j.command.kind === "move-subtree") {
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
      for (const r of [...c.rows, ...(c.deletes ?? [])])
        if (owned.has(r.id) && !legacyDirty(db, s, r.id))
          db.prepare("DELETE FROM working WHERE scope=? AND id=?").run(s, r.id);
      receiveBatches(db, s, generation, [c], (p) => {
        if (["after-row", "after-delete"].includes(p)) fault(p);
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
    page = readChanges(server, s, g, state(db, s).cursor, 2);
    applyMixed(db, s, g, page, fault);
  } while (page.length === 2);
}
export function integratedState(db, s) {
  initIntegrated(db);
  return {
    typedJobs:
      jobs(db, s).filter((j) => j.status === "queued" || j.status === "sent").length +
      db.prepare("SELECT count(*) n FROM move_intents WHERE scope=? AND status='queued'").get(s).n,
    typedDrafts: drafts(db, s).length,
    legacyDrafts: db.prepare("SELECT count(*) n FROM drafts WHERE scope=?").get(s).n,
    legacyFlights: db.prepare("SELECT count(*) n FROM flights WHERE scope=?").get(s).n,
    conflicts:
      db.prepare("SELECT count(*) n FROM conflicts WHERE scope=?").get(s).n +
      db.prepare("SELECT count(*) n FROM move_intents WHERE scope=? AND status='blocked'").get(s).n,
  };
}
export function integratedTick(db, server, account, s, { loseAck = false, fault = () => {} } = {}) {
  initIntegrated(db);
  if (!s.startsWith(account + "/")) throw Error("ACCESS_REVOKED");
  try {
    pullMixed(db, server, s, fault);
    promoteIntents(db, s);
    freezePatches(db, s);
    for (const j of jobs(db, s).filter((j) => j.status === "queued" || j.status === "sent")) {
      if (blocked(db, s, j.command.id)) continue;
      transaction(db, () =>
        db.prepare("UPDATE typed_jobs SET status='sent' WHERE scope=? AND opid=?").run(s, j.opid),
      );
      fault("after-sent");
      try {
        (["delete-subtree", "insert-child", "save-document"].includes(j.command.kind)
          ? applyLifecycle
          : applyCommand)(server, account, j.command);
      } catch (e) {
        if (
          ![
            "CONTENT_CONFLICT",
            "CELL_CONFLICT",
            "ROOT_REQUIRED",
            "DESTINATION_REQUIRED",
            "ENTRY_REQUIRED",
            "ROWSET_CONFLICT",
            "DOCUMENT_CONFLICT",
            "LINK_TARGET",
          ].includes(e.message)
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

export function enqueueLifecycle(db, s, command, fault = () => {}) {
  initIntegrated(db);
  const cmd = {
    ...command,
    scope: s,
    generation: state(db, s).generation,
    baseCursor: state(db, s).cursor,
    opId: randomUUID(),
  };
  transaction(db, () => {
    const r = record(db, s, cmd.id);
    if (!r || legacyDirty(db, s, cmd.id) || blocked(db, s, cmd.id)) throw Error("RESOLUTION_REQUIRED");
    let meta = { before: r };
    if (cmd.kind === "delete-subtree") {
      if (
        jobs(db, s).some(
          (j) => active(j) && ["move-subtree", "delete-subtree", "insert-child"].includes(j.command.kind),
        )
      )
        throw Error("MOVE_PENDING");
      const key = cellKey(r.body.row.date, r.body.row.category_id);
      const list = cellRowsFor(db, s, key),
        start = list.findIndex((v) => v.id === cmd.id);
      if (start < 0 || list[start].body.row.depth !== 0) throw Error("ROOT_REQUIRED");
      let end = start + 1;
      while (end < list.length && list[end].body.row.depth === 1) end++;
      const group = list.slice(start, end);
      cmd.cell = {
        date: r.body.row.date,
        categoryId: r.body.row.category_id,
        version: cellVersion(db, s, key),
      };
      cmd.expectedContent = Object.fromEntries(group.map((v) => [v.id, contentVersion(db, s, v.id)]));
      meta = {
        before: r,
        originals: group,
        positions: group.map((v) => ({ id: v.id, fields: { _pendingDelete: true } })),
      };
    } else if (cmd.kind === "insert-child") {
      cmd.cell = {
        date: r.body.row.date,
        categoryId: r.body.row.category_id,
        version: cellVersion(db, s, cellKey(r.body.row.date, r.body.row.category_id)),
      };
    } else if (cmd.kind === "save-document") {
      cmd.baseRevision = r.rev;
      validateDocument(db, s, cmd.body, cmd.links);
    } else throw Error("COMMAND_KIND");
    saveJob(db, s, cmd, meta);
    rebuild(db, s);
    fault("after-job");
  });
  fault("after-queued");
  return cmd;
}

export function resolveConflict(db, s, id, seen, { choice, target, beforeId = null, links = null } = {}) {
  initIntegrated(db);
  db.exec(
    "CREATE TABLE IF NOT EXISTS resolution_history(scope TEXT,id TEXT,payload TEXT,PRIMARY KEY(scope,id));CREATE TABLE IF NOT EXISTS recovered_copies(scope TEXT,id TEXT,payload TEXT,PRIMARY KEY(scope,id));",
  );
  return transaction(db, () => {
    const conflict = db.prepare("SELECT body FROM conflicts WHERE scope=? AND id=?").get(s, id),
      current = record(db, s, id);
    if (!conflict) throw Error("CONFLICT_REQUIRED");
    if (state(db, s).generation !== seen.generation || (current?.rev ?? null) !== seen.revision)
      throw Error("CONFLICT_CHANGED");
    if (!["keep-server", "keep-local", "copy", "retry-move"].includes(choice))
      throw Error("RESOLUTION_CHOICE");
    const related = jobs(db, s).filter((j) => active(j) && j.command.id === id),
      parent = jobs(db, s).find(
        (j) => active(j) && j.command.id !== id && j.meta.positions?.some((p) => p.id === id),
      );
    if (parent) throw Error("RESOLVE_PARENT_FIRST");
    const local = working(db, s, id) ?? JSON.parse(conflict.body).local,
      history = randomUUID(),
      cleanup = [id, ...related.flatMap((j) => j.meta.positions?.map((p) => p.id) ?? [])];
    db.prepare("INSERT INTO resolution_history VALUES(?,?,?)").run(
      s,
      history,
      JSON.stringify({
        conflict: JSON.parse(conflict.body),
        jobs: related,
        drafts: drafts(db, s).filter((d) => d.id === id),
        local,
        choice,
      }),
    );
    const legacy = db.prepare("SELECT op FROM flights WHERE scope=? AND id=?").get(s, id);
    if (legacy) {
      const op = JSON.parse(legacy.op);
      db.prepare("DELETE FROM pending WHERE scope=? AND id=?").run(s, op.opId);
    }
    db.prepare("DELETE FROM flights WHERE scope=? AND id=?").run(s, id);
    db.prepare("DELETE FROM drafts WHERE scope=? AND id=?").run(s, id);
    for (const j of related)
      db.prepare("UPDATE typed_jobs SET status='done',error='CANCELLED' WHERE scope=? AND opid=?").run(
        s,
        j.opid,
      );
    db.prepare("DELETE FROM typed_drafts WHERE scope=? AND id=?").run(s, id);
    db.prepare("DELETE FROM conflicts WHERE scope=? AND id=?").run(s, id);
    db.prepare("DELETE FROM working WHERE scope=? AND id=?").run(s, id);
    rebuild(db, s, cleanup);
    if (choice === "copy") {
      const copy = randomUUID();
      db.prepare("INSERT INTO recovered_copies VALUES(?,?,?)").run(s, copy, JSON.stringify(local));
      return { history, copy };
    }
    if (choice === "keep-local") {
      if (!current) throw Error("COPY_OR_EXPLICIT_COMMAND_REQUIRED");
      if (current.body.table === "entry_item") {
        if (related.some((j) => j.command.kind !== "patch-entry"))
          throw Error("COPY_OR_EXPLICIT_COMMAND_REQUIRED");
        enqueuePatch(
          db,
          s,
          id,
          Object.fromEntries(["text", "flagged", "flag_done_at"].map((k) => [k, local.row[k]])),
        );
      } else {
        const fields =
          current.body.table === "cabi_note"
            ? ["title", "content", "plain_text", "format_version"]
            : ["doc", "format_version"];
        const body = JSON.parse(JSON.stringify(current.body));
        for (const k of fields) if (k in local.row) body.row[k] = local.row[k];
        const desired =
          links ??
          related.find((j) => j.command.kind === "save-document")?.command.links ??
          documentLinks(db, s, id).map((l) => ({ boxId: l.body.row.box_id, entryId: l.body.row.entry_id }));
        enqueueLifecycle(db, s, { kind: "save-document", id, body, links: desired });
      }
    }
    if (choice === "retry-move") {
      const move = related.find((j) => j.command.kind === "move-subtree");
      if (!move || !current) throw Error("MOVE_REQUIRED");
      enqueueMove(db, s, id, target ?? move.command.to, beforeId ?? move.command.beforeId);
    }
    return { history };
  });
}
export function enqueueMoveAfter(db, s, id, target, beforeId = null) {
  initIntegrated(db);
  return transaction(db, () => {
    const pending = jobs(db, s).filter((j) => active(j) && j.command.kind === "move-subtree");
    const last = db
      .prepare("SELECT id FROM move_intents WHERE scope=? AND status='queued' ORDER BY rowid DESC LIMIT 1")
      .get(s);
    if (!pending.length && !last) return enqueueMove(db, s, id, target, beforeId).opId;
    const node = randomUUID(),
      after = last?.id ?? pending.at(-1).opid;
    db.prepare("INSERT INTO move_intents VALUES(?,?,?,?,?,'queued',NULL)").run(
      s,
      node,
      id,
      JSON.stringify({ target, beforeId }),
      after,
    );
    return node;
  });
}
function promoteIntents(db, s) {
  for (const intent of db
    .prepare("SELECT * FROM move_intents WHERE scope=? AND status='queued' ORDER BY rowid")
    .all(s)) {
    const parent = jobs(db, s).find((j) => j.opid === intent.after_id);
    if (!parent) continue;
    if (parent.status === "conflict" || (parent.status === "done" && parent.error)) {
      db.prepare(
        "UPDATE move_intents SET status='blocked',error='DEPENDENCY_FAILED' WHERE scope=? AND id=?",
      ).run(s, intent.id);
      continue;
    }
    if (parent.status !== "done" || jobs(db, s).some((j) => active(j) && j.command.kind === "move-subtree"))
      continue;
    transaction(db, () => {
      const p = JSON.parse(intent.payload);
      enqueueMove(db, s, intent.entry_id, p.target, p.beforeId, () => {}, intent.id);
      db.prepare("UPDATE move_intents SET status='promoted' WHERE scope=? AND id=?").run(s, intent.id);
    });
    break;
  }
}

export function upgradeLegacyDraft(db, s, id, { decision } = {}) {
  if (decision !== "convert-content-only") throw Error("UPGRADE_CONFIRMATION");
  initIntegrated(db);
  db.exec(
    "CREATE TABLE IF NOT EXISTS legacy_upgrades(scope TEXT,id TEXT,payload TEXT,PRIMARY KEY(scope,id));",
  );
  return transaction(db, () => {
    if (db.prepare("SELECT 1 FROM flights WHERE scope=? AND id=?").get(s, id))
      throw Error("LEGACY_FLIGHT_REQUIRES_RECONCILE");
    const d = db.prepare("SELECT * FROM drafts WHERE scope=? AND id=?").get(s, id),
      r = record(db, s, id);
    if (!d || !r || r.body.table !== "entry_item") throw Error("ENTRY_REQUIRED");
    if (r.rev !== d.base || hash(r.body) !== d.base_hash) throw Error("LEGACY_BASE_CHANGED");
    const body = JSON.parse(d.body),
      allowed = ["text", "flagged", "flag_done_at"];
    if (
      body.table !== "entry_item" ||
      Object.keys(r.body.row).some((k) => !allowed.includes(k) && hash(body.row[k]) !== hash(r.body.row[k]))
    )
      throw Error("ARCHIVE_REQUIRED");
    const archive = randomUUID();
    db.prepare("INSERT INTO legacy_upgrades VALUES(?,?,?)").run(
      s,
      archive,
      JSON.stringify({ draft: d, local: working(db, s, id) }),
    );
    db.prepare("DELETE FROM drafts WHERE scope=? AND id=?").run(s, id);
    db.prepare("DELETE FROM working WHERE scope=? AND id=?").run(s, id);
    enqueuePatch(db, s, id, Object.fromEntries(allowed.map((k) => [k, body.row[k]])));
    return { archive };
  });
}
export function recoverArchivedEdit(db, s, archiveId, id, seen, { choice } = {}) {
  initIntegrated(db);
  const archive = db
    .prepare("SELECT payload FROM recovery_archives WHERE scope=? AND id=?")
    .get(s, archiveId);
  if (!archive) throw Error("ARCHIVE_REQUIRED");
  const localRow = JSON.parse(archive.payload).working?.find((r) => r.id === id);
  if (!localRow) throw Error("LOCAL_EDIT_REQUIRED");
  const local = JSON.parse(localRow.body),
    r = record(db, s, id);
  if (state(db, s).generation !== seen.generation || (r?.rev ?? null) !== seen.revision)
    throw Error("CONFLICT_CHANGED");
  if (choice === "copy") {
    db.exec(
      "CREATE TABLE IF NOT EXISTS recovered_copies(scope TEXT,id TEXT,payload TEXT,PRIMARY KEY(scope,id));",
    );
    const copy = randomUUID();
    db.prepare("INSERT INTO recovered_copies VALUES(?,?,?)").run(s, copy, JSON.stringify(local));
    return { copy };
  }
  if (choice !== "new-content-draft" || !r || r.body.table !== "entry_item") throw Error("RECOVERY_CHOICE");
  enqueuePatch(
    db,
    s,
    id,
    Object.fromEntries(["text", "flagged", "flag_done_at"].map((k) => [k, local.row[k]])),
  );
  return { draft: id };
}
