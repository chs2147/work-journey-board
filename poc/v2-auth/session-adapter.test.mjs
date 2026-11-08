import test from "node:test";
import assert from "node:assert/strict";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createSessionVerifier } from "./session-adapter.mjs";
const projectRef = "hutqsfftioxtredcjhsy";
const user = "00000000-0000-0000-0000-000000000001";
const session = "00000000-0000-0000-0000-000000000007";
const now = Math.floor(Date.now() / 1000);
const pair = await generateKeyPair("ES256");
const jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), alg: "ES256", kid: "adapter-local" }] };
const value = await new SignJWT({ session_id: session, role: "authenticated" })
  .setProtectedHeader({ alg: "ES256", kid: "adapter-local", typ: "JWT" })
  .setSubject(user)
  .setAudience("authenticated")
  .setIssuer(`https://${projectRef}.supabase.co/auth/v1`)
  .setIssuedAt(now)
  .setExpirationTime(now + 3600)
  .sign(pair.privateKey);
const make = (callServerRpc) => createSessionVerifier({ projectRef, jwks, callServerRpc });
test("only signed principal and fixed RPC reach server transport", async () => {
  const check = make(async (name, args) => {
    assert.equal(name, "wjb_v2_session_active");
    assert.deepEqual(args, { p_user: user, p_session: session });
    return true;
  });
  assert.equal((await check(value)).userId, user);
});
for (const result of [false, null, undefined, "true", 1, {}, [true]]) {
  test(`non-boolean-true RPC result rejected: ${JSON.stringify(result)}`, async () => {
    await assert.rejects(
      () => make(async () => result)(value),
      (e) => e.code === "ACCESS_REVOKED",
    );
  });
}
test("server RPC outage fails closed without leaking original error", async () => {
  await assert.rejects(
    () =>
      make(async () => {
        throw new Error("private connection detail");
      })(value),
    (e) => e.code === "AUTH_UNAVAILABLE" && !e.message.includes("private"),
  );
});
test("invalid token never reaches service transport", async () => {
  let calls = 0;
  await assert.rejects(() =>
    make(async () => {
      calls++;
      return true;
    })("bad"),
  );
  assert.equal(calls, 0);
});
test("service transport is mandatory", () => assert.throws(() => make(null)));
