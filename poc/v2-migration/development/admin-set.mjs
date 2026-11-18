// 계정 한도 모듈(028, docs/v2-design/96 Q-1)의 관리자 계정 하나를 정한다(103 7단계).
//   개발: node poc/v2-migration/development/admin-set.mjs --set-admin-development
//   운영: node poc/v2-migration/development/admin-set.mjs --set-admin-production --production-confirmed  (WJB_CLOUD_ENV=production)
// 관리자 이메일은 WJB_ADMIN_EMAIL에서만(저장소·인자·증거 파일에 없음). 서버에는 사용자 ID만 저장한다.
// 화면에는 가린 이메일, 증거 파일에는 없음. 대상 고르기는 poc/v2-ops/target.mjs 한 곳. 앱에서 가져다 쓰지 않는다.
import { writeFile } from "node:fs/promises";
import { opsTarget, evidenceName } from "../../v2-ops/target.mjs";

const t = opsTarget(process.argv.slice(2), process.env, { action: "set-admin", write: true });
const ref = t.ref;
const management = t.managementToken;
const email = (process.env.WJB_ADMIN_EMAIL ?? "").trim().toLowerCase();
// 이메일 형식만 허용(작은따옴표·역슬래시 없음 — SQL 문자열에 그대로 넣어도 안전)
if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) throw Error("ADMIN_EMAIL_REQUIRED");
const mask = (e) => {
  const [u, d] = e.split("@");
  return `${u.slice(0, 2)}${"*".repeat(Math.max(1, u.length - 2))}@${d}`;
};

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${management}`, "content-type": "application/json" },
    body: JSON.stringify({ query, read_only: false }),
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) {
    const text = await r.text();
    const code = /((?:MIGRATION|ACCOUNT)_[A-Z0-9_]+)/.exec(text)?.[1] ?? null;
    throw Object.assign(Error("SQL_HTTP_" + r.status), { code });
  }
  return r.json();
}

// 개발은 예전 기록 이름 그대로, 운영은 prod-admin-set.json
const evidence = new URL(
  "../../../" +
    (t.environment === "production"
      ? evidenceName(t, "admin-set")
      : "docs/v2-design/evidence/migration-dev-admin-set.json"),
  import.meta.url,
);
const report = {
  at: new Date().toISOString(),
  environment: t.environment,
  projectRef: ref,
  productionTouched: t.environment === "production",
};
try {
  const rows = await sql(
    `SELECT to_regnamespace('wjb_ops') IS NOT NULL AS has028,` +
      ` (SELECT count(*) FROM auth.users WHERE lower(email)='${email}' AND deleted_at IS NULL) AS found;`,
  );
  if (!rows[0]?.has028) throw Error("MIGRATION_028_REQUIRED");
  // 가입하지 않은 이메일이면 먼저 초대(dev-signup-admin.mjs --invite-<환경>)
  if (Number(rows[0].found) !== 1) throw Error("ADMIN_ACCOUNT_NOT_FOUND");
  const set = await sql(
    `INSERT INTO wjb_ops.admin(one,user_id) SELECT true,id FROM auth.users WHERE lower(email)='${email}' AND deleted_at IS NULL` +
      ` ON CONFLICT(one) DO UPDATE SET user_id=excluded.user_id;`,
  );
  // 관리자는 계정별 조정 행이 없어도 무제한 — 남아 있던 정지·한도 행은 지운다
  await sql(`DELETE FROM wjb_ops.account WHERE user_id=(SELECT user_id FROM wjb_ops.admin);`);
  // 같은 문장 안의 count는 넣기 전 값이라 따로 확인
  void set;
  const check = await sql(
    `SELECT count(*) AS admins, bool_and(a.user_id=u.id) AS matches FROM wjb_ops.admin a` +
      ` JOIN auth.users u ON lower(u.email)='${email}' AND u.deleted_at IS NULL;`,
  );
  Object.assign(report, { set: check[0]?.matches === true, admins: Number(check[0]?.admins ?? 0) });
} catch (error) {
  report.failure = {
    message: /^[A-Z0-9_]{1,80}$/.test(error.message) ? error.message : null,
    code: error.code ?? null,
  };
  process.exitCode = 1;
} finally {
  // 증거 파일에는 이메일(가린 것도) 남기지 않는다 — 화면에만 가린 주소
  await writeFile(evidence, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ ...report, admin: mask(email) }));
}
