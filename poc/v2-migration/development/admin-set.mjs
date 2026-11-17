// Explicit DEV-only: fix the single admin account of the account-quota module (028, docs/v2-design/96 Q-1).
// The admin e-mail comes only from WJB_ADMIN_EMAIL (never from this repository, arguments or evidence files).
// The server stores the user id only. The console shows a masked e-mail; the evidence file has none. Never imported by product.
import { writeFile } from "node:fs/promises";

const ref = "vsphftnmfzfoufasjttd";
if (
  process.argv.slice(2).join(" ") !== "--set-admin-development" ||
  process.env.WJB_CLOUD_ENV !== "development" ||
  process.env.WJB_SUPABASE_DEV_PROJECT_REF !== ref
)
  throw Error("EXPLICIT_DEV_ADMIN_REQUIRED");
const management = process.env.WJB_SUPABASE_DEV_MANAGEMENT_TOKEN;
if (!management) throw Error("DEV_CREDENTIALS_REQUIRED");
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
    throw Object.assign(Error("DEV_SQL_HTTP_" + r.status), { code });
  }
  return r.json();
}

const evidence = new URL("../../../docs/v2-design/evidence/migration-dev-admin-set.json", import.meta.url);
const report = { at: new Date().toISOString(), projectRef: ref, productionTouched: false };
try {
  const rows = await sql(
    `SELECT to_regnamespace('wjb_ops') IS NOT NULL AS has028,` +
      ` (SELECT count(*) FROM auth.users WHERE lower(email)='${email}' AND deleted_at IS NULL) AS found;`,
  );
  if (!rows[0]?.has028) throw Error("MIGRATION_028_REQUIRED");
  // 가입하지 않은 이메일이면 먼저 초대(dev-signup-admin.mjs --invite-development)
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
