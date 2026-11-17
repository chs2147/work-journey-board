// E-2 서버 동기화 전송(서버 전용, docs/v2-design/90) — wjb_v2_workspace_sync(push/pull/asset_declare). 환경변수를 읽지 않는다.
import { GatewayError, readLimited } from "../v2-gateway/io.mjs";
import { isAllowedProjectRef } from "../v2-cloud/cloud-environment.mjs";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha = /^[0-9a-f]{64}$/;
const errors = new Set([
  "SYNC_INVALID_REQUEST",
  "SYNC_INVALID_CHANGE",
  "SYNC_ACCESS_DENIED",
  "SYNC_NOT_FOUND",
  "SYNC_IDEMPOTENCY_MISMATCH",
  "SYNC_INLINE_IMAGE",
  "SYNC_ASSET_NOT_READY",
  "SYNC_ASSET_CONFLICT",
  "SYNC_CURSOR_AHEAD",
  "SYNC_LIMIT",
  // G 운영 준비(96): 기록 한도·안전선·정지 — 보낸 것은 서버에 들어가지 않고 이 기기 대기열에 남는다
  "QUOTA_ACCOUNT_RECORDS",
  "QUOTA_ACCOUNT_IMAGES",
  "QUOTA_PROJECT",
  "ACCOUNT_SUSPENDED",
]);
export const SYNC_ACTIONS = Object.freeze(["push", "pull", "asset_declare"]);
/** 한 요청 본문 한도(서버 함수 1.1MB와 같음) */
export const SYNC_BODY_LIMIT = 1_100_000;
const keys = (o, k) =>
  o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).sort().join() === [...k].sort().join();

export function checkSyncParams(action, p) {
  if (!p || typeof p !== "object" || Array.isArray(p) || !uuid.test(p.workspaceId)) return false;
  if (action === "pull")
    return (
      keys(p, ["workspaceId", "after", "limit"]) &&
      typeof p.after === "string" &&
      /^(0|[1-9][0-9]{0,17})$/.test(p.after) &&
      Number.isInteger(p.limit) &&
      p.limit >= 1 &&
      p.limit <= 1000
    );
  if (action === "asset_declare")
    return (
      keys(p, ["workspaceId", "objectId", "sha256", "bytes"]) &&
      uuid.test(p.objectId) &&
      sha.test(p.sha256) &&
      Number.isInteger(p.bytes) &&
      p.bytes >= 1 &&
      p.bytes <= 10 * 1024 * 1024
    );
  if (action === "push")
    return (
      keys(p, ["workspaceId", "opId", "changes"]) &&
      uuid.test(p.opId) &&
      Array.isArray(p.changes) &&
      p.changes.length >= 1 &&
      p.changes.length <= 500 &&
      p.changes.every(
        (c) =>
          keys(c, ["table", "key", "baseRev", "value"]) &&
          typeof c.table === "string" &&
          /^[a-z][a-z0-9_]{0,62}$/.test(c.table) &&
          sha.test(c.key) &&
          (c.baseRev === null || (Number.isSafeInteger(c.baseRev) && c.baseRev >= 0)) &&
          (c.value === null || (typeof c.value === "object" && !Array.isArray(c.value))),
      )
    );
  return false;
}

export function createWorkspaceSyncRPC({ projectRef, serviceRoleKey, fetchTransport }) {
  if (
    !isAllowedProjectRef(projectRef) ||
    typeof serviceRoleKey !== "string" ||
    !serviceRoleKey ||
    /[\r\n]/.test(serviceRoleKey) ||
    serviceRoleKey.startsWith("sbp_") ||
    serviceRoleKey.startsWith("sb_secret_") ||
    typeof fetchTransport !== "function"
  )
    throw Error("SERVER_TRANSPORT_REQUIRED");
  const url = new URL(`https://${projectRef}.supabase.co/rest/v1/rpc/wjb_v2_workspace_sync`);
  return Object.freeze({
    async call(action, params, principal, deviceId) {
      if (
        !SYNC_ACTIONS.includes(action) ||
        !checkSyncParams(action, params) ||
        !uuid.test(principal?.userId) ||
        !uuid.test(principal?.sessionId) ||
        principal.role !== "authenticated" ||
        !uuid.test(deviceId)
      )
        throw new GatewayError("INVALID_RPC");
      const body = JSON.stringify({
        p_request: { action, params, userId: principal.userId, sessionId: principal.sessionId, deviceId },
      });
      let response;
      try {
        response = await fetchTransport(url, {
          method: "POST",
          headers: {
            apikey: serviceRoleKey,
            authorization: `Bearer ${serviceRoleKey}`,
            "content-type": "application/json",
            "cache-control": "no-store",
          },
          body,
          redirect: "error",
          signal: AbortSignal.timeout(20000),
        });
      } catch {
        throw new GatewayError("SYNC_UNAVAILABLE", 503);
      }
      if (!response.ok) {
        let code;
        try {
          const v = JSON.parse((await readLimited(response, 4096)).toString("utf8"));
          if (v.code === "P0001" && errors.has(v.message)) code = v.message;
        } catch {
          /* 알 수 없는 응답은 아래 고정 오류 */
        }
        if (code)
          throw new GatewayError(
            code,
            code === "SYNC_ACCESS_DENIED"
              ? 403
              : code === "SYNC_NOT_FOUND"
                ? 404
                : /^SYNC_INVALID/.test(code)
                  ? 400
                  : 409,
          );
        throw new GatewayError("SYNC_UNAVAILABLE", 503);
      }
      try {
        const v = JSON.parse((await readLimited(response, 1_200_000, { timeoutMs: 20000 })).toString("utf8"));
        if (!v || typeof v !== "object" || Array.isArray(v)) throw Error();
        return v;
      } catch {
        throw new GatewayError("SYNC_UNAVAILABLE", 503);
      }
    },
  });
}
