import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import console from "node:console";

// Offline review gate only. No API requests, secrets, SQL execution or deployment.
export function checkReadiness(plan, observed, now = new Date()) {
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
    plan?.planVersion === 1 &&
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
  for (const [name, floor] of Object.entries(floors)) {
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
  for (const name of [
    "authSchemaVerified",
    "migrationOwnerReviewed",
    "gatewayVerified",
    "privateStorageVerified",
    "rollbackReviewed",
  ]) {
    check(observed?.[name] === true, `${name.replace(/[A-Z]/g, (c) => "_" + c).toUpperCase()}_REQUIRED`);
  }
  return {
    status: blocked.length ? "BLOCKED" : "REVIEW_READY",
    projectRef: "hutqsfftioxtredcjhsy",
    autoApply: false,
    blocked: [...new Set(blocked)],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const plan = JSON.parse(readFileSync(new URL("./plan.json", import.meta.url), "utf8"));
    const observed = JSON.parse(
      readFileSync(process.argv[2] || new URL("./observations.example.json", import.meta.url), "utf8"),
    );
    const result = checkReadiness(plan, observed);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === "BLOCKED" ? 2 : 0;
  } catch {
    console.log(JSON.stringify({ status: "BLOCKED", autoApply: false, blocked: ["INVALID_INPUT"] }));
    process.exitCode = 2;
  }
}
