// D단계 서버 읽기 전송(서버 전용, docs/v2-design/87) — wjb_v2_workspace_read(list/header/records). 환경변수를 읽지 않는다.
import { GatewayError, readLimited, serverKeyHeaders, serverKeyKind } from "../v2-gateway/io.mjs";
import { isAllowedProjectRef } from "../v2-cloud/cloud-environment.mjs";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha = /^[0-9a-f]{64}$/;
const errors = new Set([
  "READ_INVALID_REQUEST",
  "READ_ACCESS_DENIED",
  "READ_NOT_FOUND",
  "READ_MANIFEST_CHANGED",
]);
export const READ_ACTIONS = Object.freeze(["list", "header", "records"]);
const keys = (o, k) =>
  o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).sort().join() === [...k].sort().join();

export function checkReadParams(action, p) {
  if (action === "list") return keys(p, []);
  if (action === "header") return keys(p, ["workspaceId"]) && uuid.test(p.workspaceId);
  if (action === "records")
    return (
      keys(p, ["workspaceId", "manifestHash", "after", "limit"]) &&
      uuid.test(p.workspaceId) &&
      sha.test(p.manifestHash) &&
      Number.isInteger(p.limit) &&
      p.limit >= 1 &&
      p.limit <= 1000 &&
      (p.after === null ||
        (Array.isArray(p.after) &&
          p.after.length === 2 &&
          p.after.every((s) => typeof s === "string" && s.length <= 128)))
    );
  return false;
}

export function createWorkspaceReadRPC({ projectRef, serviceRoleKey, fetchTransport }) {
  if (
    !isAllowedProjectRef(projectRef) ||
    !serverKeyKind(serviceRoleKey) ||
    typeof fetchTransport !== "function"
  )
    throw Error("SERVER_TRANSPORT_REQUIRED");
  const url = new URL(`https://${projectRef}.supabase.co/rest/v1/rpc/wjb_v2_workspace_read`);
  return Object.freeze({
    async read(action, params, principal, deviceId) {
      if (
        !READ_ACTIONS.includes(action) ||
        !checkReadParams(action, params) ||
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
            ...serverKeyHeaders(serviceRoleKey),
            "content-type": "application/json",
            "cache-control": "no-store",
          },
          body,
          redirect: "error",
          signal: AbortSignal.timeout(20000),
        });
      } catch {
        throw new GatewayError("READ_UNAVAILABLE", 503);
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
            code === "READ_ACCESS_DENIED" ? 403 : code === "READ_NOT_FOUND" ? 404 : 409,
          );
        throw new GatewayError("READ_UNAVAILABLE", 503);
      }
      try {
        const v = JSON.parse((await readLimited(response, 1_200_000, { timeoutMs: 20000 })).toString("utf8"));
        if (!v || typeof v !== "object" || Array.isArray(v)) throw Error();
        return v;
      } catch {
        throw new GatewayError("READ_UNAVAILABLE", 503);
      }
    },
  });
}
