import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createAccountRPC, checkAccountParams } from "./account-rpc.mjs";
const principal = {
  userId: "22222222-2222-4222-8222-222222222222",
  sessionId: "33333333-3333-4333-8333-333333333333",
  role: "authenticated",
};
const DEV = "44444444-4444-4444-8444-444444444444";
const OTHER = "66666666-6666-4666-8666-666666666666";
function fake(responses) {
  const seen = [];
  const t = async (url, init) => {
    seen.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
    const [status, body] = responses.shift();
    return new Response(JSON.stringify(body), { status });
  };
  return { t, seen };
}
const make = (t) =>
  createAccountRPC({ projectRef: "vsphftnmfzfoufasjttd", serviceRoleKey: "eyJtest", fetchTransport: t });

test("account params: shapes checked before any request", () => {
  assert.equal(checkAccountParams("usage", {}), true);
  assert.equal(checkAccountParams("usage", { x: 1 }), false);
  assert.equal(checkAccountParams("admin_set", { userId: OTHER, images: 1048576, unlimited: false }), true);
  assert.equal(checkAccountParams("admin_set", { userId: OTHER, images: null }), true);
  assert.equal(checkAccountParams("admin_set", { userId: OTHER, images: -1 }), false);
  assert.equal(checkAccountParams("admin_set", { userId: OTHER, images: 1.5 }), false);
  assert.equal(checkAccountParams("admin_set", { userId: OTHER, nope: true }), false);
  assert.equal(checkAccountParams("admin_set", { userId: "x" }), false);
  assert.equal(checkAccountParams("admin_set", { userId: OTHER, suspended: "yes" }), false);
  assert.equal(checkAccountParams("admin_invite", { email: "invited@example.invalid" }), true);
  assert.equal(checkAccountParams("admin_invite", { email: "x'@example.invalid" }), false);
  assert.equal(checkAccountParams("admin_invite", { email: "nope" }), false);
});

test("account rpc: server-only RPC with the verified principal, error codes passed through, unknown = unavailable", async () => {
  const ok = fake([[200, { admin: false, limits: { images: 1 } }]]);
  const r = await make(ok.t).call("usage", {}, principal, DEV);
  assert.equal(r.admin, false);
  assert.match(ok.seen[0].url, /\/rest\/v1\/rpc\/wjb_v2_account$/);
  assert.deepEqual(ok.seen[0].body.p_request, {
    action: "usage",
    params: {},
    userId: principal.userId,
    sessionId: principal.sessionId,
    deviceId: DEV,
  });
  const no = fake([[400, { code: "P0001", message: "ACCOUNT_NOT_ADMIN" }]]);
  await assert.rejects(make(no.t).call("admin_list", {}, principal, DEV), {
    code: "ACCOUNT_NOT_ADMIN",
    status: 403,
  });
  const odd = fake([[400, { code: "P0001", message: "SOMETHING_ELSE" }]]);
  await assert.rejects(make(odd.t).call("usage", {}, principal, DEV), { code: "ACCOUNT_UNAVAILABLE" });
  await assert.rejects(make(ok.t).call("usage", {}, { ...principal, role: "anon" }, DEV), {
    code: "INVALID_RPC",
  });
  await assert.rejects(make(ok.t).call("drop", {}, principal, DEV), { code: "INVALID_RPC" });
});

test("account invite: admin confirmed by the server function first; non-admin never reaches the Auth admin API", async () => {
  const notAdmin = fake([[200, { admin: false }]]);
  await assert.rejects(
    make(notAdmin.t).call("admin_invite", { email: "a@example.invalid" }, principal, DEV),
    {
      code: "ACCOUNT_NOT_ADMIN",
    },
  );
  assert.equal(notAdmin.seen.length, 1);
  const admin = fake([
    [200, { admin: true }],
    [200, { id: OTHER }],
  ]);
  assert.deepEqual(
    await make(admin.t).call("admin_invite", { email: "New@Example.invalid" }, principal, DEV),
    {
      invited: true,
      created: true,
    },
  );
  assert.match(admin.seen[1].url, /\/auth\/v1\/admin\/users$/);
  assert.deepEqual(admin.seen[1].body, { email: "new@example.invalid", email_confirm: true });
  const exists = fake([
    [200, { admin: true }],
    [422, { msg: "A user with this email address has already been registered" }],
  ]);
  assert.deepEqual(
    await make(exists.t).call("admin_invite", { email: "a@example.invalid" }, principal, DEV),
    {
      invited: true,
      created: false,
    },
  );
});

test("account rpc: only allowed projects (G-3: development·production) with a legacy service key", async () => {
  // 운영 프로젝트면 그 프로젝트 주소로만 보낸다
  const urls = [];
  const prod = createAccountRPC({
    projectRef: "hutqsfftioxtredcjhsy",
    serviceRoleKey: "eyJtest",
    fetchTransport: async (u) => {
      urls.push(String(u));
      return new Response(JSON.stringify({ usage: {} }), { status: 200 });
    },
  });
  assert.ok(prod);
  await prod
    .call("usage", {}, { userId: randomUUID(), sessionId: randomUUID(), role: "authenticated" }, randomUUID())
    .catch(() => {});
  assert.ok(urls.length > 0);
  assert.ok(urls.every((u) => u.startsWith("https://hutqsfftioxtredcjhsy.supabase.co/")));
  assert.throws(() =>
    createAccountRPC({ projectRef: "other", serviceRoleKey: "eyJ", fetchTransport: () => {} }),
  );
  assert.throws(() =>
    createAccountRPC({
      projectRef: "vsphftnmfzfoufasjttd",
      serviceRoleKey: "sb_secret_x",
      fetchTransport: () => {},
    }),
  );
});
