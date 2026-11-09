// Explicit management-tool environment selection. No requests or process.env reads.
export const CLOUD_TARGETS = Object.freeze({
  development: Object.freeze({ projectRef: "vsphftnmfzfoufasjttd", region: "ap-northeast-2", prefix: "DEV" }),
  production: Object.freeze({ projectRef: "hutqsfftioxtredcjhsy", region: "ap-northeast-1", prefix: "PROD" }),
});
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
