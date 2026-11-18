// 개발 프로젝트 전용: 온라인 가입 관리(docs/v2-design/94 — 2026-11-16 사용자 결정 A안).
// 수파베이스 기본 스위치 "새 사용자 가입"을 쓴다: 끄면 초대 전용(초대한 사람만), 켜면 아무나 이메일 인증 가입.
// - 상태(--status-development): 가입 방식·계정 수만. 이메일 목록은 보여 주지 않는다.
// - 초대(--invite-development <이메일>): 그 이메일로 계정을 미리 만든다(메일 안 보냄). 초대받은 사람은 Preview에서
//   [인증번호 받기]로 바로 로그인. 이미 있으면 그대로 둔다.
// - 목록(--list-development): 초대한 계정을 가린 이메일(앞 2자·도메인)·만든 날짜로.
// - 스위치(--signup-development invite|open --confirm): 초대 전용 ↔ 아무나 가입.
// 같은 명령의 운영 줄: `--status-production`·`--list-production`(읽기만), `--invite-production <이메일> --production-confirmed`,
// `--signup-production invite|open --confirm --production-confirmed`(WJB_CLOUD_ENV=production — 103 4·7단계).
// 대상 고르기는 poc/v2-ops/target.mjs 한 곳(개발·운영 안 섞임). 관리 토큰·서버 열쇠는 이 요청에만 쓰고 출력·파일에 남기지 않는다.
// 계정 지우기는 하지 않는다(그 계정의 온라인 자료는 dev-copy-admin.mjs --purge-owner-development로 따로).
import { serverKeyHeaders } from "../io.mjs";
import { opsTarget } from "../../v2-ops/target.mjs";
const args = process.argv.slice(2);
const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const kind = /^--(status|list|invite|signup)-(?:development|production)$/.exec(args[0] ?? "")?.[1];
// signup은 기존처럼 `--confirm`도 받아야 한다(가입 방식 바꾸기)
const signupArgs = kind === "signup" ? args.filter((a) => a !== "--confirm") : args;
if (!kind || (kind === "signup" && !args.includes("--confirm"))) throw Error("EXPLICIT_TARGET_REQUIRED");
// 이메일·가입 방식은 열쇠를 보기 전에 먼저 확인(잘못된 입력이면 아무것도 읽지 않는다)
const value = signupArgs.slice(1).find((x) => !x.startsWith("--"));
const cmd =
  kind === "invite"
    ? email.test(value ?? "") && { kind, email: value.trim().toLowerCase() }
    : kind === "signup"
      ? ["invite", "open"].includes(value) && { kind, mode: value }
      : { kind };
if (!cmd) throw Error("EXPLICIT_TARGET_REQUIRED");
const t = opsTarget(signupArgs, process.env, {
  action: kind,
  write: kind === "invite" || kind === "signup",
  args: kind === "invite" || kind === "signup" ? 1 : 0,
  needs: ["management", "serverKey"],
});
const ref = t.ref;
const mgmt = t.managementToken,
  key = t.serverKey;

const api = async (method, path, body) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`, {
    method,
    headers: { authorization: `Bearer ${mgmt}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw Error("API_" + r.status);
  return r.json().catch(() => ({}));
};
const admin = async (method, path, body) => {
  const r = await fetch(`https://${ref}.supabase.co/auth/v1/admin${path}`, {
    method,
    headers: { ...serverKeyHeaders(key), "content-type": "application/json" },
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
    if (r.status !== 200) throw Error("ADMIN_" + r.status);
    const list = r.body?.users ?? [];
    out.push(...list);
    if (list.length < 200) break;
  }
  return out;
};

const result = {
  environment: t.environment,
  projectRef: ref,
  productionTouched: t.environment === "production" && cmd.kind !== "status" && cmd.kind !== "list",
};
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
  if (r.status !== 200 && !exists) throw Error("INVITE_" + r.status);
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
    // "Allow new users to sign up") — 바꾼 뒤 --status-<환경>으로 확인
    if (String(e.message) === "API_403")
      throw Error("AUTH_CONFIG_WRITE_NOT_ALLOWED_USE_DASHBOARD", { cause: e });
    throw e;
  }
  Object.assign(result, { signup: await mode() });
}
console.log(JSON.stringify(result, null, 2));
