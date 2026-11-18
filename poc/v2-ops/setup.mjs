// G-2(docs/v2-design/103) 빈 프로젝트를 처음부터 세우는 도구 — 개발 서버가 거쳐 온 것과 같은 파일·같은 순서.
//
//   node poc/v2-ops/setup.mjs --plan-production                                   읽기만: 리전·상태·이미 있는 단계·다음 단계
//   node poc/v2-ops/setup.mjs --apply-sql-production --production-confirmed       2단계: 세션 보호·gateway 기반 → SQL 001…037
//   node poc/v2-ops/setup.mjs --bucket-production --production-confirmed          3단계: 비공개 그림 버킷
//   node poc/v2-ops/setup.mjs --schedule-production --production-confirmed        8단계: KeepAlive·안 쓰는 그림 정리·측정 예약
//
// - 운영 쓰기는 두 번 확인(WJB_CLOUD_ENV=production + --production-confirmed, target.mjs). 개발(이미 세운 서버)은 계획만.
// - 파일은 production-manifest.json의 SHA-256과 같아야 실행(검토한 그대로). SQL을 고치면 목록을 다시 검토·갱신해야 한다.
// - 단계마다: 있는지 확인 → 없을 때만 적용 → 응답을 잃으면 다시 확인(다시 실행하지 않음) → 확인 SQL로 검사. 중간에 멈추면
//   다음 실행이 그다음 단계부터 이어 간다. 되돌리기는 각 SQL의 rollback 파일(자료 없는 동안만, 103 2절 표).
// - 같은 단계 목록을 로컬 PostgreSQL(Docker)에도 그대로 돌려 본다(setup.test.mjs — 빈 DB 리허설).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { managementSql, opsTarget, evidenceName } from "./target.mjs";

const ROOT = new URL("../../", import.meta.url);
const P = "poc/v2-migration/postgres/";
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const sha = (text) => createHash("sha256").update(text).digest("hex");
const not =
  (...keys) =>
  (v) =>
    keys.every((k) => !v[k]);

/**
 * 세우는 순서. probe = 이 단계가 이미 있는가(앞 단계가 모두 있을 때만 묻는다 — 없는 함수를 부르지 않게).
 * check = 확인 SQL 결과 검사(개발 적용 도구·로컬 시험과 같은 기준).
 */
export const STEPS = Object.freeze([
  {
    id: "session-guard",
    apply: "poc/v2-cloud/session-guard.sql",
    probe: "SELECT to_regprocedure('public.wjb_v2_session_active(uuid,uuid)') IS NOT NULL;",
  },
  {
    id: "gateway-metadata",
    apply: "poc/v2-gateway/postgres-metadata.sql",
    probe: "SELECT to_regnamespace('wjb_gateway') IS NOT NULL;",
  },
  {
    id: "gateway-recovery",
    apply: "poc/v2-gateway/recovery.sql",
    probe: "SELECT to_regclass('wjb_gateway.recovery_audit') IS NOT NULL;",
  },
  {
    id: "001",
    before: {
      file: P + "000-preflight.sql",
      check: (v) =>
        v.sessionGuard && v.assetCommand && !v.schemaCollision && !v.rpcCollision && !v.triggerCollision,
    },
    apply: P + "001-migration.sql",
    verify: P + "002-verify.sql",
    probe: "SELECT to_regnamespace('wjb_migration') IS NOT NULL;",
    check: (v) =>
      v.tables === 3 &&
      v.rlsTables === 3 &&
      v.functions === 6 &&
      v.unsafeSearchPaths === 0 &&
      v.binaryColumns === 0 &&
      v.ownerSuperuser === false &&
      v.serviceExecute === true &&
      not("clientExecute", "serviceTableAccess")(v),
  },
  {
    id: "004",
    apply: P + "004-workspace.sql",
    verify: P + "005-workspace-verify.sql",
    probe: "SELECT to_regclass('wjb_migration.workspace_record') IS NOT NULL;",
    check: (v) =>
      v.tables === 5 &&
      v.rlsTables === 5 &&
      v.serviceRPC === true &&
      not("clientRPC", "directTableAccess", "privateExecute", "unsafeSearchPaths")(v),
  },
  {
    id: "007",
    apply: P + "007-workspace-db20.sql",
    verify: P + "008-workspace-db20-verify.sql",
    probe: "SELECT wjb_migration.workspace_contract(20) IS NOT NULL;",
    check: (v) =>
      v.db20Contract === true &&
      v.db20Tables === 30 &&
      v.profileCheck === true &&
      v.tables === 5 &&
      v.rlsTables === 5 &&
      v.serviceRPC === true &&
      not("clientRPC", "directTableAccess", "privateExecute", "unsafeSearchPaths")(v),
  },
  {
    id: "010",
    apply: P + "010-workspace-paged-upload.sql",
    verify: P + "012-workspace-paged-upload-verify.sql",
    probe: "SELECT to_regclass('wjb_migration.upload') IS NOT NULL;",
    check: (v) =>
      v.uploadTables === 2 &&
      v.tables === 7 &&
      v.rlsTables === 7 &&
      v.pagedActions === true &&
      v.core === true &&
      v.recordLimit20000 === true &&
      v.assetLimit10MB === true &&
      v.quotaDefault === "209715200" &&
      v.deviceRPC === true &&
      v.serviceRPC === true &&
      not("clientRPC", "directTableAccess", "privateExecute", "unsafeSearchPaths")(v),
  },
  {
    id: "013",
    apply: P + "013-workspace-upload-paging.sql",
    verify: P + "014-workspace-upload-paging-verify.sql",
    probe:
      "SELECT prosrc LIKE '%013 D-d%' FROM pg_proc WHERE oid='public.wjb_v2_migration_command(jsonb)'::regprocedure;",
    check: (v) =>
      v.pagingFree === true &&
      v.staleCleanup === true &&
      v.serviceRPC === true &&
      v.searchPath === true &&
      !v.clientRPC,
  },
  {
    id: "016",
    apply: P + "016-workspace-read.sql",
    verify: P + "017-workspace-read-verify.sql",
    probe: "SELECT to_regprocedure('public.wjb_v2_workspace_read(jsonb)') IS NOT NULL;",
    check: (v) =>
      v.readRPC === true &&
      v.readServiceOnly === true &&
      v.readSearchPath === true &&
      v.publishByIoVersion === true &&
      !v.privateExecute,
  },
  {
    id: "019",
    apply: P + "019-workspace-sync.sql",
    verify: P + "020-workspace-sync-verify.sql",
    probe: "SELECT to_regnamespace('wjb_sync') IS NOT NULL;",
    check: (v) =>
      v.syncRPC === true &&
      v.syncServiceOnly === true &&
      v.syncSearchPath === true &&
      v.inlineImageGuard === true &&
      v.assetGateSync === true &&
      v.tables === 4 &&
      v.rlsTables === 4 &&
      v.unsafeSearchPaths === 0 &&
      not("directTableAccess", "schemaUsage", "privateExecute")(v),
  },
  {
    id: "022",
    apply: P + "022-workspace-sync-retention.sql",
    verify: P + "023-workspace-sync-retention-verify.sql",
    probe:
      "SELECT coalesce((SELECT prosrc LIKE '%022 E+%' FROM pg_proc WHERE oid=to_regprocedure('public.wjb_v2_workspace_sync(jsonb)')),false);",
    check: (v) =>
      v.retention === true && v.index === true && v.syncServiceOnly === true && v.syncSearchPath === true,
  },
  {
    id: "025",
    apply: P + "025-workspace-list-label.sql",
    verify: P + "026-workspace-list-label-verify.sql",
    probe: "SELECT to_regprocedure('wjb_migration.workspace_label(jsonb)') IS NOT NULL;",
    check: (v) =>
      v.label === true && v.helper === true && v.readServiceOnly === true && v.readSearchPath === true,
  },
  {
    id: "028",
    apply: P + "028-account-quota.sql",
    verify: P + "029-account-quota-verify.sql",
    probe: "SELECT to_regnamespace('wjb_ops') IS NOT NULL;",
    check: (v) =>
      v.schema === true &&
      v.triggers === true &&
      v.accountServiceOnly === true &&
      v.accountSearchPath === true &&
      v.opsClosed === true,
  },
  {
    id: "031",
    apply: P + "031-lifecycle.sql",
    verify: P + "032-lifecycle-verify.sql",
    probe: "SELECT to_regnamespace('wjb_life') IS NOT NULL;",
    check: (v) =>
      v.schema === true &&
      v.tables === true &&
      v.userServiceOnly === true &&
      v.workerServiceOnly === true &&
      v.searchPath === true &&
      v.lifeClosed === true &&
      v.grace === "7 days",
  },
  {
    id: "034",
    apply: P + "034-metrics.sql",
    verify: P + "035-metrics-verify.sql",
    probe: "SELECT to_regclass('wjb_ops.metric_day') IS NOT NULL;",
    check: (v) => v.table === true && v.function === true && v.searchPath === true && v.closed === true,
  },
  {
    id: "037",
    apply: P + "037-sync-first-lock.sql",
    verify: P + "038-sync-first-lock-verify.sql",
    probe:
      "SELECT position('037:' IN pg_get_functiondef('wjb_sync.ensure_space(uuid,uuid)'::regprocedure))>0;",
    check: (v) => v.locked === true && v.searchPath === true && v.closed === true,
  },
]);

/** 8단계 예약(개발과 같은 이름·시각, UTC) — KeepAlive 12:00 KST · 그림 정리 03:10 KST · 측정 23:50 KST */
export const KEEPALIVE = {
  apply: "poc/v2-cloud/development/keepalive.sql",
  verify: "poc/v2-cloud/development/keepalive-verify.sql",
};
export const SCHEDULES = Object.freeze([
  { job: "wjb-life-sweep", cron: "10 18 * * *", command: "SELECT wjb_life.sweep_orphans(clock_timestamp())" },
  {
    job: "wjb-ops-metrics",
    cron: "50 14 * * *",
    command: "SELECT wjb_ops.snapshot_metrics((now() AT TIME ZONE 'Asia/Seoul')::date)",
  },
]);
/** 3단계 버킷 — gateway는 application/octet-stream 하나로만 올린다(개발 dev-bucket.mjs와 같은 설정) */
export const BUCKET = Object.freeze({
  public: false,
  fileSizeLimit: 10485760,
  mimeTypes: ["application/octet-stream"],
});

export const MANIFEST_PATH = "poc/v2-ops/production-manifest.json";
/** 검토 대상 파일 전부(단계·확인·예약) */
export function sourceFiles() {
  const files = [];
  for (const s of STEPS) files.push(...[s.before?.file, s.apply, s.verify].filter(Boolean));
  files.push(KEEPALIVE.apply, KEEPALIVE.verify);
  return files;
}
export function currentManifest() {
  return sourceFiles().map((path) => ({ path, sha256: sha(read(path)) }));
}
/** 파일이 검토한 목록과 같은가 — 다르면 이름을 돌려준다 */
export function manifestDrift(reviewed = JSON.parse(read(MANIFEST_PATH))) {
  const want = new Map(reviewed.sources.map((s) => [s.path, s.sha256]));
  const now = currentManifest();
  const drift = now.filter((s) => want.get(s.path) !== s.sha256).map((s) => s.path);
  for (const path of want.keys()) if (!now.some((s) => s.path === path)) drift.push(path);
  return drift;
}

/** 결과 값 하나 정리: 관리 API(true/false/객체)와 psql(t/f/JSON 글자) 모두 */
export function normalize(value) {
  if (value === "t") return true;
  if (value === "f") return false;
  if (typeof value === "string" && /^[{[]/.test(value.trim())) return JSON.parse(value);
  return value ?? null;
}

/** 앞에서부터 어디까지 있는가(읽기만). 앞 단계가 없으면 뒤는 묻지 않는다. */
export async function probeAll(db) {
  const present = [];
  for (const step of STEPS) {
    if ((await db.value(step.probe, true)) !== true) return { present, next: step.id };
    present.push(step.id);
  }
  return { present, next: null };
}

/**
 * 2단계 SQL 세우기. db = { exec(sql), value(sql, readOnly) }. 기록(report.steps)에 단계마다 결과를 남긴다(값·비밀 없음).
 * 이미 있는 단계는 건너뛰고(다시 실행하지 않음), 처음 없는 단계부터 끝까지.
 */
export async function applySql(db, report, { readFile = read } = {}) {
  report.steps = [];
  const { present } = await probeAll(db);
  for (const step of STEPS) {
    if (present.includes(step.id)) {
      report.steps.push({ id: step.id, state: "already" });
      continue;
    }
    if (step.before) {
      const v = await db.value(readFile(step.before.file), true);
      if (!step.before.check(v)) throw Object.assign(Error("PREFLIGHT_FAILED"), { step: step.id });
    }
    let lost = null;
    try {
      await db.exec(readFile(step.apply));
    } catch (error) {
      // 응답을 잃었어도 들어갔을 수 있다 — 다시 확인만 하고, 다시 실행하지 않는다
      if ((await db.value(step.probe, true)) !== true) throw Object.assign(error, { step: step.id });
      lost = error.code ?? error.message ?? "lost";
    }
    if ((await db.value(step.probe, true)) !== true)
      throw Object.assign(Error("STEP_NOT_PRESENT"), { step: step.id });
    let verified = null;
    if (step.verify) {
      const v = await db.value(readFile(step.verify), true);
      verified = !!step.check(v);
      if (!verified) throw Object.assign(Error("POST_APPLY_VERIFY_FAILED"), { step: step.id });
    }
    report.steps.push({ id: step.id, state: "applied", verified, ...(lost ? { responseLost: true } : {}) });
  }
  return report;
}

/** 8단계 예약 — KeepAlive가 없을 때만 넣고, 예약 둘은 없는 것만 더한 뒤 측정 첫 줄 */
export async function applySchedules(db, report, { readFile = read } = {}) {
  report.schedules = [];
  if ((await probeAll(db)).next !== null) throw Error("SQL_NOT_COMPLETE");
  const hasJob = async (name) =>
    (await db.value(`SELECT EXISTS(SELECT 1 FROM cron.job WHERE jobname='${name}');`, true)) === true;
  const cron = await db.value(
    "SELECT EXISTS(SELECT 1 FROM pg_available_extensions WHERE name='pg_cron');",
    true,
  );
  if (cron !== true) throw Error("PG_CRON_UNAVAILABLE");
  const ext = await db.value("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron');", true);
  if (ext !== true || !(await hasJob("keepalive_ping"))) {
    await db.exec(readFile(KEEPALIVE.apply));
    report.schedules.push({ job: "keepalive_ping", state: "applied" });
  } else report.schedules.push({ job: "keepalive_ping", state: "already" });
  const k = await db.value(readFile(KEEPALIVE.verify), true);
  if (!(
    k?.rls === true &&
    k.clientTableAccess === false &&
    (k.jobs ?? []).some((j) => j.name === "keepalive_ping" && j.active)
  ))
    throw Error("KEEPALIVE_VERIFY_FAILED");
  for (const s of SCHEDULES) {
    if (await hasJob(s.job)) {
      report.schedules.push({ job: s.job, state: "already" });
      continue;
    }
    await db.exec(`SELECT cron.schedule('${s.job}','${s.cron}',$$${s.command}$$);`);
    report.schedules.push({ job: s.job, cron: s.cron, state: "applied" });
  }
  await db.exec("SELECT wjb_ops.snapshot_metrics((now() AT TIME ZONE 'Asia/Seoul')::date);");
  report.firstSnapshot = true;
  return report;
}

/** 3단계 버킷 — 없으면 만들고, 있으면 설정이 같은지만 본다(다르면 멈춤: 고치는 것은 사람이 확인한 뒤) */
export async function applyBucket(db, bucket, report) {
  const row = () =>
    db.value(
      `SELECT jsonb_build_object('public',public,'size',file_size_limit,'mime',allowed_mime_types) FROM storage.buckets WHERE id='${bucket}';`,
      true,
    );
  let got = await row();
  report.bucket = { id: bucket, created: false };
  if (got == null) {
    await db.exec(
      `INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('${bucket}','${bucket}',false,${BUCKET.fileSizeLimit},ARRAY['application/octet-stream']) ON CONFLICT(id) DO NOTHING;`,
    );
    report.bucket.created = true;
    got = await row();
  }
  const ok =
    got?.public === false &&
    Number(got.size) === BUCKET.fileSizeLimit &&
    JSON.stringify(got.mime) === JSON.stringify(BUCKET.mimeTypes);
  report.bucket.matches = ok;
  if (!ok) throw Error("BUCKET_SETTINGS_DIFFER");
  return report;
}

/** 관리 API 연결 → { exec, value } */
export function cloudDb(target) {
  const sql = managementSql(target);
  return {
    exec: (q) => sql(q, false),
    value: async (q, readOnly) => {
      const rows = await sql(q, readOnly);
      return normalize(rows?.[0] ? Object.values(rows[0])[0] : null);
    },
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const action = /^--([a-z-]+)-(development|production)$/.exec(argv[0] ?? "")?.[1];
  const actions = { plan: false, "apply-sql": true, bucket: true, schedule: true };
  if (!Object.hasOwn(actions, action)) throw Error("EXPLICIT_TARGET_REQUIRED");
  const write = actions[action];
  // 개발 서버는 이미 세워져 있다 — 계획(읽기)만. 쓰기는 운영(빈 프로젝트)만.
  const t = opsTarget(argv, process.env, { action, write, environments: write ? ["production"] : undefined });
  const drift = manifestDrift();
  const report = {
    at: new Date().toISOString(),
    environment: t.environment,
    projectRef: t.ref,
    action,
    autoApply: false,
  };
  const db = cloudDb(t);
  try {
    if (drift.length) throw Object.assign(Error("REVIEWED_SQL_CHANGED"), { files: drift });
    if (write) {
      const role = await db.value(
        "SELECT jsonb_build_object('role',current_user,'super',r.rolsuper,'ro',current_setting('transaction_read_only')) FROM pg_roles r WHERE r.rolname=current_user;",
        false,
      );
      if (role?.super !== false || role.ro !== "off") throw Error("WRITE_ROLE_REQUIRED");
      report.executionRole = role.role;
    }
    if (action === "plan") {
      const p = await fetch(`https://api.supabase.com/v1/projects/${t.ref}`, {
        headers: { authorization: `Bearer ${t.managementToken}` },
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
      const body = await p.json().catch(() => null);
      report.project = { status: p.status, region: body?.region ?? null, state: body?.status ?? null };
      report.sql = await probeAll(db);
      report.schemas = await db.value(
        "SELECT coalesce(jsonb_agg(nspname ORDER BY nspname),'[]') FROM pg_namespace WHERE nspname LIKE 'wjb%';",
        true,
      );
      report.pgCronAvailable = await db.value(
        "SELECT EXISTS(SELECT 1 FROM pg_available_extensions WHERE name='pg_cron');",
        true,
      );
      report.bucketExists = await db.value(
        `SELECT EXISTS(SELECT 1 FROM storage.buckets WHERE id='${t.bucket}');`,
        true,
      );
    } else if (action === "apply-sql") await applySql(db, report);
    else if (action === "bucket") await applyBucket(db, t.bucket, report);
    else await applySchedules(db, report);
    report.ok = true;
  } catch (error) {
    report.ok = false;
    report.failure = {
      message: /^[A-Z0-9_]{1,80}$/.test(error.message) ? error.message : null,
      code: error.code ?? null,
      step: error.step ?? null,
      files: error.files ?? undefined,
    };
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    if (write)
      writeFileSync(
        new URL(evidenceName(t, `setup-${action}`), ROOT),
        JSON.stringify(report, null, 2) + "\n",
      );
    console.log(JSON.stringify(report, null, 2));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
