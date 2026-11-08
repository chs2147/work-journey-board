import { createHash } from "node:crypto";
import { URL } from "node:url";
import { GatewayError, readLimited, scopeValid } from "./io.mjs";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const response = (value, status = 200) =>
  new globalThis.Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
async function jsonBody(request, keys) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
    throw new GatewayError("INVALID_CONTENT_TYPE", 415);
  let value;
  try {
    value = JSON.parse((await readLimited(request, 2048)).toString("utf8"));
  } catch (e) {
    if (e instanceof GatewayError) throw e;
    throw new GatewayError("INVALID_JSON");
  }
  if (
    !value ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    Object.keys(value).sort().join(",") !== [...keys].sort().join(",")
  ) {
    throw new GatewayError("INVALID_FIELDS");
  }
  return value;
}
function verifyBytes(bytes, row) {
  if (bytes.length !== row.bytes || hash(bytes) !== row.sha256)
    throw new GatewayError("INTEGRITY_MISMATCH", 409);
}

// metadata is a trusted atomic/lease adapter. Local fixture is not a production DB.
export function createGateway({ verifyAccessToken, metadata, storage }) {
  if (
    typeof verifyAccessToken !== "function" ||
    typeof metadata?.withAsset !== "function" ||
    typeof metadata?.reserve !== "function" ||
    typeof storage?.putIfAbsent !== "function"
  )
    throw new TypeError("Trusted adapters required");
  return async function handle(request) {
    try {
      if (request.headers.has("origin")) throw new GatewayError("ORIGIN_DENIED", 403);
      const auth = request.headers.get("authorization");
      if (!auth || !/^Bearer [^\s,]+$/.test(auth)) throw new GatewayError("AUTH_REQUIRED", 401);
      const token = auth.slice(7);
      const principal = await verifyAccessToken(token);
      const url = new URL(request.url);
      const match = url.pathname.match(
        /^\/v2\/workspaces\/([^/]+)\/assets\/([^/]+)\/(reserve|content|cancel)$/,
      );
      if (!match || url.search) throw new GatewayError("NOT_FOUND", 404);
      const [, workspaceId, assetId, action] = match;
      if (action === "reserve" && request.method === "POST") {
        const body = await jsonBody(request, ["deviceId", "generation", "sha256", "bytes"]);
        const scope = { workspaceId, assetId, deviceId: body.deviceId, generation: body.generation };
        if (
          !scopeValid(scope) ||
          typeof body.sha256 !== "string" ||
          !/^[0-9a-f]{64}$/.test(body.sha256) ||
          !Number.isInteger(body.bytes) ||
          body.bytes < 1 ||
          body.bytes > 65536
        )
          throw new GatewayError("INVALID_REQUEST");
        const row = await metadata.reserve(principal, scope, { sha256: body.sha256, bytes: body.bytes });
        return response({ assetId, state: row.state }, row.created ? 201 : 200);
      }
      if (action === "cancel" && request.method === "POST") {
        const body = await jsonBody(request, ["deviceId", "generation"]);
        const scope = { workspaceId, assetId, deviceId: body.deviceId, generation: body.generation };
        if (!scopeValid(scope)) throw new GatewayError("INVALID_REQUEST");
        return await metadata.withAsset(principal, scope, "cancel", async (ctx) => {
          if (ctx.row.state === "ready") throw new GatewayError("ASSET_ALREADY_READY", 409);
          if (ctx.row.state === "canceled") return response({ assetId, state: "canceled" });
          await ctx.markCleanup();
          await storage.remove(scope);
          await verifyAccessToken(token);
          await ctx.markCanceled();
          return response({ assetId, state: "canceled" });
        });
      }
      if (action !== "content" || !["GET", "PUT"].includes(request.method))
        throw new GatewayError("METHOD_NOT_ALLOWED", 405);
      const scope = {
        workspaceId,
        assetId,
        deviceId: request.headers.get("x-wjb-device-id"),
        generation: request.headers.get("x-wjb-generation"),
      };
      if (!scopeValid(scope)) throw new GatewayError("INVALID_REQUEST");
      if (request.method === "GET") {
        return await metadata.withAsset(principal, scope, "read", async (ctx) => {
          if (ctx.row.state !== "ready") throw new GatewayError("ASSET_NOT_READY", 409);
          const bytes = await storage.get(scope, ctx.row.bytes);
          verifyBytes(bytes, ctx.row);
          await verifyAccessToken(token);
          await ctx.recheck();
          return new globalThis.Response(bytes, {
            status: 200,
            headers: {
              "content-type": "application/octet-stream",
              "content-disposition": `attachment; filename="${assetId}.bin"`,
              "cache-control": "no-store",
              "x-content-type-options": "nosniff",
            },
          });
        });
      }
      if (request.headers.get("content-type") !== "application/octet-stream")
        throw new GatewayError("INVALID_CONTENT_TYPE", 415);
      return await metadata.withAsset(principal, scope, "write", async (ctx) => {
        if (!["reserved", "ready"].includes(ctx.row.state)) throw new GatewayError("ASSET_NOT_PENDING", 409);
        const bytes = await readLimited(request, ctx.row.bytes);
        verifyBytes(bytes, ctx.row);
        if (ctx.row.state === "ready") return response({ assetId, state: "ready" });
        await ctx.recheck();
        try {
          await storage.putIfAbsent(scope, bytes);
        } catch (e) {
          if (e?.code !== "OBJECT_EXISTS") throw e;
          const existing = await storage.get(scope, ctx.row.bytes);
          verifyBytes(existing, ctx.row);
        }
        await verifyAccessToken(token);
        await ctx.markReady();
        return response({ assetId, state: "ready" });
      });
    } catch (e) {
      const known = new Set(["AUTH_REQUIRED", "ACCESS_REVOKED", "AUTH_UNAVAILABLE"]);
      if (known.has(e?.code))
        return response(
          { error: { code: e.code } },
          e.code === "AUTH_REQUIRED" ? 401 : e.code === "ACCESS_REVOKED" ? 403 : 503,
        );
      if (e instanceof GatewayError) return response({ error: { code: e.code } }, e.status);
      return response({ error: { code: "INTERNAL_ERROR" } }, 503);
    }
  };
}
