import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import { ReadableStream } from "node:stream/web";
import { exportJWK, generateKeyPair, SignJWT } from "../v2-auth/test-jose.mjs";
import { createSessionVerifier } from "../v2-auth/session-adapter.mjs";
import { createGateway } from "./gateway.mjs";
import { createSupabaseRest } from "./supabase-rest.mjs";
import { fixtureMetadata } from "./fixtures.mjs";
import { createNodeServer } from "./node-server.mjs";
import { readLimited, GatewayError } from "./io.mjs";

const id = (n) => `00000000-0000-0000-0000-${n.toString(16).padStart(12, "0")}`;
const [A, B, WA, WB, DA, DB, SA, SB, D2, S2] = Array.from({ length: 10 }, (_, i) => id(i + 1));
const bytes = Buffer.from("fictional private bytes");
const hash = (b) => createHash("sha256").update(b).digest("hex");
const key = "fixture-only-service-key";
let provider, providerURL, host, hostURL, context;
const pair = await generateKeyPair("ES256");
const jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), alg: "ES256", kid: "http-test" }] };
async function sign(user = A, session = SA, extra = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ session_id: session, role: "authenticated", ...extra })
    .setSubject(user)
    .setIssuer("https://hutqsfftioxtredcjhsy.supabase.co/auth/v1")
    .setAudience("authenticated")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .setProtectedHeader({ alg: "ES256", kid: "http-test", typ: "JWT" })
    .sign(pair.privateKey);
}
const tokenA = await sign(),
  tokenB = await sign(B, SB),
  token2 = await sign(A, S2);
const bucket = "/storage/v1/object/wjb-v2-poc-private";
const getPrefix = "/storage/v1/object/authenticated/wjb-v2-poc-private/";
async function body(req) {
  const chunks = [];
  for await (const x of req) chunks.push(x);
  return Buffer.concat(chunks);
}
function reply(res, status, value) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}
async function providerHandler(req, res) {
  const c = context;
  c.calls.push({ method: req.method, path: req.url });
  if (req.headers.authorization !== `Bearer ${key}` || req.headers.apikey !== key)
    return reply(res, 401, { error: "private upstream auth" });
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    if (path === "/rest/v1/rpc/wjb_v2_session_active") {
      const args = JSON.parse((await body(req)).toString());
      if (c.faults.authDown) return reply(res, 503, { error: "private service detail" });
      if (c.faults.rpcValue) return reply(res, 200, "true");
      const active = c.sessions.get(args.p_session) === args.p_user;
      return reply(res, 200, active);
    }
    if (req.method === "POST" && path.startsWith(bucket + "/")) {
      assert.equal(req.headers["x-upsert"], "false");
      const object = path.slice(bucket.length + 1),
        content = await body(req);
      if (c.faults.put) return reply(res, 500, { error: "private Storage detail" });
      if (c.objects.has(object)) return reply(res, 400, { statusCode: "409", error: "Duplicate" });
      c.objects.set(object, content);
      if (c.hooks.afterPut) await c.hooks.afterPut();
      if (c.faults.putAckLost) return reply(res, 500, { error: "private lost response" });
      return reply(res, 200, { Key: object });
    }
    if (req.method === "GET" && path.startsWith(getPrefix)) {
      const object = path.slice(getPrefix.length);
      if (c.faults.get) return reply(res, 503, { error: "private download detail" });
      if (c.faults.redirect) {
        res.writeHead(302, { location: providerURL + "/escape" });
        res.end();
        return;
      }
      if (!c.objects.has(object)) {
        if (c.faults.missingAs400)
          return reply(res, 400, { statusCode: "404", error: "not_found", message: "Object not found" });
        return reply(res, 404, { error: "Object not found" });
      }
      if (c.hooks.beforeGet) await c.hooks.beforeGet();
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(c.objects.get(object));
      return;
    }
    if (req.method === "DELETE" && path === bucket) {
      const data = JSON.parse((await body(req)).toString());
      assert.equal(data.prefixes.length, 1);
      if (c.faults.remove) return reply(res, 500, { error: "private deletion detail" });
      if (!c.faults.keepAfterDelete) for (const object of data.prefixes) c.objects.delete(object);
      if (c.hooks.afterDelete) await c.hooks.afterDelete();
      return reply(res, 200, []);
    }
    reply(res, 404, { error: "route missing" });
  } catch {
    reply(res, 500, { error: "fixture failure" });
  }
}
async function reset({ quota } = {}) {
  context = {
    objects: new Map(),
    sessions: new Map([
      [SA, A],
      [SB, B],
      [S2, A],
    ]),
    calls: [],
    faults: {},
    hooks: {},
    clock: Date.now(),
    outgoing: [],
  };
  context.workspaces = new Map([
    [WA, { userId: A, generation: "1" }],
    [WB, { userId: B, generation: "1" }],
  ]);
  context.devices = new Map([
    [DA, { userId: A, sessionId: SA }],
    [DB, { userId: B, sessionId: SB }],
    [D2, { userId: A, sessionId: S2 }],
  ]);
  context.meta = fixtureMetadata({ ...context, clock: () => context.clock, quota });
  context.transport = async (url, options) => {
    assert.equal(url.origin, "https://hutqsfftioxtredcjhsy.supabase.co");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal);
    context.outgoing.push(url.toString());
    return globalThis.fetch(providerURL + url.pathname, { ...options });
  };
  const adapters = createSupabaseRest({
    projectRef: "hutqsfftioxtredcjhsy",
    serviceRoleKey: key,
    fetchTransport: context.transport,
  });
  context.rest = adapters;
  context.handle = createGateway({
    verifyAccessToken: createSessionVerifier({
      projectRef: "hutqsfftioxtredcjhsy",
      jwks,
      callServerRpc: adapters.callServerRpc,
    }),
    metadata: context.meta,
    storage: adapters.storage,
  });
}
before(async () => {
  provider = createServer(providerHandler);
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  providerURL = `http://127.0.0.1:${provider.address().port}`;
  host = createNodeServer((request) => context.handle(request));
  host.listen(0, "127.0.0.1");
  await once(host, "listening");
  hostURL = `http://127.0.0.1:${host.address().port}`;
});
after(async () => {
  for (const server of [host, provider])
    if (server) {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
});
const route = (asset = 100, action = "content", workspace = WA) =>
  `/v2/workspaces/${workspace}/assets/${id(asset)}/${action}`;
async function call(path, { method = "GET", token = tokenA, headers = {}, data, ...options } = {}) {
  return globalThis.fetch(hostURL + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: data,
    ...options,
  });
}
async function reserve(
  asset = 100,
  { workspace = WA, device = DA, token = tokenA, body: changes = {}, data = bytes, ...options } = {},
) {
  return call(route(asset, "reserve", workspace), {
    method: "POST",
    token,
    headers: { "content-type": "application/json" },
    data: JSON.stringify({
      deviceId: device,
      generation: "1",
      sha256: hash(data),
      bytes: data.length,
      ...changes,
    }),
    ...options,
  });
}
async function upload(
  asset = 100,
  { data = bytes, device = DA, token = tokenA, generation = "1", workspace = WA, headers = {} } = {},
) {
  return call(route(asset, "content", workspace), {
    method: "PUT",
    token,
    headers: {
      "content-type": "application/octet-stream",
      "x-wjb-device-id": device,
      "x-wjb-generation": generation,
      ...headers,
    },
    data,
  });
}
async function download(asset = 100, { device = DA, token = tokenA, generation = "1", workspace = WA } = {}) {
  return call(route(asset, "content", workspace), {
    token,
    headers: { "x-wjb-device-id": device, "x-wjb-generation": generation },
  });
}
async function cancel(asset = 100) {
  return call(route(asset, "cancel"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    data: JSON.stringify({ deviceId: DA, generation: "1" }),
  });
}
async function error(result, code, status) {
  assert.equal(result.status, status);
  const text = await result.text();
  assert.equal(JSON.parse(text).error.code, code);
  assert.ok(
    !text.includes(key) &&
      !text.includes("private service detail") &&
      !text.includes("private Storage detail"),
  );
}
const row = (asset = 100) => context.meta.rows.get(`${WA}/${id(asset)}`);
const ready = async (asset = 100) => {
  assert.equal((await reserve(asset)).status, 201);
  assert.equal((await upload(asset)).status, 200);
};

test("real HTTP reserve/upload/download round trip", async () => {
  await reset();
  await ready();
  const r = await download();
  assert.equal(r.status, 200);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), bytes);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.ok(r.headers.get("content-disposition").includes(id(100)));
});
test("missing bearer rejected before backend", async () => {
  await reset();
  await error(await call(route(), { token: null }), "AUTH_REQUIRED", 401);
  assert.equal(context.calls.length, 0);
});
test("invalid signed token rejected before backend", async () => {
  await reset();
  await error(await call(route(), { token: "bad" }), "AUTH_REQUIRED", 401);
  assert.equal(context.calls.length, 0);
});
test("live session revoked rejects valid bearer", async () => {
  await reset();
  context.sessions.delete(SA);
  await error(await reserve(), "ACCESS_REVOKED", 403);
  assert.equal(context.objects.size, 0);
});
test("session RPC outage fails closed and hides details", async () => {
  await reset();
  context.faults.authDown = true;
  await error(await reserve(), "AUTH_UNAVAILABLE", 503);
});
test("other account cannot reserve another workspace", async () => {
  await reset();
  await error(await reserve(100, { token: tokenB }), "ACCESS_DENIED", 403);
});
test("another session cannot spoof device binding", async () => {
  await reset();
  await error(await reserve(100, { token: token2 }), "ACCESS_DENIED", 403);
});
test("request body principal spoofing is not accepted", async () => {
  await reset();
  await error(await reserve(100, { body: { userId: B } }), "INVALID_FIELDS", 400);
});
test("request body path injection is not accepted", async () => {
  await reset();
  await error(await reserve(100, { body: { path: "../other" } }), "INVALID_FIELDS", 400);
});
test("unknown route and query parameters rejected", async () => {
  await reset();
  await error(await call(route() + "?url=https://other.invalid"), "NOT_FOUND", 404);
});
test("browser origin denied by default", async () => {
  await reset();
  await error(await call(route(), { headers: { origin: "https://other.invalid" } }), "ORIGIN_DENIED", 403);
});
test("unsupported HTTP method rejected", async () => {
  await reset();
  await error(await call(route(), { method: "DELETE" }), "METHOD_NOT_ALLOWED", 405);
});
test("reservation replay idempotent", async () => {
  await reset();
  assert.equal((await reserve()).status, 201);
  assert.equal((await reserve()).status, 200);
  assert.equal(context.meta.used(WA), bytes.length);
});
test("reservation changes cannot reuse asset id", async () => {
  await reset();
  await reserve();
  await error(await reserve(100, { data: Buffer.from("changed") }), "IDEMPOTENCY_KEY_REUSED", 409);
});
test("pending asset cannot download", async () => {
  await reset();
  await reserve();
  await error(await download(), "ASSET_NOT_READY", 409);
});
test("upload without reservation rejected", async () => {
  await reset();
  await error(await upload(), "ASSET_NOT_FOUND", 404);
});
test("upload content type enforced", async () => {
  await reset();
  await reserve();
  await error(await upload(100, { headers: { "content-type": "text/plain" } }), "INVALID_CONTENT_TYPE", 415);
});
test("actual payload hash must match reservation", async () => {
  await reset();
  await reserve();
  await error(await upload(100, { data: Buffer.alloc(bytes.length, 1) }), "INTEGRITY_MISMATCH", 409);
  assert.equal(context.objects.size, 0);
});
test("larger body rejected before object write", async () => {
  await reset();
  await reserve();
  await error(await upload(100, { data: Buffer.alloc(bytes.length + 1) }), "PAYLOAD_TOO_LARGE", 413);
  assert.equal(context.objects.size, 0);
});
test("short body rejected before object write", async () => {
  await reset();
  await reserve();
  await error(await upload(100, { data: Buffer.from("short") }), "INTEGRITY_MISMATCH", 409);
});
test("storage upload failure leaves pending and quota held", async () => {
  await reset();
  await reserve();
  context.faults.put = true;
  await error(await upload(), "STORAGE_UNAVAILABLE", 503);
  assert.equal(row().state, "reserved");
  assert.equal(context.meta.used(WA), bytes.length);
});
test("lost storage ack retries without overwriting", async () => {
  await reset();
  await reserve();
  context.faults.putAckLost = true;
  await error(await upload(), "STORAGE_UNAVAILABLE", 503);
  assert.equal(context.objects.size, 1);
  context.faults.putAckLost = false;
  assert.equal((await upload()).status, 200);
  assert.equal(row().state, "ready");
});
test("same existing private bytes can reconcile pending upload", async () => {
  await reset();
  await reserve();
  context.objects.set(`${WA}/${id(100)}`, bytes);
  assert.equal((await upload()).status, 200);
});
test("different existing bytes never overwritten or exposed", async () => {
  await reset();
  await reserve();
  const wrong = Buffer.alloc(bytes.length, 1);
  context.objects.set(`${WA}/${id(100)}`, wrong);
  await error(await upload(), "INTEGRITY_MISMATCH", 409);
  assert.deepEqual(context.objects.get(`${WA}/${id(100)}`), wrong);
  assert.equal(row().state, "reserved");
});
test("metadata finalize failure preserves private object", async () => {
  await reset();
  await reserve();
  context.meta.faults.finalize = true;
  await error(await upload(), "INTERNAL_ERROR", 503);
  assert.equal(row().state, "reserved");
  await error(await download(), "ASSET_NOT_READY", 409);
  context.meta.faults.finalize = false;
  assert.equal((await upload()).status, 200);
});
test("lost metadata ack returns prior committed ready on retry", async () => {
  await reset();
  await reserve();
  context.meta.faults.ackLost = true;
  await error(await upload(), "INTERNAL_ERROR", 503);
  assert.equal(row().state, "ready");
  context.meta.faults.ackLost = false;
  assert.equal((await upload()).status, 200);
});
test("revocation during upload prevents ready publication", async () => {
  await reset();
  await reserve();
  context.hooks.afterPut = () => context.sessions.delete(SA);
  await error(await upload(), "ACCESS_REVOKED", 403);
  assert.equal(row().state, "reserved");
  assert.equal(context.objects.size, 1);
});
test("generation change during upload prevents publication", async () => {
  await reset();
  await reserve();
  context.hooks.afterPut = () => {
    context.workspaces.get(WA).generation = "2";
  };
  await error(await upload(), "GENERATION_CHANGED", 409);
  assert.equal(row().state, "reserved");
});
test("expiry during upload prevents publication", async () => {
  await reset();
  await reserve();
  context.hooks.afterPut = () => {
    context.clock += 300001;
  };
  await error(await upload(), "UPLOAD_EXPIRED", 409);
  assert.equal(row().state, "reserved");
});
test("another account cannot download finalized object", async () => {
  await reset();
  await ready();
  await error(await download(100, { token: tokenB, device: DB }), "ACCESS_DENIED", 403);
});
test("same owner with second valid device can download", async () => {
  await reset();
  await ready();
  assert.equal((await download(100, { token: token2, device: D2 })).status, 200);
});
test("second device cannot replace reserved upload", async () => {
  await reset();
  await reserve();
  await error(await upload(100, { token: token2, device: D2 }), "ACCESS_DENIED", 403);
});
test("corrupted finalized bytes never returned", async () => {
  await reset();
  await ready();
  context.objects.set(`${WA}/${id(100)}`, Buffer.alloc(bytes.length, 1));
  await error(await download(), "INTEGRITY_MISMATCH", 409);
});
test("revocation during download denies response bytes", async () => {
  await reset();
  await ready();
  context.hooks.beforeGet = () => context.sessions.delete(SA);
  await error(await download(), "ACCESS_REVOKED", 403);
});
test("generation change during download denies response", async () => {
  await reset();
  await ready();
  context.hooks.beforeGet = () => {
    context.workspaces.get(WA).generation = "2";
  };
  await error(await download(), "GENERATION_CHANGED", 409);
});
test("ready asset cannot be canceled", async () => {
  await reset();
  await ready();
  await error(await cancel(), "ASSET_ALREADY_READY", 409);
  assert.equal(context.objects.size, 1);
});
test("pending cancellation confirms absence before quota release", async () => {
  await reset();
  await reserve();
  context.meta.faults.finalize = true;
  await upload();
  context.meta.faults.finalize = false;
  assert.equal((await cancel()).status, 200);
  assert.equal(context.objects.size, 0);
  assert.equal(context.meta.used(WA), 0);
});
test("delete error keeps cleanup pending and quota held", async () => {
  await reset();
  await reserve();
  context.faults.remove = true;
  await error(await cancel(), "STORAGE_UNAVAILABLE", 503);
  assert.equal(row().state, "cleanup");
  assert.equal(context.meta.used(WA), bytes.length);
  context.faults.remove = false;
  assert.equal((await cancel()).status, 200);
  assert.equal(context.meta.used(WA), 0);
});
test("successful delete response without absence is not completion", async () => {
  await reset();
  await reserve();
  context.objects.set(`${WA}/${id(100)}`, bytes);
  context.faults.keepAfterDelete = true;
  await error(await cancel(), "DELETE_NOT_CONFIRMED", 503);
  assert.equal(row().state, "cleanup");
  assert.equal(context.meta.used(WA), bytes.length);
});
test("cancel metadata error retains quota and can retry", async () => {
  await reset();
  await reserve();
  context.meta.faults.cancel = true;
  await error(await cancel(), "INTERNAL_ERROR", 503);
  assert.equal(row().state, "cleanup");
  context.meta.faults.cancel = false;
  assert.equal((await cancel()).status, 200);
  assert.equal(context.meta.used(WA), 0);
});
test("cancel replay is safe and id cannot be reused", async () => {
  await reset();
  await reserve();
  await cancel();
  assert.equal((await cancel()).status, 200);
  await error(await reserve(), "ASSET_CANCELED", 409);
});
test("expired reservation can be canceled", async () => {
  await reset();
  await reserve();
  context.clock += 300001;
  assert.equal((await cancel()).status, 200);
  assert.equal(context.meta.used(WA), 0);
});
test("concurrent uploads serialize without duplicate object", async () => {
  await reset();
  await reserve();
  const rs = await Promise.all([upload(), upload()]);
  assert.deepEqual(
    rs.map((r) => r.status),
    [200, 200],
  );
  assert.equal(context.objects.size, 1);
  assert.equal(context.calls.filter((x) => x.method === "POST" && x.path.startsWith(bucket)).length, 1);
});
test("concurrent reservations cannot exceed quota", async () => {
  await reset({ quota: bytes.length });
  const rs = await Promise.all([reserve(100), reserve(101)]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409]);
  assert.equal(context.meta.used(WA), bytes.length);
});
test("cancel racing upload never exposes unverified bytes", async () => {
  await reset();
  await reserve();
  const rs = await Promise.all([upload(), cancel()]);
  assert.ok(["ready", "canceled"].includes(row().state));
  assert.ok(rs.every((r) => [200, 409].includes(r.status)));
  if (row().state === "canceled") assert.equal(context.objects.size, 0);
});
test("server credential never appears in gateway JSON", async () => {
  await reset();
  await reserve();
  const text = await (await upload()).text();
  assert.ok(!text.includes(key));
  assert.equal(
    context.outgoing.every((u) => u.startsWith("https://hutqsfftioxtredcjhsy.supabase.co/")),
    true,
  );
});
test("adapter rejects another target project", () =>
  assert.throws(() =>
    createSupabaseRest({ projectRef: "other", serviceRoleKey: key, fetchTransport: () => {} }),
  ));
test("adapter rejects object path traversal before transport", async () => {
  await reset();
  const calls = context.calls.length;
  await assert.rejects(
    () => context.rest.storage.get({ workspaceId: "../x", assetId: id(100) }, 10),
    (e) => e.code === "INVALID_SCOPE",
  );
  assert.equal(context.calls.length, calls);
});
test("server RPC allowlist rejects arbitrary function", async () => {
  await reset();
  await assert.rejects(
    () => context.rest.callServerRpc("dangerous_sql", { p_user: A, p_session: SA }),
    (e) => e.code === "INVALID_RPC",
  );
  assert.equal(context.calls.length, 0);
});
test("transport failure hides original details", async () => {
  const rest = createSupabaseRest({
    projectRef: "hutqsfftioxtredcjhsy",
    serviceRoleKey: key,
    fetchTransport: async () => {
      throw new Error("private secret transport");
    },
  });
  await assert.rejects(
    () => rest.storage.get({ workspaceId: WA, assetId: id(100) }, 10),
    (e) => e.code === "STORAGE_UNAVAILABLE" && !e.message.includes("private"),
  );
});
test("chunked source without content length has bounded read", async () => {
  let canceled = false;
  const source = {
    headers: new globalThis.Headers(),
    body: new ReadableStream({
      start(c) {
        c.enqueue(Buffer.alloc(11));
      },
      cancel() {
        canceled = true;
      },
    }),
  };
  await assert.rejects(
    () => readLimited(source, 10),
    (e) => e.code === "PAYLOAD_TOO_LARGE",
  );
  assert.equal(canceled, true);
});
test("stalled source times out and cancels", async () => {
  let canceled = false;
  const source = {
    headers: new globalThis.Headers(),
    body: new ReadableStream({
      cancel() {
        canceled = true;
      },
    }),
  };
  await assert.rejects(
    () => readLimited(source, 10, { timeoutMs: 10 }),
    (e) => e.code === "BODY_TIMEOUT",
  );
  assert.equal(canceled, true);
});
test("invalid declared length rejected", async () => {
  const source = { headers: new globalThis.Headers({ "content-length": "-1" }) };
  await assert.rejects(
    () => readLimited(source, 10),
    (e) => e instanceof GatewayError && e.code === "INVALID_LENGTH",
  );
});

test("gateway rejects malformed JSON without leaking internals", async () => {
  await reset();
  await error(
    await call(route(100, "reserve"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      data: "{",
    }),
    "INVALID_JSON",
    400,
  );
});
test("oversized JSON rejected before metadata mutation", async () => {
  await reset();
  await error(
    await call(route(100, "reserve"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      data: " ".repeat(2049),
    }),
    "PAYLOAD_TOO_LARGE",
    413,
  );
  assert.equal(context.meta.rows.size, 0);
});
test("unsafe generation integer rejected before metadata", async () => {
  await reset();
  await error(await reserve(100, { body: { generation: "9223372036854775808" } }), "INVALID_REQUEST", 400);
});
test("real HTTP chunked upload is bounded without declared length", async () => {
  await reset();
  await reserve();
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(bytes);
      c.enqueue(Buffer.from("x"));
      c.close();
    },
  });
  await error(
    await call(route(), {
      method: "PUT",
      headers: { "content-type": "application/octet-stream", "x-wjb-device-id": DA, "x-wjb-generation": "1" },
      data: stream,
      duplex: "half",
    }),
    "PAYLOAD_TOO_LARGE",
    413,
  );
  assert.equal(context.objects.size, 0);
});
test("provider redirect is not followed with server credentials", async () => {
  await reset();
  await ready();
  context.faults.redirect = true;
  await error(await download(), "STORAGE_UNAVAILABLE", 503);
  assert.ok(!context.calls.some((c) => c.path === "/escape"));
});
test("oversized provider bytes rejected with bounded read", async () => {
  await reset();
  await ready();
  context.objects.set(`${WA}/${id(100)}`, Buffer.alloc(65537));
  await error(await download(), "STORAGE_UNAVAILABLE", 503);
});
test("HTTP RPC string true is not a verified session", async () => {
  await reset();
  context.faults.rpcValue = true;
  await error(await reserve(), "AUTH_UNAVAILABLE", 503);
  assert.equal(context.meta.rows.size, 0);
});
test("revocation during delete retains cleanup and quota", async () => {
  await reset();
  await reserve();
  context.hooks.afterDelete = () => context.sessions.delete(SA);
  await error(await cancel(), "ACCESS_REVOKED", 403);
  assert.equal(row().state, "cleanup");
  assert.equal(context.objects.size, 0);
  assert.equal(context.meta.used(WA), bytes.length);
});
test("actual Storage HTTP400 inner404 confirms pending cancellation and releases quota", async () => {
  await reset();
  await reserve();
  context.faults.missingAs400 = true;
  const result = await cancel();
  assert.equal(result.status, 200);
  assert.equal(row().state, "canceled");
  assert.equal(context.meta.used(WA), 0);
});
for (const [name, status, value] of [
  ["permission denial", 403, { statusCode: "404", error: "not_found", message: "Object not found" }],
  ["missing bucket", 400, { statusCode: "404", error: "not_found", message: "Bucket not found" }],
  ["inner permission code", 400, { statusCode: "403", error: "not_found", message: "Object not found" }],
  ["unknown error type", 400, { statusCode: "404", error: "unknown", message: "Object not found" }],
  ["malformed body", 400, "not-json"],
  ["oversized body", 400, "x".repeat(4097)],
]) {
  test(`${name} cannot prove Storage object absence`, async () => {
    const rest = createSupabaseRest({
      projectRef: "vsphftnmfzfoufasjttd",
      serviceRoleKey: key,
      fetchTransport: async () =>
        new Response(typeof value === "string" ? value : JSON.stringify(value), { status }),
    });
    await assert.rejects(
      () => rest.storage.get({ workspaceId: WA, assetId: id(100) }, 64),
      (error) => error.code === "STORAGE_UNAVAILABLE",
    );
  });
}
