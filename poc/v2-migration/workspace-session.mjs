// Full-profile control connection; optional trusted Storage adapter performs and proves IO.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inspectConnectedCopy } from "../v2-assets/connected-copy.mjs";
import { mapWorkspace } from "./workspace-map.mjs";
import { hash } from "../v2-sync/model.mjs";
import { bindMigrationManifests } from "./server-rpc.mjs";

export async function advanceWorkspaceSession({ journal, id, actor, directory, rpc, principal, assetIO }) {
  if (principal?.role !== "authenticated" || principal.userId !== actor?.ownerId)
    throw Error("WORKSPACE_PRINCIPAL_MISMATCH");
  let job = journal.get(id, actor);
  if (job.binding?.phase === "poc_verified")
    return { state: "poc-verified", productActivationAllowed: false };
  if (job.state === "canceled") return { state: "canceled", productActivationAllowed: false };
  const lease = journal.acquire(id, actor);
  const call = (action, params) => rpc.call({ action, jobId: id, params }, principal, actor.deviceId);
  try {
    job = journal.refresh(lease);
    if (!job.binding?.target_manifest_hash) {
      // Persist mapping intent BEFORE the first request. A lost start response is
      // replayed with the same job and exact frozen copy; missing copy never means absent.
      const copy = inspectConnectedCopy(directory, job.workspace_id);
      if (hash(copy.manifest) !== job.manifest_hash) throw Error("COPY_MANIFEST_CHANGED");
      const mapped = mapWorkspace(directory, job.workspace_id);
      journal.prepareWorkspace(lease, { mappingHash: mapped.mappingHash, profile: mapped.envelope.profile });
      const started = await call("start", mapped.envelope);
      const binding = bindMigrationManifests(
        {
          jobId: id,
          workspaceId: job.workspace_id,
          sourceManifestHash: job.manifest_hash,
          expectedProfile: mapped.envelope.profile,
        },
        started,
      );
      journal.bindWorkspace(lease, binding);
    }
    job = journal.refresh(lease);
    const b = job.binding,
      target = b.target_manifest_hash;
    const status = await call("status", { manifestHash: target });
    if (
      status.workspaceId !== job.workspace_id ||
      status.sourceManifestHash !== b.source_manifest_hash ||
      status.profile !== b.target_profile
    )
      throw Error("WORKSPACE_SERVER_SCOPE");
    if (job.state === "cancel_requested") {
      const canceled = await call("cancel", { manifestHash: target, operationId: job.cancel_op });
      if (canceled.state === "connected") {
        journal.workspacePocVerified(lease, canceled.receipt);
        return { state: "poc-verified", cancelRejected: true, productActivationAllowed: false };
      }
      journal.workspaceCancelFenced(lease, canceled);
      job = journal.refresh(lease);
    }
    if (job.state === "cancel_fenced") {
      if (assetIO && !(await assetIO.cancelAll({ journal, lease })))
        return { state: "cancel_fenced", blocked: "UNSETTLED_STORAGE_IO", productActivationAllowed: false };
      let result;
      try {
        result = await call("finish_cancel", { manifestHash: target });
      } catch (e) {
        if (e.code === "MIGRATION_CANCEL_INCOMPLETE")
          return {
            state: "cancel_fenced",
            blocked: "STORAGE_ABSENCE_VERIFICATION_REQUIRED",
            productActivationAllowed: false,
          };
        throw e;
      }
      journal.workspaceCanceled(lease, result);
      return { state: "canceled", productActivationAllowed: false };
    }
    if (job.state === "publishing") {
      const result = await call("publication", { manifestHash: target, operationId: job.publish_op });
      if (result.state === "connected") {
        journal.workspacePocVerified(lease, result.receipt);
        return { state: "poc-verified", productActivationAllowed: false };
      }
      if (result.state !== "absent" || result.operationSettled !== true)
        return { state: "publishing", blocked: "PUBLICATION_UNCERTAIN", productActivationAllowed: false };
      // A settled-absent fence invalidates delayed prepares/publishes before retry.
      if (job.assets.length && (!assetIO || !(await assetIO.attestAll({ journal, lease }))))
        return {
          state: "publishing",
          blocked: "STORAGE_ATTESTATION_REQUIRED",
          productActivationAllowed: false,
        };
      const t = await call("prepare_publish", {
        manifestHash: target,
        operationId: job.publish_op,
        expectedFence: result.serverFence,
      });
      const receipt = await call("publish", { manifestHash: target, ...t });
      journal.workspacePocVerified(lease, receipt);
      return { state: "poc-verified", productActivationAllowed: false };
    }
    if (!["prepared", "uploading"].includes(job.state)) throw Error("WORKSPACE_SESSION_STATE");
    // Revalidate the frozen copy; later original edits are deliberately not collected.
    const copy = inspectConnectedCopy(directory, job.workspace_id);
    if (hash(copy.manifest) !== b.source_manifest_hash) throw Error("COPY_MANIFEST_CHANGED");
    const mapped = mapWorkspace(directory, job.workspace_id);
    if (mapped.mappingHash !== b.mapping_hash) throw Error("WORKSPACE_MAPPING_CHANGED");
    const read = await call("workspace", { manifestHash: target });
    if (
      read.workspaceId !== job.workspace_id ||
      read.envelope.sourceManifestHash !== b.source_manifest_hash ||
      read.envelope.profile !== b.target_profile ||
      hash(read.envelope) !== b.mapping_hash
    )
      throw Error("WORKSPACE_METADATA_MISMATCH");
    journal.workspaceVerified(lease, {
      jobId: id,
      mappingHash: hash(read.envelope),
      targetManifestHash: target,
      sourceManifestHash: b.source_manifest_hash,
      profile: b.target_profile,
    });
    if (job.assets.length) {
      if (!assetIO)
        return { state: "staged", blocked: "ASSET_GATEWAY_NOT_CONNECTED", productActivationAllowed: false };
      for (const item of job.assets) {
        const bytes = readFileSync(join(directory, "assets", item.sha256 + ".bin"));
        if (bytes.length !== item.bytes || hash(bytes) !== item.sha256) throw Error("LOCAL_ASSET_CHANGED");
        if (!(await assetIO.upload({ journal, lease, objectId: item.object_id, bytes })))
          return { state: "uploading", blocked: "UNSETTLED_STORAGE_IO", productActivationAllowed: false };
      }
      if (!(await assetIO.attestAll({ journal, lease })))
        return {
          state: "uploading",
          blocked: "STORAGE_ATTESTATION_REQUIRED",
          productActivationAllowed: false,
        };
    }
    const op = journal.beginPublish(lease);
    const observed = await call("publication", { manifestHash: target, operationId: op });
    if (observed.state === "connected") {
      journal.workspacePocVerified(lease, observed.receipt);
      return { state: "poc-verified", productActivationAllowed: false };
    }
    if (observed.state !== "absent" || observed.operationSettled !== true)
      return { state: "publishing", blocked: "PUBLICATION_UNCERTAIN", productActivationAllowed: false };
    const t = await call("prepare_publish", {
      manifestHash: target,
      operationId: op,
      expectedFence: observed.serverFence,
    });
    const receipt = await call("publish", { manifestHash: target, ...t });
    journal.workspacePocVerified(lease, receipt);
    return { state: "poc-verified", productActivationAllowed: false };
  } finally {
    journal.release(lease);
  }
}
