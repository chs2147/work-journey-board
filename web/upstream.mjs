/* global AbortSignal, URL */
import { CLOUD_TARGETS } from "../poc/v2-cloud/cloud-environment.mjs";

const gateway = "/functions/v1/wjb-gateway/v2";
const uuid = /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i;

export class WebError extends Error {
  constructor(code, status) {
    super(code);
    this.status = status;
  }
}

export function createDevUpstream({ projectRef, publicKey, fetch, now = Date.now }) {
  if (
    projectRef !== CLOUD_TARGETS.development.projectRef ||
    !/^sb_publishable_[\w-]+$/.test(publicKey ?? "")
  ) {
    throw Error("DEV_AUTH_CONFIGURATION_REQUIRED");
  }
  const origin = `https://${projectRef}.supabase.co`;
  async function request(path, { body, access, method = "POST" } = {}) {
    const response = await fetch(new URL(path, origin), {
      method,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
      headers: {
        apikey: publicKey,
        ...(access ? { authorization: `Bearer ${access}` } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const value = response.status === 204 ? null : await response.json().catch(() => null);
    return { status: response.status, value };
  }
  function tokens({ status, value }, failure) {
    if ([400, 401, 403, 404, 422].includes(status)) throw new WebError(failure, 401);
    if (status === 429) throw new WebError("TRY_LATER", 429);
    if (
      status !== 200 ||
      !uuid.test(value?.user?.id) ||
      typeof value.user.email !== "string" ||
      typeof value.access_token !== "string" ||
      typeof value.refresh_token !== "string" ||
      !Number.isFinite(value.expires_in) ||
      value.expires_in <= 0
    )
      throw new WebError("UNAVAILABLE", 503);
    return {
      accountId: value.user.id.toLowerCase(),
      email: value.user.email,
      access: value.access_token,
      refresh: value.refresh_token,
      accessUntil: now() + value.expires_in * 1000,
    };
  }
  function gatewayValue({ status, value }) {
    if ([401, 403].includes(status)) throw new WebError("SIGN_IN_REQUIRED", 401);
    if (status !== 200 || !value || typeof value !== "object") throw new WebError("UNAVAILABLE", 503);
    return value;
  }
  async function workspaceCall(session, action, params) {
    const result = await request(gateway + action, {
      access: session.access,
      body: { deviceId: session.deviceId, params },
    });
    if (result.status === 404) throw new WebError("SPACE_NOT_FOUND", 404);
    if (result.value?.error === "ACCOUNT_SUSPENDED") throw new WebError("READ_ONLY", 403);
    if (params.kanbanMove) {
      if (["SYNC_LIMIT", "QUOTA_ACCOUNT_RECORDS", "QUOTA_PROJECT"].includes(result.value?.error))
        throw new WebError("SPACE_LIMIT", 409);
      if (result.value?.error === "SYNC_INVALID_CHANGE") throw new WebError("SPACE_CHANGED", 409);
    }
    if (result.status === 409) throw new WebError("SPACE_CHANGED", 409);
    return gatewayValue(result);
  }
  return {
    async send(email) {
      // The provider can return different delivery statuses for registered addresses.
      await request("/auth/v1/otp", { body: { email, create_user: false } });
    },
    async verify(email, code) {
      return tokens(
        await request("/auth/v1/verify", { body: { type: "email", email, token: code } }),
        "CODE_REJECTED",
      );
    },
    async refresh(refresh) {
      return tokens(
        await request("/auth/v1/token?grant_type=refresh_token", { body: { refresh_token: refresh } }),
        "SIGN_IN_REQUIRED",
      );
    },
    async check(session) {
      const value = gatewayValue(await request(gateway + "/me", { method: "GET", access: session.access }));
      if (
        value.accountId !== session.accountId ||
        value.sessionActive !== true ||
        value.project !== "development"
      ) {
        throw new WebError("SIGN_IN_REQUIRED", 401);
      }
    },
    async register(access, deviceId) {
      const result = await request(gateway + "/devices", { access, body: { deviceId } });
      if (["DEVICE_LIMIT", "DEVICE_REVOKED"].includes(result.value?.error)) {
        throw new WebError(result.value.error, 409);
      }
      const value = gatewayValue(result);
      if (value.registered !== true || value.deviceId !== deviceId) throw new WebError("UNAVAILABLE", 503);
    },
    async list({ access, deviceId }) {
      const value = gatewayValue(
        await request(gateway + "/read/list", { access, body: { deviceId, params: {} } }),
      );
      if (!Array.isArray(value.workspaces)) throw new WebError("UNAVAILABLE", 503);
      return value.workspaces
        .filter((space) => uuid.test(space.workspaceId))
        .map((space) => ({
          id: space.workspaceId,
          name:
            typeof space.workspace?.name === "string"
              ? space.workspace.name.slice(0, 80)
              : "온라인 워크스페이스",
          color: /^c[1-8]$/.test(space.workspace?.color) ? space.workspace.color : "c1",
        }));
    },
    header: (session, workspaceId) => workspaceCall(session, "/read/header", { workspaceId }),
    records: (session, workspaceId, manifestHash, after) =>
      workspaceCall(session, "/read/records", { workspaceId, manifestHash, after, limit: 500 }),
    pull: (session, workspaceId, after) =>
      workspaceCall(session, "/sync/pull", { workspaceId, after, limit: 500 }),
    async readAsset(session, workspaceId, objectId, signal) {
      const response = await fetch(
        new URL(`${gateway}/workspaces/${workspaceId}/assets/${objectId}/content`, origin),
        {
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]),
          headers: {
            apikey: publicKey,
            authorization: `Bearer ${session.access}`,
            "x-wjb-device-id": session.deviceId,
            "x-wjb-generation": "1",
          },
        },
      );
      if (
        response.status === 200 &&
        response.body &&
        response.headers.get("content-type") === "application/octet-stream"
      ) {
        return response;
      }
      await response.body?.cancel();
      if (response.status === 401) throw new WebError("SIGN_IN_REQUIRED", 401);
      if ([403, 404, 409].includes(response.status)) throw new WebError("ASSET_NOT_FOUND", 404);
      throw new WebError("WORKSPACE_UNAVAILABLE", 503);
    },
    pushText: (session, workspaceId, opId, key, baseRev, value) =>
      workspaceCall(session, "/sync/push", {
        workspaceId,
        opId,
        changes: [{ table: "entry_item", key, baseRev, value }],
      }),
    moveCard: (session, workspaceId, opId, key, baseRev, to) =>
      workspaceCall(session, "/sync/push", { workspaceId, opId, kanbanMove: { key, baseRev, to } }),
    async logout(access) {
      await request("/auth/v1/logout?scope=local", { access });
    },
  };
}
