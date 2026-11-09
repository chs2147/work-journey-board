import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import console from "node:console";
// Offline technical assessment only: never logs in, changes roles or authorizes DDL.
export function assessOwner(live, { manifestHash, now = new Date() } = {}) {
  const missing = [];
  const check = (ok, code) => {
    if (!ok) missing.push(code);
  };
  const d = live?.summary?.[0]?.owner_inspection;
  const time = Date.parse(live?.observed_at);
  check(
    live?.project_ref === "hutqsfftioxtredcjhsy" &&
      live?.read_only === true &&
      [200, 201].includes(live?.http_status),
    "TARGET_EVIDENCE_REQUIRED",
  );
  check(
    Number.isFinite(time) && now.getTime() >= time && now.getTime() - time <= 86400000,
    "FRESH_EVIDENCE_REQUIRED",
  );
  check(typeof manifestHash === "string" && /^[0-9a-f]{64}$/.test(manifestHash), "BUNDLE_HASH_REQUIRED");
  check(
    d?.inspection_role === "supabase_read_only_user" && d?.candidate_role === "postgres",
    "ROLE_SCOPE_CHANGED",
  );
  check(
    d?.candidate?.exists === true && d.candidate.superuser === false && d.candidate.bypassRls === true,
    "CANDIDATE_PROFILE_CHANGED",
  );
  for (const field of ["create_schema", "public_create", "public_usage", "auth_usage", "plpgsql_usage"])
    check(d?.[field] === true, field.toUpperCase() + "_REQUIRED");
  const required = [
    "sessions.id",
    "sessions.user_id",
    "sessions.not_after",
    "users.id",
    "users.banned_until",
    "users.deleted_at",
  ].sort();
  const columns = d?.auth_columns || [];
  check(
    columns.length === 6 &&
      columns.every((x) => x.select === true) &&
      JSON.stringify(columns.map((x) => x.table + "." + x.column).sort()) === JSON.stringify(required),
    "AUTH_COLUMN_SELECT_REQUIRED",
  );
  const api = new Map((d?.api_roles || []).map((x) => [x.role, x]));
  check(
    api.size === 3 &&
      ["anon", "authenticated", "service_role"].every((name) => {
        const x = api.get(name);
        return (
          x && x.superuser === false && x.publicCreate === false && x.bypassRls === (name === "service_role")
        );
      }),
    "API_ROLE_PROFILE_CHANGED",
  );
  const rls = d?.auth_rls || [];
  check(
    rls.length === 2 &&
      new Set(rls.map((x) => x.table)).size === 2 &&
      rls.every((x) => ["users", "sessions"].includes(x.table) && x.enabled === true && x.forced === false),
    "AUTH_RLS_PROFILE_CHANGED",
  );
  return {
    status: missing.length ? "NEEDS_REVIEW" : "TECHNICALLY_REVIEWED",
    candidateRole: "postgres",
    bundleManifestSha256: manifestHash || null,
    checkedAt: now.toISOString(),
    writeCredentialVerified: false,
    installationAuthorized: false,
    scope: "candidate SQL executor and fixed server-only definer functions",
    missing,
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const live = JSON.parse(readFileSync(process.argv[2], "utf8"));
    const manifest = readFileSync(new URL("./bundle/manifest.json", import.meta.url));
    const review = assessOwner(live, { manifestHash: createHash("sha256").update(manifest).digest("hex") });
    console.log(JSON.stringify(review, null, 2));
    process.exitCode = review.status === "TECHNICALLY_REVIEWED" ? 0 : 2;
  } catch {
    console.log(
      JSON.stringify({
        status: "NEEDS_REVIEW",
        writeCredentialVerified: false,
        installationAuthorized: false,
        missing: ["INVALID_INPUT"],
      }),
    );
    process.exitCode = 2;
  }
}
