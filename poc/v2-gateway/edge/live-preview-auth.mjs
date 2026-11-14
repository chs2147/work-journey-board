// 개발 프로젝트 전용 실서버 왕복: 가상 시험 계정(…@example.invalid, 메일 발송 없음) → 앱 Rust 로그인 코드
// (`online.rs` live 시험) → 계정 삭제·잔여 확인. 명시 실행(`--run-development-preview-auth`)만, 운영 거절.
// 서버 열쇠는 이 도구의 관리 요청(계정 만들기·인증번호 받기·지우기)에만 쓰고 앱·시험 출력·증거에 넣지 않는다.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

const ref = "vsphftnmfzfoufasjttd";
if (
  process.argv.slice(2).join(" ") !== "--run-development-preview-auth" ||
  process.env.WJB_CLOUD_ENV !== "development" ||
  process.env.WJB_SUPABASE_DEV_PROJECT_REF !== ref
)
  throw Error("EXPLICIT_DEV_RUN_REQUIRED");
const key = process.env.WJB_SUPABASE_DEV_SERVICE_ROLE_KEY;
if (!key) throw Error("DEV_CREDENTIALS_REQUIRED");
const origin = `https://${ref}.supabase.co`;
const admin = async (method, path, body) => {
  const r = await fetch(origin + path, {
    method,
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const email = `wjb-preview-${randomUUID()}@example.invalid`;
const report = {
  startedAt: new Date().toISOString(),
  projectRef: ref,
  productionTouched: false,
  mailSent: false,
  account: "virtual (example.invalid)",
  checks: [],
  cleanup: {},
  passed: false,
};
let userId = null;
try {
  const created = await admin("POST", "/auth/v1/admin/users", { email, email_confirm: true });
  if (created.status !== 200 || !created.body?.id) throw Error("CREATE_USER_" + created.status);
  userId = created.body.id;
  const link = await admin("POST", "/auth/v1/admin/generate_link", { type: "magiclink", email });
  const otp = link.body?.email_otp ?? link.body?.properties?.email_otp;
  if (link.status !== 200 || !/^\d{6,10}$/.test(otp ?? "")) throw Error("GENERATE_OTP_" + link.status);
  let output = "";
  try {
    output = execFileSync(
      "cargo",
      [
        "test",
        "--lib",
        "--features",
        "connected-preview",
        "live_development_round_trip",
        "--",
        "--ignored",
        "--nocapture",
      ],
      {
        cwd: new URL("../../../src-tauri/", import.meta.url).pathname,
        env: {
          ...process.env,
          WJB_LIVE_EMAIL: email,
          WJB_LIVE_OTP: otp,
          WJB_SUPABASE_DEV_SERVICE_ROLE_KEY: "",
        },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch (e) {
    output = String(e.stdout ?? "");
  }
  for (const m of output.matchAll(/^LIVE_CHECK (\S+) (true|false)$/gm))
    report.checks.push({ name: m[1], passed: m[2] === "true" });
} catch (e) {
  report.failure = /^[A-Z0-9_]{1,60}$/.test(e.message) ? e.message : "UNEXPECTED";
} finally {
  if (userId) {
    const del = await admin("DELETE", `/auth/v1/admin/users/${userId}`);
    const after = await admin("GET", `/auth/v1/admin/users/${userId}`);
    report.cleanup = { deleteStatus: del.status, userAbsent: after.status === 404 };
  }
  report.passed =
    !report.failure &&
    report.checks.length === 8 &&
    report.checks.every((c) => c.passed) &&
    report.cleanup.userAbsent === true;
  report.finishedAt = new Date().toISOString();
  writeFileSync(
    new URL("../../../docs/v2-design/evidence/preview-dev-auth-live.json", import.meta.url),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
  if (!report.passed) process.exitCode = 1;
}
