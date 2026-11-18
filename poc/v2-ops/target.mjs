// G-2(docs/v2-design/103 1절) 관리 도구가 어느 서버에 쓰는지 고르는 한 곳 — 요청·파일 없음(순수, 시험).
//
// 규칙
// - 명령줄 첫 인자 = `--<동작>-development` 또는 `--<동작>-production`. 그 환경 = WJB_CLOUD_ENV와 같아야 한다.
// - 프로젝트 ID는 cloud-environment.mjs 허용 표(개발·운영 둘)로 고정, 환경 변수 WJB_SUPABASE_<DEV|PROD>_PROJECT_REF도 같아야 한다.
// - 변수는 그 환경 접두어(DEV·PROD)만 읽는다 — 개발 도구가 운영 열쇠를, 운영 도구가 개발 열쇠를 빌려 쓰지 않는다.
// - 운영 쓰기는 두 번 확인: 환경 선택(WJB_CLOUD_ENV=production) + `--production-confirmed`. 읽기만 하는 동작은 확인 없이.
// - 열쇠는 결과 객체의 숨은 속성(직렬화·로그에 안 나옴).
import { CLOUD_TARGETS } from "../v2-cloud/cloud-environment.mjs";
import { serverKeyKind } from "../v2-gateway/io.mjs";

export const OPS_TARGETS = Object.freeze({
  development: Object.freeze({
    ref: CLOUD_TARGETS.development.projectRef,
    prefix: "DEV",
    bucket: "wjb-v2-dev-assets",
  }),
  production: Object.freeze({
    ref: CLOUD_TARGETS.production.projectRef,
    prefix: "PROD",
    bucket: "wjb-v2-assets",
  }),
});
export const PRODUCTION_CONFIRM = "--production-confirmed";

/**
 * @param {string[]} argv 명령줄(node·파일 뒤)
 * @param {Record<string,string|undefined>} env
 * @param {{ action: string, write?: boolean, args?: number, needs?: ("management"|"serverKey")[], environments?: string[] }} o
 *   args = 플래그 뒤 위치 인자 개수(예: 내보내기 출력 폴더 1), environments = 이 동작을 허용하는 환경
 */
export function opsTarget(argv, env, o) {
  const { action, write = false, args = 0, needs = ["management"] } = o;
  const environments = o.environments ?? Object.keys(OPS_TARGETS);
  const flag = argv[0];
  const name = environments.find((n) => flag === `--${action}-${n}`);
  if (!name) throw Error("EXPLICIT_TARGET_REQUIRED");
  const t = OPS_TARGETS[name];
  const rest = argv.slice(1);
  const confirmed = rest.includes(PRODUCTION_CONFIRM);
  const positional = rest.filter((a) => a !== PRODUCTION_CONFIRM);
  if (positional.length !== args || positional.some((a) => a.startsWith("--")))
    throw Error("EXPLICIT_TARGET_REQUIRED");
  if (name === "production" && write && !confirmed) throw Error("PRODUCTION_CONFIRM_REQUIRED");
  if (name !== "production" && confirmed) throw Error("PRODUCTION_CONFIRM_ONLY_FOR_PRODUCTION");
  if (name === "production" && !write && confirmed) throw Error("PRODUCTION_CONFIRM_NOT_NEEDED");
  if (env.WJB_CLOUD_ENV !== name) throw Error("CLOUD_ENV_MISMATCH");
  if (env[`WJB_SUPABASE_${t.prefix}_PROJECT_REF`] !== t.ref) throw Error("PROJECT_REF_MISMATCH");
  const result = { environment: name, ref: t.ref, bucket: t.bucket, write, args: positional };
  if (needs.includes("management")) {
    const token = env[`WJB_SUPABASE_${t.prefix}_MANAGEMENT_TOKEN`];
    if (typeof token !== "string" || !/^sbp_[A-Za-z0-9_-]{16,}$/.test(token))
      throw Error("MANAGEMENT_TOKEN_REQUIRED");
    Object.defineProperty(result, "managementToken", { value: token, enumerable: false });
  }
  if (needs.includes("serverKey")) {
    const key = env[`WJB_SUPABASE_${t.prefix}_SERVICE_ROLE_KEY`];
    // 운영은 처음부터 새 secret 키만(103 2절 5단계) — 예전 JWT는 받지 않는다
    const kind = serverKeyKind(key);
    if (!kind || (name === "production" && kind !== "secret")) throw Error("SERVER_KEY_REQUIRED");
    Object.defineProperty(result, "serverKey", { value: key, enumerable: false });
  }
  return Object.freeze(result);
}

/** 관리 API로 SQL 한 번(소유자 역할). readOnly면 거래 안에서 쓰기를 막는다(쓰면 25006). */
export function managementSql(target, { fetchImpl = fetch, timeoutMs = 60000 } = {}) {
  return async (query, readOnly = false) => {
    const r = await fetchImpl(`https://api.supabase.com/v1/projects/${target.ref}/database/query`, {
      method: "POST",
      headers: { authorization: `Bearer ${target.managementToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        query: readOnly ? "SET TRANSACTION READ ONLY;\n" + query : query,
        read_only: false,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) {
      const text = await r.text();
      const code = /((?:MIGRATION|SYNC|READ|ACCOUNT|LIFE|OPS|KEEPALIVE)_[A-Z0-9_]+)/.exec(text)?.[1] ?? null;
      throw Object.assign(Error("SQL_HTTP_" + r.status), { code });
    }
    return r.json();
  };
}

/** 증거 파일 이름 — 환경마다 따로(운영 기록이 개발 기록을 덮지 않게) */
export function evidenceName(target, stem) {
  return `docs/v2-design/evidence/${target.environment === "production" ? "prod" : "dev"}-${stem}.json`;
}
