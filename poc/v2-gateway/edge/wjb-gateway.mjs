// Supabase Edge Function 진입점(docs/v2-design/79-preview-dev-connection.md). G-3(97): 개발·운영 허용 목록 —
// 돌고 있는 프로젝트를 SUPABASE_URL로 확인하고 그 프로젝트·버킷으로만 요청한다(배포는 개발만, 운영은 G-2 승인 뒤).
// - 기존 gateway(자산 예약·업로드·취소)는 그대로 넘기고, 계정 확인 `GET /v2/me`만 더한다.
// - 서버 전용 열쇠(G-4): Supabase가 넣는 SUPABASE_SECRET_KEYS의 `wjb_gateway` 비밀 키(sb_secret_, 사용자가 대시보드에서 만듦).
//   바꾸는 동안만 예전 비밀 WJB_GATEWAY_SERVICE_ROLE_JWT(service_role JWT)로 대신한다. 값은 어디에도 내보내지 않는다.
//   앱·요청 본문에서 받지 않는다.
// - JWKS는 같은 개발 프로젝트의 공개 주소에서만 읽는다(토큰이 가리키는 주소를 따라가지 않음).
import { createDevelopmentGateway } from "../development-gateway.mjs";
import { environmentOf, runtimeProjectRef } from "../../v2-cloud/cloud-environment.mjs";
import { createSupabaseRest } from "../supabase-rest.mjs";
import { createSessionVerifier } from "../../v2-auth/session-adapter.mjs";
import { createMigrationRPC } from "../../v2-migration/server-rpc.mjs";
import { createWorkspaceReadRPC, READ_ACTIONS } from "../../v2-migration/read-rpc.mjs";
import { createWorkspaceSyncRPC, SYNC_ACTIONS, SYNC_BODY_LIMIT } from "../../v2-migration/sync-rpc.mjs";
import { ACCOUNT_ACTIONS, ACCOUNT_BODY_LIMIT, createAccountRPC } from "../../v2-migration/account-rpc.mjs";
import {
  LIFECYCLE_ACTIONS,
  LIFECYCLE_BODY_LIMIT,
  createLifecycleRPC,
  runPurge,
} from "../../v2-migration/lifecycle-rpc.mjs";
import { GatewayError, readLimited, serverKeyKind, uuid } from "../io.mjs";

/** 개발용 영구 비공개 버킷(C-1b, docs/v2-design/82) — 시험마다 만들고 지우는 POC 버킷과 다르다 */
export const DEV_BUCKET = "wjb-v2-dev-assets";
/** G-3(97): 환경마다 그림 버킷 하나(운영 버킷은 G-2에서 만든다) */
export const ASSET_BUCKETS = Object.freeze({ development: DEV_BUCKET, production: "wjb-v2-assets" });
// 앱이 직접 부를 수 있는 이관 명령(attest·confirm_absent는 서버가 바이트를 확인한 뒤에만 — 아래 전용 경로)
const CLIENT_ACTIONS = new Set([
  "upload_begin",
  "upload_page",
  "upload_status",
  "start_upload",
  "status",
  "workspace",
  "renew",
  "observe",
  "prepare_publish",
  "publish",
  "publication",
  "cancel",
  "finish_cancel",
]);
const sha = /^[0-9a-f]{64}$/;

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
let currentRef = null;
const projectRefOf = () => currentRef;

/** G-4: 서버 열쇠 고르기 — 새 비밀 키 `wjb_gateway` 먼저, 없으면(바꾸는 동안) 예전 service_role JWT */
export function runtimeServerKey(env) {
  let keys;
  try {
    keys = JSON.parse(env("SUPABASE_SECRET_KEYS") ?? "{}") ?? {};
  } catch {
    keys = {};
  }
  const fresh = typeof keys === "object" ? keys.wjb_gateway : undefined;
  if (serverKeyKind(fresh) === "secret") return { key: fresh, kind: "secret" };
  const legacy = env("WJB_GATEWAY_SERVICE_ROLE_JWT") ?? "";
  if (legacy.startsWith("eyJ") && serverKeyKind(legacy) === "legacy") return { key: legacy, kind: "legacy" };
  throw new Error("RUNTIME_KEY_UNAVAILABLE");
}
async function setup() {
  // G-3: 이 함수가 돌고 있는 프로젝트(Supabase가 넣는 SUPABASE_URL)를 허용 목록(개발·운영)으로 확인 — 그 프로젝트로만 요청
  const projectRef = runtimeProjectRef(globalThis.Deno?.env.get("SUPABASE_URL"));
  currentRef = projectRef;
  const bucket = ASSET_BUCKETS[environmentOf(projectRef)];
  // 예약 SUPABASE_SERVICE_ROLE_KEY는 예전 형식이 아니어서, 사용자가 대시보드에 넣은 예전 형식(JWT) 비밀만 읽는다
  // (예전 키는 2027년 초 은퇴 예정 — 운영 전 새 형식 키로 옮긴다, 79문서)
  const { key: serviceRoleKey, kind: keyKind } = runtimeServerKey((name) => globalThis.Deno?.env.get(name));
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
  const gateway = createDevelopmentGateway({
    projectRef,
    serviceRoleKey,
    jwks,
    fetchTransport,
    bucket,
  });
  const rest = createSupabaseRest({ projectRef, serviceRoleKey, fetchTransport, bucket });
  const verify = createSessionVerifier({ projectRef, jwks, callServerRpc: rest.callServerRpc });
  const rpc = createMigrationRPC({
    projectRef,
    serviceRoleKey,
    fetchTransport,
    allowWorkspaceProfiles: true,
  });
  const reader = createWorkspaceReadRPC({ projectRef, serviceRoleKey, fetchTransport });
  const syncer = createWorkspaceSyncRPC({ projectRef, serviceRoleKey, fetchTransport });
  const accounts = createAccountRPC({ projectRef, serviceRoleKey, fetchTransport });
  const lifecycle = createLifecycleRPC({ projectRef, serviceRoleKey, fetchTransport });
  return { gateway, verify, rest, rpc, reader, syncer, accounts, lifecycle, keyKind };
}

export async function handle(request) {
  try {
    ready ??= setup().catch((e) => {
      ready = null;
      throw e;
    });
    const { gateway, verify, rest, rpc, reader, syncer, accounts, lifecycle, keyKind } = await ready;
    // G-5(100): 지울 그림·Auth 사용자 정리 — 응답을 막지 않게 뒤에서(Supabase EdgeRuntime.waitUntil), 실패는 다음 차례에
    const purgeLater = (budgetMs) => {
      const work = runPurge({ lifecycle, storage: rest.storage, budgetMs }).catch(() => undefined);
      globalThis.EdgeRuntime?.waitUntil?.(work);
      return work;
    };
    const url = new URL(request.url);
    const path = url.pathname.startsWith(prefix + "/") ? url.pathname.slice(prefix.length) : url.pathname;
    if (path === "/v2/me") {
      if (request.method !== "GET" || url.search) return json({ error: "NOT_FOUND" }, 404);
      if (request.headers.has("origin")) return json({ error: "ORIGIN_DENIED" }, 403);
      const auth = request.headers.get("authorization") ?? "";
      if (!/^Bearer [^\s,]+$/.test(auth)) return json({ error: "AUTH_REQUIRED" }, 401);
      try {
        const p = await verify(auth.slice(7));
        // 열쇠 종류만(값 없음) — G-4 전환 확인용
        return json({
          accountId: p.userId,
          sessionActive: true,
          project: environmentOf(projectRefOf()),
          serverKey: keyKind,
        });
      } catch (e) {
        const code = ["AUTH_REQUIRED", "ACCESS_REVOKED", "AUTH_UNAVAILABLE"].includes(e?.code)
          ? e.code
          : "AUTH_REQUIRED";
        return json({ error: code }, code === "AUTH_UNAVAILABLE" ? 503 : 401);
      }
    }
    const route = path.match(/^\/v2\/(?:devices|migrations\/([^/]+)\/([a-z_-]+))$/);
    if (route) return await control(request, url, route, { verify, rest, rpc });
    const readRoute = path.match(/^\/v2\/read\/([a-z]+)$/);
    if (readRoute)
      return await serverCall(request, url, readRoute[1], {
        verify,
        actions: READ_ACTIONS,
        limit: 8192,
        call: (a, p, who, dev) => reader.read(a, p, who, dev),
      });
    const syncRoute = path.match(/^\/v2\/sync\/([a-z_]+)$/);
    if (syncRoute)
      return await serverCall(request, url, syncRoute[1], {
        verify,
        actions: SYNC_ACTIONS,
        limit: SYNC_BODY_LIMIT,
        call: (a, p, who, dev) => syncer.call(a, p, who, dev),
      });
    // G 운영 준비(96): 계정 사용량·관리자 기능 — 관리자 확인은 서버 함수 안에서
    const accountRoute = path.match(/^\/v2\/account\/([a-z_]+)$/);
    if (accountRoute)
      return await serverCall(request, url, accountRoute[1], {
        verify,
        actions: ACCOUNT_ACTIONS,
        limit: ACCOUNT_BODY_LIMIT,
        call: async (a, p, who, dev) => {
          const r = await accounts.call(a, p, who, dev);
          if (a === "usage") void purgeLater(4000);
          return r;
        },
      });
    // G-5(100): 공간 지우기·계정 삭제 — 소유·관리자 확인은 서버 함수 안에서. 기록은 바로, 그림 실물은 뒤에서 지운다
    const lifeRoute = path.match(/^\/v2\/lifecycle\/([a-z_]+)$/);
    if (lifeRoute)
      return await serverCall(request, url, lifeRoute[1], {
        verify,
        actions: LIFECYCLE_ACTIONS,
        limit: LIFECYCLE_BODY_LIMIT,
        call: async (a, p, who, dev) => {
          const r = await lifecycle.call(a, p, who, dev);
          void purgeLater(8000);
          return r;
        },
      });
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

/**
 * 서버 전용 RPC 경로: D단계 읽기(87, /v2/read/*) · E-2 동기화(90, /v2/sync/*).
 * 사용자 토큰 → 서버 확인 → 서버 전용 RPC(service role은 gateway 안에서만)
 */
async function serverCall(request, url, action, { verify, actions, limit, call }) {
  try {
    if (request.method !== "POST" || url.search || !actions.includes(action))
      throw new GatewayError("NOT_FOUND", 404);
    if (request.headers.has("origin")) throw new GatewayError("ORIGIN_DENIED", 403);
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
      throw new GatewayError("INVALID_CONTENT_TYPE", 415);
    const auth = request.headers.get("authorization") ?? "";
    if (!/^Bearer [^\s,]+$/.test(auth)) throw new GatewayError("AUTH_REQUIRED", 401);
    let principal;
    try {
      principal = await verify(auth.slice(7));
    } catch (e) {
      const code = ["AUTH_UNAVAILABLE", "ACCESS_REVOKED"].includes(e?.code) ? e.code : "AUTH_REQUIRED";
      throw new GatewayError(code, code === "AUTH_UNAVAILABLE" ? 503 : 401);
    }
    let body;
    try {
      body = JSON.parse((await readLimited(request, limit, { timeoutMs: 30000 })).toString("utf8"));
    } catch (e) {
      if (e instanceof GatewayError) throw e;
      throw new GatewayError("INVALID_JSON");
    }
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).sort().join() !== "deviceId,params" ||
      !uuid.test(body.deviceId)
    )
      throw new GatewayError("INVALID_REQUEST");
    return json(await call(action, body.params, principal, body.deviceId.toLowerCase()));
  } catch (e) {
    if (e instanceof GatewayError) return json({ error: e.code }, e.status);
    return json({ error: "GATEWAY_UNAVAILABLE" }, 503);
  }
}

/** 기기 등록·이관 명령(C-1b). 사용자 토큰 → 서버 확인 → 서버 전용 RPC. 요청 본문에서 계정·세션을 받지 않는다 */
async function control(request, url, route, { verify, rest, rpc }) {
  try {
    if (request.method !== "POST" || url.search) throw new GatewayError("NOT_FOUND", 404);
    if (request.headers.has("origin")) throw new GatewayError("ORIGIN_DENIED", 403);
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
      throw new GatewayError("INVALID_CONTENT_TYPE", 415);
    const auth = request.headers.get("authorization") ?? "";
    if (!/^Bearer [^\s,]+$/.test(auth)) throw new GatewayError("AUTH_REQUIRED", 401);
    let principal;
    try {
      principal = await verify(auth.slice(7));
    } catch (e) {
      const code =
        e?.code === "AUTH_UNAVAILABLE"
          ? "AUTH_UNAVAILABLE"
          : e?.code === "ACCESS_REVOKED"
            ? "ACCESS_REVOKED"
            : "AUTH_REQUIRED";
      throw new GatewayError(code, code === "AUTH_UNAVAILABLE" ? 503 : 401);
    }
    let body;
    try {
      body = JSON.parse((await readLimited(request, 1100000, { timeoutMs: 30000 })).toString("utf8"));
    } catch (e) {
      if (e instanceof GatewayError) throw e;
      throw new GatewayError("INVALID_JSON");
    }
    if (!body || typeof body !== "object" || Array.isArray(body) || !uuid.test(body.deviceId))
      throw new GatewayError("INVALID_REQUEST");
    const deviceId = body.deviceId.toLowerCase();
    if (!route[1]) {
      if (Object.keys(body).join() !== "deviceId") throw new GatewayError("INVALID_REQUEST");
      const r = await rest.callServerRpc("wjb_v2_device_register", {
        p_user: principal.userId,
        p_session: principal.sessionId,
        p_device: deviceId,
      });
      if (r?.deviceId !== deviceId || r.registered !== true)
        throw new GatewayError("DEVICE_UNAVAILABLE", 503);
      return json({ deviceId, registered: true });
    }
    const jobId = route[1].toLowerCase(),
      action = route[2];
    if (!uuid.test(jobId) || Object.keys(body).sort().join() !== "deviceId,params")
      throw new GatewayError("INVALID_REQUEST");
    const params = body.params;
    if (CLIENT_ACTIONS.has(action))
      return json(await rpc.call({ action, jobId, params }, principal, deviceId));
    if (action !== "attest" && action !== "confirm-absent") throw new GatewayError("NOT_FOUND", 404);
    // 서버 확인 후 정산: 관측(상태·입출력 판) → Storage에서 바이트 다시 읽기/부재 확인 → attest/confirm_absent
    if (
      !params ||
      Object.keys(params).sort().join() !== "manifestHash,objectId" ||
      !sha.test(params.manifestHash) ||
      !uuid.test(params.objectId)
    )
      throw new GatewayError("INVALID_REQUEST");
    const ob = await rpc.call({ action: "observe", jobId, params }, principal, deviceId);
    const status = await rpc.call(
      { action: "status", jobId, params: { manifestHash: params.manifestHash } },
      principal,
      deviceId,
    );
    const scope = { workspaceId: status.workspaceId, assetId: params.objectId, deviceId, generation: "1" };
    if (!ob.operationSettled) throw new GatewayError("MIGRATION_IO_UNSETTLED", 409);
    if (action === "attest") {
      if (ob.assetState !== "ready") throw new GatewayError("ASSET_NOT_READY", 409);
      const bytes = await rest.storage.get(scope, ob.bytes);
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      if (bytes.length !== ob.bytes || digest !== ob.sha256)
        throw new GatewayError("INTEGRITY_MISMATCH", 409);
      return json(
        await rpc.call(
          {
            action: "attest",
            jobId,
            params: { ...params, ioVersion: ob.ioVersion, sha256: digest, bytes: bytes.length },
          },
          principal,
          deviceId,
        ),
      );
    }
    try {
      await rest.storage.get(scope, ob.bytes);
      throw new GatewayError("DELETE_NOT_CONFIRMED", 409);
    } catch (e) {
      if (e?.code !== "OBJECT_MISSING") throw e;
    }
    return json(
      await rpc.call(
        { action: "confirm_absent", jobId, params: { ...params, ioVersion: ob.ioVersion } },
        principal,
        deviceId,
      ),
    );
  } catch (e) {
    if (e instanceof GatewayError) return json({ error: e.code }, e.status);
    return json({ error: "GATEWAY_UNAVAILABLE" }, 503);
  }
}

if (globalThis.Deno?.serve) globalThis.Deno.serve(handle);
