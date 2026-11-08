import test from "node:test";
import assert from "node:assert/strict";
import { createPostgresMetadata } from "./postgres-metadata.mjs";
const id = (n) => `00000000-0000-0000-0000-${n.toString(16).padStart(12, "0")}`;
const principal = { userId: id(1), sessionId: id(7), unusedSecret: "never forwarded" };
const scope = { workspaceId: id(3), assetId: id(100), deviceId: id(5), generation: "1" };
function fixture(overrides = {}) {
  const calls = [];
  let current = {
    ...scope,
    sha256: "0".repeat(64),
    bytes: 10,
    state: "reserved",
    ioVersion: "0",
    expires: Date.now() + 300000,
  };
  const call = async (name, args) => {
    assert.equal(name, "wjb_v2_asset_command");
    assert.deepEqual(Object.keys(args), ["p_request"]);
    assert.ok(!JSON.stringify(args).includes("never forwarded"));
    const r = args.p_request;
    calls.push(r);
    if (overrides[r.action]) return overrides[r.action](r, current);
    if (r.action === "release") return { released: true };
    if (r.action === "acquire") current = { ...current, leaseToken: r.params.token, fence: "1" };
    if (r.action === "mark_cleanup") current = { ...current, state: "cleanup", ioVersion: "8" };
    if (r.action === "recheck") current = { ...current, ioVersion: "9" };
    if (r.action === "begin_io") current = { ...current, ioVersion: "1" };
    if (r.action === "settle_io") current = { ...current, ioVersion: "2" };
    return { ...current, created: true };
  };
  return { calls, call, meta: createPostgresMetadata({ callServerRpc: call }) };
}
test("explicit server transport required", () => assert.throws(() => createPostgresMetadata({})));
test("reserve forwards only trusted identity and fixed RPC", async () => {
  const f = fixture();
  const r = await f.meta.reserve(principal, scope, { bytes: 10, sha256: "0".repeat(64) });
  assert.equal(r.created, true);
  assert.equal(f.calls[0].userId, principal.userId);
});
test("invalid scope never reaches backend", async () => {
  const f = fixture();
  await assert.rejects(() => f.meta.reserve(principal, { ...scope, workspaceId: "bad" }, {}));
  assert.equal(f.calls.length, 0);
});
test("wrong workspace response fails closed", async () => {
  const f = fixture({ reserve: (_r, row) => ({ ...row, workspaceId: id(99) }) });
  await assert.rejects(
    () => f.meta.reserve(principal, scope, {}),
    (e) => e.code === "METADATA_UNAVAILABLE",
  );
});
test("unknown backend errors do not leak details", async () => {
  const f = fixture({
    reserve: () => {
      throw new Error("private SQL details");
    },
  });
  await assert.rejects(
    () => f.meta.reserve(principal, scope, {}),
    (e) => e.code === "METADATA_UNAVAILABLE" && !e.message.includes("private"),
  );
});
test("known access rejection maps to forbidden", async () => {
  const f = fixture({
    reserve: () => {
      const e = new Error();
      e.code = "ACCESS_DENIED";
      throw e;
    },
  });
  await assert.rejects(
    () => f.meta.reserve(principal, scope, {}),
    (e) => e.status === 403,
  );
});
test("busy lease is returned as retryable conflict", async () => {
  const f = fixture({
    acquire: () => {
      const e = new Error();
      e.code = "LEASE_BUSY";
      throw e;
    },
  });
  await assert.rejects(
    () => f.meta.withAsset(principal, scope, "write", async () => {}),
    (e) => e.code === "LEASE_BUSY" && e.status === 409,
  );
});
test("lease token mismatch fails closed", async () => {
  const f = fixture({ acquire: (_r, row) => ({ ...row, leaseToken: id(999), fence: "1" }) });
  await assert.rejects(
    () => f.meta.withAsset(principal, scope, "write", async () => {}),
    (e) => e.code === "METADATA_UNAVAILABLE",
  );
});
test("callback error still releases exact acquired lease", async () => {
  const f = fixture();
  await assert.rejects(() =>
    f.meta.withAsset(principal, scope, "write", async () => {
      throw new Error("callback");
    }),
  );
  assert.equal(f.calls.at(-1).action, "release");
  assert.equal(f.calls.at(-1).params.token, f.calls[0].params.token);
  assert.equal(f.calls.at(-1).params.fence, "1");
});
test("release outage cannot alter successful committed result", async () => {
  const f = fixture({
    release: () => {
      throw new Error();
    },
  });
  const seen = [];
  const meta = createPostgresMetadata({ callServerRpc: f.call, onReleaseError: (code) => seen.push(code) });
  assert.equal(await meta.withAsset(principal, scope, "read", async () => 42), 42);
  assert.deepEqual(seen, ["LEASE_RELEASE_UNCONFIRMED"]);
});
test("cleanup keeps original IO epoch despite later recheck", async () => {
  const f = fixture();
  await f.meta.withAsset(principal, scope, "cancel", async (ctx) => {
    await ctx.markCleanup();
    await ctx.recheck();
    await ctx.markCanceled();
  });
  assert.equal(f.calls.find((c) => c.action === "mark_canceled").params.ioVersion, "8");
});
test("storage intent ID is identical in begin and settlement", async () => {
  const f = fixture();
  await f.meta.withAsset(principal, scope, "write", async (ctx) => {
    await ctx.beginStorageWrite();
    await ctx.settleStorageWrite();
  });
  const begin = f.calls.find((c) => c.action === "begin_io"),
    settle = f.calls.find((c) => c.action === "settle_io");
  assert.equal(begin.params.intent, settle.params.intent);
  assert.equal(begin.params.token, settle.params.token);
});

test("numeric IO version is rejected instead of rounded", async () => {
  const f = fixture({ reserve: (_r, row) => ({ ...row, ioVersion: 9007199254740992 }) });
  await assert.rejects(
    () => f.meta.reserve(principal, scope, {}),
    (e) => e.code === "METADATA_UNAVAILABLE",
  );
});
test("numeric lease fence is rejected instead of rounded", async () => {
  const f = fixture({ acquire: (r, row) => ({ ...row, leaseToken: r.params.token, fence: 1 }) });
  await assert.rejects(
    () => f.meta.withAsset(principal, scope, "read", async () => {}),
    (e) => e.code === "METADATA_UNAVAILABLE",
  );
});
