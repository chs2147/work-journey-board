import console from "node:console";
// Local integration fixture only. No real user token or cloud session is used.
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { createVerifier } from "./verifier.mjs";
const sub = "00000000-0000-0000-0000-000000000001";
const session = "00000000-0000-0000-0000-000000000007";
const { publicKey, privateKey } = await generateKeyPair("ES256");
const now = Math.floor(Date.now() / 1000);
const jwk = { ...(await exportJWK(publicKey)), kid: "integration-fixture", alg: "ES256" };
const verify = createVerifier({
  projectRef: "hutqsfftioxtredcjhsy",
  jwks: { keys: [jwk] },
  sessionIsActive: async (p) => p.userId === sub && p.sessionId === session,
});
const token = await new SignJWT({ session_id: session, role: "authenticated" })
  .setProtectedHeader({ alg: "ES256", kid: jwk.kid, typ: "JWT" })
  .setIssuer("https://hutqsfftioxtredcjhsy.supabase.co/auth/v1")
  .setAudience("authenticated")
  .setSubject(sub)
  .setIssuedAt(now)
  .setExpirationTime(now + 3600)
  .sign(privateKey);
console.log(JSON.stringify(await verify(token)));
