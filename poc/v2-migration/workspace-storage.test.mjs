import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { workspaceSessionFixture } from "./workspace-session-fixture.mjs";
import { openMigrationJournal } from "./journal.mjs";
import { mapWorkspace } from "./workspace-map.mjs";
import { createWorkspaceStorageGateway } from "./workspace-storage.mjs";
function setup(t) {
  const root = mkdtempSync(join(tmpdir(), "wjb-storage-journal-")),
    e = workspaceSessionFixture(root);
  e.options = { protectedLocalRoots: [e.localRoot] };
  e.journal = openMigrationJournal(e.path, e.options);
  const job = e.journal.create({ directory: e.directory, workspaceId: e.workspaceId, ...e.actor });
  e.id = job.id;
  e.lease = e.journal.acquire(e.id, e.actor);
  const m = mapWorkspace(e.directory, e.workspaceId);
  e.journal.prepareWorkspace(e.lease, { mappingHash: m.mappingHash, profile: m.envelope.profile });
  e.journal.bindWorkspace(e.lease, {
    jobId: e.id,
    workspaceId: e.workspaceId,
    sourceManifestHash: job.manifest_hash,
    targetManifestHash: "a".repeat(64),
    targetProfile: m.envelope.profile,
    productActivationAllowed: false,
  });
  e.object = job.assets[0].object_id;
  e.op = e.journal.beginUpload(e.lease, e.object);
  e.session = randomUUID();
  t.after(() => {
    e.journal.close();
    rmSync(root, { recursive: true, force: true });
  });
  return e;
}
test("persistent IO receipts survive schema2 upgrade without touching full bindings", (t) => {
  const e = setup(t),
    before = e.journal.get(e.id, e.actor);
  e.journal.release(e.lease);
  e.journal.close();
  const d = new DatabaseSync(e.path);
  d.exec("DROP TABLE storage_io; PRAGMA user_version=2");
  d.close();
  e.journal = openMigrationJournal(e.path, e.options);
  const after = e.journal.get(e.id, e.actor);
  assert.deepEqual(after.binding, before.binding);
  assert.deepEqual(after.assets, before.assets);
  const r = new DatabaseSync(e.path, { readOnly: true });
  try {
    assert.equal(r.prepare("PRAGMA user_version").get().user_version, 4);
  } finally {
    r.close();
  }
});
test("durable IO token is bound to issued asset operation and initial session", (t) => {
  const e = setup(t);
  const io = e.journal.prepareStorageIO(e.lease, e.object, e.session);
  assert.equal(io.operation_id, e.op);
  assert.equal(io.lease_token, e.op);
  assert.equal(io.session_id, e.session);
  assert.equal(io.phase, "prepared");
  assert.deepEqual(e.journal.prepareStorageIO(e.lease, e.object, randomUUID()), io);
  e.journal.storageIOAcquired(e.lease, e.object, e.op, "1");
  assert.throws(() => e.journal.storageIOAcquired(e.lease, e.object, e.op, "2"), /STORAGE_IO_FENCE_CHANGED/);
});
test("IO confirmation cannot skip dispatch phase or target a different operation", (t) => {
  const e = setup(t);
  e.journal.prepareStorageIO(e.lease, e.object, e.session);
  assert.throws(
    () => e.journal.storageIOCompleted(e.id, e.actor, e.object, e.op, "confirmed"),
    /STORAGE_IO_RECEIPT/,
  );
  assert.throws(
    () => e.journal.storageIOCompleted(e.id, e.actor, e.object, randomUUID(), "confirmed"),
    /STORAGE_IO_RECEIPT/,
  );
  assert.throws(
    () => e.journal.storageIOPhase(e.lease, e.object, e.op, "prepared", "dispatching"),
    /STORAGE_IO_STATE/,
  );
});
test("late terminal IO receipt can settle after cancellation without changing job state", (t) => {
  const e = setup(t);
  e.journal.prepareStorageIO(e.lease, e.object, e.session);
  e.journal.storageIOAcquired(e.lease, e.object, e.op, "1");
  e.journal.storageIOPhase(e.lease, e.object, e.op, "acquired", "begun");
  e.journal.storageIOPhase(e.lease, e.object, e.op, "begun", "dispatching");
  e.journal.requestCancel(e.id, e.actor);
  assert.throws(() => e.journal.workspaceAssetProof(e.lease, e.object, {}), /LEASE_LOST/);
  e.journal.storageIOCompleted(e.id, e.actor, e.object, e.op, "confirmed");
  e.journal.storageIOCompleted(e.id, e.actor, e.object, e.op, "settled");
  assert.equal(e.journal.get(e.id, e.actor).state, "cancel_requested");
  assert.equal(e.journal.storageIOs(e.id, e.actor)[0].phase, "settled");
});
test("another actor cannot record IO completion or read its receipts", (t) => {
  const e = setup(t),
    other = { ...e.actor, ownerId: randomUUID() };
  e.journal.prepareStorageIO(e.lease, e.object, e.session);
  assert.throws(() => e.journal.storageIOs(e.id, other), /SCOPE_DENIED/);
  assert.throws(() => e.journal.storageIOCompleted(e.id, other, e.object, e.op, "confirmed"), /SCOPE_DENIED/);
});
test("Storage composition rejects production refs, PATs and absent verified principal before IO", () => {
  const principal = { userId: randomUUID(), sessionId: randomUUID(), role: "authenticated" };
  const base = {
    projectRef: "vsphftnmfzfoufasjttd",
    serviceRoleKey: "fictional-key",
    principal,
    deviceId: randomUUID(),
    fetchTransport: () => {
      throw Error("no transport expected");
    },
  };
  for (const extra of [
    { projectRef: "hutqsfftioxtredcjhsy" },
    { serviceRoleKey: "sbp_fake" },
    { principal: null },
    { principal: { ...principal, role: "service_role" } },
  ])
    assert.throws(() => createWorkspaceStorageGateway({ ...base, ...extra }));
});
