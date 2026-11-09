import test from "node:test";
import assert from "node:assert/strict";
import { resolveCloudEnvironment } from "./cloud-environment.mjs";
const dev = {
  WJB_CLOUD_ENV: "development",
  WJB_SUPABASE_DEV_PROJECT_REF: "vsphftnmfzfoufasjttd",
  WJB_SUPABASE_DEV_MANAGEMENT_TOKEN: "fictional-dev",
  WJB_SUPABASE_PROD_PROJECT_REF: "hutqsfftioxtredcjhsy",
  WJB_SUPABASE_PROD_MANAGEMENT_TOKEN: "fictional-prod",
};
test("development uses only development credentials", () => {
  const r = resolveCloudEnvironment(dev);
  assert.equal(r.managementToken, "fictional-dev");
  assert.equal(r.region, "ap-northeast-2");
});
test("production inspection uses only production credentials", () => {
  const r = resolveCloudEnvironment({ ...dev, WJB_CLOUD_ENV: "production" });
  assert.equal(r.managementToken, "fictional-prod");
  assert.equal(r.region, "ap-northeast-1");
});
test("missing or unknown environment cannot fall back", () => {
  for (const value of [undefined, "", "staging", "__proto__"])
    assert.throws(() => resolveCloudEnvironment({ ...dev, WJB_CLOUD_ENV: value }), /CLOUD_ENV_REQUIRED/);
});
test("development does not require a production token", () =>
  assert.equal(
    resolveCloudEnvironment({ ...dev, WJB_SUPABASE_PROD_MANAGEMENT_TOKEN: undefined }).environment,
    "development",
  ));
test("development never borrows production or legacy credentials", () =>
  assert.throws(
    () =>
      resolveCloudEnvironment({
        ...dev,
        WJB_SUPABASE_DEV_MANAGEMENT_TOKEN: undefined,
        WJB_SUPABASE_MANAGEMENT_TOKEN: "legacy",
      }),
    /SELECTED_TOKEN_REQUIRED/,
  ));
test("wrong selected ref is rejected even when legacy ref is correct", () =>
  assert.throws(
    () =>
      resolveCloudEnvironment({
        ...dev,
        WJB_SUPABASE_DEV_PROJECT_REF: dev.WJB_SUPABASE_PROD_PROJECT_REF,
        WJB_SUPABASE_PROJECT_REF: dev.WJB_SUPABASE_DEV_PROJECT_REF,
      }),
    /PROJECT_REF_MISMATCH/,
  ));
test("a development-only install cannot target production", () =>
  assert.throws(
    () =>
      resolveCloudEnvironment({ ...dev, WJB_CLOUD_ENV: "production" }, { operation: "install-development" }),
    /PRODUCTION_WRITE_DENIED/,
  ));
test("environment selection is not a generic write authorization", () =>
  assert.throws(() => resolveCloudEnvironment(dev, { operation: "drop-production" }), /UNKNOWN_OPERATION/));
test("credential is not serialized and result is immutable", () => {
  const r = resolveCloudEnvironment(dev);
  assert.ok(!JSON.stringify(r).includes("fictional-dev"));
  assert.ok(!Object.keys(r).includes("managementToken"));
  assert.ok(Object.isFrozen(r));
});
test("invalid header content cannot reach a request", () =>
  assert.throws(
    () => resolveCloudEnvironment({ ...dev, WJB_SUPABASE_DEV_MANAGEMENT_TOKEN: "token\nextra" }),
    /SELECTED_TOKEN_REQUIRED/,
  ));
