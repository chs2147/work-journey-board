// 개발 프로젝트 전용: 영구 비공개 버킷 `wjb-v2-dev-assets` 1개를 만든다(C-1b, docs/v2-design/82). 이미 있으면 설정만 확인.
// 명시 실행만, 운영 거절. 파일 10MB, application/octet-stream(gateway가 그 형식으로만 올림), 공개 아님.
import { writeFileSync } from "node:fs";
const ref = "vsphftnmfzfoufasjttd",
  bucket = "wjb-v2-dev-assets";
if (
  process.argv.slice(2).join(" ") !== "--create-development" ||
  process.env.WJB_CLOUD_ENV !== "development" ||
  process.env.WJB_SUPABASE_DEV_PROJECT_REF !== ref
)
  throw Error("EXPLICIT_DEV_BUCKET_REQUIRED");
const key = process.env.WJB_SUPABASE_DEV_SERVICE_ROLE_KEY;
if (!key) throw Error("DEV_CREDENTIALS_REQUIRED");
const api = async (method, path, body) => {
  const r = await fetch(`https://${ref}.supabase.co/storage/v1${path}`, {
    method,
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const want = { public: false, file_size_limit: 10485760, allowed_mime_types: ["application/octet-stream"] };
let got = await api("GET", `/bucket/${bucket}`);
const created = got.status !== 200;
if (created) {
  const c = await api("POST", "/bucket", { id: bucket, name: bucket, ...want });
  if (c.status !== 200) throw Error("BUCKET_CREATE_" + c.status);
  got = await api("GET", `/bucket/${bucket}`);
}
const b = got.body ?? {};
const report = {
  checkedAt: new Date().toISOString(),
  projectRef: ref,
  productionTouched: false,
  bucket,
  created,
  public: b.public,
  fileSizeLimit: b.file_size_limit,
  allowedMimeTypes: b.allowed_mime_types,
  ok:
    got.status === 200 &&
    b.public === false &&
    b.file_size_limit === 10485760 &&
    JSON.stringify(b.allowed_mime_types) === JSON.stringify(want.allowed_mime_types),
};
writeFileSync(
  new URL("../../../docs/v2-design/evidence/preview-dev-bucket.json", import.meta.url),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
if (!report.ok) process.exitCode = 1;
