// Independent Node reference for a future native command boundary. Never wired into Classic.
import { openRegisteredWorkspace } from "./workspace-registry.mjs";
const errors = new Set([
  "WORKSPACE_REQUEST_STALE",
  "WORKSPACE_NOT_FOUND",
  "WORKSPACE_OWNER_MISMATCH",
  "PRODUCT_ACTIVATION_REQUIRED",
  "WORKSPACE_NOT_OPENABLE",
  "WORKSPACE_SAVE_FAILED",
  "WORKSPACE_CLOSE_FAILED",
  "WORKSPACE_ACTIVATION_FAILED",
  "WORKSPACE_BRIDGE_BLOCKED",
  "WORKSPACE_COMMAND_INVALID",
]);
export function createWorkspaceSettingsBridge({ registry, adapters, lifecycle, getAccountContext }) {
  let epoch = 0,
    tail = Promise.resolve(),
    active = null,
    phase = "idle",
    blocked = false;
  const row = (e) => Object.freeze({ entryId: e.entry_id, name: e.name, kind: e.kind });
  const snapshot = () =>
    Object.freeze({
      entries: Object.freeze(registry.list().map(row)),
      activeId: blocked ? null : (active?.entry.entry_id ?? null),
      phase,
    });
  const failure = (e) => ({
    ok: false,
    code: errors.has(e?.message) ? e.message : "WORKSPACE_NOT_OPENABLE",
    state: snapshot(),
  });
  const serial = (fn) => {
    const task = tail.then(fn);
    tail = task.catch(() => {});
    return task;
  };
  // Track disposal failures even when the router closes a late, unactivated handle.
  function tracked(handle) {
    if (!handle || typeof handle.close !== "function") {
      blocked = true;
      phase = "blocked";
      throw Error("WORKSPACE_ACTIVATION_FAILED");
    }
    return new Proxy(handle, {
      get(target, key) {
        if (key === "close")
          return async () => {
            try {
              await target.close();
            } catch {
              blocked = true;
              phase = "blocked";
              throw Error("WORKSPACE_CLOSE_FAILED");
            }
          };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }
  const guardedAdapters = {
    openOffline: async (args) => tracked(await adapters.openOffline(args)),
    verifyActivation: (args) => adapters.verifyActivation(args),
    openOnline: async (args) => tracked(await adapters.openOnline(args)),
  };
  async function change(entryId, requestEpoch, lockOnFailure = false) {
    const entry = entryId === null ? null : registry.get(entryId);
    // Account context is native-owned and contains no token. Offline opens never access it.
    const rawContext = entry?.kind === "online" ? getAccountContext() : null;
    const context = rawContext
      ? Object.freeze({ ownerId: rawContext.ownerId, revision: rawContext.revision })
      : null;
    const current = () => {
      if (requestEpoch !== epoch) return false;
      if (entry?.kind !== "online") return true;
      try {
        const now = getAccountContext();
        return now?.ownerId === context?.ownerId && now?.revision === context?.revision;
      } catch {
        return false;
      }
    };
    const ensure = () => {
      if (!current()) throw Error("WORKSPACE_REQUEST_STALE");
    };
    try {
      ensure();
      if (blocked) throw Error("WORKSPACE_BRIDGE_BLOCKED");
      if (
        entry?.kind === "online" &&
        (!context?.ownerId ||
          context.ownerId !== entry.owner_id ||
          !Number.isSafeInteger(context.revision) ||
          context.revision < 0)
      )
        throw Error("WORKSPACE_OWNER_MISMATCH");
      if (active && active.entry.entry_id === entryId) return { ok: true, state: snapshot() };
      if (active) {
        phase = "closing";
        try {
          await lifecycle.flushPending(active.handle);
          await lifecycle.finishNote(active.handle);
          await lifecycle.backupBeforeClose(active.handle);
        } catch {
          throw Error("WORKSPACE_SAVE_FAILED");
        }
        ensure(); // A newer selection must not detach a still-valid old view.
        try {
          await lifecycle.detachAll(active.handle);
          await active.handle.close();
          active = null;
        } catch {
          blocked = true;
          phase = "blocked";
          throw Error("WORKSPACE_CLOSE_FAILED");
        }
      }
      ensure();
      if (!entry) {
        phase = "idle";
        return { ok: true, state: snapshot() };
      }
      phase = "opening";
      const handle = await openRegisteredWorkspace({
        registry,
        entryId,
        actor: context,
        adapters: guardedAdapters,
        isCurrent: current,
      });
      // Native factories must return a disposable, unactivated handle.
      try {
        ensure();
        if (typeof handle?.close !== "function") throw Error("WORKSPACE_ACTIVATION_FAILED");
        // attach is synchronous: no await may separate the final guard from UI attachment.
        const result = lifecycle.attach(handle, row(entry));
        if (result && typeof result.then === "function") throw Error("WORKSPACE_ACTIVATION_FAILED");
        ensure();
        active = { entry, handle };
        phase = "active";
        return { ok: true, state: snapshot() };
      } catch {
        // Partial attachment is uncertain. Stop all subsequent opens until process restart.
        blocked = true;
        phase = "blocked";
        try {
          await lifecycle.detachAll(handle);
        } catch {
          // Already blocked: attempt remaining cleanup without replacing activation failure.
        }
        try {
          await handle?.close?.();
        } catch {
          // Already blocked: attempt remaining cleanup without replacing activation failure.
        }
        throw Error("WORKSPACE_ACTIVATION_FAILED");
      }
    } catch (e) {
      if (lockOnFailure) {
        blocked = true;
        phase = "blocked";
      }
      if (!blocked) phase = active ? "active" : "idle";
      return failure(e);
    }
  }
  return Object.freeze({
    async request(command, payload = {}) {
      if (!payload || typeof payload !== "object" || Array.isArray(payload))
        return failure(Error("WORKSPACE_COMMAND_INVALID"));
      const keys = Object.keys(payload);
      if (command === "list" && !keys.length) return { ok: true, state: snapshot() };
      if (
        command === "select" &&
        keys.length === 1 &&
        keys[0] === "entryId" &&
        typeof payload.entryId === "string"
      ) {
        // Reject nonexistent/forged IDs before invalidating an in-flight valid request.
        try {
          registry.get(payload.entryId);
        } catch {
          return failure(Error("WORKSPACE_NOT_FOUND"));
        }
        const next = ++epoch;
        return serial(() => change(payload.entryId, next)).catch(failure);
      }
      if ((command === "deactivate" || command === "accountChanged") && !keys.length) {
        const target =
          command === "accountChanged" && active?.entry.kind === "offline_only"
            ? active.entry.entry_id
            : null;
        const next = ++epoch;
        return serial(() =>
          change(target, next, command === "accountChanged" && active?.entry.kind === "online"),
        ).catch(failure);
      }
      return failure(Error("WORKSPACE_COMMAND_INVALID"));
    },
  });
}
