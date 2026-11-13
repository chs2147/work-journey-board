// 개발 프로젝트 전용: gateway를 묶어 Supabase Edge Function `wjb-gateway`로 배포한다(docs/v2-design/79).
// 명시 실행만(`--deploy-development`), 운영 ref·다른 환경 거절. 관리 토큰은 배포 요청에만 쓰고 함수에 넣지 않는다.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ref = "vsphftnmfzfoufasjttd";
if (
  process.argv.slice(2).join(" ") !== "--deploy-development" ||
  process.env.WJB_CLOUD_ENV !== "development" ||
  process.env.WJB_SUPABASE_DEV_PROJECT_REF !== ref
)
  throw Error("EXPLICIT_DEV_DEPLOY_REQUIRED");
const token = process.env.WJB_SUPABASE_DEV_MANAGEMENT_TOKEN;
if (!token) throw Error("DEV_CREDENTIALS_REQUIRED");

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
  productionTouched: false,
  function: "wjb-gateway",
  verifyJwt: false,
  bundleSha256: sha256,
  bundleBytes: bytes.length,
  status: r.status,
  version: body?.version ?? null,
  functionStatus: body?.status ?? null,
};
writeFileSync(
  new URL("../../../docs/v2-design/evidence/preview-dev-gateway-deploy.json", import.meta.url),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
if (!r.ok) process.exitCode = 1;
