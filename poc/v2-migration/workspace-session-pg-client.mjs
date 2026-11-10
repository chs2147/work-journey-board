// Loopback HTTP -> actual PG, with actual SQLite journal reopen and fake response loss.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workspaceSessionFixture } from "./workspace-session-fixture.mjs";
import { openMigrationJournal } from "./journal.mjs";
import { createMigrationRPC } from "./server-rpc.mjs";
import { advanceWorkspaceSession } from "./workspace-session.mjs";
import { sourceHash } from "../v2-sync/model.mjs";
if (process.argv[2] !== "--local-fixture-only" || !/^http:\/\/127\.0\.0\.1:\d+$/.test(process.argv[3] || ""))
  throw Error("LOOPBACK_FIXTURE_REQUIRED");
let raw = "";
for await (const c of process.stdin) raw += c;
const f = JSON.parse(raw);
const root = mkdtempSync(join(tmpdir(), "wjb-session-pg-"));
let journal;
try {
  const e = workspaceSessionFixture(root, {
    ownerId: f.user,
    deviceId: f.device,
    withoutImages: true,
    textSize: 24000,
  });
  const options = { protectedLocalRoots: [e.localRoot] };
  journal = openMigrationJournal(e.path, options);
  const job = journal.create({ directory: e.directory, workspaceId: e.workspaceId, ...e.actor });
  let lose = f.scenario === "cancel" ? "workspace" : f.scenario === "start" ? "start" : "publish";
  const actions = [];
  const rpc = createMigrationRPC({
    projectRef: "vsphftnmfzfoufasjttd",
    serviceRoleKey: "local-migration-fixture-key",
    allowWorkspaceProfiles: true,
    fetchTransport: async (url, options) => {
      assert.equal(url.origin, "https://vsphftnmfzfoufasjttd.supabase.co");
      const action = JSON.parse(options.body).p_request.action;
      actions.push(action);
      const response = await fetch(process.argv[3] + url.pathname, options);
      if (response.ok && action === lose) {
        await response.arrayBuffer();
        lose = null;
        throw Error("fictional lost HTTP response");
      }
      return response;
    },
  });
  const principal = { userId: f.user, sessionId: f.session, role: "authenticated" };
  const run = () =>
    advanceWorkspaceSession({ journal, id: job.id, actor: e.actor, directory: e.directory, rpc, principal });
  await assert.rejects(run, (e) => e.code === "MIGRATION_UNAVAILABLE");
  journal.close();
  journal = openMigrationJournal(e.path, options);
  const persisted = journal.get(job.id, e.actor);
  if (f.scenario === "cancel") {
    assert.equal(persisted.binding.phase, "staged");
    journal.requestCancel(job.id, e.actor);
    rmSync(e.directory, { recursive: true });
    assert.equal((await run()).state, "canceled");
  } else {
    if (f.scenario === "start") assert.equal(persisted.binding.phase, "waiting_binding");
    else {
      assert.equal(persisted.state, "publishing");
      rmSync(e.directory, { recursive: true });
    }
    const result = await run();
    assert.equal(result.state, "poc-verified");
    assert.equal(result.productActivationAllowed, false);
    const row = journal.get(job.id, e.actor);
    assert.notEqual(row.binding.source_manifest_hash, row.binding.target_manifest_hash);
    assert.equal(row.binding.phase, "poc_verified");
    assert.notEqual(row.state, "connected");
    if (f.scenario !== "start") assert.equal(actions.filter((a) => a === "publish").length, 1);
  }
  assert.equal(sourceHash(e.source), e.before);
  process.stdout.write("WORKSPACE_SESSION_PG_PASS\n");
} finally {
  journal?.close();
  rmSync(root, { recursive: true, force: true });
}
