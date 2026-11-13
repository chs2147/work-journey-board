// Supabase Edge Function 진입점(개발 프로젝트 전용, docs/v2-design/79-preview-dev-connection.md).
// - 기존 gateway(자산 예약·업로드·취소)는 그대로 넘기고, 계정 확인 `GET /v2/me`만 더한다.
// - 서버 전용 열쇠(SUPABASE_SERVICE_ROLE_KEY)는 Edge 런타임이 넣어 준 값만 쓴다. 앱·요청 본문에서 받지 않는다.
// - JWKS는 같은 개발 프로젝트의 공개 주소에서만 읽는다(토큰이 가리키는 주소를 따라가지 않음).
import { createDevelopmentGateway } from "../development-gateway.mjs";
import { CLOUD_TARGETS } from "../../v2-cloud/cloud-environment.mjs";
import { createSupabaseRest } from "../supabase-rest.mjs";
import { createSessionVerifier } from "../../v2-auth/session-adapter.mjs";

const projectRef = CLOUD_TARGETS.development.projectRef;
const prefix = "/wjb-gateway";
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

let ready = null;
async function setup() {
  const serviceRoleKey = globalThis.Deno?.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!serviceRoleKey.startsWith("eyJ")) throw new Error("RUNTIME_KEY_UNAVAILABLE");
  const r = await fetch(`https://${projectRef}.supabase.co/auth/v1/.well-known/jwks.json`, {
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error("JWKS_UNAVAILABLE");
  const jwks = await r.json();
  const fetchTransport = (url, init) => {
    if (url.origin !== `https://${projectRef}.supabase.co`) throw new Error("DESTINATION_DENIED");
    return fetch(url, init);
  };
  const gateway = createDevelopmentGateway({ projectRef, serviceRoleKey, jwks, fetchTransport });
  const rest = createSupabaseRest({ projectRef, serviceRoleKey, fetchTransport });
  const verify = createSessionVerifier({ projectRef, jwks, callServerRpc: rest.callServerRpc });
  return { gateway, verify };
}

export async function handle(request) {
  try {
    ready ??= setup().catch((e) => {
      ready = null;
      throw e;
    });
    const { gateway, verify } = await ready;
    const url = new URL(request.url);
    const path = url.pathname.startsWith(prefix + "/") ? url.pathname.slice(prefix.length) : url.pathname;
    if (path === "/v2/me") {
      if (request.method !== "GET" || url.search) return json({ error: "NOT_FOUND" }, 404);
      if (request.headers.has("origin")) return json({ error: "ORIGIN_DENIED" }, 403);
      const auth = request.headers.get("authorization") ?? "";
      if (!/^Bearer [^\s,]+$/.test(auth)) return json({ error: "AUTH_REQUIRED" }, 401);
      try {
        const p = await verify(auth.slice(7));
        return json({ accountId: p.userId, sessionActive: true, project: "development" });
      } catch (e) {
        const code = ["AUTH_REQUIRED", "ACCESS_REVOKED", "AUTH_UNAVAILABLE"].includes(e?.code)
          ? e.code
          : "AUTH_REQUIRED";
        return json({ error: code }, code === "AUTH_UNAVAILABLE" ? 503 : 401);
      }
    }
    const inner = new URL(path, url.origin);
    return await gateway.handler(new Request(inner, request));
  } catch (e) {
    // 단계 코드만(대문자·밑줄) — 비밀값·내부 메시지는 내보내지 않는다
    const stage = /^[A-Z_]{3,40}$/.test(e?.message)
      ? e.message
      : e?.name === "TypeError"
        ? "SETUP_TYPE"
        : "SETUP";
    return json({ error: "GATEWAY_UNAVAILABLE", stage }, 503);
  }
}

if (globalThis.Deno?.serve) globalThis.Deno.serve(handle);
