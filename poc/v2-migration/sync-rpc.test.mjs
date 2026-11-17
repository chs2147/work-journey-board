import test from "node:test";
import assert from "node:assert/strict";
import { createWorkspaceSyncRPC, checkSyncParams } from "./sync-rpc.mjs";
const WS = "11111111-1111-4111-8111-111111111111";
const OP = "55555555-5555-4555-8555-555555555555";
const principal = {
  userId: "22222222-2222-4222-8222-222222222222",
  sessionId: "33333333-3333-4333-8333-333333333333",
  role: "authenticated",
};
const DEV = "44444444-4444-4444-8444-444444444444";
function fake(status, body) {
  const seen = [];
  const t = async (url, init) => {
    seen.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify(body), { status });
  };
  return { t, seen };
}
const make = (t) =>
  createWorkspaceSyncRPC({
    projectRef: "vsphftnmfzfoufasjttd",
    serviceRoleKey: "eyJtest",
    fetchTransport: t,
  });
const change = { table: "entry_item", key: "a".repeat(64), baseRev: 0, value: { text: "가상" } };

test("sync params: shapes and limits checked before any request", () => {
  assert.equal(checkSyncParams("pull", { workspaceId: WS, after: "0", limit: 1000 }), true);
  assert.equal(checkSyncParams("pull", { workspaceId: WS, after: 0, limit: 10 }), false);
  assert.equal(checkSyncParams("pull", { workspaceId: WS, after: "01", limit: 10 }), false);
  assert.equal(checkSyncParams("pull", { workspaceId: WS, after: "0", limit: 1001 }), false);
  assert.equal(checkSyncParams("push", { workspaceId: WS, opId: OP, changes: [change] }), true);
  assert.equal(
    checkSyncParams("push", {
      workspaceId: WS,
      opId: OP,
      changes: [{ ...change, value: null, baseRev: null }],
    }),
    true,
  );
  assert.equal(checkSyncParams("push", { workspaceId: WS, opId: OP, changes: [] }), false);
  assert.equal(
    checkSyncParams("push", { workspaceId: WS, opId: OP, changes: Array(501).fill(change) }),
    false,
  );
  assert.equal(
    checkSyncParams("push", { workspaceId: WS, opId: OP, changes: [{ ...change, table: "Bad" }] }),
    false,
  );
  assert.equal(
    checkSyncParams("push", { workspaceId: WS, opId: OP, changes: [{ ...change, baseRev: -1 }] }),
    false,
  );
  assert.equal(
    checkSyncParams("push", { workspaceId: WS, opId: OP, changes: [{ ...change, value: [1] }] }),
    false,
  );
  assert.equal(checkSyncParams("push", { workspaceId: WS, opId: OP, changes: [{ ...change, x: 1 }] }), false);
  assert.equal(
    checkSyncParams("asset_declare", { workspaceId: WS, objectId: OP, sha256: "b".repeat(64), bytes: 10 }),
    true,
  );
  assert.equal(
    checkSyncParams("asset_declare", { workspaceId: WS, objectId: OP, sha256: "b".repeat(64), bytes: 0 }),
    false,
  );
  assert.equal(checkSyncParams("drop", { workspaceId: WS }), false);
});

test("sync sends verified principal (never from the body) and maps server codes", async () => {
  const ok = fake(200, { applied: true, records: [], head: "1" });
  const p = { workspaceId: WS, opId: OP, changes: [change] };
  assert.deepEqual(await make(ok.t).call("push", p, principal, DEV), {
    applied: true,
    records: [],
    head: "1",
  });
  assert.equal(ok.seen[0].url, "https://vsphftnmfzfoufasjttd.supabase.co/rest/v1/rpc/wjb_v2_workspace_sync");
  assert.deepEqual(ok.seen[0].body.p_request, {
    action: "push",
    params: p,
    userId: principal.userId,
    sessionId: principal.sessionId,
    deviceId: DEV,
  });
  for (const [code, status] of [
    ["SYNC_NOT_FOUND", 404],
    ["SYNC_ACCESS_DENIED", 403],
    ["SYNC_INVALID_CHANGE", 400],
    ["SYNC_INLINE_IMAGE", 409],
    ["SYNC_ASSET_NOT_READY", 409],
  ]) {
    const f = fake(400, { code: "P0001", message: code });
    await assert.rejects(
      make(f.t).call("push", p, principal, DEV),
      (e) => e.code === code && e.status === status,
    );
  }
  const odd = fake(500, { message: "secret detail" });
  await assert.rejects(make(odd.t).call("push", p, principal, DEV), (e) => e.code === "SYNC_UNAVAILABLE");
  await assert.rejects(
    make(ok.t).call("push", p, { ...principal, role: "anon" }, DEV),
    (e) => e.code === "INVALID_RPC",
  );
  await assert.rejects(
    make(ok.t).call("push", { ...p, changes: [] }, principal, DEV),
    (e) => e.code === "INVALID_RPC",
  );
  // G-3: 허용 목록(개발·운영) 밖은 거절, 운영은 받음
  assert.throws(() =>
    createWorkspaceSyncRPC({
      projectRef: "abcdefghijklmnopqrst",
      serviceRoleKey: "eyJ",
      fetchTransport: ok.t,
    }),
  );
  assert.ok(
    createWorkspaceSyncRPC({
      projectRef: "hutqsfftioxtredcjhsy",
      serviceRoleKey: "eyJ",
      fetchTransport: ok.t,
    }),
  );
});
