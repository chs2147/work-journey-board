// Explicit DEV-only, one-time install of the reviewed paged-upload forward SQL (010, C-1a docs/v2-design/81).
// 001/004/007/C1/C2/KeepAlive are installed already and are never re-run here. Never imported by product.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";

const ref = "vsphftnmfzfoufasjttd";
if (
  process.argv.slice(2).join(" ") !== "--apply-010-development --free-usage-confirmed" ||
  process.env.WJB_CLOUD_ENV !== "development" ||
  process.env.WJB_SUPABASE_DEV_PROJECT_REF !== ref
)
  throw Error("EXPLICIT_DEV_APPLY_REQUIRED");
const management = process.env.WJB_SUPABASE_DEV_MANAGEMENT_TOKEN;
if (!management) throw Error("DEV_CREDENTIALS_REQUIRED");

const root = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifest = JSON.parse(read("poc/v2-migration/postgres/paged-upload-review-manifest.json"));
if (manifest.projectRef !== ref || manifest.autoApply !== false) throw Error("REVIEW_MANIFEST_SCOPE");
const reviewed = Object.fromEntries(manifest.sources.map((s) => [s.path, s.sha256]));
const files = {
  apply: "poc/v2-migration/postgres/010-workspace-paged-upload.sql",
  verify: "poc/v2-migration/postgres/012-workspace-paged-upload-verify.sql",
};
for (const path of Object.values(files))
  if (sha(read(path)) !== reviewed[path]) throw Error("REVIEWED_SQL_CHANGED");

const evidence = new URL("docs/v2-design/evidence/migration-dev-paged-upload-install.json", root);
const report = {
  startedAt: new Date().toISOString(),
  projectRef: ref,
  autoApply: false,
  userRequestedDevIntegration: true,
  productionTouched: false,
  sources: Object.values(files).map((path) => ({ path, sha256: reviewed[path] })),
  phases: [],
  applied: false,
};
// The API's read_only=true runs as supabase_read_only_user, which cannot EXECUTE the private
// wjb_migration functions (42501). Checks therefore run as the owner role inside a read-only
// transaction: any write in them fails with 25006 (005 verify used the same owner connection).
async function sql(query, readOnly) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${management}`, "content-type": "application/json" },
    body: JSON.stringify({
      query: readOnly ? "SET TRANSACTION READ ONLY;\n" + query : query,
      read_only: false,
    }),
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) {
    const text = await r.text();
    const code = /(MIGRATION_[A-Z0-9_]+)/.exec(text)?.[1] ?? null;
    throw Object.assign(Error("DEV_SQL_HTTP_" + r.status), { code });
  }
  return r.json();
}
const state = async () =>
  (
    await sql(
      "SELECT wjb_migration.workspace_contract(20) IS NOT NULL AS has007,to_regclass('wjb_migration.upload') IS NOT NULL AS has010;",
      true,
    )
  )[0];
try {
  const role = (
    await sql(
      "SELECT current_user AS role,current_setting('transaction_read_only') AS read_only,r.rolsuper,r.rolbypassrls FROM pg_roles r WHERE r.rolname=current_user;",
      false,
    )
  )[0];
  report.executionRole = role;
  if (role.read_only !== "off" || role.rolsuper) throw Error("WRITE_ROLE_REQUIRED");
  const before = await state();
  report.phases.push({ phase: "preflight", ...before });
  if (!before.has007) throw Error("MIGRATION_007_REQUIRED");
  if (before.has010) throw Error("MIGRATION_010_ALREADY_APPLIED");
  try {
    await sql(read(files.apply).toString("utf8"), false);
    report.phases.push({ phase: "apply", ok: true });
  } catch (error) {
    // A lost response may still have committed: read state, never re-run the bundle.
    const after = await state();
    report.phases.push({ phase: "apply", ok: false, code: error.code ?? null, observedAfter: after });
    if (!after.has010) throw error;
  }
  const verify = (await sql(read(files.verify).toString("utf8"), true))[0]?.jsonb_build_object;
  report.verify = verify;
  report.applied =
    verify?.uploadTables === 2 &&
    verify.tables === 7 &&
    verify.rlsTables === 7 &&
    verify.pagedActions === true &&
    verify.core === true &&
    verify.recordLimit20000 === true &&
    verify.assetLimit10MB === true &&
    verify.quotaDefault === "209715200" &&
    verify.deviceRPC === true &&
    verify.serviceRPC === true &&
    !verify.clientRPC &&
    !verify.directTableAccess &&
    !verify.privateExecute &&
    !verify.unsafeSearchPaths;
  if (!report.applied) throw Error("POST_APPLY_VERIFY_FAILED");
} catch (error) {
  report.failure = {
    type: error.name,
    message: /^[A-Z0-9_]{1,80}$/.test(error.message) ? error.message : null,
    code: error.code ?? null,
  };
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(evidence, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
}
