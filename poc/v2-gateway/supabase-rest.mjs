import { CLOUD_TARGETS } from "../v2-cloud/cloud-environment.mjs";
import { URL } from "node:url";
import { GatewayError, readLimited, uuid } from "./io.mjs";
const bucket = "wjb-v2-poc-private";

// Explicit trusted transport required. No environment values or client URLs read.
export function createSupabaseRest({ projectRef, serviceRoleKey, fetchTransport }) {
  if (
    !Object.values(CLOUD_TARGETS).some((target) => target.projectRef === projectRef) ||
    typeof serviceRoleKey !== "string" ||
    !serviceRoleKey ||
    /[\r\n]/.test(serviceRoleKey) ||
    typeof fetchTransport !== "function"
  ) {
    throw new TypeError("Invalid server-only transport configuration");
  }
  const origin = `https://${projectRef}.supabase.co`;
  const pathFor = (scope) => {
    if (!uuid.test(scope.workspaceId) || !uuid.test(scope.assetId)) throw new GatewayError("INVALID_SCOPE");
    return `${scope.workspaceId}/${scope.assetId}`;
  };
  async function request(path, options = {}) {
    try {
      return await fetchTransport(new URL(path, origin), {
        ...options,
        redirect: "error",
        signal: globalThis.AbortSignal.timeout(5000),
        headers: {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
          "cache-control": "no-store",
          ...options.headers,
        },
      });
    } catch {
      throw new GatewayError("STORAGE_UNAVAILABLE", 503);
    }
  }
  async function get(scope, maxBytes) {
    if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 65536)
      throw new GatewayError("INVALID_LIMIT");
    const res = await request(`/storage/v1/object/authenticated/${bucket}/${pathFor(scope)}`);
    if (res.status === 404) {
      await res.body?.cancel();
      throw new GatewayError("OBJECT_MISSING", 404);
    }
    // Supabase Storage can encode object absence as HTTP 400 with an inner 404.
    // Match the observed object-specific payload; permission/bucket/unknown
    // errors must not confirm deletion or release reserved quota.
    if (res.status === 400) {
      let missing = false;
      try {
        const value = JSON.parse((await readLimited(res, 4096)).toString("utf8"));
        missing =
          String(value.statusCode) === "404" &&
          value.error === "not_found" &&
          value.message === "Object not found";
      } catch {
        // Malformed/oversized responses remain unavailable.
      }
      if (missing) throw new GatewayError("OBJECT_MISSING", 404);
      throw new GatewayError("STORAGE_UNAVAILABLE", 503);
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new GatewayError("STORAGE_UNAVAILABLE", 503);
    }
    try {
      return await readLimited(res, maxBytes);
    } catch {
      void res.body?.cancel().catch(() => {});
      throw new GatewayError("STORAGE_UNAVAILABLE", 503);
    }
  }
  return {
    storage: {
      async putIfAbsent(scope, bytes) {
        if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > 65536)
          throw new GatewayError("INVALID_LIMIT");
        const res = await request(`/storage/v1/object/${bucket}/${pathFor(scope)}`, {
          method: "POST",
          headers: { "content-type": "application/octet-stream", "x-upsert": "false" },
          body: bytes,
        });
        if (res.ok) {
          await res.body?.cancel();
          return;
        }
        let duplicate = res.status === 409;
        if (res.status === 400) {
          try {
            const data = JSON.parse((await readLimited(res, 4096)).toString("utf8"));
            duplicate = data.error === "Duplicate" || data.code === "Duplicate";
          } catch {
            /* unknown errors stay failures */
          }
        } else {
          await res.body?.cancel();
        }
        if (duplicate) throw new GatewayError("OBJECT_EXISTS", 409);
        throw new GatewayError("STORAGE_UNAVAILABLE", 503);
      },
      get,
      async remove(scope) {
        const res = await request(`/storage/v1/object/${bucket}`, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prefixes: [pathFor(scope)] }),
        });
        if (!res.ok) {
          await res.body?.cancel();
          throw new GatewayError("STORAGE_UNAVAILABLE", 503);
        }
        await res.body?.cancel();
        // Do not release quota until absence is observed, even after a 2xx DELETE.
        try {
          await get(scope, 65536);
        } catch (e) {
          if (e.code === "OBJECT_MISSING") return;
          throw e;
        }
        throw new GatewayError("DELETE_NOT_CONFIRMED", 503);
      },
    },
    async callServerRpc(name, args) {
      if (name === "wjb_v2_session_active") {
        if (
          !uuid.test(args?.p_user) ||
          !uuid.test(args?.p_session) ||
          Object.keys(args).sort().join(",") !== "p_session,p_user"
        )
          throw new GatewayError("INVALID_RPC");
      } else if (["wjb_v2_asset_command", "wjb_v2_recovery_catalog"].includes(name)) {
        if (
          !args?.p_request ||
          Object.keys(args).join(",") !== "p_request" ||
          JSON.stringify(args).length > 4096
        )
          throw new GatewayError("INVALID_RPC");
      } else throw new GatewayError("INVALID_RPC");
      const res = await request(`/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });
      if (!res.ok) {
        if (["wjb_v2_asset_command", "wjb_v2_recovery_catalog"].includes(name)) {
          const allowed = new Set([
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
          let code;
          try {
            const data = JSON.parse((await readLimited(res, 4096)).toString("utf8"));
            if (data.code === "P0001" && allowed.has(data.message)) code = data.message;
          } catch {
            /* unknown stays unavailable */
          }
          if (code) throw new GatewayError(code, 409);
          throw new GatewayError("METADATA_UNAVAILABLE", 503);
        }
        await res.body?.cancel();
        throw new GatewayError("AUTH_UNAVAILABLE", 503);
      }
      try {
        const result = JSON.parse(
          (await readLimited(res, name === "wjb_v2_session_active" ? 128 : 4096)).toString("utf8"),
        );
        if (name === "wjb_v2_session_active" && typeof result !== "boolean") throw new Error();
        if (
          name !== "wjb_v2_session_active" &&
          (!result || Array.isArray(result) || typeof result !== "object")
        )
          throw new Error();
        return result;
      } catch {
        void res.body?.cancel().catch(() => {});
        throw new GatewayError("AUTH_UNAVAILABLE", 503);
      }
    },
  };
}
