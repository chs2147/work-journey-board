import { URL } from "node:url";
import { GatewayError, readLimited, uuid } from "./io.mjs";
const bucket = "wjb-v2-poc-private";

// Explicit trusted transport required. No environment values or client URLs read.
export function createSupabaseRest({ projectRef, serviceRoleKey, fetchTransport }) {
  if (
    projectRef !== "hutqsfftioxtredcjhsy" ||
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
      if (
        name !== "wjb_v2_session_active" ||
        !uuid.test(args?.p_user) ||
        !uuid.test(args?.p_session) ||
        Object.keys(args).sort().join(",") !== "p_session,p_user"
      )
        throw new GatewayError("INVALID_RPC");
      const res = await request("/rest/v1/rpc/wjb_v2_session_active", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });
      if (!res.ok) {
        await res.body?.cancel();
        throw new GatewayError("AUTH_UNAVAILABLE", 503);
      }
      try {
        const result = JSON.parse((await readLimited(res, 128)).toString("utf8"));
        if (typeof result !== "boolean") throw new Error();
        return result;
      } catch {
        void res.body?.cancel().catch(() => {});
        throw new GatewayError("AUTH_UNAVAILABLE", 503);
      }
    },
  };
}
