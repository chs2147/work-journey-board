// Loopback HTTP -> actual local PostgreSQL integration companion only.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createMigrationRPC, bindMigrationManifests } from "./server-rpc.mjs";
if (process.argv[2] !== "--local-fixture-only" || !/^http:\/\/127\.0\.0\.1:\d+$/.test(process.argv[3] || ""))
  throw Error("LOOPBACK_FIXTURE_REQUIRED");
let raw = "";
for await (const c of process.stdin) raw += c;
const f = JSON.parse(raw),
  local = process.argv[3];
const principal = { userId: f.user, sessionId: f.session, role: "authenticated" };
const rpc = createMigrationRPC({
  projectRef: "vsphftnmfzfoufasjttd",
  serviceRoleKey: "local-migration-fixture-key",
  fetchTransport: (url, options) => {
    assert.equal(url.origin, "https://vsphftnmfzfoufasjttd.supabase.co");
    assert.equal(options.redirect, "error");
    return fetch(local + url.pathname, options);
  },
});
const result = await rpc.call({ action: "start", jobId: f.job, params: f.manifest }, principal, f.device);
const binding = bindMigrationManifests(
  { jobId: f.job, workspaceId: f.ws, sourceManifestHash: f.manifest.sourceManifestHash },
  result,
);
assert.equal(binding.targetManifestHash, f.hash);
assert.equal(binding.productActivationAllowed, false);
const status = await rpc.call(
  { action: "status", jobId: f.job, params: { manifestHash: f.hash } },
  principal,
  f.device,
);
assert.equal(status.state, "staging");
const op = randomUUID(),
  observed = await rpc.call(
    { action: "publication", jobId: f.job, params: { manifestHash: f.hash, operationId: op } },
    principal,
    f.device,
  );
assert.equal(observed.state, "absent");
const t = await rpc.call(
  {
    action: "prepare_publish",
    jobId: f.job,
    params: { manifestHash: f.hash, operationId: op, expectedFence: observed.serverFence },
  },
  principal,
  f.device,
);
await assert.rejects(
  () =>
    rpc.call(
      { action: "publish", jobId: f.job, params: { manifestHash: f.hash, ...t } },
      principal,
      f.device,
    ),
  (e) => e.code === "MIGRATION_NOT_VERIFIED",
);
await assert.rejects(
  () =>
    rpc.call(
      { action: "status", jobId: f.job, params: { manifestHash: f.hash } },
      { userId: f.otherUser, sessionId: f.otherSession, role: "authenticated" },
      f.otherDevice,
    ),
  (e) => e.code === "MIGRATION_ACCESS_DENIED",
);
process.stdout.write("RPC_PG_HTTP_PASS\n");
