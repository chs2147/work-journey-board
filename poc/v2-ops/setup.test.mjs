// G-2(docs/v2-design/103) 운영 세우기 도구 시험.
// 1) 순수: 대상 고르기(개발·운영 안 섞임, 운영 쓰기 두 번 확인), 검토 목록 = 지금 파일, 단계 순서 = 절차서.
// 2) 리허설: 빈 PostgreSQL 17(Docker, run-local.py와 같은 고정 이미지)에 같은 단계 목록을 처음부터 → 중간에 끊고 이어 가기 →
//    끝까지. 로컬 데몬이 없으면 건너뜀(실서버·실제 열쇠 쓰지 않음, 네트워크 없는 컨테이너).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { opsTarget, evidenceName } from "./target.mjs";
import {
  STEPS,
  applySql,
  applyBucket,
  probeAll,
  manifestDrift,
  sourceFiles,
  normalize,
  SCHEDULES,
} from "./setup.mjs";

const DEV = "vsphftnmfzfoufasjttd";
const PROD = "hutqsfftioxtredcjhsy";
const token = (c) => "sbp_" + c.repeat(40);
const devEnv = {
  WJB_CLOUD_ENV: "development",
  WJB_SUPABASE_DEV_PROJECT_REF: DEV,
  WJB_SUPABASE_DEV_MANAGEMENT_TOKEN: token("d"),
};
const prodEnv = {
  WJB_CLOUD_ENV: "production",
  WJB_SUPABASE_PROD_PROJECT_REF: PROD,
  WJB_SUPABASE_PROD_MANAGEMENT_TOKEN: token("p"),
  WJB_SUPABASE_PROD_SERVICE_ROLE_KEY: "sb_secret_" + "p".repeat(30),
};

test("target: development and production never mix (flag, WJB_CLOUD_ENV, ref, variable prefix)", () => {
  const d = opsTarget(["--audit-development"], devEnv, { action: "audit" });
  assert.equal(d.ref, DEV);
  assert.equal(d.bucket, "wjb-v2-dev-assets");
  const p = opsTarget(["--audit-production"], prodEnv, { action: "audit" });
  assert.equal(p.ref, PROD);
  assert.equal(p.bucket, "wjb-v2-assets");
  // 운영 플래그 + 개발 선택, 개발 플래그 + 운영 선택
  assert.throws(() => opsTarget(["--audit-production"], devEnv, { action: "audit" }), /CLOUD_ENV_MISMATCH/);
  assert.throws(() => opsTarget(["--audit-development"], prodEnv, { action: "audit" }), /CLOUD_ENV_MISMATCH/);
  // 운영 선택인데 개발 ID, 운영 변수 대신 개발 변수만
  assert.throws(
    () =>
      opsTarget(
        ["--audit-production"],
        { ...prodEnv, WJB_SUPABASE_PROD_PROJECT_REF: DEV },
        { action: "audit" },
      ),
    /PROJECT_REF_MISMATCH/,
  );
  assert.throws(
    () =>
      opsTarget(
        ["--audit-production"],
        { ...devEnv, WJB_CLOUD_ENV: "production", WJB_SUPABASE_PROD_PROJECT_REF: PROD },
        { action: "audit" },
      ),
    /MANAGEMENT_TOKEN_REQUIRED/,
  );
  // 개발 도구는 운영 열쇠를 빌리지 않는다
  assert.throws(
    () =>
      opsTarget(
        ["--audit-development"],
        {
          WJB_CLOUD_ENV: "development",
          WJB_SUPABASE_DEV_PROJECT_REF: DEV,
          WJB_SUPABASE_PROD_MANAGEMENT_TOKEN: token("p"),
        },
        { action: "audit" },
      ),
    /MANAGEMENT_TOKEN_REQUIRED/,
  );
  assert.throws(
    () => opsTarget(["--audit-staging"], devEnv, { action: "audit" }),
    /EXPLICIT_TARGET_REQUIRED/,
  );
  assert.throws(() => opsTarget([], devEnv, { action: "audit" }), /EXPLICIT_TARGET_REQUIRED/);
});

test("target: production writes need --production-confirmed; reads and development refuse it", () => {
  assert.throws(
    () => opsTarget(["--deploy-production"], prodEnv, { action: "deploy", write: true }),
    /PRODUCTION_CONFIRM_REQUIRED/,
  );
  assert.equal(
    opsTarget(["--deploy-production", "--production-confirmed"], prodEnv, { action: "deploy", write: true })
      .write,
    true,
  );
  assert.throws(
    () =>
      opsTarget(["--deploy-development", "--production-confirmed"], devEnv, {
        action: "deploy",
        write: true,
      }),
    /PRODUCTION_CONFIRM_ONLY_FOR_PRODUCTION/,
  );
  assert.throws(
    () => opsTarget(["--audit-production", "--production-confirmed"], prodEnv, { action: "audit" }),
    /PRODUCTION_CONFIRM_NOT_NEEDED/,
  );
  // 위치 인자 개수 고정(내보내기 출력 폴더 1개)
  assert.deepEqual(opsTarget(["--export-production", "/x"], prodEnv, { action: "export", args: 1 }).args, [
    "/x",
  ]);
  assert.throws(
    () => opsTarget(["--export-production"], prodEnv, { action: "export", args: 1 }),
    /EXPLICIT_TARGET_REQUIRED/,
  );
  assert.throws(
    () => opsTarget(["--audit-production", "--extra"], prodEnv, { action: "audit" }),
    /EXPLICIT_TARGET_REQUIRED/,
  );
  // 허용하지 않는 환경
  assert.throws(
    () =>
      opsTarget(["--apply-sql-development"], devEnv, {
        action: "apply-sql",
        write: true,
        environments: ["production"],
      }),
    /EXPLICIT_TARGET_REQUIRED/,
  );
});

test("target: production server key must be a new secret key; secrets stay out of serialization", () => {
  const p = opsTarget(["--export-production", "/x"], prodEnv, {
    action: "export",
    args: 1,
    needs: ["management", "serverKey"],
  });
  assert.ok(p.serverKey.startsWith("sb_secret_"));
  assert.ok(!JSON.stringify(p).includes("sb_secret_") && !JSON.stringify(p).includes("sbp_"));
  assert.throws(
    () =>
      opsTarget(
        ["--export-production", "/x"],
        { ...prodEnv, WJB_SUPABASE_PROD_SERVICE_ROLE_KEY: "eyJhbGciOi.legacy.jwt" },
        {
          action: "export",
          args: 1,
          needs: ["serverKey"],
        },
      ),
    /SERVER_KEY_REQUIRED/,
  );
  assert.equal(evidenceName(p, "x"), "docs/v2-design/evidence/prod-x.json");
});

test("setup: reviewed manifest equals current files; order matches runbook 103 step 2", () => {
  assert.deepEqual(manifestDrift(), []);
  assert.deepEqual(
    STEPS.map((s) => s.id),
    [
      "session-guard",
      "gateway-metadata",
      "gateway-recovery",
      "001",
      "004",
      "007",
      "010",
      "013",
      "016",
      "019",
      "022",
      "025",
      "028",
      "031",
      "034",
      "037",
    ],
  );
  assert.ok(
    sourceFiles().every((p) => !/rollback/.test(p)),
    "rollback files are never run by the tool",
  );
  assert.deepEqual(
    SCHEDULES.map((s) => s.job),
    ["wjb-life-sweep", "wjb-ops-metrics"],
  );
  assert.equal(normalize("t"), true);
  assert.deepEqual(normalize('{"a":1}'), { a: 1 });
});

// ── 로컬 리허설 ─────────────────────────────────────────────────────────────
const IMAGE_DIGEST = "sha256:665dc7b37ac52a17e298511414c21d23ffa4e6a6ef6225b3e5d59c7afb35e994";
const IMAGES = ["postgres@" + IMAGE_DIGEST, "mirror.gcr.io/library/postgres@" + IMAGE_DIGEST];
const dockerEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) => !k.startsWith("WJB_SUPABASE_") && !k.startsWith("SUPABASE_") && !k.startsWith("DOCKER_"),
  ),
);
const docker = (...args) =>
  spawnSync("docker", args, { env: dockerEnv, encoding: "utf8", maxBuffer: 64 << 20 });
const hasDocker = docker("info").status === 0;

test(
  "rehearsal: empty PostgreSQL 17 → same steps from scratch, resume after a stop, re-run is a no-op",
  { skip: !hasDocker && "no local Docker daemon", timeout: 300000 },
  async () => {
    let image = IMAGES.find((i) => docker("image", "inspect", i).status === 0);
    if (!image)
      for (const i of IMAGES)
        if (docker("pull", i).status === 0) {
          image = i;
          break;
        }
    assert.ok(image, "pinned PostgreSQL image unavailable");
    const name = "wjb-ops-setup-" + randomBytes(6).toString("hex");
    const run = docker(
      "run",
      "-d",
      "--name",
      name,
      "--label",
      "wjb.poc=ops-setup",
      "--network",
      "none",
      "--memory",
      "512m",
      "--tmpfs",
      "/var/lib/postgresql/data:rw,size=256m",
      "-e",
      "POSTGRES_HOST_AUTH_METHOD=trust",
      image,
      "-c",
      "listen_addresses=",
    );
    assert.equal(run.status, 0, run.stderr);
    try {
      for (let i = 0; i < 100; i++) {
        const logs = docker("logs", name);
        if (
          (logs.stdout + logs.stderr).includes("PostgreSQL init process complete") &&
          docker("exec", name, "pg_isready", "-U", "postgres").status === 0
        )
          break;
        await new Promise((r) => setTimeout(r, 200));
      }
      const psql = (user, sql) => {
        const r = spawnSync(
          "docker",
          ["exec", "-i", name, "psql", "-U", user, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qAt"],
          {
            input: sql,
            env: dockerEnv,
            encoding: "utf8",
            maxBuffer: 64 << 20,
          },
        );
        if (r.status !== 0) throw Object.assign(Error("LOCAL_SQL_FAILED"), { stderr: r.stderr });
        return r.stdout;
      };
      // Supabase와 같은 역할 모양(run-local.py와 같음): 소유자 = 슈퍼유저 아님, 서비스·로그인 역할, auth·storage 최소 표
      psql(
        "postgres",
        "CREATE ROLE service_role NOLOGIN NOSUPERUSER BYPASSRLS;CREATE ROLE authenticated NOLOGIN;CREATE ROLE anon NOLOGIN;" +
          "CREATE ROLE wjb_owner LOGIN NOSUPERUSER BYPASSRLS;GRANT service_role,authenticated,anon TO wjb_owner;" +
          "GRANT CREATE ON DATABASE postgres TO wjb_owner;GRANT USAGE,CREATE ON SCHEMA public TO wjb_owner;" +
          "CREATE SCHEMA auth AUTHORIZATION wjb_owner;CREATE SCHEMA storage AUTHORIZATION wjb_owner;SET ROLE wjb_owner;" +
          "CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,banned_until timestamptz,deleted_at timestamptz);" +
          "CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id),not_after timestamptz);" +
          "CREATE TABLE storage.buckets(id text PRIMARY KEY,name text NOT NULL,public boolean DEFAULT false,file_size_limit bigint,allowed_mime_types text[]);",
      );
      const db = {
        exec: async (q) => void psql("wjb_owner", q),
        value: async (q, readOnly) => {
          const out = psql(
            "wjb_owner",
            (readOnly ? "BEGIN READ ONLY;\n" : "") + q + (readOnly ? "\nCOMMIT;" : ""),
          ).trim();
          return normalize(out.split("\n").filter(Boolean).at(-1) ?? null);
        },
      };
      assert.deepEqual(await probeAll(db), { present: [], next: "session-guard" });

      // 중간에 멈춤: 010 적용이 실패한 척(응답 없음·실제로 안 들어감) → 앞 단계까지만 남는다
      const stopAt = "poc/v2-migration/postgres/010-workspace-paged-upload.sql";
      const { readFileSync } = await import("node:fs");
      const real = (p) => readFileSync(new URL("../../" + p, import.meta.url), "utf8");
      const first = {};
      await assert.rejects(
        applySql(db, first, { readFile: (p) => (p === stopAt ? "SELECT 1/0;" : real(p)) }),
        (e) => e.step === "010",
      );
      assert.deepEqual(
        first.steps.map((s) => s.id),
        ["session-guard", "gateway-metadata", "gateway-recovery", "001", "004", "007"],
      );
      assert.ok(first.steps.every((s) => s.state === "applied" && s.verified !== false));
      assert.equal((await probeAll(db)).next, "010");

      // 이어 가기: 앞은 그대로 두고 010부터 끝까지, 모두 확인 SQL 통과
      const second = await applySql(db, {});
      assert.deepEqual(
        second.steps.filter((s) => s.state === "already").map((s) => s.id),
        first.steps.map((s) => s.id),
      );
      const applied = second.steps.filter((s) => s.state === "applied");
      assert.deepEqual(
        applied.map((s) => s.id),
        ["010", "013", "016", "019", "022", "025", "028", "031", "034", "037"],
      );
      assert.ok(applied.every((s) => s.verified === true));
      assert.deepEqual(await probeAll(db), { present: STEPS.map((s) => s.id), next: null });

      // 끝난 뒤 다시 돌리면 아무것도 하지 않는다(각 SQL은 두 번 실행하면 ALREADY_APPLIED로 실패하므로 건너뛰어야 통과)
      const third = await applySql(db, {});
      assert.ok(third.steps.every((s) => s.state === "already"));

      // 버킷: 없으면 만들고, 다시 돌리면 그대로, 설정이 다르면 멈춤
      const b1 = await applyBucket(db, "wjb-v2-assets", {});
      assert.deepEqual(b1.bucket, { id: "wjb-v2-assets", created: true, matches: true });
      const b2 = await applyBucket(db, "wjb-v2-assets", {});
      assert.equal(b2.bucket.created, false);
      psql("wjb_owner", "UPDATE storage.buckets SET public=true WHERE id='wjb-v2-assets';");
      await assert.rejects(applyBucket(db, "wjb-v2-assets", {}), /BUCKET_SETTINGS_DIFFER/);
    } finally {
      execFileSync("docker", ["rm", "-f", "-v", name], { env: dockerEnv, stdio: "ignore" });
    }
  },
);

test("setup: a lost apply response is re-checked, never re-run; a real failure stops at that step", async () => {
  const have = new Set();
  const calls = [];
  const fake = (loseOn, failOn) => ({
    exec: async (q) => {
      const step = STEPS.find((s) => s.apply === q);
      calls.push(step.id);
      if (step.id === failOn) throw Object.assign(Error("SQL_HTTP_500"), { code: null });
      have.add(step.id);
      if (step.id === loseOn) throw Object.assign(Error("SQL_HTTP_504"), { code: null });
    },
    value: async (q) => {
      const probe = STEPS.find((s) => s.probe === q);
      if (probe) return have.has(probe.id);
      // before·verify: 그 단계 검사를 통과하는 값
      const s = STEPS.find((x) => x.verify === q || x.before?.file === q);
      return s && fakeVerify(s, q);
    },
  });
  const r = await applySql(fake("019", null), {}, { readFile: (p) => p });
  assert.equal(calls.filter((c) => c === "019").length, 1);
  assert.equal(r.steps.find((s) => s.id === "019").responseLost, true);
  have.clear();
  calls.length = 0;
  await assert.rejects(applySql(fake(null, "022"), {}, { readFile: (p) => p }), (e) => e.step === "022");
  assert.equal(calls.at(-1), "022");
});

/** 각 확인 SQL의 통과 값(STEPS check 기준을 만족하는 최소 값) */
function fakeVerify(step, q) {
  if (step.before?.file === q) return { sessionGuard: true, assetCommand: true };
  const pass = {
    "001": {
      tables: 3,
      rlsTables: 3,
      functions: 6,
      unsafeSearchPaths: 0,
      binaryColumns: 0,
      ownerSuperuser: false,
      serviceExecute: true,
    },
    "004": { tables: 5, rlsTables: 5, serviceRPC: true },
    "007": {
      db20Contract: true,
      db20Tables: 30,
      profileCheck: true,
      tables: 5,
      rlsTables: 5,
      serviceRPC: true,
    },
    "010": {
      uploadTables: 2,
      tables: 7,
      rlsTables: 7,
      pagedActions: true,
      core: true,
      recordLimit20000: true,
      assetLimit10MB: true,
      quotaDefault: "209715200",
      deviceRPC: true,
      serviceRPC: true,
    },
    "013": { pagingFree: true, staleCleanup: true, serviceRPC: true, searchPath: true },
    "016": { readRPC: true, readServiceOnly: true, readSearchPath: true, publishByIoVersion: true },
    "019": {
      syncRPC: true,
      syncServiceOnly: true,
      syncSearchPath: true,
      inlineImageGuard: true,
      assetGateSync: true,
      tables: 4,
      rlsTables: 4,
      unsafeSearchPaths: 0,
    },
    "022": { retention: true, index: true, syncServiceOnly: true, syncSearchPath: true },
    "025": { label: true, helper: true, readServiceOnly: true, readSearchPath: true },
    "028": {
      schema: true,
      triggers: true,
      accountServiceOnly: true,
      accountSearchPath: true,
      opsClosed: true,
    },
    "031": {
      schema: true,
      tables: true,
      userServiceOnly: true,
      workerServiceOnly: true,
      searchPath: true,
      lifeClosed: true,
      grace: "7 days",
    },
    "034": { table: true, function: true, searchPath: true, closed: true },
    "037": { locked: true, searchPath: true, closed: true },
  };
  return pass[step.id];
}
