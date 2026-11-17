import test from "node:test";
import assert from "node:assert/strict";
import { createWorkspaceReadRPC, checkReadParams } from "./read-rpc.mjs";
const WS = "11111111-1111-4111-8111-111111111111";
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
  createWorkspaceReadRPC({
    projectRef: "vsphftnmfzfoufasjttd",
    serviceRoleKey: "eyJtest",
    fetchTransport: t,
  });

test("read params: shapes and limits checked before any request", () => {
  assert.equal(checkReadParams("list", {}), true);
  assert.equal(checkReadParams("list", { x: 1 }), false);
  assert.equal(
    checkReadParams("records", { workspaceId: WS, manifestHash: "a".repeat(64), after: null, limit: 1000 }),
    true,
  );
  assert.equal(
    checkReadParams("records", { workspaceId: WS, manifestHash: "a".repeat(64), after: null, limit: 1001 }),
    false,
  );
  assert.equal(
    checkReadParams("records", { workspaceId: WS, manifestHash: "a".repeat(64), after: ["t"], limit: 5 }),
    false,
  );
  assert.equal(checkReadParams("drop", {}), false);
});

test("read sends verified principal (never from the body) and maps server codes", async () => {
  const ok = fake(200, { workspaces: [] });
  assert.deepEqual(await make(ok.t).read("list", {}, principal, DEV), { workspaces: [] });
  assert.equal(ok.seen[0].url, "https://vsphftnmfzfoufasjttd.supabase.co/rest/v1/rpc/wjb_v2_workspace_read");
  assert.deepEqual(ok.seen[0].body.p_request, {
    action: "list",
    params: {},
    userId: principal.userId,
    sessionId: principal.sessionId,
    deviceId: DEV,
  });
  const nf = fake(400, { code: "P0001", message: "READ_NOT_FOUND" });
  await assert.rejects(
    make(nf.t).read("header", { workspaceId: WS }, principal, DEV),
    (e) => e.code === "READ_NOT_FOUND" && e.status === 404,
  );
  const odd = fake(500, { message: "secret detail" });
  await assert.rejects(make(odd.t).read("list", {}, principal, DEV), (e) => e.code === "READ_UNAVAILABLE");
  await assert.rejects(
    make(ok.t).read("list", {}, { ...principal, role: "anon" }, DEV),
    (e) => e.code === "INVALID_RPC",
  );
  // G-3: 허용 목록(개발·운영) 밖은 거절, 운영은 받음
  assert.throws(() =>
    createWorkspaceReadRPC({
      projectRef: "abcdefghijklmnopqrst",
      serviceRoleKey: "eyJ",
      fetchTransport: ok.t,
    }),
  );
  assert.ok(
    createWorkspaceReadRPC({
      projectRef: "hutqsfftioxtredcjhsy",
      serviceRoleKey: "eyJ",
      fetchTransport: ok.t,
    }),
  );
});
