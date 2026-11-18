// gateway를 묶어 Supabase Edge Function `wjb-gateway`로 배포한다(docs/v2-design/79·103 6단계).
//   개발: node poc/v2-gateway/edge/deploy.mjs --deploy-development
//   운영: node poc/v2-gateway/edge/deploy.mjs --deploy-production --production-confirmed   (WJB_CLOUD_ENV=production)
// 대상 고르기는 poc/v2-ops/target.mjs 한 곳(개발·운영 안 섞임, 운영 쓰기 두 번 확인). 관리 토큰은 배포 요청에만 쓰고 함수에 넣지 않는다.
// 같은 묶음이 두 환경에 간다 — 어느 프로젝트에서 도는지는 함수가 SUPABASE_URL을 허용 목록으로 확인한다(G-3).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { opsTarget, evidenceName } from "../../v2-ops/target.mjs";

const t = opsTarget(process.argv.slice(2), process.env, { action: "deploy", write: true });
const ref = t.ref;
const token = t.managementToken;

const root = new URL("../../../", import.meta.url).pathname;
const out = join(mkdtempSync(join(tmpdir(), "wjb-edge-")), "index.js");
execFileSync(
  "npx",
  [
    "rolldown",
    "poc/v2-gateway/edge/wjb-gateway.mjs",
    "--format",
    "esm",
    "--platform",
    "neutral",
    "--external",
    "node:*",
    "--file",
    out,
  ],
  { cwd: root, stdio: "ignore" },
);
const bytes = readFileSync(out);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const form = new FormData();
form.append(
  "metadata",
  JSON.stringify({ name: "wjb-gateway", entrypoint_path: "index.js", verify_jwt: false }),
);
form.append("file", new Blob([bytes], { type: "application/javascript" }), "index.js");
const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/functions/deploy?slug=wjb-gateway`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}` },
  body: form,
  redirect: "error",
  signal: AbortSignal.timeout(120000),
});
const body = await r.json().catch(() => null);
const report = {
  deployedAt: new Date().toISOString(),
  projectRef: ref,
  environment: t.environment,
  productionTouched: t.environment === "production",
  function: "wjb-gateway",
  verifyJwt: false,
  bundleSha256: sha256,
  bundleBytes: bytes.length,
  status: r.status,
  version: body?.version ?? null,
  functionStatus: body?.status ?? null,
};
// 개발은 예전 기록 이름 그대로(preview-dev-gateway-deploy.json), 운영은 prod-gateway-deploy.json
const evidence =
  t.environment === "production"
    ? evidenceName(t, "gateway-deploy")
    : "docs/v2-design/evidence/preview-dev-gateway-deploy.json";
writeFileSync(new URL("../../../" + evidence, import.meta.url), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
if (!r.ok) process.exitCode = 1;
