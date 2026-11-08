import { randomUUID } from "node:crypto";
import { GatewayError, scopeValid, uuid } from "./io.mjs";
const codes = new Set([
  "ACCESS_DENIED",
  "ACCESS_REVOKED",
  "GENERATION_CHANGED",
  "IDEMPOTENCY_KEY_REUSED",
  "ASSET_CANCELED",
  "CLEANUP_PENDING",
  "UPLOAD_EXPIRED",
  "QUOTA_EXCEEDED",
  "ASSET_NOT_FOUND",
  "LEASE_BUSY",
  "LEASE_LOST",
  "ASSET_NOT_PENDING",
  "ASSET_ALREADY_READY",
  "CLEANUP_CHANGED",
  "CLEANUP_UNCERTAIN",
  "STORAGE_NOT_CONFIRMED",
  "INTENT_LIMIT",
  "ASSET_LIMIT",
]);
export function createPostgresMetadata({ callServerRpc, onReleaseError = () => {} }) {
  if (typeof callServerRpc !== "function") throw new TypeError("Server RPC transport required");
  function validateRow(row, scope) {
    if (
      !row ||
      row.workspaceId !== scope.workspaceId ||
      row.assetId !== scope.assetId ||
      row.generation !== scope.generation ||
      !uuid.test(row.deviceId) ||
      !/^[0-9a-f]{64}$/.test(row.sha256) ||
      !Number.isInteger(row.bytes) ||
      row.bytes < 1 ||
      row.bytes > 65536 ||
      !["reserved", "ready", "cleanup", "canceled"].includes(row.state) ||
      !/^[0-9]+$/.test(row.ioVersion)
    )
      throw new GatewayError("METADATA_UNAVAILABLE", 503);
    return row;
  }
  async function command(principal, scope, action, params = {}) {
    if (!scopeValid(scope) || !uuid.test(principal?.userId) || !uuid.test(principal?.sessionId))
      throw new GatewayError("INVALID_SCOPE");
    try {
      return await callServerRpc("wjb_v2_asset_command", {
        p_request: { action, userId: principal.userId, sessionId: principal.sessionId, scope, params },
      });
    } catch (e) {
      if (codes.has(e?.code))
        throw new GatewayError(
          e.code,
          e.code === "ACCESS_DENIED" || e.code === "ACCESS_REVOKED"
            ? 403
            : e.code === "ASSET_NOT_FOUND"
              ? 404
              : 409,
        );
      throw new GatewayError("METADATA_UNAVAILABLE", 503);
    }
  }
  return {
    async reserve(principal, scope, spec) {
      return validateRow(await command(principal, scope, "reserve", spec), scope);
    },
    async withAsset(principal, scope, mode, fn) {
      const token = randomUUID();
      const row = validateRow(await command(principal, scope, "acquire", { token, mode }), scope);
      if (row.leaseToken !== token || !/^[1-9][0-9]*$/.test(row.fence))
        throw new GatewayError("METADATA_UNAVAILABLE", 503);
      const fence = row.fence,
        intent = randomUUID();
      let cleanupVersion;
      async function update(action, extra = {}) {
        const result = validateRow(
          await command(principal, scope, action, { token, fence, ...extra }),
          scope,
        );
        Object.assign(row, result);
        return result;
      }
      try {
        return await fn({
          row,
          recheck: () => update("recheck"),
          beginStorageWrite: () => update("begin_io", { intent }),
          settleStorageWrite: () => update("settle_io", { intent }),
          markReady: () => update("mark_ready"),
          async markCleanup() {
            await update("mark_cleanup");
            cleanupVersion = row.ioVersion;
          },
          markCanceled: () => update("mark_canceled", { ioVersion: cleanupVersion }),
        });
      } finally {
        try {
          await command(principal, scope, "release", { token, fence });
        } catch {
          try {
            onReleaseError("LEASE_RELEASE_UNCONFIRMED");
          } catch {
            /* no data is returned from observer */
          }
        }
      }
    },
  };
}
