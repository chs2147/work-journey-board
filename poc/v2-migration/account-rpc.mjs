// G 운영 준비 계정 한도·관리자 전송(서버 전용, docs/v2-design/96 Q-2) — wjb_v2_account(usage/admin_list/admin_set) +
// admin_invite(관리자 확인 뒤 Auth 관리 API로 계정 미리 만들기, 메일 안 보냄). 환경변수를 읽지 않는다.
// 관리자인지는 화면이 아니라 서버 함수가 매번 확인한다(초대도 먼저 서버 함수로 관리자 확인).
import { GatewayError, readLimited, serverKeyHeaders, serverKeyKind } from "../v2-gateway/io.mjs";
import { isAllowedProjectRef } from "../v2-cloud/cloud-environment.mjs";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const email = /^[^\s@'"\\]{1,64}@[^\s@'"\\]{1,190}\.[^\s@'"\\]{2,}$/;
const errors = new Set([
  "ACCOUNT_INVALID_REQUEST",
  "ACCOUNT_ACCESS_DENIED",
  "ACCOUNT_NOT_ADMIN",
  "ACCOUNT_NOT_FOUND",
  "ACCOUNT_ADMIN_FIXED",
]);
export const ACCOUNT_ACTIONS = Object.freeze(["usage", "admin_list", "admin_set", "admin_invite"]);
export const ACCOUNT_BODY_LIMIT = 4096;
const SET_KEYS = new Set(["userId", "images", "spaces", "records", "unlimited", "suspended", "reset"]);
const limitOk = (v) => v === null || (Number.isSafeInteger(v) && v >= 0 && v <= 1e12);

export function checkAccountParams(action, p) {
  if (!p || typeof p !== "object" || Array.isArray(p)) return false;
  const keys = Object.keys(p);
  if (action === "usage" || action === "admin_list") return keys.length === 0;
  if (action === "admin_invite")
    return keys.join() === "email" && typeof p.email === "string" && email.test(p.email);
  return (
    uuid.test(p.userId) &&
    keys.every((k) => SET_KEYS.has(k)) &&
    ["images", "spaces", "records"].every((k) => !(k in p) || limitOk(p[k])) &&
    ["unlimited", "suspended", "reset"].every((k) => !(k in p) || typeof p[k] === "boolean")
  );
}

export function createAccountRPC({ projectRef, serviceRoleKey, fetchTransport }) {
  if (
    !isAllowedProjectRef(projectRef) ||
    !serverKeyKind(serviceRoleKey) ||
    typeof fetchTransport !== "function"
  )
    throw Error("SERVER_TRANSPORT_REQUIRED");
  const rpcUrl = new URL(`https://${projectRef}.supabase.co/rest/v1/rpc/wjb_v2_account`);
  const usersUrl = new URL(`https://${projectRef}.supabase.co/auth/v1/admin/users`);
  const headers = {
    ...serverKeyHeaders(serviceRoleKey),
    "content-type": "application/json",
    "cache-control": "no-store",
  };
  async function rpc(action, params, principal, deviceId) {
    const body = JSON.stringify({
      p_request: { action, params, userId: principal.userId, sessionId: principal.sessionId, deviceId },
    });
    let response;
    try {
      response = await fetchTransport(rpcUrl, {
        method: "POST",
        headers,
        body,
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new GatewayError("ACCOUNT_UNAVAILABLE", 503);
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
          code === "ACCOUNT_ACCESS_DENIED" || code === "ACCOUNT_NOT_ADMIN"
            ? 403
            : code === "ACCOUNT_NOT_FOUND"
              ? 404
              : 400,
        );
      throw new GatewayError("ACCOUNT_UNAVAILABLE", 503);
    }
    try {
      const v = JSON.parse((await readLimited(response, 400_000, { timeoutMs: 20000 })).toString("utf8"));
      if (!v || typeof v !== "object" || Array.isArray(v)) throw Error();
      return v;
    } catch {
      throw new GatewayError("ACCOUNT_UNAVAILABLE", 503);
    }
  }
  return Object.freeze({
    async call(action, params, principal, deviceId) {
      if (
        !ACCOUNT_ACTIONS.includes(action) ||
        !checkAccountParams(action, params) ||
        !uuid.test(principal?.userId) ||
        !uuid.test(principal?.sessionId) ||
        principal.role !== "authenticated" ||
        !uuid.test(deviceId)
      )
        throw new GatewayError("INVALID_RPC");
      if (action !== "admin_invite") return rpc(action, params, principal, deviceId);
      // 초대: 서버 함수로 관리자 확인 → 계정 미리 만들기(메일 안 보냄, 이미 있으면 그대로)
      const me = await rpc("usage", {}, principal, deviceId);
      if (me.admin !== true) throw new GatewayError("ACCOUNT_NOT_ADMIN", 403);
      let response;
      try {
        response = await fetchTransport(usersUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({ email: params.email.trim().toLowerCase(), email_confirm: true }),
          redirect: "error",
          signal: AbortSignal.timeout(20000),
        });
      } catch {
        throw new GatewayError("ACCOUNT_UNAVAILABLE", 503);
      }
      if (response.ok) {
        await response.body?.cancel();
        return { invited: true, created: true };
      }
      const text = (await readLimited(response, 4096).catch(() => Buffer.from(""))).toString("utf8");
      if (response.status === 422 || /already/i.test(text)) return { invited: true, created: false };
      throw new GatewayError("ACCOUNT_UNAVAILABLE", 503);
    },
  });
}
