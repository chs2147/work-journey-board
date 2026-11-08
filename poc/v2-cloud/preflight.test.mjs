import { URL } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkReadiness } from "./preflight.mjs";
const plan = JSON.parse(readFileSync(new URL("./plan.json", import.meta.url), "utf8"));
const example = JSON.parse(readFileSync(new URL("./observations.example.json", import.meta.url), "utf8"));
const now = new Date("2026-11-08T12:00:00Z");
const good = {
  ...example,
  usageObservedAt: now.toISOString(),
  remainingBytes: {
    database: 10485760,
    storage: 1048576,
    egress: 10485760,
  },
  sessionPolicyObservedAt: now.toISOString(),
  authSchemaVerified: true,
  migrationOwnerReviewed: true,
  gatewayVerified: true,
  privateStorageVerified: true,
  rollbackReviewed: true,
};
test("complete operator review returns ready but never auto-applies", () =>
  assert.deepEqual(checkReadiness(plan, good, now), {
    status: "REVIEW_READY",
    projectRef: plan.projectRef,
    autoApply: false,
    blocked: [],
  }));
test("actual unknown example is blocked", () => {
  const r = checkReadiness(plan, example, now);
  assert.equal(r.status, "BLOCKED");
  assert.ok(r.blocked.includes("USAGE_STALE_OR_MISSING"));
  assert.ok(r.blocked.includes("GATEWAY_VERIFIED_REQUIRED"));
});
for (const [name, changed, code] of [
  ["wrong project", { projectRef: "other" }, "TARGET_MISMATCH"],
  ["paid plan", { plan: "pro" }, "FREE_ONLY_REQUIRED"],
  ["unknown plan source", { planSource: "guessed" }, "PLAN_SOURCE_REQUIRED"],
  ["stale usage", { usageObservedAt: "2026-11-06T00:00:00Z" }, "USAGE_STALE_OR_MISSING"],
  ["future usage", { usageObservedAt: "2026-11-09T00:00:00Z" }, "USAGE_STALE_OR_MISSING"],
  ["invalid usage date", { usageObservedAt: "wrong" }, "USAGE_STALE_OR_MISSING"],
  ["missing session inspection", { sessionPolicyObservedAt: null }, "SESSION_POLICY_STALE_OR_MISSING"],
  [
    "unsupported inactivity",
    { sessionPolicy: { ...good.sessionPolicy, inactivitySeconds: 3600 } },
    "SESSION_POLICY_NOT_SUPPORTED",
  ],
  ["unreviewed rollback", { rollbackReviewed: false }, "ROLLBACK_REVIEWED_REQUIRED"],
  ["unverified storage", { privateStorageVerified: false }, "PRIVATE_STORAGE_VERIFIED_REQUIRED"],
])
  test(name, () => assert.ok(checkReadiness(plan, { ...good, ...changed }, now).blocked.includes(code)));
for (const name of ["database", "storage", "egress"]) {
  test(`${name} missing or low headroom blocks`, () => {
    for (const value of [null, -1, 0, "999999999", Number.MAX_SAFE_INTEGER + 1]) {
      const r = checkReadiness(
        plan,
        { ...good, remainingBytes: { ...good.remainingBytes, [name]: value } },
        now,
      );
      assert.ok(r.blocked.includes(`INSUFFICIENT_${name.toUpperCase()}_HEADROOM`));
    }
  });
}
for (const [name, changed, code] of [
  ["auto apply cannot be enabled", { autoApply: true }, "FREE_ONLY_REQUIRED"],
  ["budget cannot be raised", { monthlyBudgetKRW: 1 }, "FREE_ONLY_REQUIRED"],
  ["bucket cannot be public", { bucketPublic: true }, "SCOPE_CHANGED"],
  ["bucket cannot be replaced", { bucket: "existing-data" }, "SCOPE_CHANGED"],
  ["signed urls not enabled", { signedDownloadURLs: true }, "SCOPE_CHANGED"],
  [
    "scope cannot be expanded",
    { sample: { users: 3, assets: 100, bytesPerAsset: 65536 } },
    "SAMPLE_SCOPE_CHANGED",
  ],
  [
    "floors cannot be relaxed",
    { requiredRemainingBytes: { database: 0, storage: 0, egress: 0 } },
    "INSUFFICIENT_DATABASE_HEADROOM",
  ],
])
  test(name, () => assert.ok(checkReadiness({ ...plan, ...changed }, good, now).blocked.includes(code)));
test("invalid input fails closed without outputting supplied data", () => {
  const r = checkReadiness(null, null, now);
  assert.equal(r.status, "BLOCKED");
  assert.equal(r.autoApply, false);
});
