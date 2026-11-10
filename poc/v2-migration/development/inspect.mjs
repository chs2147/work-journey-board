// Explicit read-only DEV inspection. No schema, account, bucket or scheduling mutation.
import { writeFile, readFile } from "node:fs/promises";
if (process.argv.slice(2).join(" ") !== "--inspect-development")
  throw Error("EXPLICIT_DEV_INSPECTION_REQUIRED");
const ref = "vsphftnmfzfoufasjttd",
  origin = `https://${ref}.supabase.co`;
if (process.env.WJB_CLOUD_ENV !== "development" || process.env.WJB_SUPABASE_DEV_PROJECT_REF !== ref)
  throw Error("DEV_REQUIRED");
const token = process.env.WJB_SUPABASE_DEV_MANAGEMENT_TOKEN,
  key = process.env.WJB_SUPABASE_DEV_SERVICE_ROLE_KEY;
if (!token || !key) throw Error("DEV_KEYS_REQUIRED");
async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query, read_only: true }),
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw Error("SQL_READ_HTTP_" + r.status);
  return r.json();
}
const projectResponse = await fetch(`https://api.supabase.com/v1/projects/${ref}`, {
  headers: { authorization: `Bearer ${token}` },
  redirect: "error",
  signal: AbortSignal.timeout(20000),
});
if (!projectResponse.ok) throw Error("PROJECT_HTTP_" + projectResponse.status);
const project = await projectResponse.json();
const preflight = await sql(
  await readFile(new URL("../postgres/000-preflight.sql", import.meta.url), "utf8"),
);
const role = await sql(
  "SELECT current_user AS role, current_setting('transaction_read_only') AS read_only, r.rolsuper,r.rolbypassrls, pg_database_size(current_database()) AS database_bytes FROM pg_roles r WHERE r.rolname=current_user;",
);
const counts = await sql(
  "SELECT (SELECT count(*) FROM wjb_gateway.workspace) AS workspaces,(SELECT count(*) FROM wjb_gateway.asset) AS assets,(SELECT count(*) FROM storage.buckets) AS buckets,(SELECT count(*) FROM storage.objects) AS objects;",
);
const keepalive = await sql(
  await readFile(new URL("../../v2-cloud/development/bundle/keepalive-verify.sql", import.meta.url), "utf8"),
);
const functions = await sql(
  "SELECT n.nspname AS schema,p.proname AS name,encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') AS definition_hash FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('wjb_gateway','wjb_v2_cloud') OR (n.nspname='public' AND p.proname IN('wjb_v2_session_active','wjb_v2_asset_command','wjb_v2_recovery_catalog')) ORDER BY 1,2;",
);
const b = await fetch(origin + "/storage/v1/bucket", {
  headers: { apikey: key, authorization: `Bearer ${key}` },
  redirect: "error",
  signal: AbortSignal.timeout(15000),
});
const migrationCounts = await sql(
  "SELECT (SELECT count(*) FROM wjb_migration.job) AS jobs,(SELECT count(*) FROM wjb_migration.workspace_record) AS records,(SELECT count(*) FROM wjb_migration.workspace_header) AS headers,(SELECT count(*) FROM wjb_migration.asset) AS migration_assets,(SELECT count(*) FROM wjb_gateway.io_intent) AS io_intents,(SELECT count(*) FROM wjb_gateway.device) AS devices;",
);
const migrationOwner = await sql(
  "SELECT DISTINCT r.rolname,r.rolsuper,r.rolbypassrls FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='wjb_migration' OR (n.nspname='public' AND p.proname='wjb_v2_migration_command');",
);
const report = {
  migrationCounts,
  migrationOwner,
  checkedAt: new Date().toISOString(),
  projectRef: ref,
  project: { status: project.status, region: project.region, name: project.name },
  preflight,
  role,
  counts,
  keepalive,
  functions,
  storageListStatus: b.status,
  cloudWritten: false,
};
await b.body?.cancel();
await writeFile(
  new URL("../../../docs/v2-design/evidence/migration-dev-inspection.json", import.meta.url),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
