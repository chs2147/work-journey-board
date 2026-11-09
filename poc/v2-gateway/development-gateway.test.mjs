import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createDevelopmentGateway } from "./development-gateway.mjs";
import { createNodeServer } from "./node-server.mjs";
import { generateKeyPair, exportJWK, SignJWT } from "../v2-auth/test-jose.mjs";
const dev = "vsphftnmfzfoufasjttd",
  prod = "hutqsfftioxtredcjhsy",
  id = (n) => `00000000-0000-0000-0000-${n.toString(16).padStart(12, "0")}`;
const pair = await generateKeyPair("ES256"),
  jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), alg: "ES256", kid: "dev-fixture" }] };
const token = (ref = dev) =>
  new SignJWT({ session_id: id(2), role: "authenticated" })
    .setSubject(id(1))
    .setIssuer(`https://${ref}.supabase.co/auth/v1`)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("1h")
    .setProtectedHeader({ alg: "ES256", kid: "dev-fixture", typ: "JWT" })
    .sign(pair.privateKey);
let active = true,
  calls = [],
  server,
  origin;
let malformed = false;
const transport = async (url, options) => {
  assert.equal(url.origin, `https://${dev}.supabase.co`);
  assert.equal(options.headers.apikey, "fictional-dev-runtime-key");
  assert.equal(options.redirect, "error");
  calls.push(url.pathname);
  if (url.pathname.endsWith("wjb_v2_session_active"))
    return globalThis.Response.json(malformed ? {} : active);
  const body = JSON.parse(options.body),
    r = body.p_request;
  if (r.action === "reserve")
    return globalThis.Response.json({
      ...r.scope,
      ...r.params,
      state: "reserved",
      ioVersion: "0",
      expires: Date.now() + 300000,
      created: true,
    });
  throw new Error("Unexpected fixture RPC");
};
const config = {
  projectRef: dev,
  serviceRoleKey: "fictional-dev-runtime-key",
  jwks,
  fetchTransport: transport,
};
before(async () => {
  server = createNodeServer(createDevelopmentGateway(config).handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});
async function reserve(bearer, headers = {}) {
  return globalThis.fetch(`${origin}/v2/workspaces/${id(3)}/assets/${id(4)}/reserve`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...headers,
    },
    body: JSON.stringify({ deviceId: id(5), generation: "1", bytes: 8, sha256: "a".repeat(64) }),
  });
}
test("dev composition rejects production target", () =>
  assert.throws(() => createDevelopmentGateway({ ...config, projectRef: prod }), /Development/));
test("no implicit transport or credential", () => {
  assert.throws(() => createDevelopmentGateway({ ...config, fetchTransport: undefined }));
  assert.throws(() => createDevelopmentGateway({ ...config, serviceRoleKey: undefined }));
});
test("unverified modern secret-key mode fails explicitly", () =>
  assert.throws(
    () => createDevelopmentGateway({ ...config, serviceRoleKey: "sb_secret_fixture" }),
    /legacy/,
  ));
test("real loopback HTTP validates dev issuer then session and reserve RPC", async () => {
  calls = [];
  const r = await reserve(await token());
  assert.equal(r.status, 201);
  assert.deepEqual(calls, ["/rest/v1/rpc/wjb_v2_session_active", "/rest/v1/rpc/wjb_v2_asset_command"]);
  assert.ok(!(await r.text()).includes("runtime-key"));
});
test("production token rejected before any server RPC", async () => {
  calls = [];
  assert.equal((await reserve(await token(prod))).status, 401);
  assert.deepEqual(calls, []);
});
test("session revoked by server is denied", async () => {
  active = false;
  try {
    calls = [];
    assert.equal((await reserve(await token())).status, 403);
    assert.equal(calls.length, 1);
  } finally {
    active = true;
  }
});
test("unknown session response fails closed", async () => {
  malformed = true;
  try {
    assert.equal((await reserve(await token())).status, 503);
  } finally {
    malformed = false;
  }
});
test("missing authentication cannot call metadata", async () => {
  calls = [];
  assert.equal((await reserve(null)).status, 401);
  assert.deepEqual(calls, []);
});
test("browser origin is still denied pending explicit native/browser auth contract", async () => {
  calls = [];
  assert.equal((await reserve(await token(), { origin: "https://example.com" })).status, 403);
  assert.deepEqual(calls, []);
});

test("management PAT shape cannot be substituted for runtime key", () =>
  assert.throws(
    () => createDevelopmentGateway({ ...config, serviceRoleKey: "sbp_fictional" }),
    /Management PAT/,
  ));
