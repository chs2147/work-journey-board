import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { workspaceSessionFixture } from "./workspace-session-fixture.mjs";
import { openMigrationJournal } from "./journal.mjs";
import { advanceWorkspaceSession } from "./workspace-session.mjs";
import { advanceMigration } from "./coordinator.mjs";
import { createMigrationRPC } from "./server-rpc.mjs";
import { hash, sourceHash } from "../v2-sync/model.mjs";
function setup(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), "wjb-bound-session-"));
  const e = workspaceSessionFixture(root, options);
  e.options = { protectedLocalRoots: [e.localRoot] };
  e.journal = openMigrationJournal(e.path, e.options);
  e.job = e.journal.create({ directory: e.directory, workspaceId: e.workspaceId, ...e.actor });
  e.principal = { userId: e.actor.ownerId, sessionId: randomUUID(), role: "authenticated" };
  e.reopen = () => {
    e.journal.close();
    e.journal = openMigrationJournal(e.path, e.options);
  };
  t.after(() => {
    e.journal.close();
    rmSync(root, { recursive: true, force: true });
  });
  return e;
}
function remote(e) {
  const s = {
    calls: [],
    target: "a".repeat(64),
    epoch: "1",
    state: "staging",
    fence: 0,
    lose: null,
    corrupt: false,
    pending: false,
  };
  const reply = (v) => new Response(JSON.stringify(v), { status: 200 });
  const error = (code) => new Response(JSON.stringify({ code: "P0001", message: code }), { status: 400 });
  const rpc = createMigrationRPC({
    projectRef: "vsphftnmfzfoufasjttd",
    serviceRoleKey: "fictional-workspace-key",
    allowWorkspaceProfiles: true,
    fetchTransport: async (url, options) => {
      assert.equal(url.origin, "https://vsphftnmfzfoufasjttd.supabase.co");
      const { p_request: q } = JSON.parse(options.body),
        p = q.params;
      s.calls.push(q);
      assert.equal(q.userId, e.actor.ownerId);
      assert.equal(q.deviceId, e.actor.deviceId);
      let v;
      const scope = {
        jobId: e.job.id,
        workspaceId: e.workspaceId,
        manifestHash: s.target,
        sourceManifestHash: s.envelope?.sourceManifestHash,
        profile: s.envelope?.profile,
      };
      if (q.action === "start") {
        if (s.envelope) assert.equal(hash(p), hash(s.envelope));
        else s.envelope = p;
        v = { ...scope, sourceManifestHash: p.sourceManifestHash, profile: p.profile, state: s.state };
      } else {
        assert.equal(p.manifestHash, s.target);
        if (q.action === "status") v = { ...scope, state: s.state, epoch: s.epoch };
        if (q.action === "workspace")
          v = {
            ...scope,
            envelope: s.corrupt ? { ...s.envelope, sourceManifestHash: "0".repeat(64) } : s.envelope,
            productActivationAllowed: false,
          };
        if (q.action === "publication")
          v =
            s.state === "connected"
              ? { ...scope, state: "connected", operationId: p.operationId, receipt: s.receipt }
              : {
                  ...scope,
                  state: s.pending ? "pending" : "absent",
                  operationId: p.operationId,
                  operationSettled: !s.pending,
                  serverFence: String(++s.fence),
                };
        if (q.action === "prepare_publish")
          v = { operationId: p.operationId, token: randomUUID(), fence: String(++s.fence) };
        if (q.action === "publish") {
          s.state = "connected";
          s.receipt = { ...scope, status: "poc-verified", generation: "1", publicationId: p.operationId };
          v = s.receipt;
        }
        if (q.action === "cancel") {
          if (s.state === "connected") v = { state: "connected", receipt: s.receipt };
          else {
            s.state = "cancel_fenced";
            s.epoch = "2";
            v = { ...scope, state: "cancel_fenced", epoch: "2", publishBlocked: true };
          }
        }
        if (q.action === "finish_cancel") {
          if (s.envelope.assets.length) return error("MIGRATION_CANCEL_INCOMPLETE");
          s.state = "canceled";
          v = { ...scope, state: "canceled", epoch: "2" };
        }
      }
      if (s.lose === q.action) {
        s.lose = null;
        throw Error("fictional response loss");
      }
      return reply(v);
    },
  });
  return { s, rpc };
}
const run = (e, r, extra = {}) =>
  advanceWorkspaceSession({
    journal: e.journal,
    id: e.job.id,
    actor: e.actor,
    directory: e.directory,
    principal: e.principal,
    rpc: r.rpc,
    ...extra,
  });
const get = (e) => e.journal.get(e.job.id, e.actor);
for (const version of [18, 19, 20])
  test(`DB${version}: durable dual digests and PoC completion never activates product`, async (t) => {
    const e = setup(t, { withoutImages: true, version }),
      r = remote(e);
    assert.equal((await run(e, r)).state, "poc-verified");
    e.reopen();
    const j = get(e);
    assert.equal(j.binding.source_manifest_hash, j.manifest_hash);
    assert.equal(j.binding.target_manifest_hash, r.s.target);
    assert.notEqual(j.manifest_hash, r.s.target);
    assert.equal(j.binding.mapping_hash, hash(r.s.envelope));
    assert.equal(j.binding.phase, "poc_verified");
    assert.notEqual(j.state, "connected");
    assert.equal(sourceHash(e.source), e.before);
    assert.throws(() => e.journal.requestCancel(j.id, e.actor), /ALREADY_CONNECTED/);
  });
test("image workspace is staged and verified but cannot publish without Storage adapter", async (t) => {
  const e = setup(t),
    r = remote(e);
  const result = await run(e, r);
  assert.equal(result.blocked, "ASSET_GATEWAY_NOT_CONNECTED");
  assert.equal(get(e).binding.metadata_verified, 1);
  assert.equal(
    r.s.calls.some((c) => ["publish", "attest"].includes(c.action)),
    false,
  );
  const db = new DatabaseSync(e.path, { readOnly: true });
  try {
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 4);
    assert.ok(
      db
        .prepare("PRAGMA table_info(workspace_binding)")
        .all()
        .every((c) => c.type !== "BLOB"),
    );
  } finally {
    db.close();
  }
  assert.equal(readFileSync(e.path).includes(Buffer.from("fictional-workspace-key")), false);
});
for (const action of ["start", "workspace", "publication", "prepare_publish", "publish"])
  test(`response loss after ${action} resumes same durable job`, async (t) => {
    const e = setup(t, { withoutImages: true }),
      r = remote(e);
    r.s.lose = action;
    await assert.rejects(
      () => run(e, r),
      (e) => e.code === "MIGRATION_UNAVAILABLE",
    );
    e.reopen();
    assert.equal((await run(e, r)).state, "poc-verified");
    assert.equal(new Set(r.s.calls.map((c) => c.jobId)).size, 1);
    assert.equal(
      new Set(r.s.calls.filter((c) => c.params.operationId).map((c) => c.params.operationId)).size,
      1,
    );
  });
test("lost publish reconciles without staging files and does not republish", async (t) => {
  const e = setup(t, { withoutImages: true }),
    r = remote(e);
  r.s.lose = "publish";
  await assert.rejects(() => run(e, r));
  rmSync(e.directory, { recursive: true });
  e.reopen();
  assert.equal((await run(e, r)).state, "poc-verified");
  assert.equal(r.s.calls.filter((c) => c.action === "publish").length, 1);
});
test("lost start without copy remains unresolved and cannot claim canceled", async (t) => {
  const e = setup(t, { withoutImages: true }),
    r = remote(e);
  r.s.lose = "start";
  await assert.rejects(() => run(e, r));
  rmSync(e.directory, { recursive: true });
  e.reopen();
  e.journal.requestCancel(e.job.id, e.actor);
  await assert.rejects(() => run(e, r));
  assert.equal(get(e).binding.phase, "waiting_binding");
  assert.notEqual(get(e).state, "canceled");
});
for (const action of ["cancel", "finish_cancel"])
  test(`cancel response loss after ${action} reconciles without local files`, async (t) => {
    const e = setup(t, { withoutImages: true }),
      r = remote(e);
    r.s.lose = "workspace";
    await assert.rejects(() => run(e, r));
    e.journal.requestCancel(e.job.id, e.actor);
    r.s.lose = action;
    await assert.rejects(() => run(e, r));
    rmSync(e.directory, { recursive: true });
    e.reopen();
    assert.equal((await run(e, r)).state, "canceled");
    assert.equal(get(e).binding.phase, "canceled");
  });
test("image cancellation stays fenced until authoritative Storage absence confirmation", async (t) => {
  const e = setup(t),
    r = remote(e);
  await run(e, r);
  e.journal.requestCancel(e.job.id, e.actor);
  assert.equal((await run(e, r)).blocked, "STORAGE_ABSENCE_VERIFICATION_REQUIRED");
  assert.equal(get(e).state, "cancel_fenced");
});
test("metadata mismatch cannot set verified flag or publish", async (t) => {
  const e = setup(t),
    r = remote(e);
  r.s.corrupt = true;
  await assert.rejects(() => run(e, r), /WORKSPACE_METADATA_MISMATCH/);
  assert.equal(get(e).binding.metadata_verified, 0);
  assert.equal(
    r.s.calls.some((c) => c.action === "publish"),
    false,
  );
});
test("pending publication does not create a second ticket", async (t) => {
  const e = setup(t, { withoutImages: true }),
    r = remote(e);
  r.s.pending = true;
  assert.equal((await run(e, r)).blocked, "PUBLICATION_UNCERTAIN");
  e.reopen();
  assert.equal((await run(e, r)).blocked, "PUBLICATION_UNCERTAIN");
  assert.equal(
    r.s.calls.some((c) => c.action === "prepare_publish"),
    false,
  );
});
test("wrong actor principal rejected before transport", async (t) => {
  const e = setup(t),
    r = remote(e);
  await assert.rejects(
    () => run(e, r, { principal: { ...e.principal, userId: randomUUID() } }),
    /WORKSPACE_PRINCIPAL_MISMATCH/,
  );
  assert.equal(r.s.calls.length, 0);
});
test("legacy coordinator cannot treat full PoC receipt as product completion", async (t) => {
  const e = setup(t),
    r = remote(e);
  await run(e, r);
  await assert.rejects(
    () =>
      advanceMigration({
        journal: e.journal,
        id: e.job.id,
        actor: e.actor,
        directory: e.directory,
        backend: {},
      }),
    /FULL_WORKSPACE_COORDINATOR_REQUIRED/,
  );
});
test("schema1 journal upgrade preserves all prior jobs/assets", (t) => {
  const e = setup(t);
  e.journal.close();
  const d = new DatabaseSync(e.path);
  d.exec("DROP TABLE storage_io; DROP TABLE workspace_binding; PRAGMA user_version=1");
  d.close();
  e.journal = openMigrationJournal(e.path, e.options);
  assert.equal(get(e).id, e.job.id);
  assert.deepEqual(get(e).assets, e.job.assets);
  assert.equal(get(e).binding, null);
});
test("bound target digest is immutable and scope cannot be swapped", async (t) => {
  const e = setup(t),
    r = remote(e);
  await run(e, r);
  const j = get(e),
    lease = e.journal.acquire(j.id, e.actor);
  try {
    const binding = {
      jobId: j.id,
      workspaceId: j.workspace_id,
      sourceManifestHash: j.manifest_hash,
      targetManifestHash: "b".repeat(64),
      targetProfile: j.binding.target_profile,
      productActivationAllowed: false,
    };
    assert.throws(() => e.journal.bindWorkspace(lease, binding), /WORKSPACE_TARGET_CHANGED/);
    assert.throws(
      () => e.journal.bindWorkspace(lease, { ...binding, sourceManifestHash: "c".repeat(64) }),
      /WORKSPACE_BINDING_MISMATCH/,
    );
  } finally {
    e.journal.release(lease);
  }
});

test("cancel during start invalidates callback lease; replay binds then fences same server job", async (t) => {
  const e = setup(t, { withoutImages: true }),
    r = remote(e);
  let once = true;
  const intercepted = {
    call: async (...args) => {
      const result = await r.rpc.call(...args);
      if (once && args[0].action === "start") {
        once = false;
        e.journal.requestCancel(e.job.id, e.actor);
      }
      return result;
    },
  };
  await assert.rejects(() => run(e, r, { rpc: intercepted }), /LEASE_LOST/);
  e.reopen();
  assert.equal((await run(e, r)).state, "canceled");
  assert.equal(new Set(r.s.calls.filter((c) => c.action === "start").map((c) => c.jobId)).size, 1);
});
test("later original edits stay independent of the frozen migration copy", async (t) => {
  const e = setup(t, { withoutImages: true }),
    r = remote(e);
  r.s.lose = "workspace";
  await assert.rejects(() => run(e, r));
  const db = new DatabaseSync(e.source);
  db.prepare("UPDATE category SET name='새로운 로컬 편집' WHERE id='c1'").run();
  db.close();
  const changed = sourceHash(e.source);
  e.reopen();
  assert.equal((await run(e, r)).state, "poc-verified");
  assert.equal(sourceHash(e.source), changed);
  assert.ok(r.s.envelope.records.every((x) => x.value.name !== "새로운 로컬 편집"));
});
test("missing bound copy blocks preparation without inventing metadata verification", async (t) => {
  const e = setup(t),
    r = remote(e);
  r.s.lose = "workspace";
  await assert.rejects(() => run(e, r));
  rmSync(e.directory, { recursive: true });
  e.reopen();
  await assert.rejects(() => run(e, r));
  assert.equal(get(e).binding.metadata_verified, 0);
});
test("unverified metadata cannot enter publication", async (t) => {
  const e = setup(t, { withoutImages: true }),
    r = remote(e);
  r.s.lose = "workspace";
  await assert.rejects(() => run(e, r));
  const lease = e.journal.acquire(e.job.id, e.actor);
  try {
    assert.throws(() => e.journal.beginPublish(lease), /ASSETS_NOT_VERIFIED/);
  } finally {
    e.journal.release(lease);
  }
});
test("wrong PoC receipt cannot mark a full job verified", async (t) => {
  const e = setup(t, { withoutImages: true }),
    r = remote(e);
  r.s.lose = "publish";
  await assert.rejects(() => run(e, r));
  const lease = e.journal.acquire(e.job.id, e.actor);
  try {
    for (const receipt of [
      { ...r.s.receipt, status: "verified" },
      { ...r.s.receipt, sourceManifestHash: "b".repeat(64) },
      { ...r.s.receipt, publicationId: randomUUID() },
    ])
      assert.throws(() => e.journal.workspacePocVerified(lease, receipt), /WORKSPACE_RECEIPT_MISMATCH/);
    assert.equal(get(e).binding.phase, "staged");
  } finally {
    e.journal.release(lease);
  }
});
test("full-profile UTF8 request above 1MiB is rejected before transport", async (t) => {
  const e = setup(t),
    r = remote(e);
  await run(e, r);
  const params = structuredClone(r.s.envelope);
  params.records.find((x) => x.table === "cabi_note").value.plain_text = "가".repeat(400000);
  const calls = r.s.calls.length;
  await assert.rejects(
    () => r.rpc.call({ action: "start", jobId: e.job.id, params }, e.principal, e.actor.deviceId),
    (e) => e.code === "INVALID_RPC",
  );
  assert.equal(r.s.calls.length, calls);
});
test("binding rows store no auth key, source path, user document or image body", async (t) => {
  const e = setup(t),
    r = remote(e);
  await run(e, r);
  e.reopen();
  const bytes = readFileSync(e.path);
  const db = new DatabaseSync(e.source, { readOnly: true });
  try {
    const data = db.prepare("SELECT data FROM note_asset LIMIT 1").get().data;
    for (const value of ["fictional-workspace-key", e.source, data, Buffer.from(data, "base64")])
      assert.equal(bytes.includes(Buffer.isBuffer(value) ? value : Buffer.from(value)), false);
  } finally {
    db.close();
  }
});

test("schema3 journal with a DB19 binding upgrades to v4 losslessly and widens the profile CHECK to DB20", async (t) => {
  const e = setup(t, { withoutImages: true }),
    r = remote(e);
  await run(e, r);
  const before = get(e);
  assert.equal(before.binding.target_profile, "workspace-db19-map-poc-1");
  e.journal.close();
  // Rebuild the binding table exactly as schema3 created it (old CHECK), keeping the row.
  const d = new DatabaseSync(e.path);
  const row = d.prepare("SELECT * FROM workspace_binding").get();
  d.exec(`DROP TABLE workspace_binding;
    CREATE TABLE workspace_binding(job_id TEXT PRIMARY KEY REFERENCES job(id),
      source_manifest_hash TEXT NOT NULL CHECK(length(source_manifest_hash)=64),
      mapping_hash TEXT NOT NULL CHECK(length(mapping_hash)=64),
      target_profile TEXT NOT NULL CHECK(target_profile IN ('workspace-db18-map-poc-1','workspace-db19-map-poc-1')),
      target_manifest_hash TEXT CHECK(target_manifest_hash IS NULL OR length(target_manifest_hash)=64),
      phase TEXT NOT NULL CHECK(phase IN ('waiting_binding','staged','publishing','poc_verified','cancel_fenced','canceled')),
      metadata_verified INTEGER NOT NULL DEFAULT 0 CHECK(metadata_verified IN (0,1)), server_epoch TEXT);
    PRAGMA user_version=3;`);
  d.prepare(
    `INSERT INTO workspace_binding VALUES(${Object.keys(row)
      .map(() => "?")
      .join(",")})`,
  ).run(...Object.values(row));
  assert.throws(
    () => d.prepare("UPDATE workspace_binding SET target_profile='workspace-db20-map-poc-1'").run(),
    /CHECK/,
  );
  d.close();
  e.journal = openMigrationJournal(e.path, e.options);
  assert.deepEqual(get(e), before);
  const r2 = new DatabaseSync(e.path, { readOnly: true });
  try {
    assert.equal(r2.prepare("PRAGMA user_version").get().user_version, 4);
    assert.match(
      r2.prepare("SELECT sql FROM sqlite_master WHERE name='workspace_binding'").get().sql,
      /workspace-db20-map-poc-1/,
    );
    assert.equal(r2.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  } finally {
    r2.close();
  }
});
