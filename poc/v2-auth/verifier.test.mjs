import { Buffer } from "node:buffer";
import test from "node:test";
import assert from "node:assert/strict";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createVerifier } from "./verifier.mjs";

const projectRef = "hutqsfftioxtredcjhsy";
const issuer = `https://${projectRef}.supabase.co/auth/v1`;
const now = new Date("2026-11-08T00:00:00Z");
const timestamp = now.getTime() / 1000;
const sub = "00000000-0000-0000-0000-000000000001";
const session = "00000000-0000-0000-0000-000000000007";
const { privateKey, publicKey } = await generateKeyPair("ES256");
const publicJwk = { ...(await exportJWK(publicKey)), kid: "local-1", alg: "ES256", use: "sig" };
const jwks = { keys: [publicJwk] };
const config = { projectRef, jwks, sessionIsActive: async () => true };
const verify = createVerifier(config);
async function token(claims = {}, header = {}, key = privateKey) {
  return new SignJWT({
    iss: issuer,
    aud: "authenticated",
    sub,
    session_id: session,
    role: "authenticated",
    iat: timestamp - 1,
    exp: timestamp + 3599,
    ...claims,
  })
    .setProtectedHeader({ alg: "ES256", kid: "local-1", typ: "JWT", ...header })
    .sign(key);
}
async function denied(value, code = "AUTH_REQUIRED", verifier = verify) {
  await assert.rejects(
    () => verifier(value, { now }),
    (e) => e.code === code && e.message === code,
  );
}

test("signed ES256 token returns only verified principal", async () => {
  assert.deepEqual(await verify(await token(), { now }), {
    userId: sub,
    sessionId: session,
    role: "authenticated",
    expiresAt: timestamp + 3599,
  });
});
test("tampered payload fails signature", async () => {
  const parts = (await token()).split(".");
  parts[1] = Buffer.from(
    JSON.stringify({ sub, iss: issuer, aud: "authenticated", role: "authenticated" }),
  ).toString("base64url");
  await denied(parts.join("."));
});
test("different signing key rejected", async () => {
  const pair = await generateKeyPair("ES256");
  await denied(await token({}, {}, pair.privateKey));
});
test("unsigned token rejected", () => denied("eyJhbGciOiJub25lIn0.e30."));
test("HMAC algorithm confusion rejected", async () => {
  const value = await new SignJWT({ sub })
    .setProtectedHeader({ alg: "HS256", kid: "local-1" })
    .sign(new Uint8Array(32));
  await denied(value);
});
test("wrong project issuer rejected", async () =>
  denied(await token({ iss: "https://other.supabase.co/auth/v1" })));
test("wrong audience rejected", async () => denied(await token({ aud: "service_role" })));
test("expired token rejected", async () => denied(await token({ iat: timestamp - 3600, exp: timestamp })));
test("future issued token rejected", async () => denied(await token({ iat: timestamp + 10 })));
test("not-before enforced", async () => denied(await token({ nbf: timestamp + 10 })));
test("excess token lifetime rejected", async () => denied(await token({ exp: timestamp + 7200 })));
test("missing expiration rejected", async () => denied(await token({ exp: undefined })));
test("missing issued time rejected", async () => denied(await token({ iat: undefined })));
test("missing session rejected", async () => denied(await token({ session_id: undefined })));
test("invalid subject UUID rejected", async () => denied(await token({ sub: "not-a-user" })));
test("invalid session UUID rejected", async () => denied(await token({ session_id: "not-a-session" })));
test("service role rejected", async () => denied(await token({ role: "service_role" })));
test("anonymous authenticated account rejected", async () => denied(await token({ is_anonymous: true })));
test("unknown key id fails closed", async () => denied(await token({}, { kid: "rotated-unknown" })));
test("token supplied key URL rejected", async () =>
  denied(await token({}, { jku: "https://untrusted.invalid/keys" })));
test("token embedded key rejected", async () => denied(await token({}, { jwk: publicJwk })));
test("wrong token type rejected", async () => denied(await token({}, { typ: "refresh+jwt" })));
test("malformed and excessive tokens rejected", async () => {
  await denied("broken");
  await denied("a".repeat(16385));
});
test("live session revoked despite valid signature", async () =>
  denied(await token(), "ACCESS_REVOKED", createVerifier({ ...config, sessionIsActive: async () => false })));
test("session verification failure fails closed", async () =>
  denied(
    await token(),
    "AUTH_UNAVAILABLE",
    createVerifier({
      ...config,
      sessionIsActive: async () => {
        throw new Error("private backend detail");
      },
    }),
  ));
test("session checker runs only after signature and claims pass", async () => {
  let calls = 0;
  const check = createVerifier({
    ...config,
    sessionIsActive: async (p) => {
      calls++;
      assert.equal(p.sessionId, session);
      return true;
    },
  });
  await denied(await token({ iss: "wrong" }), "AUTH_REQUIRED", check);
  assert.equal(calls, 0);
  await check(await token(), { now });
  assert.equal(calls, 1);
});
test("rotation accepts trusted new kid, rejects removed old kid", async () => {
  const pair = await generateKeyPair("ES256");
  const key2 = { ...(await exportJWK(pair.publicKey)), kid: "local-2", alg: "ES256" };
  const both = createVerifier({ ...config, jwks: { keys: [publicJwk, key2] } });
  await both(await token(), { now });
  await both(await token({}, { kid: "local-2" }, pair.privateKey), { now });
  const rotated = createVerifier({ ...config, jwks: { keys: [key2] } });
  await denied(await token(), "AUTH_REQUIRED", rotated);
});
test("trusted configuration rejects private or duplicate keys", () => {
  assert.throws(() => createVerifier({ ...config, jwks: { keys: [{ ...publicJwk, d: "private" }] } }));
  assert.throws(() => createVerifier({ ...config, jwks: { keys: [publicJwk, publicJwk] } }));
});
