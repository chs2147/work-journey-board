// G-2(docs/v2-design/103) 서버 점검 — 운영 절차서의 "끝난 상태"를 읽기만 해서 확인한다(쓰기 없음, 값·비밀 내보내지 않음).
//   node poc/v2-ops/audit.mjs --audit-development
//   node poc/v2-ops/audit.mjs --audit-production      (WJB_CLOUD_ENV=production — 운영 적용 직후·복구 리허설 뒤)
// 대상 고르기는 target.mjs 한 곳(개발·운영 안 섞임). 비밀은 이름만 본다(Edge 비밀 값은 응답에서 버린다).
import { opsTarget } from "./target.mjs";

/** 확인 항목(순수 — 시험): 상태 → [이름, 통과, 메모] */
export function evaluate(s) {
  const c = [];
  const add = (name, ok, note) => c.push({ name, ok: !!ok, ...(note ? { note } : {}) });
  add("sql_001_to_037", s.sql?.all === true, s.sql?.missing?.join(",") || undefined);
  add("schemas_closed_to_api_roles", s.sql?.closed === true);
  add("admin_set", s.sql?.admins === 1);
  add("keepalive_cron", s.sql?.cron?.includes("keepalive"));
  add("unused_image_sweep_cron", s.sql?.cron?.includes("wjb-life-sweep"));
  add("metrics_cron", s.sql?.cron?.includes("wjb-ops-metrics"));
  add("bucket_private", s.bucket?.exists === true && s.bucket.public === false);
  add("gateway_deployed", s.functions?.includes("wjb-gateway"));
  add("gateway_answers", s.me?.status === 401); // 로그인 없이 401 = 시작 단계(프로젝트·열쇠 확인) 통과. 열쇠 종류는 실서버 점검이 본다
  add(
    "legacy_gateway_secret_removed",
    s.secretNames && !s.secretNames.includes("WJB_GATEWAY_SERVICE_ROLE_JWT"),
  );
  add("signup_invite_only", s.auth?.disableSignup === true);
  add("email_otp_template", s.auth?.otpTemplate === true);
  return c;
}

async function main() {
  const t = opsTarget(process.argv.slice(2), process.env, { action: "audit" });
  const name = t.environment;
  const mgmt = t.managementToken;
  const api = async (path, init = {}) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${t.ref}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${mgmt}`, "content-type": "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const sql = async (q) =>
    (
      await api("/database/query", {
        method: "POST",
        body: JSON.stringify({ query: "SET TRANSACTION READ ONLY; " + q, read_only: false }),
      })
    ).body;
  const s = {};
  const [row] =
    (await sql(`SELECT
      to_regnamespace('wjb_migration') IS NOT NULL m001, to_regprocedure('public.wjb_v2_workspace_read(jsonb)') IS NOT NULL m016,
      to_regnamespace('wjb_sync') IS NOT NULL m019, to_regnamespace('wjb_ops') IS NOT NULL m028, to_regnamespace('wjb_life') IS NOT NULL m031,
      to_regclass('wjb_ops.metric_day') IS NOT NULL m034,
      position('037:' IN pg_get_functiondef('wjb_sync.ensure_space(uuid,uuid)'::regprocedure))>0 m037,
      (SELECT count(*) FROM wjb_ops.admin) admins,
      NOT has_schema_privilege('authenticated','wjb_ops','USAGE') AND NOT has_schema_privilege('authenticated','wjb_life','USAGE')
        AND NOT has_schema_privilege('authenticated','wjb_sync','USAGE') AND NOT has_schema_privilege('anon','wjb_migration','USAGE') closed,
      (SELECT array_agg(jobname) FROM cron.job) cron;`)) ?? [];
  if (row) {
    const missing = ["m001", "m016", "m019", "m028", "m031", "m034", "m037"].filter((k) => row[k] !== true);
    s.sql = {
      all: missing.length === 0,
      missing,
      admins: Number(row.admins),
      closed: row.closed === true,
      cron: (row.cron ?? []).join(","),
    };
  }
  const b = (await sql(`SELECT public FROM storage.buckets WHERE id='${t.bucket}';`)) ?? [];
  s.bucket = { exists: b.length === 1, public: b[0]?.public };
  const f = await api("/functions");
  s.functions = Array.isArray(f.body) ? f.body.map((x) => x.slug) : [];
  const sec = await api("/secrets");
  s.secretNames = Array.isArray(sec.body) ? sec.body.map((x) => x.name) : null; // 값은 버린다
  const auth = await api("/config/auth");
  s.auth =
    auth.status === 200
      ? {
          disableSignup: auth.body?.disable_signup === true,
          otpTemplate: /\{\{\s*\.Token\s*\}\}/.test(auth.body?.mailer_templates_magic_link_content ?? ""),
        }
      : null;
  const me = await fetch(`https://${t.ref}.supabase.co/functions/v1/wjb-gateway/v2/me`, {
    signal: AbortSignal.timeout(20000),
  }).catch(() => null);
  s.me = { status: me?.status ?? null };
  const checks = evaluate(s);
  console.log(
    JSON.stringify(
      { environment: name, checks, passed: checks.filter((x) => x.ok).length, total: checks.length },
      null,
      2,
    ),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
