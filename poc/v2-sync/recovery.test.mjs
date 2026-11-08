import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { env, drain, scope, root, child } from "./scenario.mjs";
import { record, working, state, hash, changes } from "./model.mjs";
import {
  createSnapshot,
  verifySnapshot,
  restoreSnapshot,
  compact,
  readChanges,
  reconcile,
  gcAssets,
  snapshotPlan,
  pruneSnapshots,
} from "./recovery.mjs";
import { allRecords } from "./lifecycle.mjs";
import {
  enqueuePatch,
  enqueueLifecycle,
  enqueueMove,
  enqueueMoveAfter,
  integratedTick,
  jobs,
  resolveConflict,
} from "./integrated.mjs";
const target = { date: "2026-11-03", categoryId: "c1" };
for (const n of [17, 41, 73]) {
  test(`recovery/${n}: complete snapshot restore, before-copy and idempotence`, (t) => {
    const e = env(t, n),
      snap = createSnapshot(e.s, scope),
      original = hash(allRecords(e.s, scope));
    enqueuePatch(e.a, scope, root, { text: "newer than snapshot" });
    drain(e.a, e.s);
    const result = restoreSnapshot(e.s, "u", scope, 1, "restore", snap.id);
    assert.equal(hash(allRecords(e.s, scope)), original);
    assert.equal(state(e.s, scope).generation, 2);
    assert.deepEqual(restoreSnapshot(e.s, "u", scope, 1, "restore", snap.id), result);
    assert.equal(
      verifySnapshot(e.s, scope, result.beforeSnapshot).rows.find((r) => r.id === root).body.row.text,
      "newer than snapshot",
    );
    assert.equal(e.s.prepare("SELECT count(*) n FROM snapshots WHERE scope=?").get(scope).n, 2);
  });
  test(`recovery/${n}: expired cursor preserves pending then explicit archive-refresh`, (t) => {
    const e = env(t, n);
    enqueuePatch(e.a, scope, child, { text: "offline pending" });
    enqueuePatch(e.b, scope, root, { text: "server update" });
    drain(e.b, e.s);
    createSnapshot(e.s, scope);
    compact(e.s, scope, 1);
    assert.throws(() => integratedTick(e.a, e.s, "u", scope), /CURSOR_EXPIRED/);
    assert.equal(working(e.a, scope, child).row.text, "offline pending");
    assert.throws(() => reconcile(e.a, e.s, scope), /RECONCILE_CONFIRMATION/);
    const r = reconcile(e.a, e.s, scope, { decision: "archive-and-refresh", reason: "cursor expired" }),
      archive = JSON.parse(
        e.a.prepare("SELECT payload FROM recovery_archives WHERE scope=? AND id=?").get(scope, r.archive)
          .payload,
      );
    assert.ok(archive.typed_drafts.length);
    assert.equal(JSON.parse(archive.working.find((r) => r.id === child).body).row.text, "offline pending");
    assert.equal(drain(e.a, e.s), "idle");
    assert.equal(state(e.a, scope).cursor, 1);
    enqueuePatch(e.a, scope, child, { text: "new confirmed edit" });
    drain(e.a, e.s);
    assert.equal(record(e.s, scope, child).body.row.text, "new confirmed edit");
  });
  test(`recovery/${n}: generation refresh archives old move rather than replay`, (t) => {
    const e = env(t, n),
      snapshot = createSnapshot(e.s, scope);
    enqueueMove(e.a, scope, root, target);
    restoreSnapshot(e.s, "u", scope, 1, "restore", snapshot.id);
    assert.throws(() => integratedTick(e.a, e.s, "u", scope), /GENERATION_CHANGED/);
    const result = reconcile(e.a, e.s, scope, { decision: "archive-and-refresh" });
    assert.equal(result.generation, 2);
    assert.equal(jobs(e.a, scope).length, 0);
    assert.equal(record(e.a, scope, root).body.row.date, "2026-10-30");
    assert.equal(e.a.prepare("SELECT count(*) n FROM archive_blobs WHERE scope=?").get(scope).n, 1);
    assert.equal(drain(e.a, e.s), "idle");
  });
}
test("recovery corrupt snapshot blob refuses restore without changing live data", (t) => {
  const e = env(t),
    snap = createSnapshot(e.s, scope),
    before = hash(allRecords(e.s, scope));
  e.s.prepare("UPDATE snapshot_blobs SET bytes=x'00' WHERE scope=? AND id=?").run(scope, snap.id);
  assert.throws(() => restoreSnapshot(e.s, "u", scope, 1, "restore", snap.id), /SNAPSHOT_BLOBS|ASSET_HASH/);
  assert.equal(hash(allRecords(e.s, scope)), before);
  assert.equal(state(e.s, scope).generation, 1);
});
test("recovery injected restore failure keeps old records and generation", (t) => {
  const e = env(t),
    snap = createSnapshot(e.s, scope),
    before = hash(allRecords(e.s, scope));
  assert.throws(
    () =>
      restoreSnapshot(e.s, "u", scope, 1, "restore", snap.id, (p) => {
        if (p === "after-clear") throw Error("fault");
      }),
    /fault/,
  );
  assert.equal(hash(allRecords(e.s, scope)), before);
  assert.equal(state(e.s, scope).generation, 1);
  assert.equal(e.s.prepare("SELECT count(*) n FROM snapshots WHERE scope=?").get(scope).n, 1);
});
test("recovery snapshot quotas and missing assets do not publish a snapshot", (t) => {
  const e = env(t);
  assert.throws(() => createSnapshot(e.s, scope, { maxBytes: 1 }), /SNAPSHOT_QUOTA/);
  assert.equal(e.s.prepare("SELECT count(*) n FROM snapshots").get().n, 0);
  e.s.prepare("DELETE FROM local_assets WHERE scope=?").run(scope);
  assert.throws(() => createSnapshot(e.s, scope), /ASSET_MISSING/);
});
test("recovery checkpoint required, retired ID survives tombstone/log compaction", (t) => {
  const e = env(t);
  enqueueLifecycle(e.a, scope, { kind: "delete-subtree", id: root });
  drain(e.a, e.s);
  assert.throws(() => compact(e.s, scope, 1), /CHECKPOINT_REQUIRED/);
  createSnapshot(e.s, scope);
  compact(e.s, scope, 1);
  assert.equal(e.s.prepare("SELECT count(*) n FROM tombstones WHERE scope=?").get(scope).n, 0);
  assert.ok(e.s.prepare("SELECT 1 FROM retired_ids WHERE scope=? AND id=?").get(scope, root));
  assert.throws(() => readChanges(e.s, scope, 1, 0), /CURSOR_EXPIRED/);
  assert.deepEqual(readChanges(e.s, scope, 1, 1), []);
});
test("recovery asset GC protects snapshot, archives and pending work", (t) => {
  const e = env(t);
  createSnapshot(e.s, scope);
  const bytes = Buffer.from("orphan"),
    h = hash(bytes);
  e.s.prepare("INSERT INTO local_assets VALUES(?,?,?)").run(scope, h, bytes);
  assert.equal(gcAssets(e.s, scope).removed, 1);
  assert.equal(e.s.prepare("SELECT count(*) n FROM local_assets WHERE scope=?").get(scope).n, 1);
  enqueuePatch(e.a, scope, root, { text: "pending" });
  e.a.prepare("INSERT INTO local_assets VALUES(?,?,?)").run(scope, h, bytes);
  assert.equal(gcAssets(e.a, scope).reason, "PENDING_EDITS");
  assert.equal(e.a.prepare("SELECT count(*) n FROM local_assets WHERE scope=?").get(scope).n, 2);
});
test("recovery snapshot retention is previewed, stale plan rejected, pins win", (t) => {
  const e = env(t);
  createSnapshot(e.s, scope, { id: "pinned", pinned: true });
  for (let i = 0; i < 4; i++) createSnapshot(e.s, scope, { id: "s" + i });
  const plan = snapshotPlan(e.s, scope, 2);
  assert.equal(plan.remove.length, 2);
  createSnapshot(e.s, scope, { id: "new" });
  assert.throws(() => pruneSnapshots(e.s, scope, plan, 2), /SNAPSHOT_PLAN_CHANGED/);
  const fresh = snapshotPlan(e.s, scope, 2);
  assert.equal(pruneSnapshots(e.s, scope, fresh, 2), 3);
  assert.ok(verifySnapshot(e.s, scope, "pinned"));
  assert.equal(e.s.prepare("SELECT count(*) n FROM snapshots WHERE scope=?").get(scope).n, 3);
});
test("recovery conflict resolution detects changed view and keeps local explicitly", (t) => {
  const e = env(t);
  enqueuePatch(e.a, scope, root, { text: "mine" });
  enqueuePatch(e.b, scope, root, { text: "theirs" });
  drain(e.b, e.s);
  drain(e.a, e.s);
  const seen = { generation: 1, revision: record(e.a, scope, root).rev };
  enqueuePatch(e.b, scope, root, { text: "third" });
  drain(e.b, e.s);
  drain(e.a, e.s);
  assert.throws(() => resolveConflict(e.a, scope, root, seen, { choice: "keep-local" }), /CONFLICT_CHANGED/);
  resolveConflict(
    e.a,
    scope,
    root,
    { generation: 1, revision: record(e.a, scope, root).rev },
    { choice: "keep-local" },
  );
  assert.equal(drain(e.a, e.s), "idle");
  assert.equal(record(e.s, scope, root).body.row.text, "mine");
});
test("recovery deleted child is recoverable as a detached new copy", (t) => {
  const e = env(t);
  enqueuePatch(e.a, scope, child, { text: "lost child draft" });
  enqueueLifecycle(e.b, scope, { kind: "delete-subtree", id: root });
  drain(e.b, e.s);
  drain(e.a, e.s);
  const r = resolveConflict(e.a, scope, child, { generation: 1, revision: null }, { choice: "copy" });
  assert.equal(
    JSON.parse(
      e.a.prepare("SELECT payload FROM recovered_copies WHERE scope=? AND id=?").get(scope, r.copy).payload,
    ).row.text,
    "lost child draft",
  );
  assert.equal(record(e.s, scope, child), null);
  assert.equal(drain(e.a, e.s), "idle");
  assert.throws(() => createSnapshot(e.a, scope), /PENDING_EDITS/);
});
test("recovery dependent moves promote once using fresh versions after each ack", (t) => {
  const e = env(t);
  const first = enqueueMoveAfter(e.a, scope, root, target),
    second = enqueueMoveAfter(e.a, scope, root, { date: "2026-11-04", categoryId: "c1" }),
    third = enqueueMoveAfter(e.a, scope, root, { date: "2026-11-05", categoryId: "c1" });
  assert.notEqual(first, second);
  assert.notEqual(second, third);
  assert.equal(drain(e.a, e.s), "idle");
  assert.equal(record(e.s, scope, root).body.row.date, "2026-11-05");
  assert.equal(changes(e.s, scope, 0).length, 3);
});
