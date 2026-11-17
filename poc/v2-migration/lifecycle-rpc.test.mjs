import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { checkLifecycleParams, createLifecycleRPC, runPurge } from "./lifecycle-rpc.mjs";

const DEV = "vsphftnmfzfoufasjttd";
const principal = { userId: randomUUID(), sessionId: randomUUID(), role: "authenticated" };
function fake(handler) {
  const calls = [];
  const t = async (url, init) => {
    calls.push({ url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : null });
    const [status, body] = handler(String(url), init);
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  };
  return { t, calls };
}
const make = (t, projectRef = DEV) =>
  createLifecycleRPC({ projectRef, serviceRoleKey: "eyJtest", fetchTransport: t });

test("lifecycle params: delete_space needs a workspace id; delete_account is self ({}) or one user id", () => {
  assert.equal(checkLifecycleParams("delete_space", { workspaceId: randomUUID() }), true);
  assert.equal(checkLifecycleParams("delete_space", {}), false);
  assert.equal(checkLifecycleParams("delete_space", { workspaceId: "x" }), false);
  assert.equal(checkLifecycleParams("delete_space", { workspaceId: randomUUID(), name: "a" }), false);
  assert.equal(checkLifecycleParams("delete_account", {}), true);
  assert.equal(checkLifecycleParams("delete_account", { userId: randomUUID() }), true);
  assert.equal(checkLifecycleParams("delete_account", { userId: randomUUID(), x: 1 }), false);
  assert.equal(checkLifecycleParams("sweep", {}), false);
});

test("lifecycle rpc: user call goes to wjb_v2_lifecycle with the verified principal only; server codes pass through", async () => {
  const ws = randomUUID();
  const ok = fake(() => [200, { workspaceId: ws, state: "purging", images: 2 }]);
  const r = await make(ok.t).call("delete_space", { workspaceId: ws }, principal, randomUUID());
  assert.equal(r.state, "purging");
  assert.equal(ok.calls[0].url, `https://${DEV}.supabase.co/rest/v1/rpc/wjb_v2_lifecycle`);
  assert.deepEqual(Object.keys(ok.calls[0].body.p_request).sort(), [
    "action",
    "deviceId",
    "params",
    "sessionId",
    "userId",
  ]);
  for (const [code, http] of [
    ["LIFE_NOT_FOUND", 404],
    ["ACCOUNT_ADMIN_FIXED", 403],
    ["LIFE_ACCESS_DENIED", 403],
  ]) {
    const f = fake(() => [400, { code: "P0001", message: code }]);
    await assert.rejects(
      make(f.t).call("delete_space", { workspaceId: ws }, principal, randomUUID()),
      (e) => e.code === code && e.status === http,
    );
  }
  const odd = fake(() => [500, { message: "secret detail" }]);
  await assert.rejects(
    make(odd.t).call("delete_account", {}, principal, randomUUID()),
    (e) => e.code === "LIFE_UNAVAILABLE",
  );
  await assert.rejects(
    make(ok.t).call("delete_account", {}, { ...principal, role: "service_role" }, randomUUID()),
    (e) => e.code === "INVALID_RPC",
  );
  await assert.rejects(
    make(ok.t).call("sweep", {}, principal, randomUUID()),
    (e) => e.code === "INVALID_RPC",
  );
});

test("lifecycle rpc: only allowed projects (G-3), legacy key only, requests stay on that project", async () => {
  for (const bad of [
    { projectRef: "abcdefghijklmnopqrst" },
    { serviceRoleKey: "sb_secret_x" },
    { serviceRoleKey: "sbp_x" },
    { fetchTransport: null },
  ])
    assert.throws(() =>
      createLifecycleRPC({ projectRef: DEV, serviceRoleKey: "eyJ", fetchTransport: () => {}, ...bad }),
    );
  const f = fake(() => [204, undefined]);
  const prod = make(f.t, "hutqsfftioxtredcjhsy");
  assert.equal(await prod.deleteAuthUser(randomUUID()), true);
  assert.ok(f.calls.every((c) => c.url.startsWith("https://hutqsfftioxtredcjhsy.supabase.co/")));
  assert.equal(f.calls[0].method, "DELETE");
  const gone = fake(() => [404, { message: "User not found" }]);
  assert.equal(await make(gone.t).deleteAuthUser(randomUUID()), true); // 이미 없음 = 지움
  const fail = fake(() => [500, {}]);
  await assert.rejects(make(fail.t).deleteAuthUser(randomUUID()), (e) => e.code === "LIFE_UNAVAILABLE");
  await assert.rejects(make(f.t).deleteAuthUser("not-a-uuid"), (e) => e.code === "INVALID_RPC");
});

test("runPurge: confirm only after storage removal (absence) succeeded; failures retried later; Auth users deleted", async () => {
  const ws = randomUUID();
  const items = [randomUUID(), randomUUID(), randomUUID()].map((assetId, i) => ({
    workspaceId: ws,
    assetId,
    ioVersion: String(i + 1),
  }));
  const user = randomUUID();
  const log = [];
  const lifecycle = {
    async worker(action, params) {
      log.push([action, params]);
      if (action === "next") return { items, pendingSpaces: 1 };
      if (action === "auth_pending") return { users: [user] };
      return { ok: true };
    },
    async deleteAuthUser(id) {
      log.push(["deleteAuthUser", id]);
      return true;
    },
  };
  const storage = {
    async remove(scope) {
      if (scope.assetId === items[1].assetId) throw Object.assign(Error(), { code: "DELETE_NOT_CONFIRMED" });
    },
  };
  const r = await runPurge({ lifecycle, storage });
  assert.deepEqual(r, { removed: 2, failed: 1, authDeleted: 1, pendingSpaces: 1 });
  const confirmed = log.filter(([a]) => a === "confirm").map(([, p]) => p.assetId);
  assert.deepEqual(confirmed, [items[0].assetId, items[2].assetId]); // 확인 못 한 것은 용량을 돌려주지 않음
  assert.deepEqual(
    log.filter(([a]) => a === "deleteAuthUser" || a === "auth_deleted").map(([a]) => a),
    ["deleteAuthUser", "auth_deleted"],
  );
  // 시간 예산을 넘으면 거기서 멈춘다
  let t = 0;
  const slow = await runPurge({
    lifecycle,
    storage: { remove: async () => void (t += 10_000) },
    now: () => t,
    budgetMs: 5000,
  });
  assert.equal(slow.removed, 1);
  assert.equal(slow.authDeleted, 0);
});
