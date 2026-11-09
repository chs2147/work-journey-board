import test from "node:test";
import assert from "node:assert/strict";
import { renderDevelopment } from "./build.mjs";
const files = renderDevelopment(),
  m = JSON.parse(files["manifest.json"]);
test("development target and region fixed with autoApply false", () => {
  assert.equal(m.projectRef, "vsphftnmfzfoufasjttd");
  assert.equal(m.region, "ap-northeast-2");
  assert.equal(m.autoApply, false);
});
test("render deterministic", () => assert.deepEqual(renderDevelopment(), files));
test("one outer install transaction wraps existing modules and cron", () => {
  assert.equal(files["install.sql"].match(/^BEGIN;/gm)?.length, 1);
  assert.equal(files["install.sql"].match(/^COMMIT;/gm)?.length, 1);
  assert.ok(files["install.sql"].includes("CREATE EXTENSION IF NOT EXISTS pg_cron"));
});
test("daily job matches reference cadence and singleton", () => {
  assert.ok(files["install.sql"].includes("'keepalive_ping','0 3 * * *'"));
  assert.ok(files["install.sql"].includes("CHECK(id=1)"));
});
test("client and server API roles get no heartbeat table access", () =>
  assert.ok(
    files["install.sql"].includes(
      "REVOKE ALL ON public.keepalive_pings FROM PUBLIC,anon,authenticated,service_role",
    ),
  ));
test("existing cron job cannot be silently replaced", () =>
  assert.ok(files["install.sql"].includes("KEEPALIVE_JOB_COLLISION")));
test("rollback and resume markers cannot target production", () => {
  for (const n of ["rollback.sql", "resume.sql"]) {
    assert.ok(files[n].includes(m.projectRef));
    assert.ok(!files[n].includes("hutqsfftioxtredcjhsy"));
  }
});
test("rollback preserves shared cron extension and heartbeat", () => {
  assert.ok(!files["rollback.sql"].includes("keepalive_pings"));
  assert.ok(!/DROP EXTENSION/i.test(files["rollback.sql"]));
});
