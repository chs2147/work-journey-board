// 개발 프로젝트 전용: 온라인 가입 관리(docs/v2-design/94 — 2026-11-16 사용자 결정 A안).
// 수파베이스 기본 스위치 "새 사용자 가입"을 쓴다: 끄면 초대 전용(초대한 사람만), 켜면 아무나 이메일 인증 가입.
// - 상태(--status-development): 가입 방식·계정 수만. 이메일 목록은 보여 주지 않는다.
// - 초대(--invite-development <이메일>): 그 이메일로 계정을 미리 만든다(메일 안 보냄). 초대받은 사람은 Preview에서
//   [인증번호 받기]로 바로 로그인. 이미 있으면 그대로 둔다.
// - 목록(--list-development): 초대한 계정을 가린 이메일(앞 2자·도메인)·만든 날짜로.
// - 스위치(--signup-development invite|open --confirm): 초대 전용 ↔ 아무나 가입.
// 운영 프로젝트·다른 환경은 거절. 관리 토큰·서비스 키는 이 요청에만 쓰고 출력·파일에 남기지 않는다.
// 계정 지우기는 하지 않는다(그 계정의 온라인 자료는 dev-copy-admin.mjs --purge-owner-development로 따로).
const ref = "vsphftnmfzfoufasjttd";
const args = process.argv.slice(2);
const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cmd =
  args.join(" ") === "--status-development"
    ? { kind: "status" }
    : args.join(" ") === "--list-development"
      ? { kind: "list" }
      : args.length === 2 && args[0] === "--invite-development" && email.test(args[1])
        ? { kind: "invite", email: args[1].trim().toLowerCase() }
        : args.length === 3 &&
            args[0] === "--signup-development" &&
            ["invite", "open"].includes(args[1]) &&
            args[2] === "--confirm"
          ? { kind: "signup", mode: args[1] }
          : null;
if (!cmd || process.env.WJB_CLOUD_ENV !== "development" || process.env.WJB_SUPABASE_DEV_PROJECT_REF !== ref)
  throw Error("EXPLICIT_DEV_RUN_REQUIRED");
const mgmt = process.env.WJB_SUPABASE_DEV_MANAGEMENT_TOKEN,
  key = process.env.WJB_SUPABASE_DEV_SERVICE_ROLE_KEY;
if (!mgmt || !key) throw Error("DEV_CREDENTIALS_REQUIRED");

const api = async (method, path, body) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`, {
    method,
    headers: { authorization: `Bearer ${mgmt}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw Error("DEV_API_" + r.status);
  return r.json().catch(() => ({}));
};
const admin = async (method, path, body) => {
  const r = await fetch(`https://${ref}.supabase.co/auth/v1/admin${path}`, {
    method,
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const mask = (e) => {
  const [u, d] = String(e).split("@");
  return `${u.slice(0, 2)}${"*".repeat(Math.max(1, u.length - 2))}@${d}`;
};
const mode = async () => ((await api("GET", "/config/auth")).disable_signup ? "invite" : "open");
const users = async () => {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const r = await admin("GET", `/users?page=${page}&per_page=200`);
    if (r.status !== 200) throw Error("DEV_ADMIN_" + r.status);
    const list = r.body?.users ?? [];
    out.push(...list);
    if (list.length < 200) break;
  }
  return out;
};

const result = { projectRef: ref, productionTouched: false };
if (cmd.kind === "status") {
  Object.assign(result, { signup: await mode(), accounts: (await users()).length });
} else if (cmd.kind === "list") {
  Object.assign(result, {
    signup: await mode(),
    accounts: (await users())
      .map((u) => ({ email: mask(u.email ?? ""), createdAt: String(u.created_at ?? "").slice(0, 10) }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  });
} else if (cmd.kind === "invite") {
  const r = await admin("POST", "/users", { email: cmd.email, email_confirm: true });
  const exists = r.status === 422 || /already/i.test(JSON.stringify(r.body ?? ""));
  if (r.status !== 200 && !exists) throw Error("DEV_INVITE_" + r.status);
  Object.assign(result, {
    invited: mask(cmd.email),
    created: r.status === 200,
    alreadyExisted: exists,
    signup: await mode(),
  });
} else {
  try {
    await api("PATCH", "/config/auth", { disable_signup: cmd.mode === "invite" });
  } catch (e) {
    // 관리 토큰에 인증 설정 쓰기 권한이 없으면 대시보드 스위치로(Authentication › Sign In / Providers ›
    // "Allow new users to sign up") — 바꾼 뒤 --status-development로 확인
    if (String(e.message) === "DEV_API_403")
      throw Error("AUTH_CONFIG_WRITE_NOT_ALLOWED_USE_DASHBOARD", { cause: e });
    throw e;
  }
  Object.assign(result, { signup: await mode() });
}
console.log(JSON.stringify(result, null, 2));
