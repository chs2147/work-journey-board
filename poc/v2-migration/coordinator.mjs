// Trusted remote port is injected; this module has no URL, key or auth handling.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hash } from "../v2-sync/model.mjs";
import { inspectConnectedCopy } from "../v2-assets/connected-copy.mjs";

export async function advanceMigration({ journal, id, actor, directory, backend }) {
  let job = journal.get(id, actor);
  if (job.binding) throw Error("FULL_WORKSPACE_COORDINATOR_REQUIRED");
  if (["connected", "canceled"].includes(job.state)) return { state: job.state };
  // Cleanup and publication reconciliation use durable scope/receipts, even if
  // local staging files are unavailable. Uploading still requires the exact copy.
  if (["prepared", "uploading"].includes(job.state)) {
    const copy = inspectConnectedCopy(directory, job.workspace_id);
    if (hash(copy.manifest) !== job.manifest_hash) throw Error("COPY_MANIFEST_CHANGED");
  }
  const lease = journal.acquire(id, actor);
  const context = (objectId) => {
    job = journal.refresh(lease);
    const a = objectId ? job.assets.find((a) => a.object_id === objectId) : undefined;
    return {
      jobId: job.id,
      workspaceId: job.workspace_id,
      ownerId: job.owner_id,
      deviceId: job.device_id,
      manifestHash: job.manifest_hash,
      generation: "1",
      epoch: job.epoch,
      ...(a ? { objectId: a.object_id, sha256: a.sha256, bytes: a.bytes, operationId: a.op_id } : {}),
    };
  };
  try {
    if (job.state === "cancel_requested") {
      const ctx = context(),
        result = await backend.cancelStaging({ ...ctx, operationId: job.cancel_op });
      if (result?.state === "connected") {
        journal.connected(lease, result.receipt);
        return { state: "connected", cancelRejected: true };
      }
      journal.cancelFenced(lease, result);
    }
    job = journal.refresh(lease);
    if (job.state === "cancel_fenced") {
      for (const item of job.assets) {
        if (item.state === "deleted") continue;
        const observation = await backend.observe(context(item.object_id));
        const state = journal.observe(lease, item.object_id, observation);
        if (observation.operationSettled !== true) return { state: "cancel_fenced", blocked: "UNSETTLED_IO" };
        if (state === "verified") {
          const op = journal.beginDelete(lease, item.object_id);
          await backend.remove({ ...context(item.object_id), operationId: op });
          const absent = await backend.observe(context(item.object_id));
          if (journal.observe(lease, item.object_id, absent) !== "deleted")
            return { state: "cancel_fenced", blocked: "DELETE_UNCONFIRMED" };
        }
      }
      const result = await backend.finishCancel(context());
      journal.canceled(lease, result);
      return { state: "canceled" };
    }
    if (job.state === "publishing") {
      const result = await backend.publication({ ...context(), operationId: job.publish_op });
      if (
        result?.jobId !== job.id ||
        result.manifestHash !== job.manifest_hash ||
        result.operationId !== job.publish_op
      )
        throw Error("PUBLICATION_SCOPE");
      if (result?.state === "connected") {
        journal.connected(lease, result.receipt);
        return { state: "connected" };
      }
      if (result?.state !== "absent" || result.operationSettled !== true)
        return { state: "publishing", blocked: "PUBLICATION_UNCERTAIN" };
    } else {
      for (const item of job.assets) {
        if (item.state === "verified") continue;
        if (item.state === "uncertain") {
          const result = await backend.observe(context(item.object_id));
          const state = journal.observe(lease, item.object_id, result);
          if (result.operationSettled !== true) return { state: "uploading", blocked: "UNSETTLED_IO" };
          if (state === "verified") continue;
        }
        const bytes = readFileSync(join(directory, "assets", item.sha256 + ".bin"));
        if (bytes.length !== item.bytes || hash(bytes) !== item.sha256) throw Error("LOCAL_ASSET_CHANGED");
        const op = journal.beginUpload(lease, item.object_id);
        await backend.upload({ ...context(item.object_id), operationId: op }, bytes);
        const result = await backend.observe(context(item.object_id));
        if (journal.observe(lease, item.object_id, result) !== "verified")
          return { state: "uploading", blocked: "UPLOAD_UNCONFIRMED" };
      }
      // Mapper must stage metadata with refs only. It must never send the whole
      // SQLite file or inline binary; the product mapper/server is a later step.
      const staged = await backend.stageMetadata(context());
      if (staged?.manifestHash !== job.manifest_hash || staged.imagePayloadRows !== 0)
        throw Error("METADATA_NOT_VERIFIED");
    }
    const op = journal.beginPublish(lease);
    const result = await backend.publish({ ...context(), operationId: op });
    journal.connected(lease, result);
    return { state: "connected" };
  } finally {
    journal.release(lease);
  }
}
