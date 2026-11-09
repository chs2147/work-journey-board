import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fixture18 } from "../v2-sync/fixture18.mjs";
import { createConnectedCopy } from "../v2-assets/connected-copy.mjs";
import { hash, sourceHash } from "../v2-sync/model.mjs";
import { openMigrationJournal } from "./journal.mjs";
import { advanceMigration } from "./coordinator.mjs";

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), "wjb-migration-")),
    localRoot = join(root, "legacy"),
    stateRoot = join(root, "connected");
  for (const path of [localRoot, stateRoot]) {
    mkdirSync(path);
    writeFileSync(join(path, ".v2-poc-only"), "synthetic only");
  }
  const source = join(localRoot, "source.db"),
    directory = join(stateRoot, "copy"),
    path = join(stateRoot, "migration.db");
  fixture18(source);
  const workspaceId = randomUUID();
  createConnectedCopy(source, directory, { sourceWorkspaceId: randomUUID(), workspaceId });
  const actor = { ownerId: randomUUID(), deviceId: randomUUID() };
  const options = { protectedLocalRoots: [localRoot] };
  const e = {
    root,
    localRoot,
    source,
    directory,
    path,
    workspaceId,
    actor,
    options,
    before: sourceHash(source),
  };
  e.journal = openMigrationJournal(path, options);
  e.job = e.journal.create({ directory, workspaceId, ...actor });
  e.reopen = (extra = {}) => {
    e.journal.close();
    e.journal = openMigrationJournal(path, { ...options, ...extra });
  };
  t.after(() => {
    try {
      e.journal.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  return e;
}
function remote() {
  const state = { objects: new Map(), calls: {}, phase: "staging", flags: {}, receipt: null };
  const count = (name) => (state.calls[name] = (state.calls[name] || 0) + 1);
  const receipt = (c) => ({
    status: "verified",
    workspaceId: c.workspaceId,
    manifestHash: c.manifestHash,
    generation: "1",
  });
  const backend = {
    async upload(c, b) {
      count("upload");
      if (state.phase !== "staging") throw Error("SERVER_FENCED");
      if (state.flags.beforeUpload) {
        state.flags.beforeUpload = false;
        throw Error("REMOTE_UNAVAILABLE");
      }
      state.objects.set(c.objectId, { sha256: hash(b), bytes: b.length, ownedByJob: true });
      if (state.flags.duringUpload) await state.flags.duringUpload(c);
      if (state.flags.lostUpload) {
        state.flags.lostUpload = false;
        throw Error("LOST_ACK");
      }
    },
    async observe(c) {
      count("observe");
      const b = state.objects.get(c.objectId);
      const identity = {
        jobId: c.jobId,
        objectId: c.objectId,
        manifestHash: c.manifestHash,
        operationId: state.flags.staleObservation ? randomUUID() : c.operationId,
      };
      if (state.flags.unsettled)
        return { ...identity, kind: b ? "ready" : "absent", ...b, operationSettled: false };
      return b
        ? { ...identity, kind: "ready", ...b, operationSettled: true }
        : { ...identity, kind: "absent", operationSettled: true };
    },
    async stageMetadata(c) {
      count("stageMetadata");
      if (state.flags.duringMetadata) await state.flags.duringMetadata();
      return { manifestHash: c.manifestHash, imagePayloadRows: state.flags.inlineImage ? 1 : 0 };
    },
    async publish(c) {
      count("publish");
      if (state.phase !== "staging") throw Error("SERVER_FENCED");
      if (state.flags.unknownPublish) {
        throw Error("UNKNOWN_PUBLICATION");
      }
      state.phase = "connected";
      state.receipt = receipt(c);
      if (state.flags.badReceipt) state.receipt = { ...state.receipt, manifestHash: "b".repeat(64) };
      if (state.flags.lostPublish) {
        state.flags.lostPublish = false;
        throw Error("LOST_PUBLICATION_ACK");
      }
      return state.receipt;
    },
    async publication(c) {
      count("publication");
      const identity = {
        jobId: c.jobId,
        manifestHash: c.manifestHash,
        operationId: state.flags.stalePublication ? randomUUID() : c.operationId,
      };
      return state.phase === "connected"
        ? { ...identity, state: "connected", receipt: state.receipt }
        : state.flags.unknownPublish
          ? { ...identity, state: "pending", operationSettled: false }
          : { ...identity, state: "absent", operationSettled: true };
    },
    async cancelStaging(c) {
      count("cancelStaging");
      if (state.phase === "connected") return { state: "connected", receipt: state.receipt };
      state.phase = "cancel_fenced";
      if (state.flags.lostCancelFence) {
        state.flags.lostCancelFence = false;
        throw Error("CANCEL_FENCE_ACK_LOST");
      }
      return {
        state: "cancel_fenced",
        publishBlocked: true,
        jobId: c.jobId,
        manifestHash: c.manifestHash,
        epoch: c.epoch,
      };
    },
    async remove(c) {
      count("remove");
      if (state.phase !== "cancel_fenced") throw Error("NOT_FENCED");
      if (!state.flags.keepAfterDelete) state.objects.delete(c.objectId);
      if (state.flags.lostDelete) {
        state.flags.lostDelete = false;
        throw Error("DELETE_ACK_LOST");
      }
    },
    async finishCancel(c) {
      count("finishCancel");
      if (state.objects.size) throw Error("NOT_EMPTY");
      state.phase = "canceled";
      return { state: "canceled", jobId: c.jobId, manifestHash: c.manifestHash, epoch: c.epoch };
    },
  };
  return { state, backend };
}
const run = (e, r) =>
  advanceMigration({
    journal: e.journal,
    id: e.job.id,
    actor: e.actor,
    directory: e.directory,
    backend: r.backend,
  });
const job = (e) => e.journal.get(e.job.id, e.actor);
test("durable metadata-only job reaches connected after exact receipt", async (t) => {
  const e = setup(t),
    r = remote();
  assert.equal((await run(e, r)).state, "connected");
  e.reopen();
  assert.equal(job(e).state, "connected");
  assert.equal(sourceHash(e.source), e.before);
  assert.equal(r.state.calls.upload, 1);
  assert.equal(r.state.objects.size, 1);
  const db = new DatabaseSync(e.path, { readOnly: true });
  try {
    for (const table of ["job", "asset"])
      assert.ok(
        db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .every((c) => c.type !== "BLOB"),
      );
  } finally {
    db.close();
  }
  const bytes = readFileSync(e.path),
    original = new DatabaseSync(e.source, { readOnly: true });
  try {
    const data = original.prepare("SELECT data FROM note_asset").get().data;
    assert.equal(bytes.includes(Buffer.from(data)), false);
    assert.equal(bytes.includes(Buffer.from(data, "base64")), false);
  } finally {
    original.close();
  }
});
test("different account or device cannot resume a job", async (t) => {
  const e = setup(t),
    r = remote();
  for (const actor of [
    { ...e.actor, ownerId: randomUUID() },
    { ...e.actor, deviceId: randomUUID() },
  ])
    await assert.rejects(
      () =>
        advanceMigration({
          journal: e.journal,
          id: e.job.id,
          actor,
          directory: e.directory,
          backend: r.backend,
        }),
      /SCOPE_DENIED/,
    );
  assert.deepEqual(r.state.calls, {});
});
test("upload ack loss survives reopen and rechecks before upload", async (t) => {
  const e = setup(t),
    r = remote();
  r.state.flags.lostUpload = true;
  await assert.rejects(() => run(e, r), /LOST_ACK/);
  assert.equal(job(e).assets[0].state, "uncertain");
  const operation = job(e).assets[0].op_id;
  e.reopen();
  assert.equal((await run(e, r)).state, "connected");
  assert.equal(r.state.calls.upload, 1);
  assert.equal(job(e).assets[0].op_id, operation);
});
test("settled absent upload can retry without changing manifest", async (t) => {
  const e = setup(t),
    r = remote();
  r.state.flags.beforeUpload = true;
  await assert.rejects(() => run(e, r), /REMOTE_UNAVAILABLE/);
  e.reopen();
  assert.equal((await run(e, r)).state, "connected");
  assert.equal(r.state.calls.upload, 2);
});
test("absent object with unsettled operation never triggers retry", async (t) => {
  const e = setup(t),
    r = remote();
  r.state.flags.beforeUpload = true;
  await assert.rejects(() => run(e, r));
  r.state.flags.unsettled = true;
  e.reopen();
  assert.equal((await run(e, r)).blocked, "UNSETTLED_IO");
  assert.equal(r.state.calls.upload, 1);
  r.state.flags.unsettled = false;
  assert.equal((await run(e, r)).state, "connected");
});
test("wrong hash or foreign ownership cannot be reconciled", async (t) => {
  const e = setup(t),
    r = remote();
  r.state.flags.lostUpload = true;
  await assert.rejects(() => run(e, r));
  const object = r.state.objects.values().next().value;
  object.ownedByJob = false;
  await assert.rejects(() => run(e, r), /OWNERSHIP/);
  object.ownedByJob = true;
  object.sha256 = "b".repeat(64);
  await assert.rejects(() => run(e, r), /INTEGRITY/);
  assert.equal(job(e).state, "uploading");
});
test("metadata image payload count blocks final publication", async (t) => {
  const e = setup(t),
    r = remote();
  r.state.flags.inlineImage = true;
  await assert.rejects(() => run(e, r), /METADATA_NOT_VERIFIED/);
  assert.equal(r.state.calls.publish, undefined);
});
test("publication ack loss reopens as committed without republishing", async (t) => {
  const e = setup(t),
    r = remote();
  r.state.flags.lostPublish = true;
  await assert.rejects(() => run(e, r), /LOST_PUBLICATION_ACK/);
  assert.equal(job(e).state, "publishing");
  e.reopen();
  assert.equal((await run(e, r)).state, "connected");
  assert.equal(r.state.calls.publish, 1);
});
test("unknown publication remains pending until authoritative observation", async (t) => {
  const e = setup(t),
    r = remote();
  r.state.flags.unknownPublish = true;
  await assert.rejects(() => run(e, r));
  e.reopen();
  assert.equal((await run(e, r)).blocked, "PUBLICATION_UNCERTAIN");
  assert.equal(r.state.calls.publish, 1);
  r.state.flags.unknownPublish = false;
  assert.equal((await run(e, r)).state, "connected");
  assert.equal(r.state.calls.publish, 2);
});
test("cancel before upload fences publication and keeps original and copy files", async (t) => {
  const e = setup(t),
    r = remote();
  e.journal.requestCancel(e.job.id, e.actor);
  assert.equal((await run(e, r)).state, "canceled");
  assert.equal(r.state.calls.upload, undefined);
  assert.equal(sourceHash(e.source), e.before);
  assert.equal(readdirSync(join(e.directory, "assets")).length, 1);
});
test("cancel after lost upload removes only owned job objects after settlement", async (t) => {
  const e = setup(t),
    r = remote();
  r.state.flags.lostUpload = true;
  await assert.rejects(() => run(e, r));
  e.journal.requestCancel(e.job.id, e.actor);
  e.reopen();
  assert.equal((await run(e, r)).state, "canceled");
  assert.equal(r.state.objects.size, 0);
  assert.equal(r.state.calls.remove, 1);
  assert.equal(sourceHash(e.source), e.before);
});
test("cancel waits for late upload settlement even when a file exists", async (t) => {
  const e = setup(t),
    r = remote();
  r.state.flags.lostUpload = true;
  await assert.rejects(() => run(e, r));
  e.journal.requestCancel(e.job.id, e.actor);
  r.state.flags.unsettled = true;
  assert.equal((await run(e, r)).blocked, "UNSETTLED_IO");
  assert.equal(r.state.calls.remove, undefined);
  r.state.flags.unsettled = false;
  assert.equal((await run(e, r)).state, "canceled");
});
test("already committed online workspace rejects staging cancellation and retains files", async (t) => {
  const e = setup(t),
    r = remote();
  r.state.flags.lostPublish = true;
  await assert.rejects(() => run(e, r));
  e.journal.requestCancel(e.job.id, e.actor);
  assert.deepEqual(await run(e, r), { state: "connected", cancelRejected: true });
  assert.equal(r.state.calls.remove, undefined);
  assert.equal(r.state.objects.size, 1);
  assert.throws(() => e.journal.requestCancel(e.job.id, e.actor), /ALREADY_CONNECTED/);
});
test("server cancellation fence blocks a late publisher", async (t) => {
  const e = setup(t),
    r = remote();
  r.state.flags.unknownPublish = true;
  await assert.rejects(() => run(e, r));
  e.journal.requestCancel(e.job.id, e.actor);
  assert.equal((await run(e, r)).state, "canceled");
  await assert.rejects(() => r.backend.publish({}), /SERVER_FENCED/);
});
test("delete ack loss resumes by absence check without deleting twice", async (t) => {
  const e = setup(t),
    r = remote();
  r.state.flags.lostUpload = true;
  await assert.rejects(() => run(e, r));
  e.journal.requestCancel(e.job.id, e.actor);
  r.state.flags.lostDelete = true;
  await assert.rejects(() => run(e, r), /DELETE_ACK_LOST/);
  assert.equal(job(e).assets[0].state, "delete_uncertain");
  e.reopen();
  assert.equal((await run(e, r)).state, "canceled");
  assert.equal(r.state.calls.remove, 1);
});
test("successful delete response with remaining bytes cannot finish cancel", async (t) => {
  const e = setup(t),
    r = remote();
  r.state.flags.lostUpload = true;
  await assert.rejects(() => run(e, r));
  e.journal.requestCancel(e.job.id, e.actor);
  r.state.flags.keepAfterDelete = true;
  assert.equal((await run(e, r)).blocked, "DELETE_UNCONFIRMED");
  assert.equal(job(e).state, "cancel_fenced");
  r.state.flags.keepAfterDelete = false;
  assert.equal((await run(e, r)).state, "canceled");
});
test("concurrent lease and stale lease completion are rejected", (t) => {
  const e = setup(t);
  e.reopen({ clock: () => 1000 });
  const lease = e.journal.acquire(e.job.id, e.actor);
  const second = openMigrationJournal(e.path, { ...e.options, clock: () => 1000 });
  try {
    assert.throws(() => second.acquire(e.job.id, e.actor), /LEASE_BUSY/);
  } finally {
    second.close();
  }
  e.reopen({ clock: () => 40000 });
  const replacement = e.journal.acquire(e.job.id, e.actor);
  assert.throws(() => e.journal.beginUpload(lease, e.job.assets[0].object_id), /LEASE_LOST/);
  e.journal.release(replacement);
});
test("cancel invalidates in-flight worker completion without losing intent", async (t) => {
  const e = setup(t),
    r = remote();
  r.state.flags.duringUpload = () => e.journal.requestCancel(e.job.id, e.actor);
  await assert.rejects(() => run(e, r), /LEASE_LOST/);
  assert.equal(job(e).state, "cancel_requested");
  assert.equal(job(e).assets[0].state, "uncertain");
  assert.equal((await run(e, r)).state, "canceled");
});
test("existing DB18 cannot be opened as a migration journal", (t) => {
  const e = setup(t);
  assert.throws(() => openMigrationJournal(e.source, e.options), /NOT_MIGRATION_JOURNAL/);
  assert.equal(sourceHash(e.source), e.before);
});
test("journal creation inside preserved source folder is rejected", (t) => {
  const e = setup(t),
    files = readdirSync(e.localRoot),
    path = join(e.localRoot, "migration.db");
  assert.throws(() => openMigrationJournal(path, e.options), /PATH_OVERLAP/);
  assert.equal(existsSync(path), false);
  assert.deepEqual(readdirSync(e.localRoot), files);
});
test("changed extraction manifest refuses resume before any remote request", async (t) => {
  const e = setup(t),
    r = remote();
  writeFileSync(join(e.directory, "manifest.json"), "{}");
  await assert.rejects(() => run(e, r), /MANIFEST_SCOPE/);
  assert.deepEqual(r.state.calls, {});
});
test("wrong completion receipt cannot mark a job connected", async (t) => {
  const e = setup(t),
    r = remote();
  r.state.flags.badReceipt = true;
  await assert.rejects(() => run(e, r), /RECEIPT_MISMATCH/);
  assert.equal(job(e).state, "publishing");
});
test("SIGKILL after durable intent retains uncertain state and can be reacquired", (t) => {
  const e = setup(t);
  e.journal.close();
  const source = `import {openMigrationJournal} from ${JSON.stringify(new URL("./journal.mjs", import.meta.url).href)};
const x=JSON.parse(process.argv[1]);const j=openMigrationJournal(x.path,{protectedLocalRoots:[x.localRoot],clock:()=>1000});
const l=j.acquire(x.id,x.actor);j.beginUpload(l,x.objectId);process.kill(process.pid,'SIGKILL');`;
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      source,
      JSON.stringify({
        path: e.path,
        localRoot: e.localRoot,
        id: e.job.id,
        actor: e.actor,
        objectId: e.job.assets[0].object_id,
      }),
    ],
    { encoding: "utf8" },
  );
  e.journal = openMigrationJournal(e.path, { ...e.options, clock: () => 40000 });
  assert.equal(child.signal, "SIGKILL");
  assert.equal(job(e).assets[0].state, "uncertain");
  const lease = e.journal.acquire(e.job.id, e.actor);
  e.journal.release(lease);
  assert.equal(sourceHash(e.source), e.before);
});
test("later edits of original local workspace are not swept into migration", async (t) => {
  const e = setup(t),
    r = remote(),
    db = new DatabaseSync(e.source);
  db.exec("UPDATE entry_item SET text='원본에서 계속 작업' WHERE id='e1'");
  db.close();
  const edited = sourceHash(e.source);
  assert.notEqual(edited, e.before);
  assert.equal((await run(e, r)).state, "connected");
  assert.equal(sourceHash(e.source), edited);
});
test("stale operation observation cannot settle the current upload", async (t) => {
  const e = setup(t),
    r = remote();
  r.state.flags.staleObservation = true;
  await assert.rejects(() => run(e, r), /OBSERVATION_SCOPE/);
  assert.equal(job(e).assets[0].state, "uncertain");
  assert.equal(r.state.calls.publish, undefined);
});
test("wrong cancellation fence cannot authorize cleanup", async (t) => {
  const e = setup(t),
    r = remote();
  e.journal.requestCancel(e.job.id, e.actor);
  r.backend.cancelStaging = async (c) => ({
    state: "cancel_fenced",
    publishBlocked: true,
    jobId: c.jobId,
    manifestHash: c.manifestHash,
    epoch: c.epoch - 1,
  });
  await assert.rejects(() => run(e, r), /CANCEL_NOT_FENCED/);
  assert.equal(job(e).state, "cancel_requested");
  assert.equal(r.state.calls.remove, undefined);
});
test("lost server cancellation acknowledgement safely resumes fencing", async (t) => {
  const e = setup(t),
    r = remote();
  e.journal.requestCancel(e.job.id, e.actor);
  r.state.flags.lostCancelFence = true;
  await assert.rejects(() => run(e, r), /CANCEL_FENCE_ACK_LOST/);
  e.reopen();
  assert.equal((await run(e, r)).state, "canceled");
  assert.equal(r.state.calls.cancelStaging, 2);
});
test("cancel during metadata staging prevents a late local publish", async (t) => {
  const e = setup(t),
    r = remote();
  r.state.flags.duringMetadata = () => e.journal.requestCancel(e.job.id, e.actor);
  await assert.rejects(() => run(e, r), /LEASE_LOST/);
  assert.equal(r.state.calls.publish, undefined);
  assert.equal((await run(e, r)).state, "canceled");
});
test("journal alias is rejected before writable open", (t) => {
  const e = setup(t),
    alias = join(e.root, "connected", "alias.db");
  symlinkSync(e.path, alias);
  assert.throws(() => openMigrationJournal(alias, e.options), /JOURNAL_ALIAS_DENIED/);
  assert.equal(sourceHash(e.source), e.before);
});
test("cancellation can clean owned remote staging without local copy files", async (t) => {
  const e = setup(t),
    r = remote();
  r.state.flags.lostUpload = true;
  await assert.rejects(() => run(e, r));
  rmSync(e.directory, { recursive: true });
  e.journal.requestCancel(e.job.id, e.actor);
  e.reopen();
  assert.equal((await run(e, r)).state, "canceled");
  assert.equal(r.state.objects.size, 0);
  assert.equal(sourceHash(e.source), e.before);
});
test("committed publication can be reconciled even if local cache is unavailable", async (t) => {
  const e = setup(t),
    r = remote();
  r.state.flags.lostPublish = true;
  await assert.rejects(() => run(e, r));
  rmSync(e.directory, { recursive: true });
  e.reopen();
  assert.equal((await run(e, r)).state, "connected");
  assert.equal(r.state.calls.publish, 1);
  assert.equal(sourceHash(e.source), e.before);
});
test("stale publication observation never authorizes republish or connection", async (t) => {
  const e = setup(t),
    r = remote();
  r.state.flags.lostPublish = true;
  await assert.rejects(() => run(e, r));
  r.state.flags.stalePublication = true;
  await assert.rejects(() => run(e, r), /PUBLICATION_SCOPE/);
  assert.equal(job(e).state, "publishing");
  assert.equal(r.state.calls.publish, 1);
});
