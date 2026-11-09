import test from "node:test";
import assert from "node:assert/strict";
import { assessOwner } from "./owner-review.mjs";
const now = new Date("2026-11-09T00:05:00Z"),
  manifestHash = "a".repeat(64);
const candidate = { exists: true, superuser: false, bypassRls: true };
const good = {
  project_ref: "hutqsfftioxtredcjhsy",
  read_only: true,
  http_status: 201,
  observed_at: "2026-11-09T00:01:00Z",
  summary: [
    {
      owner_inspection: {
        inspection_role: "supabase_read_only_user",
        candidate_role: "postgres",
        candidate,
        create_schema: true,
        public_create: true,
        public_usage: true,
        auth_usage: true,
        plpgsql_usage: true,
        auth_columns: [
          "sessions.id",
          "sessions.user_id",
          "sessions.not_after",
          "users.id",
          "users.banned_until",
          "users.deleted_at",
        ].map((s) => {
          const [table, column] = s.split(".");
          return { table, column, select: true };
        }),
        api_roles: ["anon", "authenticated", "service_role"].map((role) => ({
          role,
          superuser: false,
          publicCreate: false,
          bypassRls: role === "service_role",
        })),
        auth_rls: ["users", "sessions"].map((table) => ({ table, enabled: true, forced: false })),
      },
    },
  ],
};
const run = (x) => assessOwner(x, { manifestHash, now });
test("verified capabilities pass technical review without authorizing installation", () => {
  const r = run(good);
  assert.equal(r.status, "TECHNICALLY_REVIEWED");
  assert.equal(r.writeCredentialVerified, false);
  assert.equal(r.installationAuthorized, false);
});
test("wrong target rejected", () =>
  assert.equal(run({ ...good, project_ref: "other" }).status, "NEEDS_REVIEW"));
test("stale and future evidence rejected", () => {
  for (const time of ["2026-11-01", "2026-11-10"])
    assert.ok(run({ ...good, observed_at: time }).missing.includes("FRESH_EVIDENCE_REQUIRED"));
});
test("not read-only evidence rejected", () =>
  assert.equal(run({ ...good, read_only: false }).status, "NEEDS_REVIEW"));
test("missing hash rejected", () =>
  assert.ok(assessOwner(good, { now }).missing.includes("BUNDLE_HASH_REQUIRED")));
for (const field of ["create_schema", "public_create", "public_usage", "auth_usage", "plpgsql_usage"])
  test("missing " + field + " rejected", () => {
    const x = globalThis.structuredClone(good);
    x.summary[0].owner_inspection[field] = false;
    assert.equal(run(x).status, "NEEDS_REVIEW");
  });
test("superuser or missing bypass profile needs review", () => {
  for (const patch of [{ superuser: true }, { bypassRls: false }]) {
    const x = globalThis.structuredClone(good);
    Object.assign(x.summary[0].owner_inspection.candidate, patch);
    assert.equal(run(x).status, "NEEDS_REVIEW");
  }
});
test("one missing column privilege rejected", () => {
  const x = globalThis.structuredClone(good);
  x.summary[0].owner_inspection.auth_columns[0].select = false;
  assert.equal(run(x).status, "NEEDS_REVIEW");
});
test("duplicate column cannot replace a required column", () => {
  const x = globalThis.structuredClone(good);
  x.summary[0].owner_inspection.auth_columns[0] = x.summary[0].owner_inspection.auth_columns[1];
  assert.equal(run(x).status, "NEEDS_REVIEW");
});
test("client bypass or schema create rejected", () => {
  for (const patch of [{ bypassRls: true }, { publicCreate: true }]) {
    const x = globalThis.structuredClone(good);
    Object.assign(x.summary[0].owner_inspection.api_roles[0], patch);
    assert.equal(run(x).status, "NEEDS_REVIEW");
  }
});
test("changed Auth RLS profile needs explicit review", () => {
  const x = globalThis.structuredClone(good);
  x.summary[0].owner_inspection.auth_rls[0].forced = true;
  assert.equal(run(x).status, "NEEDS_REVIEW");
});
