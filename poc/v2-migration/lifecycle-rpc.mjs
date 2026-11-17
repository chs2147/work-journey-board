// G-5 데이터 수명(서버 전용, docs/v2-design/100) — wjb_v2_lifecycle(delete_space/delete_account, 사용자 세션 확인) +
// wjb_v2_lifecycle_worker(next/confirm/sweep/auth_pending/auth_deleted, 사용자 없음) + Auth 사용자 지우기.
// 그림 실물은 storage.remove(지운 뒤 없는 것까지 확인)로만 지우고, 확인된 것만 서버에 confirm → 용량 반환. 환경변수를 읽지 않는다.
import { GatewayError, readLimited, serverKeyHeaders, serverKeyKind } from "../v2-gateway/io.mjs";
import { isAllowedProjectRef } from "../v2-cloud/cloud-environment.mjs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const LIFECYCLE_ACTIONS = Object.freeze(["delete_space", "delete_account"]);
export const LIFECYCLE_BODY_LIMIT = 2048;
const errors = new Set([
  "LIFE_INVALID_REQUEST",
  "LIFE_ACCESS_DENIED",
  "LIFE_NOT_FOUND",
  "LIFE_NOT_PENDING",
  "ACCOUNT_NOT_ADMIN",
  "ACCOUNT_ADMIN_FIXED",
  "ACCOUNT_NOT_FOUND",
]);
const status = (code) =>
  code === "LIFE_ACCESS_DENIED" || code === "ACCOUNT_NOT_ADMIN" || code === "ACCOUNT_ADMIN_FIXED"
    ? 403
    : code === "LIFE_NOT_FOUND" || code === "ACCOUNT_NOT_FOUND"
      ? 404
      : 400;

export function checkLifecycleParams(action, p) {
  if (!p || typeof p !== "object" || Array.isArray(p)) return false;
  const keys = Object.keys(p).sort().join();
  if (action === "delete_space") return keys === "workspaceId" && uuid.test(p.workspaceId);
  if (action === "delete_account") return keys === "" || (keys === "userId" && uuid.test(p.userId));
  return false;
}

export function createLifecycleRPC({ projectRef, serviceRoleKey, fetchTransport }) {
  if (
    !isAllowedProjectRef(projectRef) ||
    !serverKeyKind(serviceRoleKey) ||
    typeof fetchTransport !== "function"
  )
    throw Error("SERVER_TRANSPORT_REQUIRED");
  const origin = `https://${projectRef}.supabase.co`;
  const headers = {
    ...serverKeyHeaders(serviceRoleKey),
    "content-type": "application/json",
    "cache-control": "no-store",
  };
  async function post(fn, p_request) {
    let response;
    try {
      response = await fetchTransport(new URL(`/rest/v1/rpc/${fn}`, origin), {
        method: "POST",
        headers,
        body: JSON.stringify({ p_request }),
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new GatewayError("LIFE_UNAVAILABLE", 503);
    }
    if (!response.ok) {
      let code;
      try {
        const v = JSON.parse((await readLimited(response, 4096)).toString("utf8"));
        if (v.code === "P0001" && errors.has(v.message)) code = v.message;
      } catch {
        /* 알 수 없는 응답은 아래 고정 오류 */
      }
      if (code) throw new GatewayError(code, status(code));
      throw new GatewayError("LIFE_UNAVAILABLE", 503);
    }
    try {
      const v = JSON.parse((await readLimited(response, 200_000, { timeoutMs: 30000 })).toString("utf8"));
      if (!v || typeof v !== "object" || Array.isArray(v)) throw Error();
      return v;
    } catch {
      throw new GatewayError("LIFE_UNAVAILABLE", 503);
    }
  }
  const worker = (action, params) => post("wjb_v2_lifecycle_worker", { action, params });
  return Object.freeze({
    /** 사용자 요청 — 서버 함수가 세션·기기·소유·관리자를 확인 */
    async call(action, params, principal, deviceId) {
      if (
        !LIFECYCLE_ACTIONS.includes(action) ||
        !checkLifecycleParams(action, params) ||
        !uuid.test(principal?.userId) ||
        !uuid.test(principal?.sessionId) ||
        principal.role !== "authenticated" ||
        !uuid.test(deviceId)
      )
        throw new GatewayError("INVALID_RPC");
      return post("wjb_v2_lifecycle", {
        action,
        params,
        userId: principal.userId,
        sessionId: principal.sessionId,
        deviceId,
      });
    },
    worker,
    /** Auth 사용자 지우기(관리 API). 이미 없으면(404) 지운 것으로 본다 */
    async deleteAuthUser(userId) {
      if (!uuid.test(userId)) throw new GatewayError("INVALID_RPC");
      let response;
      try {
        response = await fetchTransport(new URL(`/auth/v1/admin/users/${userId.toLowerCase()}`, origin), {
          method: "DELETE",
          headers,
          redirect: "error",
          signal: AbortSignal.timeout(20000),
        });
      } catch {
        throw new GatewayError("LIFE_UNAVAILABLE", 503);
      }
      await response.body?.cancel();
      if (response.ok || response.status === 404) return true;
      throw new GatewayError("LIFE_UNAVAILABLE", 503);
    },
  });
}

/**
 * 지울 그림 실물을 지우고(없는 것까지 확인) 서버에 confirm, 지운 계정의 Auth 사용자 지우기.
 * 시간 예산 안에서만(요청 하나가 오래 걸리지 않게). 실패한 것은 다음 차례에 다시 — 확인 못 한 것은 용량을 돌려주지 않는다.
 */
export async function runPurge({ lifecycle, storage, limit = 20, budgetMs = 5000, now = () => Date.now() }) {
  const until = now() + budgetMs;
  const out = { removed: 0, failed: 0, authDeleted: 0, pendingSpaces: null };
  const next = await lifecycle.worker("next", { limit });
  out.pendingSpaces = next.pendingSpaces ?? null;
  for (const it of next.items ?? []) {
    if (now() > until) break;
    if (!uuid.test(it?.workspaceId) || !uuid.test(it?.assetId) || !/^\d+$/.test(String(it?.ioVersion)))
      continue;
    try {
      await storage.remove({ workspaceId: it.workspaceId, assetId: it.assetId });
      await lifecycle.worker("confirm", {
        workspaceId: it.workspaceId,
        assetId: it.assetId,
        ioVersion: String(it.ioVersion),
      });
      out.removed++;
    } catch {
      out.failed++;
    }
  }
  if (now() <= until) {
    const pending = await lifecycle.worker("auth_pending", {});
    for (const userId of pending.users ?? []) {
      if (now() > until) break;
      try {
        await lifecycle.deleteAuthUser(userId);
        await lifecycle.worker("auth_deleted", { userId });
        out.authDeleted++;
      } catch {
        out.failed++;
      }
    }
  }
  return out;
}
