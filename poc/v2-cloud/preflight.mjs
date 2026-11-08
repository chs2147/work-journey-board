import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { checkBundle } from "./bundle.mjs";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import console from "node:console";

// Offline review gate only. No API requests, secrets, SQL execution or deployment.
export function checkReadiness(plan, observed, now = new Date(), { phase = "cloud-validation" } = {}) {
  const sqlPhase = plan?.planVersion === 2 && phase === "sql-install";
  const blocked = [];
  const check = (ok, code) => {
    if (!ok) blocked.push(code);
  };
  const fresh = (value) =>
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    now.getTime() >= Date.parse(value) &&
    now.getTime() - Date.parse(value) <= 86400000;
  check(
    [1, 2].includes(plan?.planVersion) &&
      plan?.projectRef === "hutqsfftioxtredcjhsy" &&
      observed?.projectRef === plan.projectRef,
    "TARGET_MISMATCH",
  );
  check(
    plan?.monthlyBudgetKRW === 0 && plan?.autoApply === false && observed?.plan === "free",
    "FREE_ONLY_REQUIRED",
  );
  check(
    plan?.region === "ap-northeast-1" &&
      plan?.schema === "wjb_v2_cloud" &&
      plan?.bucket === "wjb-v2-poc-private" &&
      plan?.bucketPublic === false &&
      plan?.transport === "server-proxy" &&
      plan?.signedUploadURLs === false &&
      plan?.signedDownloadURLs === false,
    "SCOPE_CHANGED",
  );
  check(
    plan?.sample?.users === 2 && plan?.sample?.assets === 2 && plan?.sample?.bytesPerAsset === 4096,
    "SAMPLE_SCOPE_CHANGED",
  );
  check(["user-dashboard", "provider-api"].includes(observed?.planSource), "PLAN_SOURCE_REQUIRED");
  check(fresh(observed?.usageObservedAt), "USAGE_STALE_OR_MISSING");
  const floors = { database: 10485760, storage: 1048576, egress: 10485760 };
  for (const [name, floor] of Object.entries(floors).filter(([name]) => !sqlPhase || name === "database")) {
    const remaining = observed?.remainingBytes?.[name];
    check(
      plan?.requiredRemainingBytes?.[name] === floor && Number.isSafeInteger(remaining) && remaining >= floor,
      `INSUFFICIENT_${name.toUpperCase()}_HEADROOM`,
    );
  }
  check(fresh(observed?.sessionPolicyObservedAt), "SESSION_POLICY_STALE_OR_MISSING");
  for (const policy of [plan?.sessionPolicy, observed?.sessionPolicy]) {
    check(
      policy?.timeboxSeconds === 0 && policy?.inactivitySeconds === 0 && policy?.singleSession === false,
      "SESSION_POLICY_NOT_SUPPORTED",
    );
  }
  for (const name of sqlPhase
    ? ["authSchemaVerified", "migrationOwnerReviewed", "rollbackReviewed"]
    : [
        "authSchemaVerified",
        "migrationOwnerReviewed",
        "gatewayVerified",
        "privateStorageVerified",
        "rollbackReviewed",
      ]) {
    check(observed?.[name] === true, `${name.replace(/[A-Z]/g, (c) => "_" + c).toUpperCase()}_REQUIRED`);
  }
  if (plan?.planVersion === 2) {
    check(["sql-install", "cloud-validation"].includes(phase), "PHASE_NOT_SUPPORTED");
    const expectedTables = [
      "wjb_v2_cloud.blocked_session",
      "wjb_gateway.workspace",
      "wjb_gateway.device",
      "wjb_gateway.asset",
      "wjb_gateway.io_intent",
      "wjb_gateway.recovery_audit",
    ];
    const expectedRpc = [
      "wjb_v2_session_active(uuid,uuid)",
      "wjb_v2_revoke_session(uuid,uuid)",
      "wjb_v2_asset_command(jsonb)",
      "wjb_v2_recovery_catalog(jsonb)",
    ];
    check(
      plan.metadataSchema === "wjb_gateway" &&
        plan.rollbackMode === "empty-only" &&
        JSON.stringify(plan.objects?.tables) === JSON.stringify(expectedTables) &&
        JSON.stringify(plan.objects?.publicFunctions) === JSON.stringify(expectedRpc),
      "BUNDLE_SCOPE_CHANGED",
    );
    const digest = createHash("sha256")
      .update(JSON.stringify(plan, null, 2) + "\n")
      .digest("hex");
    check(
      observed?.bundleReviewed === true && observed?.bundleManifestSha256 === digest,
      "BUNDLE_REVIEW_REQUIRED",
    );
    check(
      observed?.deploymentCollisionFree === true && fresh(observed?.targetInspectedAt),
      "TARGET_INSPECTION_REQUIRED",
    );
    check(observed?.dataApiPrivateSchemasHidden === true, "PRIVATE_SCHEMA_EXPOSURE_REVIEW_REQUIRED");
  }
  return {
    status: blocked.length ? "BLOCKED" : "REVIEW_READY",
    projectRef: "hutqsfftioxtredcjhsy",
    autoApply: false,
    ...(plan?.planVersion === 2
      ? {
          phase,
          deferred: sqlPhase
            ? ["GATEWAY_RUNTIME_VALIDATION", "PRIVATE_STORAGE_VALIDATION", "ORG_STORAGE_EGRESS_USAGE"]
            : [],
        }
      : {}),
    blocked: [...new Set(blocked)],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const bundled = args.includes("--bundle");
    const phaseOption = args.find((a) => a.startsWith("--phase="));
    const phase = phaseOption ? phaseOption.slice(8) : "cloud-validation";
    if (args.some((a) => a.startsWith("--") && a !== "--bundle" && !a.startsWith("--phase=")))
      throw new Error();
    const observationPath = args.find((a) => !a.startsWith("--"));
    if (bundled) checkBundle();
    const plan = JSON.parse(
      readFileSync(new URL(bundled ? "./bundle/manifest.json" : "./plan.json", import.meta.url), "utf8"),
    );
    const observed = JSON.parse(
      readFileSync(observationPath || new URL("./observations.example.json", import.meta.url), "utf8"),
    );
    const result = checkReadiness(plan, observed, new Date(), { phase });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === "BLOCKED" ? 2 : 0;
  } catch {
    console.log(JSON.stringify({ status: "BLOCKED", autoApply: false, blocked: ["INVALID_INPUT"] }));
    process.exitCode = 2;
  }
}
