import test from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "./audit.mjs";

const done = {
  sql: {
    all: true,
    missing: [],
    admins: 1,
    closed: true,
    cron: "keepalive-ping,wjb-life-sweep,wjb-ops-metrics",
  },
  bucket: { exists: true, public: false },
  functions: ["wjb-gateway"],
  secretNames: ["SUPABASE_URL"],
  auth: { disableSignup: true, otpTemplate: true },
  me: { status: 401 },
};

test("G-2 점검: 끝난 상태면 모두 통과", () => {
  const c = evaluate(done);
  assert.equal(c.filter((x) => !x.ok).length, 0, JSON.stringify(c));
});

test("G-2 점검: 빠진 SQL·공개 버킷·남은 예전 비밀·가입 열림·관리자 없음은 각각 실패로", () => {
  const c = evaluate({
    ...done,
    sql: { ...done.sql, all: false, missing: ["m037"], admins: 0 },
    bucket: { exists: true, public: true },
    secretNames: ["WJB_GATEWAY_SERVICE_ROLE_JWT"],
    auth: { disableSignup: false, otpTemplate: false },
    me: { status: 503 },
  });
  const bad = c.filter((x) => !x.ok).map((x) => x.name);
  assert.deepEqual(bad.sort(), [
    "admin_set",
    "bucket_private",
    "email_otp_template",
    "gateway_answers",
    "legacy_gateway_secret_removed",
    "signup_invite_only",
    "sql_001_to_037",
  ]);
  assert.equal(c.find((x) => x.name === "sql_001_to_037").note, "m037");
});
