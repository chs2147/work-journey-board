import { test } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { URL } from "node:url";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout, clearTimeout } from "node:timers";
import { env, drain, scope, root, child, board } from "./scenario.mjs";
import { record, working, state, hash } from "./model.mjs";
import { enqueue as legacyEnqueue, prepare as freezeLegacy } from "./queue.mjs";
import { allRecords, applyLifecycle, validateGraph, documentLinks } from "./lifecycle.mjs";
import { createSnapshot, restoreSnapshot, verifySnapshot, reconcile, compact } from "./recovery.mjs";
import {
  enqueuePatch,
  enqueueMoveAfter,
  enqueueLifecycle,
  resolveConflict,
  upgradeLegacyDraft,
  recoverArchivedEdit,
  jobs,
} from "./integrated.mjs";
function doc(db, label = "local board") {
  const body = record(db, scope, board).body,
    v = JSON.parse(body.row.doc);
  v.boxes[0].content.content[0].content[0].text = label;
  body.row.doc = JSON.stringify(v);
  return { kind: "save-document", id: board, body, links: [{ boxId: "cb1", entryId: "e3" }] };
}
test("completion legacy never-sent content converts with explicit choice and archive", (t) => {
  const e = env(t),
    body = record(e.a, scope, root).body;
  body.row.text = "legacy draft";
  legacyEnqueue(e.a, scope, root, body);
  assert.throws(() => upgradeLegacyDraft(e.a, scope, root), /UPGRADE_CONFIRMATION/);
  upgradeLegacyDraft(e.a, scope, root, { decision: "convert-content-only" });
  assert.equal(drain(e.a, e.s), "idle");
  assert.equal(record(e.s, scope, root).body.row.text, "legacy draft");
  assert.equal(e.a.prepare("SELECT count(*) n FROM legacy_upgrades").get().n, 1);
});
test("completion frozen legacy request stays immutable until archive/reconcile", (t) => {
  const e = env(t),
    body = record(e.a, scope, child).body;
  body.row.text = "frozen old edit";
  legacyEnqueue(e.a, scope, child, body);
  const old = freezeLegacy(e.a, scope, child);
  assert.throws(
    () => upgradeLegacyDraft(e.a, scope, child, { decision: "convert-content-only" }),
    /LEGACY_FLIGHT_REQUIRES_RECONCILE/,
  );
  const restored = reconcile(e.a, e.s, scope, { decision: "archive-and-refresh" });
  const archive = JSON.parse(
    e.a.prepare("SELECT payload FROM recovery_archives WHERE id=?").get(restored.archive).payload,
  );
  assert.deepEqual(JSON.parse(archive.flights[0].op), old);
  recoverArchivedEdit(
    e.a,
    scope,
    restored.archive,
    child,
    { generation: 1, revision: record(e.a, scope, child).rev },
    { choice: "new-content-draft" },
  );
  drain(e.a, e.s);
  assert.equal(record(e.s, scope, child).body.row.text, "frozen old edit");
});
test("completion legacy structural draft is never silently converted", (t) => {
  const e = env(t),
    body = record(e.a, scope, root).body;
  body.row.date = "2026-11-09";
  legacyEnqueue(e.a, scope, root, body);
  assert.throws(
    () => upgradeLegacyDraft(e.a, scope, root, { decision: "convert-content-only" }),
    /ARCHIVE_REQUIRED/,
  );
  assert.equal(working(e.a, scope, root).row.date, "2026-11-09");
});
test("completion dependent move is blocked after predecessor conflict", (t) => {
  const e = env(t);
  enqueueMoveAfter(e.a, scope, root, { date: "2026-11-03", categoryId: "c1" });
  enqueueMoveAfter(e.a, scope, root, { date: "2026-11-04", categoryId: "c1" });
  enqueueMoveAfter(e.b, scope, root, { date: "2026-11-05", categoryId: "c1" });
  drain(e.b, e.s);
  assert.equal(drain(e.a, e.s), "conflict");
  assert.equal(e.a.prepare("SELECT status FROM move_intents").get().status, "blocked");
  assert.equal(record(e.s, scope, root).body.row.date, "2026-11-05");
});
test("completion keep-server archives failed move and cancels its projection", (t) => {
  const e = env(t);
  enqueueMoveAfter(e.a, scope, root, { date: "2026-11-03", categoryId: "c1" });
  enqueueMoveAfter(e.b, scope, root, { date: "2026-11-04", categoryId: "c1" });
  drain(e.b, e.s);
  drain(e.a, e.s);
  resolveConflict(
    e.a,
    scope,
    root,
    { generation: 1, revision: record(e.a, scope, root).rev },
    { choice: "keep-server" },
  );
  assert.equal(drain(e.a, e.s), "idle");
  assert.equal(working(e.a, scope, root).row.date, "2026-11-04");
  assert.equal(e.a.prepare("SELECT count(*) n FROM resolution_history").get().n, 1);
});
test("completion document conflict resolves using fresh revision and validated links", (t) => {
  const e = env(t);
  enqueueLifecycle(e.a, scope, doc(e.a, "mine"));
  enqueueLifecycle(e.b, scope, doc(e.b, "theirs"));
  drain(e.b, e.s);
  assert.equal(drain(e.a, e.s), "conflict");
  resolveConflict(
    e.a,
    scope,
    board,
    { generation: 1, revision: record(e.a, scope, board).rev },
    { choice: "keep-local" },
  );
  assert.equal(drain(e.a, e.s), "idle");
  assert.match(record(e.s, scope, board).body.row.doc, /mine/);
  validateGraph(e.s, scope);
});
test("completion physical SQLite file quota rolls snapshot back", (t) => {
  const e = env(t);
  createSnapshot(e.s, scope);
  e.s.exec("DELETE FROM snapshots;DELETE FROM snapshot_blobs;");
  const r = record(e.s, scope, board),
    v = JSON.parse(r.body.row.doc);
  v.boxes[0].content.content[0].content[0].text = "x".repeat(1024 * 1024);
  r.body.row.doc = JSON.stringify(v);
  e.s.prepare("UPDATE records SET body=? WHERE scope=? AND id=?").run(JSON.stringify(r.body), scope, board);
  const before = hash(allRecords(e.s, scope)),
    pages = e.s.prepare("PRAGMA page_count").get().page_count;
  e.s.exec(`PRAGMA max_page_count=${pages + 1}`);
  assert.throws(() => createSnapshot(e.s, scope), /full|SQLITE_FULL/i);
  assert.equal(hash(allRecords(e.s, scope)), before);
  assert.equal(e.s.prepare("SELECT count(*) n FROM snapshots").get().n, 0);
  assert.equal(e.s.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
});
test("completion compacted operations cannot replay even if their content revision matches", (t) => {
  const e = env(t);
  const stale = enqueueLifecycle(e.a, scope, { kind: "insert-child", id: root, newId: "once", text: "new" });
  drain(e.a, e.s);
  createSnapshot(e.s, scope);
  compact(e.s, scope, 1);
  assert.throws(() => applyLifecycle(e.s, "u", stale), /RESYNC_REQUIRED/);
  assert.equal(allRecords(e.s, scope).filter((r) => r.body.row.id === "once").length, 1);
});
async function crash(e, mode, payload, point) {
  const file = join(e.dir, "payload.json");
  writeFileSync(file, JSON.stringify(payload));
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        new URL("./completion-crash.mjs", import.meta.url).pathname,
        join(e.dir, "server.db"),
        join(e.dir, "a.db"),
        mode,
        file,
        point,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let ready = false,
      error = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(Error("checkpoint timeout " + error));
    }, 5000);
    child.stderr.on("data", (x) => {
      error += x;
    });
    child.stdout.on("data", () => {
      ready = true;
      child.kill("SIGKILL");
    });
    child.on("error", reject);
    child.on("exit", (_code, signal) => {
      clearTimeout(timer);
      if (ready && signal === "SIGKILL") resolve();
      else reject(Error(error || "checkpoint not reached"));
    });
  });
}
for (const [kind, point] of [
  ["save-document", "after-links"],
  ["save-document", "after-document"],
  ["save-document", "after-commit"],
  ["delete-subtree", "after-delete"],
  ["delete-subtree", "after-commit"],
])
  test(`completion server SIGKILL ${kind}/${point}`, async (t) => {
    const e = env(t),
      cmd = enqueueLifecycle(e.a, scope, kind === "save-document" ? doc(e.a) : { kind, id: root }),
      before = hash(allRecords(e.s, scope));
    e.s.close();
    e.a.close();
    await crash(e, "lifecycle", cmd, point);
    const s = e.db("server");
    assert.equal(s.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    if (point !== "after-commit") assert.equal(hash(allRecords(s, scope)), before);
    applyLifecycle(s, "u", cmd);
    assert.equal(state(s, scope).cursor, 1);
    validateGraph(s, scope);
    if (kind === "delete-subtree") assert.equal(record(s, scope, child), null);
    else assert.equal(documentLinks(s, scope, board)[0].body.row.entry_id, "e3");
  });
for (const point of ["after-clear", "before-commit", "after-commit"])
  test(`completion restore SIGKILL ${point}`, async (t) => {
    const e = env(t),
      snapshot = createSnapshot(e.s, scope);
    enqueuePatch(e.a, scope, root, { text: "before restore" });
    drain(e.a, e.s);
    e.a.close();
    e.s.close();
    await crash(e, "restore", { snapshot: snapshot.id }, point);
    const s = e.db("server");
    assert.equal(state(s, scope).generation, point === "after-commit" ? 2 : 1);
    const result = restoreSnapshot(s, "u", scope, 1, "restore", snapshot.id);
    assert.equal(state(s, scope).generation, 2);
    assert.ok(verifySnapshot(s, scope, result.beforeSnapshot));
    assert.equal(record(s, scope, root).body.row.text.includes("before restore"), false);
  });
for (const point of ["after-delete", "after-apply"])
  test(`completion receiver SIGKILL delete ${point}`, async (t) => {
    const e = env(t);
    enqueueLifecycle(e.a, scope, { kind: "delete-subtree", id: root });
    e.a.close();
    e.s.close();
    await crash(e, "receive", {}, point);
    const a = e.db("a"),
      s = e.db("server");
    assert.equal(state(a, scope).cursor, point === "after-apply" ? 1 : 0);
    assert.equal(drain(a, s), "idle");
    assert.equal(record(a, scope, root), null);
    assert.equal(jobs(a, scope)[0].status, "done");
    validateGraph(a, scope);
  });

async function race(e, commands) {
  return Promise.all(
    commands.map(
      (cmd, i) =>
        new Promise((resolve, reject) => {
          const payload = join(e.dir, `race-${i}.json`);
          writeFileSync(payload, JSON.stringify(cmd));
          const child = spawn(
            process.execPath,
            [new URL("./lifecycle-race.mjs", import.meta.url).pathname, join(e.dir, "server.db"), payload],
            { stdio: ["ignore", "pipe", "pipe"] },
          );
          let out = "",
            err = "";
          const timer = setTimeout(() => {
            child.kill("SIGKILL");
            reject(Error("race timeout"));
          }, 5000);
          child.stdout.on("data", (b) => {
            out += b;
          });
          child.stderr.on("data", (b) => {
            err += b;
          });
          child.on("error", reject);
          child.on("close", (code) => {
            clearTimeout(timer);
            if (code !== 0) reject(Error(err));
            else
              try {
                resolve(JSON.parse(out));
              } catch (error) {
                reject(error);
              }
          });
        }),
    ),
  );
}
for (const kind of ["patch-entry", "insert-child"])
  test(`completion two-process parent deletion versus ${kind}`, async (t) => {
    const e = env(t),
      del = enqueueLifecycle(e.a, scope, { kind: "delete-subtree", id: root });
    const other =
      kind === "patch-entry"
        ? {
            kind,
            scope,
            generation: 1,
            baseCursor: 0,
            opId: "patch",
            id: child,
            contentVersion: 1,
            patch: { text: "concurrent child" },
          }
        : enqueueLifecycle(e.b, scope, { kind, id: root, newId: "new-race", text: "concurrent new child" });
    e.s.close();
    const result = await race(e, [del, other]);
    assert.equal(result.filter((r) => r.status === "accepted").length, 1);
    const s = e.db("server");
    validateGraph(s, scope);
    if (!record(s, scope, root)) {
      assert.equal(record(s, scope, child), null);
      assert.equal(result.find((r) => r.status === "rejected").code, "ENTRY_REQUIRED");
    } else assert.match(result.find((r) => r.status === "rejected").code, /CONTENT_CONFLICT|CELL_CONFLICT/);
  });
test("completion two-process document/link saves choose one complete winner", async (t) => {
  const e = env(t),
    a = enqueueLifecycle(e.a, scope, doc(e.a, "winner A")),
    bDoc = doc(e.b, "winner B");
  bDoc.links = [{ boxId: "cb1", entryId: "e4" }];
  const b = enqueueLifecycle(e.b, scope, bDoc);
  e.s.close();
  const result = await race(e, [a, b]);
  assert.equal(result.filter((r) => r.status === "accepted").length, 1);
  assert.equal(result.find((r) => r.status === "rejected").code, "DOCUMENT_CONFLICT");
  const s = e.db("server"),
    isA = record(s, scope, board).body.row.doc.includes("winner A");
  assert.equal(documentLinks(s, scope, board)[0].body.row.entry_id, isA ? "e3" : "e4");
  validateGraph(s, scope);
});
