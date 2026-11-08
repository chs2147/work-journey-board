// In-memory test double ONLY: not durable, multi-process, or production safe.
import { GatewayError } from "./io.mjs";
export function fixtureMetadata({ workspaces, devices, clock = () => Date.now(), quota = 1048576 }) {
  const rows = new Map();
  const locks = new Map();
  const faults = {};
  async function locked(key, fn) {
    const previous = locks.get(key) || Promise.resolve();
    let release;
    const next = new Promise((resolve) => {
      release = resolve;
    });
    locks.set(key, next);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (locks.get(key) === next) locks.delete(key);
    }
  }
  function authorize(principal, scope, row, write) {
    const workspace = workspaces.get(scope.workspaceId),
      device = devices.get(scope.deviceId);
    if (
      !workspace ||
      workspace.userId !== principal.userId ||
      !device ||
      device.userId !== principal.userId ||
      device.sessionId !== principal.sessionId ||
      device.revoked
    )
      throw new GatewayError("ACCESS_DENIED", 403);
    if (workspace.generation !== scope.generation || (row && row.generation !== scope.generation))
      throw new GatewayError("GENERATION_CHANGED", 409);
    if (write && row && row.deviceId !== scope.deviceId) throw new GatewayError("ACCESS_DENIED", 403);
  }
  const key = (scope) => `${scope.workspaceId}/${scope.assetId}`;
  const used = (workspaceId) =>
    [...rows.values()]
      .filter((r) => r.workspaceId === workspaceId && r.state !== "canceled")
      .reduce((n, r) => n + r.bytes, 0);
  return {
    rows,
    faults,
    used,
    async reserve(principal, scope, spec) {
      return locked(scope.workspaceId, async () => {
        authorize(principal, scope, null, true);
        const old = rows.get(key(scope));
        if (old) {
          authorize(principal, scope, old, true);
          if (old.sha256 !== spec.sha256 || old.bytes !== spec.bytes)
            throw new GatewayError("IDEMPOTENCY_KEY_REUSED", 409);
          if (old.state === "canceled") throw new GatewayError("ASSET_CANCELED", 409);
          if (old.state === "cleanup") throw new GatewayError("CLEANUP_PENDING", 409);
          if (old.state === "reserved" && old.expires <= clock())
            throw new GatewayError("UPLOAD_EXPIRED", 409);
          return { ...old, created: false };
        }
        if (used(scope.workspaceId) + spec.bytes > quota) throw new GatewayError("QUOTA_EXCEEDED", 409);
        const row = { ...scope, ...spec, state: "reserved", expires: clock() + 300000 };
        rows.set(key(scope), row);
        return { ...row, created: true };
      });
    },
    async withAsset(principal, scope, mode, fn) {
      return locked(key(scope), async () => {
        const row = rows.get(key(scope));
        authorize(principal, scope, row, mode !== "read");
        if (!row) throw new GatewayError("ASSET_NOT_FOUND", 404);
        const recheck = async () => {
          authorize(principal, scope, row, mode !== "read");
          if (mode !== "cancel" && row.state === "reserved" && row.expires <= clock())
            throw new GatewayError("UPLOAD_EXPIRED", 409);
        };
        await recheck();
        return fn({
          row,
          recheck,
          async markReady() {
            await recheck();
            if (faults.finalize) throw new Error("private DB failure");
            row.state = "ready";
            if (faults.ackLost) throw new Error("lost DB acknowledgement");
          },
          async markCleanup() {
            authorize(principal, scope, row, true);
            row.state = "cleanup";
          },
          async markCanceled() {
            authorize(principal, scope, row, true);
            if (faults.cancel) throw new Error("private cancel failure");
            row.state = "canceled";
          },
        });
      });
    },
  };
}
