// Explicit management-tool environment selection. No requests or process.env reads.
export const CLOUD_TARGETS = Object.freeze({
  development: Object.freeze({ projectRef: "vsphftnmfzfoufasjttd", region: "ap-northeast-2", prefix: "DEV" }),
  production: Object.freeze({ projectRef: "hutqsfftioxtredcjhsy", region: "ap-northeast-1", prefix: "PROD" }),
});
/** G-3(docs/v2-design/97): 서버 코드가 받는 프로젝트 = 이 표의 둘(개발·운영)뿐 */
export function isAllowedProjectRef(ref) {
  return Object.values(CLOUD_TARGETS).some((t) => t.projectRef === ref);
}
/** 프로젝트 ID → 환경 이름("development" | "production"), 표에 없으면 null */
export function environmentOf(ref) {
  return Object.entries(CLOUD_TARGETS).find(([, t]) => t.projectRef === ref)?.[0] ?? null;
}
/**
 * Edge Function이 돌고 있는 프로젝트(Supabase가 넣어 주는 SUPABASE_URL)를 허용 목록으로 확인.
 * 주소 = 정확히 https://<id>.supabase.co(경로·포트·다른 호스트 없음). 아니면 오류 — 다른 프로젝트로 요청을 보내지 않는다.
 */
export function runtimeProjectRef(supabaseUrl) {
  const m = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/.exec(String(supabaseUrl ?? ""));
  if (!m || !isAllowedProjectRef(m[1])) throw new Error("RUNTIME_PROJECT_NOT_ALLOWED");
  return m[1];
}
export function resolveCloudEnvironment(env, { operation = "inspect" } = {}) {
  const selected = env?.WJB_CLOUD_ENV;
  if (!Object.hasOwn(CLOUD_TARGETS, selected)) throw new Error("CLOUD_ENV_REQUIRED");
  if (!["inspect", "install-development"].includes(operation)) throw new Error("UNKNOWN_OPERATION");
  if (operation === "install-development" && selected !== "development")
    throw new Error("PRODUCTION_WRITE_DENIED");
  const target = CLOUD_TARGETS[selected];
  const projectRef = env[`WJB_SUPABASE_${target.prefix}_PROJECT_REF`];
  if (projectRef !== target.projectRef) throw new Error("PROJECT_REF_MISMATCH");
  const token = env[`WJB_SUPABASE_${target.prefix}_MANAGEMENT_TOKEN`];
  if (typeof token !== "string" || !token.trim() || /[\r\n]/.test(token))
    throw new Error("SELECTED_TOKEN_REQUIRED");
  const result = {
    environment: selected,
    projectRef,
    region: target.region,
    projectUrl: `https://${projectRef}.supabase.co`,
    managementOrigin: "https://api.supabase.com",
    operation,
  };
  // Keep credentials out of ordinary object serialization/logging.
  Object.defineProperty(result, "managementToken", { value: token, enumerable: false });
  return Object.freeze(result);
}
