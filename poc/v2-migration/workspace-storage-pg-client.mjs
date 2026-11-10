// Real local HTTP/PG and Supabase Storage wire protocol; no external service or keys.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workspaceSessionFixture } from "./workspace-session-fixture.mjs";
import { openMigrationJournal } from "./journal.mjs";
import { advanceWorkspaceSession } from "./workspace-session.mjs";
import { createWorkspaceStorageGateway } from "./workspace-storage.mjs";
import { sourceHash } from "../v2-sync/model.mjs";
if (process.argv[2] !== "--local-fixture-only" || !/^http:\/\/127\.0\.0\.1:\d+$/.test(process.argv[3] || ""))
  throw Error("LOOPBACK_FIXTURE_REQUIRED");
let raw = "";
for await (const c of process.stdin) raw += c;
const f = JSON.parse(raw);
const root = mkdtempSync(join(tmpdir(), "wjb-storage-pg-"));
let journal;
try {
  const e = workspaceSessionFixture(root, { ownerId: f.user, deviceId: f.device });
  const options = { protectedLocalRoots: [e.localRoot] };
  journal = openMigrationJournal(e.path, options);
  const job = journal.create({ directory: e.directory, workspaceId: e.workspaceId, ...e.actor });
  let fault = f.scenario,
    puts = 0,
    deletes = 0,
    gateResolve,
    enteredResolve;
  const gate = new Promise((r) => (gateResolve = r)),
    entered = new Promise((r) => (enteredResolve = r));
  const gateway = createWorkspaceStorageGateway({
    projectRef: "vsphftnmfzfoufasjttd",
    serviceRoleKey: "local-migration-fixture-key",
    principal: { userId: f.user, sessionId: f.session, role: "authenticated" },
    deviceId: f.device,
    fetchTransport: async (url, options) => {
      assert.equal(url.origin, "https://vsphftnmfzfoufasjttd.supabase.co");
      let action;
      if (url.pathname.startsWith("/rest/")) action = JSON.parse(options.body).p_request.action;
      const put = url.pathname.startsWith("/storage/") && options.method === "POST";
      const del = options.method === "DELETE";
      if (put) puts++;
      if (del) deletes++;
      if (put && fault === "late-put") {
        enteredResolve();
        await gate;
      }
      const response = await fetch(process.argv[3] + url.pathname, options);
      if (
        (fault === "lost-put" && put) ||
        (fault === "lost-ready" && action === "mark_ready") ||
        (fault === "lost-settle" && action === "settle_io") ||
        (fault === "pause-before-publish" && action === "prepare_publish") ||
        (fault === "lost-delete" && del)
      ) {
        fault = null;
        await response.arrayBuffer();
        throw Error("fictional lost response");
      }
      if (fault === "corrupt-get" && url.pathname.includes("/object/authenticated/") && response.ok) {
        const bytes = Buffer.from(await response.arrayBuffer());
        bytes[0] ^= 255;
        return new Response(bytes, { status: 200 });
      }
      if (fault === "unknown-absence" && url.pathname.includes("/object/authenticated/") && !response.ok) {
        await response.arrayBuffer();
        return new Response('{"message":"permission problem"}', { status: 403 });
      }
      return response;
    },
  });
  const principal = { userId: f.user, sessionId: f.session, role: "authenticated" };
  const run = () =>
    advanceWorkspaceSession({
      journal,
      id: job.id,
      actor: e.actor,
      directory: e.directory,
      principal,
      ...gateway,
    });
  const reopen = () => {
    journal.close();
    journal = openMigrationJournal(e.path, options);
  };
  let result;
  if (["cancel", "lost-delete", "unknown-absence"].includes(f.scenario)) {
    fault = "pause-before-publish";
    await assert.rejects(run);
    journal.requestCancel(job.id, e.actor);
    rmSync(e.directory, { recursive: true });
    if (f.scenario !== "cancel") {
      fault = f.scenario;
      await assert.rejects(run);
      reopen();
      fault = null;
    }
    result = await run();
    assert.equal(result.state, "canceled");
  } else if (f.scenario === "late-put") {
    const old = run();
    await entered;
    journal.requestCancel(job.id, e.actor);
    assert.equal((await run()).blocked, "UNSETTLED_STORAGE_IO");
    assert.equal(deletes, 0);
    gateResolve();
    await assert.rejects(() => old);
    fault = null;
    reopen();
    result = await run();
    assert.equal(result.state, "canceled");
  } else if (f.scenario === "lost-put") {
    await assert.rejects(run);
    reopen();
    result = await run();
    assert.equal(result.blocked, "UNSETTLED_STORAGE_IO");
    journal.requestCancel(job.id, e.actor);
    result = await run();
    assert.equal(result.blocked, "UNSETTLED_STORAGE_IO");
    assert.equal(deletes, 0);
  } else if (f.scenario === "corrupt-get") {
    await assert.rejects(run, (e) => e.code === "INTEGRITY_MISMATCH");
    journal.requestCancel(job.id, e.actor);
    fault = null;
    result = await run();
    assert.equal(result.state, "canceled");
  } else {
    if (f.scenario !== "happy") {
      await assert.rejects(run);
      reopen();
    }
    result = await run();
    assert.equal(result.state, "poc-verified");
    assert.equal(result.productActivationAllowed, false);
    assert.equal(puts, 1);
  }
  assert.equal(sourceHash(e.source), e.before);
  const row = journal.get(job.id, e.actor);
  assert.notEqual(row.state, "connected");
  process.stdout.write(
    JSON.stringify({
      pass: true,
      workspaceId: e.workspaceId,
      jobId: job.id,
      state: result.state,
      puts,
      deletes,
      phase: row.binding.phase,
    }),
  );
} finally {
  journal?.close();
  rmSync(root, { recursive: true, force: true });
}
