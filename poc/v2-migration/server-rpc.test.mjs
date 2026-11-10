import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { createMigrationRPC, bindMigrationManifests } from "./server-rpc.mjs";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const principal = { userId: id(1), sessionId: id(2), role: "authenticated" },
  device = id(3),
  job = id(4),
  workspace = id(5);
const source = "f".repeat(64),
  target = "a".repeat(64),
  key = "fictional-local-runtime-key";
let server,
  origin,
  mode = "normal",
  calls = 0,
  last;
const params = { workspaceId: workspace, sourceManifestHash: source, assets: [], documents: [] };
const base = {
  projectRef: "vsphftnmfzfoufasjttd",
  serviceRoleKey: key,
  fetchTransport: async (url, options) => {
    assert.equal(url.origin, "https://vsphftnmfzfoufasjttd.supabase.co");
    assert.equal(url.pathname, "/rest/v1/rpc/wjb_v2_migration_command");
    assert.equal(options.redirect, "error");
    return fetch(origin + url.pathname, options);
  },
};
const client = createMigrationRPC(base);
const start = () => client.call({ action: "start", jobId: job, params }, principal, device);
before(async () => {
  server = createServer(async (req, res) => {
    calls++;
    assert.equal(req.headers.apikey, key);
    assert.equal(req.headers.authorization, `Bearer ${key}`);
    let raw = "";
    for await (const c of req) raw += c;
    last = JSON.parse(raw).p_request;
    if (mode === "redirect") {
      res.writeHead(302, { location: "https://other.invalid/escape" });
      res.end();
      return;
    }
    res.setHeader("content-type", "application/json");
    if (mode === "permission") {
      res.statusCode = 400;
      res.end(JSON.stringify({ code: "P0001", message: "MIGRATION_ACCESS_DENIED" }));
      return;
    }
    if (mode === "private-error") {
      res.statusCode = 500;
      res.end(JSON.stringify({ message: "secret internal " + key }));
      return;
    }
    if (mode === "malformed") {
      res.end("true");
      return;
    }
    if (mode === "oversized") {
      res.end(JSON.stringify({ data: "x".repeat(9000) }));
      return;
    }
    const value = {
      jobId: job,
      state: "staging",
      workspaceId: workspace,
      sourceManifestHash: source,
      manifestHash: target,
      profile: "migration-document-poc-1",
      ...(last.action === "status" ? { epoch: "1" } : {}),
    };
    if (mode === "wrong-job") value.jobId = id(99);
    if (mode === "wrong-source") value.sourceManifestHash = "b".repeat(64);
    if (mode === "missing-state") delete value.state;
    res.end(JSON.stringify(value));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});
test("actual HTTP sends verified principal and fixed server destination only", async () => {
  mode = "normal";
  const r = await start();
  assert.equal(r.manifestHash, target);
  assert.equal(last.userId, principal.userId);
  assert.equal(last.sessionId, principal.sessionId);
  assert.equal(last.deviceId, device);
  assert.equal(last.jobId, job);
  assert.equal("userId" in last.params, false);
});
test("source and target manifest digests remain separately bound", async () => {
  mode = "normal";
  const binding = bindMigrationManifests(
    { jobId: job, workspaceId: workspace, sourceManifestHash: source },
    await start(),
  );
  assert.equal(binding.sourceManifestHash, source);
  assert.equal(binding.targetManifestHash, target);
  assert.notEqual(source, target);
  assert.equal(binding.productActivationAllowed, false);
  assert.ok(Object.isFrozen(binding));
});
test("wrong job/source binding is rejected", () => {
  const reply = {
    jobId: job,
    workspaceId: workspace,
    sourceManifestHash: source,
    manifestHash: target,
    profile: "migration-document-poc-1",
  };
  assert.throws(
    () =>
      bindMigrationManifests({ jobId: id(99), workspaceId: workspace, sourceManifestHash: source }, reply),
    /BINDING/,
  );
  assert.throws(
    () =>
      bindMigrationManifests(
        { jobId: job, workspaceId: workspace, sourceManifestHash: "b".repeat(64) },
        reply,
      ),
    /BINDING/,
  );
});
test("production ref, Management PAT, modern key and absent transport rejected", () => {
  for (const change of [
    { projectRef: "hutqsfftioxtredcjhsy" },
    { serviceRoleKey: "sbp_fixture" },
    { serviceRoleKey: "sb_secret_fixture" },
    { fetchTransport: null },
  ])
    assert.throws(() => createMigrationRPC({ ...base, ...change }), /DEV_SERVER_TRANSPORT_REQUIRED/);
});
test("full workspace maps cannot be flattened into minimal document RPC", async () => {
  const before = calls;
  await assert.rejects(
    () =>
      client.call(
        { action: "start", jobId: job, params: { profile: "workspace-db18-map-poc-1", records: [] } },
        principal,
        device,
      ),
    (e) => e.code === "MIGRATION_PROFILE_UNSUPPORTED",
  );
  assert.equal(calls, before);
});
test("unknown RPC action or principal override never reaches transport", async () => {
  const before = calls;
  await assert.rejects(
    () => client.call({ action: "arbitrary_sql", jobId: job, params: {} }, principal, device),
    (e) => e.code === "INVALID_RPC",
  );
  await assert.rejects(
    () =>
      client.call(
        { action: "status", jobId: job, params: { manifestHash: target, userId: id(99) } },
        principal,
        device,
      ),
    (e) => e.code === "INVALID_RPC",
  );
  assert.equal(calls, before);
});
test("unverified role and malformed scope rejected before HTTP", async () => {
  const before = calls;
  await assert.rejects(
    () =>
      client.call({ action: "start", jobId: job, params }, { ...principal, role: "service_role" }, device),
    (e) => e.code === "MIGRATION_SCOPE_REQUIRED",
  );
  assert.equal(calls, before);
});
test("UTF8 request size is bounded by bytes, not JS character count", async () => {
  const before = calls;
  await assert.rejects(
    () =>
      client.call(
        { action: "start", jobId: job, params: { ...params, documents: [{ text: "가".repeat(25000) }] } },
        principal,
        device,
      ),
    (e) => e.code === "INVALID_RPC",
  );
  assert.equal(calls, before);
});
test("allowlisted server permission errors map to forbidden", async () => {
  mode = "permission";
  await assert.rejects(start, (e) => e.code === "MIGRATION_ACCESS_DENIED" && e.status === 403);
});
test("unknown private server messages never leak through transport error", async () => {
  mode = "private-error";
  await assert.rejects(start, (e) => e.code === "MIGRATION_UNAVAILABLE" && !e.message.includes(key));
});
for (const value of ["malformed", "oversized", "wrong-job", "wrong-source", "redirect"])
  test(`${value} response fails closed`, async () => {
    mode = value;
    await assert.rejects(start, (e) => e.code === "MIGRATION_UNAVAILABLE");
  });
test("status requires explicit typed state/scope metadata", async () => {
  mode = "normal";
  assert.equal(
    (await client.call({ action: "status", jobId: job, params: { manifestHash: target } }, principal, device))
      .state,
    "staging",
  );
  mode = "missing-state";
  await assert.rejects(
    () => client.call({ action: "status", jobId: job, params: { manifestHash: target } }, principal, device),
    (e) => e.code === "MIGRATION_UNAVAILABLE",
  );
});
