import { createHash, randomUUID } from "node:crypto";
import { GatewayError, uuid, scopeValid } from "./io.mjs";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const snapshot = (row) => ({
  state: row.state,
  ioVersion: row.ioVersion,
  sha256: row.sha256,
  bytes: row.bytes,
  generation: row.generation,
  deviceId: row.deviceId,
  expires: row.expires,
});
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function recoveryHash(plan) {
  return sha(
    JSON.stringify([
      plan.version,
      plan.decisionId,
      plan.scope,
      plan.expected,
      plan.unsettled,
      plan.observation,
      plan.status,
      plan.actions,
      plan.checkedAt,
      plan.reviewExpiresAt,
    ]),
  );
}
export function classifyRecovery(item, observation, scope) {
  if (item.busy) return { status: "BUSY", actions: [] };
  if (item.generation !== scope.generation) return { status: "OLD_GENERATION", actions: [] };
  if (["ready", "canceled"].includes(item.state)) return { status: "FINISHED", actions: [] };
  if (observation.kind === "unavailable") return { status: "STORAGE_UNAVAILABLE", actions: [] };
  if (observation.kind === "corrupt") return { status: "INTEGRITY_REVIEW", actions: [] };
  if (item.state === "reserved" && observation.kind === "valid")
    return {
      status: "RECOVERABLE",
      actions: item.unsettled > 0 ? ["RESTORE_READY"] : ["RESTORE_READY", "CANCEL"],
    };
  if (item.unsettled > 0) return { status: "UNCERTAIN_IO", actions: [] };
  return { status: "CLEANABLE", actions: ["CANCEL"] };
}
export function createRecoveryWorker({
  verifyAccessToken,
  callServerRpc,
  metadata,
  storage,
  clock = () => Date.now(),
}) {
  if (
    typeof verifyAccessToken !== "function" ||
    typeof callServerRpc !== "function" ||
    typeof metadata?.withAsset !== "function" ||
    typeof storage?.get !== "function"
  )
    throw new TypeError("Trusted recovery adapters required");
  function validate(item, scope) {
    if (
      !item ||
      !scopeValid({ ...scope, assetId: item.assetId }) ||
      item.workspaceId !== scope.workspaceId ||
      !["reserved", "ready", "cleanup", "canceled"].includes(item.state) ||
      typeof item.ioVersion !== "string" ||
      !/^[0-9]+$/.test(item.ioVersion) ||
      !Number.isInteger(item.bytes) ||
      item.bytes < 1 ||
      item.bytes > 65536 ||
      !/^[0-9a-f]{64}$/.test(item.sha256) ||
      !Number.isInteger(item.unsettled) ||
      item.unsettled < 0 ||
      item.unsettled > 64 ||
      typeof item.busy !== "boolean"
    )
      throw new GatewayError("RECOVERY_UNAVAILABLE", 503);
  }
  async function catalog(principal, scope, { after = null, limit = 8 } = {}) {
    if (
      !scopeValid({ ...scope, assetId: after || "00000000-0000-0000-0000-000000000000" }) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 8
    )
      throw new GatewayError("INVALID_SCOPE");
    const result = await callServerRpc("wjb_v2_recovery_catalog", {
      p_request: { userId: principal.userId, sessionId: principal.sessionId, scope, after, limit },
    });
    if (
      !Array.isArray(result?.items) ||
      result.items.length > limit ||
      typeof result.hasMore !== "boolean" ||
      (result.nextCursor !== null && !uuid.test(result.nextCursor))
    )
      throw new GatewayError("RECOVERY_UNAVAILABLE", 503);
    for (const item of result.items) validate(item, scope);
    return result;
  }
  async function inspect(scope, item) {
    try {
      const bytes = await storage.get(scope, item.bytes);
      return { kind: bytes.length === item.bytes && sha(bytes) === item.sha256 ? "valid" : "corrupt" };
    } catch (e) {
      return { kind: e?.code === "OBJECT_MISSING" ? "missing" : "unavailable" };
    }
  }
  return {
    async preview({ token, scope, after = null, limit = 8 }) {
      const principal = await verifyAccessToken(token);
      const page = await catalog(principal, scope, { after, limit });
      const plans = [];
      for (const item of page.items) {
        const assetScope = { ...scope, assetId: item.assetId };
        const observation =
          item.busy || item.generation !== scope.generation || ["ready", "canceled"].includes(item.state)
            ? { kind: "not-read" }
            : await inspect(assetScope, item);
        const checkedAt = clock();
        const plan = {
          version: 1,
          decisionId: randomUUID(),
          scope: assetScope,
          expected: snapshot(item),
          unsettled: item.unsettled,
          observation,
          ...classifyRecovery(item, observation, scope),
          checkedAt,
          reviewExpiresAt: checkedAt + 60000,
        };
        plan.reviewHash = recoveryHash(plan);
        plans.push(plan);
      }
      await verifyAccessToken(token);
      return { plans, hasMore: page.hasMore, nextCursor: page.nextCursor, readOnly: true };
    },
    async apply({ token, plan, reviewHash, action }) {
      const principal = await verifyAccessToken(token);
      if (
        plan?.version !== 1 ||
        !uuid.test(plan.decisionId) ||
        !scopeValid(plan.scope) ||
        !Array.isArray(plan.actions) ||
        plan.reviewHash !== reviewHash ||
        reviewHash !== recoveryHash(plan) ||
        !plan.actions.includes(action)
      )
        throw new GatewayError("REVIEW_REQUIRED", 409);
      if (
        clock() < plan.checkedAt ||
        clock() > plan.reviewExpiresAt ||
        plan.reviewExpiresAt - plan.checkedAt !== 60000
      )
        throw new GatewayError("REVIEW_EXPIRED", 409);
      const base = {
        workspaceId: plan.scope.workspaceId,
        deviceId: plan.scope.deviceId,
        generation: plan.scope.generation,
      };
      // Exact single item lookup via UUID ordering: catalog is bounded, not a full scan.
      const page = await catalog(principal, base, { after: null, limit: 8 });
      let item = page.items.find((x) => x.assetId === plan.scope.assetId);
      if (!item) {
        // Use predecessor UUID to include the requested ID without iterating all pages.
        const n = BigInt("0x" + plan.scope.assetId.replaceAll("-", ""));
        const hex = (n > 0n ? n - 1n : 0n).toString(16).padStart(32, "0");
        const predecessor = [
          hex.slice(0, 8),
          hex.slice(8, 12),
          hex.slice(12, 16),
          hex.slice(16, 20),
          hex.slice(20),
        ].join("-");
        const exact = await catalog(principal, base, { after: n === 0n ? null : predecessor, limit: 1 });
        item = exact.items.find((x) => x.assetId === plan.scope.assetId);
      }
      if (
        item?.receipt?.decisionId === plan.decisionId &&
        item.receipt.reviewHash === reviewHash &&
        item.receipt.action === action
      )
        return { status: "ALREADY_APPLIED", state: item.receipt.resultState, decisionId: plan.decisionId };
      if (!item || !equal(snapshot(item), plan.expected)) throw new GatewayError("RECOVERY_CHANGED", 409);
      return metadata.withAsset(principal, plan.scope, "recover", async (ctx) => {
        if (!equal(snapshot(ctx.row), plan.expected)) throw new GatewayError("RECOVERY_CHANGED", 409);
        const observation = await inspect(plan.scope, ctx.row);
        const current = classifyRecovery({ ...item, ...ctx.row, busy: false }, observation, base);
        if (!equal(observation, plan.observation) || !current.actions.includes(action))
          throw new GatewayError("RECOVERY_CHANGED", 409);
        await verifyAccessToken(token);
        await ctx.recheck();
        const proof = { decisionId: plan.decisionId, reviewHash };
        if (action === "RESTORE_READY") {
          await ctx.recoverReady({
            ...proof,
            sha256: ctx.row.sha256,
            bytes: ctx.row.bytes,
            ioVersion: plan.expected.ioVersion,
          });
        } else {
          await ctx.markCleanup();
          await storage.remove(plan.scope);
          await verifyAccessToken(token);
          await ctx.recoverCancel(proof);
        }
        return {
          status: "APPLIED",
          state: action === "RESTORE_READY" ? "ready" : "canceled",
          decisionId: plan.decisionId,
        };
      });
    },
  };
}
