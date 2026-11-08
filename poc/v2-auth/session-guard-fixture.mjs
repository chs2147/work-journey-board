// Generated-token integration against disposable local SQL only; never remote HTTP.
import { execFileSync } from "node:child_process";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import process from "node:process";
import console from "node:console";
import { createSessionVerifier } from "./session-adapter.mjs";
const container = process.argv[2];
if (!/^wjb-v2-pg-[a-f0-9]{12}$/.test(container)) throw new Error("Local fixture container required");
const user = "00000000-0000-0000-0000-000000000001";
const session = "00000000-0000-0000-0000-000000000007";
const pair = await generateKeyPair("ES256");
const jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), alg: "ES256", kid: "guard-integration" }] };
const now = Math.floor(Date.now() / 1000);
const value = await new SignJWT({ session_id: session, role: "authenticated" })
  .setProtectedHeader({ alg: "ES256", kid: "guard-integration", typ: "JWT" })
  .setSubject(user)
  .setIssuer("https://hutqsfftioxtredcjhsy.supabase.co/auth/v1")
  .setAudience("authenticated")
  .setIssuedAt(now)
  .setExpirationTime(now + 3600)
  .sign(pair.privateKey);
const env = { ...process.env };
for (const key of ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"])
  delete env[key];
const verify = createSessionVerifier({
  projectRef: "hutqsfftioxtredcjhsy",
  jwks,
  callServerRpc: async (name, args) => {
    if (name !== "wjb_v2_session_active" || args.p_user !== user || args.p_session !== session)
      throw new Error("Unexpected fixture request");
    const result = execFileSync(
      "docker",
      [
        "--host=unix:///var/run/docker.sock",
        "exec",
        "-i",
        container,
        "psql",
        "-X",
        "-qAt",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "postgres",
      ],
      {
        env,
        encoding: "utf8",
        timeout: 10000,
        input: `BEGIN; SET LOCAL ROLE service_role; SELECT public.wjb_v2_session_active('${user}','${session}'); COMMIT;`,
      },
    );
    return result.trim() === "t";
  },
});
try {
  const principal = await verify(value);
  console.log(JSON.stringify({ status: "ACCEPTED", userId: principal.userId }));
} catch (e) {
  console.log(JSON.stringify({ status: e.code || "ERROR" }));
}
