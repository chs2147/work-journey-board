// Explicit DEV-only, one-time install of the reviewed lifecycle forward SQL (031, G-5 docs/v2-design/100).
// 001…028 are installed already and are never re-run here. Never imported by product. Also schedules the daily
// unused-image sweep (pg_cron, SQL only — marks images; the gateway deletes the private objects later).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";

const ref = "vsphftnmfzfoufasjttd";
if (
  process.argv.slice(2).join(" ") !== "--apply-031-development --free-usage-confirmed" ||
  process.env.WJB_CLOUD_ENV !== "development" ||
  process.env.WJB_SUPABASE_DEV_PROJECT_REF !== ref
)
  throw Error("EXPLICIT_DEV_APPLY_REQUIRED");
const management = process.env.WJB_SUPABASE_DEV_MANAGEMENT_TOKEN;
if (!management) throw Error("DEV_CREDENTIALS_REQUIRED");

const root = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifest = JSON.parse(read("poc/v2-migration/postgres/lifecycle-review-manifest.json"));
if (manifest.projectRef !== ref || manifest.autoApply !== false) throw Error("REVIEW_MANIFEST_SCOPE");
const reviewed = Object.fromEntries(manifest.sources.map((s) => [s.path, s.sha256]));
const files = {
  apply: "poc/v2-migration/postgres/031-lifecycle.sql",
  verify: "poc/v2-migration/postgres/032-lifecycle-verify.sql",
};
for (const path of Object.values(files))
  if (sha(read(path)) !== reviewed[path]) throw Error("REVIEWED_SQL_CHANGED");

const evidence = new URL("docs/v2-design/evidence/migration-dev-lifecycle-install.json", root);
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
    const code = /((?:MIGRATION|SYNC|READ)_[A-Z0-9_]+)/.exec(text)?.[1] ?? null;
    throw Object.assign(Error("DEV_SQL_HTTP_" + r.status), { code });
  }
  return r.json();
}
const state = async () =>
  (
    await sql(
      "SELECT to_regnamespace('wjb_ops') IS NOT NULL AS has028,to_regnamespace('wjb_life') IS NOT NULL AS has031;",
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
  if (!before.has028) throw Error("MIGRATION_028_REQUIRED");
  if (before.has031) throw Error("MIGRATION_031_ALREADY_APPLIED");
  try {
    await sql(read(files.apply).toString("utf8"), false);
    report.phases.push({ phase: "apply", ok: true });
  } catch (error) {
    // A lost response may still have committed: read state, never re-run the bundle.
    const after = await state();
    report.phases.push({ phase: "apply", ok: false, code: error.code ?? null, observedAfter: after });
    if (!after.has031) throw error;
  }
  const verify = (await sql(read(files.verify).toString("utf8"), true))[0]?.jsonb_build_object;
  report.verify = verify;
  report.applied =
    verify?.schema === true &&
    verify.tables === true &&
    verify.userServiceOnly === true &&
    verify.workerServiceOnly === true &&
    verify.searchPath === true &&
    verify.lifeClosed === true &&
    verify.grace === "7 days";
  if (!report.applied) throw Error("POST_APPLY_VERIFY_FAILED");
  // 매일 03:10 KST(18:10 UTC) 안 쓰는 그림 표시·넘기기 — SQL만(실물은 게이트웨이가 다음 요청 때 지움). 다시 실행해도 하나
  const cron = await sql(
    "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') AS has_cron;",
    true,
  );
  if (cron[0]?.has_cron) {
    await sql(
      "SELECT cron.schedule('wjb-life-sweep','10 18 * * *',$$SELECT wjb_life.sweep_orphans(clock_timestamp())$$);",
      false,
    );
    report.phases.push({ phase: "schedule", job: "wjb-life-sweep", cron: "10 18 * * *" });
  } else report.phases.push({ phase: "schedule", skipped: "pg_cron not installed" });
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
