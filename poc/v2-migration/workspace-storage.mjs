// Trusted DEV server composition. No environment access, listening or automatic upload.
import { createMigrationRPC } from "./server-rpc.mjs";
import { createSupabaseRest } from "../v2-gateway/supabase-rest.mjs";
import { randomUUID } from "node:crypto";
import { hash } from "../v2-sync/model.mjs";
import { GatewayError, uuid } from "../v2-gateway/io.mjs";
export function createWorkspaceStorageGateway({
  projectRef,
  serviceRoleKey,
  fetchTransport,
  principal,
  deviceId,
}) {
  if (
    principal?.role !== "authenticated" ||
    !uuid.test(principal.userId) ||
    !uuid.test(principal.sessionId) ||
    !uuid.test(deviceId)
  )
    throw Error("STORAGE_PRINCIPAL_REQUIRED");
  const identity = Object.freeze({ ...principal });
  const rpc = createMigrationRPC({
    projectRef,
    serviceRoleKey,
    fetchTransport,
    allowWorkspaceProfiles: true,
  });
  const rest = createSupabaseRest({ projectRef, serviceRoleKey, fetchTransport });
  function context(journal, lease, objectId) {
    const job = journal.refresh(lease),
      a = job.assets.find((a) => a.object_id === objectId);
    if (
      job.owner_id !== identity.userId ||
      job.device_id !== deviceId ||
      !job.binding?.target_manifest_hash ||
      !a
    )
      throw Error("STORAGE_SCOPE");
    return { job, a, scope: { workspaceId: job.workspace_id, assetId: objectId, deviceId, generation: "1" } };
  }
  const control = (c, action, extra = {}) =>
    rpc.call(
      { action, jobId: c.job.id, params: { manifestHash: c.job.binding.target_manifest_hash, ...extra } },
      identity,
      deviceId,
    );
  async function c2(c, action, params, sessionId = identity.sessionId) {
    return rest.callServerRpc("wjb_v2_asset_command", {
      p_request: { action, userId: identity.userId, sessionId, scope: c.scope, params },
    });
  }
  function checkRow(c, row, token, fence) {
    if (
      row?.workspaceId !== c.scope.workspaceId ||
      row.assetId !== c.scope.assetId ||
      row.deviceId !== deviceId ||
      row.generation !== "1" ||
      row.sha256 !== c.a.sha256 ||
      row.bytes !== c.a.bytes ||
      row.leaseToken !== token ||
      typeof row.fence !== "string" ||
      !/^[1-9][0-9]*$/.test(row.fence) ||
      (fence && row.fence !== fence)
    )
      throw Error("STORAGE_LEASE_SCOPE");
    return row;
  }
  function verify(c, bytes) {
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.length !== c.a.bytes ||
      hash(Buffer.from(bytes)) !== c.a.sha256
    )
      throw new GatewayError("INTEGRITY_MISMATCH", 409);
  }
  async function observed(c) {
    const r = await control(c, "observe", { objectId: c.a.object_id });
    if (r.sha256 !== c.a.sha256 || r.bytes !== c.a.bytes || r.ownedByJob !== true)
      throw Error("STORAGE_REMOTE_SCOPE");
    return r;
  }
  async function settleConfirmed(journal, lease, objectId) {
    const c = context(journal, lease, objectId);
    for (const io of journal
      .storageIOs(c.job.id, lease.actor)
      .filter((x) => x.object_id === objectId && ["confirmed", "settled"].includes(x.phase))) {
      if (io.phase === "confirmed") {
        await c2(
          c,
          "settle_io",
          { token: io.lease_token, fence: io.lease_fence, intent: io.operation_id },
          io.session_id,
        );
        journal.storageIOCompleted(c.job.id, lease.actor, objectId, io.operation_id, "settled");
      }
      await c2(c, "release", { token: io.lease_token, fence: io.lease_fence }, io.session_id);
    }
  }
  async function recoverReady(journal, lease, objectId) {
    const c = context(journal, lease, objectId),
      before = await observed(c);
    if (!before.operationSettled) return false;
    const token = randomUUID();
    let fence;
    try {
      const row = checkRow(c, await c2(c, "acquire", { token, mode: "recover" }), token);
      fence = row.fence;
      if (row.state !== "reserved" || row.ioVersion !== before.ioVersion) return false;
      verify(c, await rest.storage.get(c.scope, c.a.bytes));
      const decisionId = randomUUID(),
        reviewHash = hash([
          c.job.id,
          c.job.binding.target_manifest_hash,
          objectId,
          row.ioVersion,
          c.a.sha256,
          c.a.bytes,
        ]);
      checkRow(
        c,
        await c2(c, "recover_ready", {
          token,
          fence,
          ioVersion: row.ioVersion,
          sha256: c.a.sha256,
          bytes: c.a.bytes,
          decisionId,
          reviewHash,
        }),
        token,
        fence,
      );
    } finally {
      if (fence) await c2(c, "release", { token, fence });
    }
    return attestOne(journal, lease, objectId);
  }
  async function attestOne(journal, lease, objectId) {
    await settleConfirmed(journal, lease, objectId);
    const c = context(journal, lease, objectId),
      first = await observed(c);
    if (first.assetState !== "ready" || !first.operationSettled) return false;
    verify(c, await rest.storage.get(c.scope, c.a.bytes));
    const after = await observed(c);
    if (after.ioVersion !== first.ioVersion || !after.operationSettled || after.assetState !== "ready")
      return false;
    await control(c, "attest", {
      objectId,
      ioVersion: after.ioVersion,
      sha256: c.a.sha256,
      bytes: c.a.bytes,
    });
    journal.workspaceAssetProof(lease, objectId, after);
    return true;
  }
  return Object.freeze({
    rpc,
    assetIO: Object.freeze({
      async upload({ journal, lease, objectId, bytes }) {
        let c = context(journal, lease, objectId);
        verify(c, bytes);
        if (c.a.state === "pending") journal.beginUpload(lease, objectId);
        c = context(journal, lease, objectId);
        await settleConfirmed(journal, lease, objectId);
        const before = await observed(c);
        if (before.assetState === "ready") return attestOne(journal, lease, objectId);
        if (before.assetState !== "reserved") throw Error("STORAGE_UPLOAD_STATE");
        let io = journal.prepareStorageIO(lease, objectId, identity.sessionId);
        if (io.phase === "settled") return recoverReady(journal, lease, objectId);
        if (io.phase === "dispatching") return false; // Unknown POST outcome is never settled from GET/time alone.
        if (io.session_id !== identity.sessionId) throw Error("STORAGE_ORIGINAL_SESSION_REQUIRED");
        let acquired;
        try {
          if (io.phase === "prepared") {
            acquired = checkRow(
              c,
              await c2(c, "acquire", { token: io.lease_token, mode: "write" }),
              io.lease_token,
            );
            journal.storageIOAcquired(lease, objectId, io.operation_id, acquired.fence);
            io = { ...io, phase: "acquired", lease_fence: acquired.fence };
          }
          if (io.phase === "acquired") {
            checkRow(
              c,
              await c2(c, "begin_io", {
                token: io.lease_token,
                fence: io.lease_fence,
                intent: io.operation_id,
              }),
              io.lease_token,
              io.lease_fence,
            );
            journal.storageIOPhase(lease, objectId, io.operation_id, "acquired", "begun");
            io = { ...io, phase: "begun" };
          }
          if (io.phase === "begun") {
            // Recheck the server fence immediately before dispatch; cancel makes begin/recheck fail.
            const row = checkRow(
              c,
              await c2(c, "recheck", { token: io.lease_token, fence: io.lease_fence }),
              io.lease_token,
              io.lease_fence,
            );
            if (row.state !== "reserved") throw Error("STORAGE_UPLOAD_STATE");
            journal.storageIOPhase(lease, objectId, io.operation_id, "begun", "dispatching");
            try {
              await rest.storage.putIfAbsent(c.scope, bytes);
            } catch (e) {
              if (e.code !== "OBJECT_EXISTS") throw e;
            }
            // A terminal HTTP response (including duplicate) is the completion evidence.
            journal.storageIOCompleted(c.job.id, lease.actor, objectId, io.operation_id, "confirmed");
            await c2(
              c,
              "settle_io",
              { token: io.lease_token, fence: io.lease_fence, intent: io.operation_id },
              io.session_id,
            );
            journal.storageIOCompleted(c.job.id, lease.actor, objectId, io.operation_id, "settled");
          }
          verify(c, await rest.storage.get(c.scope, c.a.bytes));
          checkRow(
            c,
            await c2(c, "mark_ready", { token: io.lease_token, fence: io.lease_fence }),
            io.lease_token,
            io.lease_fence,
          );
        } finally {
          if (io.lease_fence)
            await c2(c, "release", { token: io.lease_token, fence: io.lease_fence }, io.session_id).catch(
              () => {},
            );
        }
        return attestOne(journal, lease, objectId);
      },
      async attestAll({ journal, lease }) {
        for (const a of journal.refresh(lease).assets)
          if (!(await attestOne(journal, lease, a.object_id))) return false;
        return true;
      },
      async cancelAll({ journal, lease }) {
        for (const a of journal.refresh(lease).assets) {
          await settleConfirmed(journal, lease, a.object_id);
          const c = context(journal, lease, a.object_id),
            status = await control(c, "status");
          if (status.state !== "cancel_fenced") throw Error("STORAGE_CANCEL_NOT_FENCED");
          let ob = await observed(c);
          if (!ob.operationSettled) return false;
          const token = randomUUID();
          let fence;
          try {
            const row = checkRow(c, await c2(c, "acquire", { token, mode: "cancel" }), token);
            fence = row.fence;
            if (!["cleanup", "canceled"].includes(row.state)) throw Error("STORAGE_CANCEL_STATE");
            await rest.storage.remove(c.scope);
          } finally {
            if (fence) await c2(c, "release", { token, fence });
          }
          // Absence is rechecked after releasing the C2 lease, then bound to io_version.
          try {
            await rest.storage.get(c.scope, c.a.bytes);
            throw Error("STORAGE_DELETE_UNCONFIRMED");
          } catch (e) {
            if (e.code !== "OBJECT_MISSING") throw e;
          }
          ob = await observed(c);
          if (!ob.operationSettled) return false;
          await control(c, "confirm_absent", { objectId: a.object_id, ioVersion: ob.ioVersion });
          journal.workspaceAssetProof(lease, a.object_id, await observed(c), true);
        }
        return true;
      },
    }),
  });
}
