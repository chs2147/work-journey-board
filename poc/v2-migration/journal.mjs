// Synthetic, local-only migration journal. Never opens a legacy DB for writing.
import { DatabaseSync } from "node:sqlite";
import { existsSync, openSync, closeSync, realpathSync, lstatSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { guard } from "../v2-sync/db18.mjs";
import { transaction, hash } from "../v2-sync/model.mjs";
import { inspectConnectedCopy } from "../v2-assets/connected-copy.mjs";
import { assertSeparateWorkspacePaths } from "../v2-runtime/isolation.mjs";

const applicationId = 1464487217;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const jobStates =
  "'prepared','uploading','publishing','connected','cancel_requested','cancel_fenced','canceled'";
const assetStates = "'pending','uncertain','verified','delete_uncertain','deleted'";
export function openMigrationJournal(path, { clock = () => Date.now(), protectedLocalRoots } = {}) {
  guard(path);
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || stat.nlink !== 1) throw Error("JOURNAL_ALIAS_DENIED");
    const inspect = new DatabaseSync(path, { readOnly: true });
    try {
      if (
        inspect.prepare("PRAGMA application_id").get().application_id !== applicationId ||
        ![1, 2].includes(inspect.prepare("PRAGMA user_version").get().user_version)
      )
        throw Error("NOT_MIGRATION_JOURNAL");
    } finally {
      inspect.close();
    }
  }
  if (!Array.isArray(protectedLocalRoots) || !protectedLocalRoots.length)
    throw Error("PROTECTED_LOCAL_ROOTS_REQUIRED");
  for (const root of protectedLocalRoots)
    assertSeparateWorkspacePaths(process.platform, realpathSync(root), realpathSync(dirname(path)));
  if (!existsSync(path)) {
    closeSync(openSync(path, "wx", 0o600));
  }
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;");
  if (db.prepare("PRAGMA application_id").get().application_id !== applicationId) {
    transaction(db, () =>
      db.exec(`
      PRAGMA application_id=${applicationId}; PRAGMA user_version=1;
      CREATE TABLE job(
        id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,device_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL UNIQUE,source_workspace_id TEXT NOT NULL,
        manifest_hash TEXT NOT NULL,source_hash TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN (${jobStates})),epoch INTEGER NOT NULL DEFAULT 1,
        fence INTEGER NOT NULL DEFAULT 0,lease_token TEXT,lease_until INTEGER,
        publish_op TEXT,cancel_op TEXT);
      CREATE TABLE asset(
        job_id TEXT NOT NULL REFERENCES job(id),object_id TEXT NOT NULL,
        sha256 TEXT NOT NULL,bytes INTEGER NOT NULL CHECK(bytes>0),
        state TEXT NOT NULL CHECK(state IN (${assetStates})),op_id TEXT,
        PRIMARY KEY(job_id,object_id));
    `),
    );
  }
  db.exec("PRAGMA foreign_keys=ON;");
  if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") {
    db.close();
    throw Error("JOURNAL_INTEGRITY");
  }
  // Forward-only journal upgrade, after identity/path/integrity validation.
  if (db.prepare("PRAGMA user_version").get().user_version === 1) {
    transaction(db, () =>
      db.exec(`
      CREATE TABLE workspace_binding(
        job_id TEXT PRIMARY KEY REFERENCES job(id),
        source_manifest_hash TEXT NOT NULL CHECK(length(source_manifest_hash)=64),
        mapping_hash TEXT NOT NULL CHECK(length(mapping_hash)=64),
        target_profile TEXT NOT NULL CHECK(target_profile IN ('workspace-db18-map-poc-1','workspace-db19-map-poc-1')),
        target_manifest_hash TEXT CHECK(target_manifest_hash IS NULL OR length(target_manifest_hash)=64),
        phase TEXT NOT NULL CHECK(phase IN ('waiting_binding','staged','publishing','poc_verified','cancel_fenced','canceled')),
        metadata_verified INTEGER NOT NULL DEFAULT 0 CHECK(metadata_verified IN (0,1)),
        server_epoch TEXT);
      PRAGMA user_version=2;
    `),
    );
  }
  const view = (id) => {
    const row = db.prepare("SELECT * FROM job WHERE id=?").get(id);
    if (!row) throw Error("JOB_NOT_FOUND");
    return {
      ...row,
      binding: db.prepare("SELECT * FROM workspace_binding WHERE job_id=?").get(id) || null,
      assets: db
        .prepare("SELECT * FROM asset WHERE job_id=? ORDER BY object_id")
        .all(id)
        .map((a) => ({ ...a })),
    };
  };
  function scoped(id, actor) {
    const job = view(id);
    if (job.owner_id !== actor?.ownerId || job.device_id !== actor?.deviceId) throw Error("SCOPE_DENIED");
    return job;
  }
  function fenced(lease) {
    const job = scoped(lease.id, lease.actor);
    if (
      job.lease_token !== lease.token ||
      job.fence !== lease.fence ||
      job.epoch !== lease.epoch ||
      job.lease_until <= clock()
    )
      throw Error("LEASE_LOST");
    return job;
  }
  function mutation(lease, fn) {
    return transaction(db, () => fn(fenced(lease)));
  }
  function asset(job, objectId) {
    const row = job.assets.find((a) => a.object_id === objectId);
    if (!row) throw Error("ASSET_NOT_FOUND");
    return row;
  }
  return {
    close: () => db.close(),
    get: scoped,
    create({ directory, workspaceId, ownerId, deviceId }) {
      if (![workspaceId, ownerId, deviceId].every((v) => uuid.test(v))) throw Error("SCOPE_REQUIRED");
      const copy = inspectConnectedCopy(directory, workspaceId),
        id = randomUUID();
      transaction(db, () => {
        db.prepare(
          "INSERT INTO job(id,owner_id,device_id,workspace_id,source_workspace_id,manifest_hash,source_hash,state) VALUES(?,?,?,?,?,?,?,'prepared')",
        ).run(
          id,
          ownerId,
          deviceId,
          workspaceId,
          copy.manifest.sourceWorkspaceId,
          hash(copy.manifest),
          copy.manifest.sourceHash,
        );
        for (const b of copy.blobs)
          db.prepare("INSERT INTO asset VALUES(?,?,?,?,'pending',NULL)").run(id, b.object_id, b.id, b.bytes);
      });
      return scoped(id, { ownerId, deviceId });
    },
    prepareWorkspace(lease, { mappingHash, profile }) {
      return mutation(lease, (job) => {
        if (
          !/^[0-9a-f]{64}$/.test(mappingHash) ||
          !["workspace-db18-map-poc-1", "workspace-db19-map-poc-1"].includes(profile)
        )
          throw Error("WORKSPACE_BINDING_REQUIRED");
        if (job.binding) {
          if (
            job.binding.mapping_hash !== mappingHash ||
            job.binding.target_profile !== profile ||
            job.binding.source_manifest_hash !== job.manifest_hash
          )
            throw Error("WORKSPACE_MAPPING_CHANGED");
          return job.binding;
        }
        if (!["prepared", "cancel_requested"].includes(job.state)) throw Error("WORKSPACE_BINDING_STATE");
        db.prepare(
          "INSERT INTO workspace_binding(job_id,source_manifest_hash,mapping_hash,target_profile,phase) VALUES(?,?,?,?,'waiting_binding')",
        ).run(job.id, job.manifest_hash, mappingHash, profile);
        return view(job.id).binding;
      });
    },
    bindWorkspace(lease, binding) {
      return mutation(lease, (job) => {
        const b = job.binding;
        if (
          !b ||
          binding?.jobId !== job.id ||
          binding.workspaceId !== job.workspace_id ||
          binding.sourceManifestHash !== b.source_manifest_hash ||
          binding.targetProfile !== b.target_profile ||
          binding.productActivationAllowed !== false ||
          !/^[0-9a-f]{64}$/.test(binding.targetManifestHash)
        )
          throw Error("WORKSPACE_BINDING_MISMATCH");
        if (b.target_manifest_hash && b.target_manifest_hash !== binding.targetManifestHash)
          throw Error("WORKSPACE_TARGET_CHANGED");
        if (!b.target_manifest_hash)
          db.prepare("UPDATE workspace_binding SET target_manifest_hash=?,phase='staged' WHERE job_id=?").run(
            binding.targetManifestHash,
            job.id,
          );
        return view(job.id).binding;
      });
    },
    workspaceVerified(lease, proof) {
      return mutation(lease, (job) => {
        const b = job.binding;
        if (
          !b?.target_manifest_hash ||
          proof?.jobId !== job.id ||
          proof.mappingHash !== b.mapping_hash ||
          proof.targetManifestHash !== b.target_manifest_hash ||
          proof.sourceManifestHash !== b.source_manifest_hash ||
          proof.profile !== b.target_profile
        )
          throw Error("WORKSPACE_METADATA_MISMATCH");
        db.prepare("UPDATE workspace_binding SET metadata_verified=1 WHERE job_id=?").run(job.id);
      });
    },
    workspacePocVerified(lease, receipt) {
      return mutation(lease, (job) => {
        const b = job.binding;
        if (
          !b?.metadata_verified ||
          !["publishing", "cancel_requested"].includes(job.state) ||
          receipt?.status !== "poc-verified" ||
          receipt.profile !== b.target_profile ||
          receipt.workspaceId !== job.workspace_id ||
          receipt.manifestHash !== b.target_manifest_hash ||
          receipt.sourceManifestHash !== b.source_manifest_hash ||
          receipt.generation !== "1" ||
          !job.publish_op ||
          receipt.publicationId !== job.publish_op
        )
          throw Error("WORKSPACE_RECEIPT_MISMATCH");
        db.prepare("UPDATE workspace_binding SET phase='poc_verified' WHERE job_id=?").run(job.id);
        // Do not mark product job 'connected': PoC receipt cannot activate a workspace.
      });
    },
    workspaceCancelFenced(lease, result) {
      return mutation(lease, (job) => {
        const b = job.binding;
        if (
          !b ||
          job.state !== "cancel_requested" ||
          result?.state !== "cancel_fenced" ||
          result.publishBlocked !== true ||
          result.jobId !== job.id ||
          result.manifestHash !== b.target_manifest_hash ||
          typeof result.epoch !== "string" ||
          !/^[1-9][0-9]*$/.test(result.epoch)
        )
          throw Error("CANCEL_NOT_FENCED");
        db.prepare("UPDATE job SET state='cancel_fenced' WHERE id=?").run(job.id);
        db.prepare("UPDATE workspace_binding SET phase='cancel_fenced',server_epoch=? WHERE job_id=?").run(
          result.epoch,
          job.id,
        );
      });
    },
    workspaceCanceled(lease, result) {
      return mutation(lease, (job) => {
        const b = job.binding;
        if (
          !b ||
          job.state !== "cancel_fenced" ||
          result?.state !== "canceled" ||
          result.jobId !== job.id ||
          result.manifestHash !== b.target_manifest_hash ||
          result.epoch !== b.server_epoch
        )
          throw Error("CANCEL_NOT_COMPLETE");
        db.prepare("UPDATE job SET state='canceled' WHERE id=?").run(job.id);
        db.prepare("UPDATE workspace_binding SET phase='canceled' WHERE job_id=?").run(job.id);
      });
    },
    acquire(id, actor) {
      return transaction(db, () => {
        const job = scoped(id, actor);
        if (job.lease_token && job.lease_until > clock()) throw Error("LEASE_BUSY");
        const token = randomUUID(),
          fence = job.fence + 1;
        db.prepare("UPDATE job SET lease_token=?,lease_until=?,fence=? WHERE id=?").run(
          token,
          clock() + 30000,
          fence,
          id,
        );
        return { id, actor, token, fence, epoch: job.epoch };
      });
    },
    refresh(lease) {
      return mutation(lease, () => {
        db.prepare("UPDATE job SET lease_until=? WHERE id=?").run(clock() + 30000, lease.id);
        return scoped(lease.id, lease.actor);
      });
    },
    release(lease) {
      db.prepare(
        "UPDATE job SET lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=? AND fence=? AND epoch=?",
      ).run(lease.id, lease.token, lease.fence, lease.epoch);
    },
    requestCancel(id, actor) {
      return transaction(db, () => {
        const job = scoped(id, actor);
        if (job.state === "connected" || job.binding?.phase === "poc_verified")
          throw Error("ALREADY_CONNECTED");
        if (["canceled", "cancel_requested", "cancel_fenced"].includes(job.state)) return job;
        db.prepare(
          "UPDATE job SET state='cancel_requested',epoch=epoch+1,lease_token=NULL,lease_until=NULL,cancel_op=? WHERE id=?",
        ).run(randomUUID(), id);
        return scoped(id, actor);
      });
    },
    beginUpload(lease, objectId) {
      return mutation(lease, (job) => {
        if (!["prepared", "uploading"].includes(job.state) || asset(job, objectId).state !== "pending")
          throw Error("UPLOAD_STATE");
        const op = randomUUID();
        db.prepare("UPDATE job SET state='uploading' WHERE id=?").run(job.id);
        db.prepare("UPDATE asset SET state='uncertain',op_id=? WHERE job_id=? AND object_id=?").run(
          op,
          job.id,
          objectId,
        );
        return op;
      });
    },
    observe(lease, objectId, result) {
      return mutation(lease, (job) => {
        const row = asset(job, objectId),
          cancel = job.state === "cancel_fenced";
        if (!["pending", "uncertain", "delete_uncertain", "verified"].includes(row.state)) return row.state;
        if (
          result?.jobId !== job.id ||
          result.objectId !== objectId ||
          result.manifestHash !== job.manifest_hash ||
          result.operationId !== row.op_id
        )
          throw Error("OBSERVATION_SCOPE");
        if (result?.operationSettled !== true) return row.state;
        let state;
        if (result.kind === "absent") state = cancel ? "deleted" : "pending";
        else if (
          result.kind === "ready" &&
          result.ownedByJob === true &&
          result.sha256 === row.sha256 &&
          result.bytes === row.bytes
        )
          state = "verified";
        else throw Error("REMOTE_INTEGRITY_OR_OWNERSHIP");
        if (cancel && row.state === "delete_uncertain" && result.kind === "ready") state = "verified";
        db.prepare("UPDATE asset SET state=? WHERE job_id=? AND object_id=?").run(state, job.id, objectId);
        return state;
      });
    },
    beginDelete(lease, objectId) {
      return mutation(lease, (job) => {
        if (job.state !== "cancel_fenced" || asset(job, objectId).state !== "verified")
          throw Error("DELETE_STATE");
        const op = randomUUID();
        db.prepare("UPDATE asset SET state='delete_uncertain',op_id=? WHERE job_id=? AND object_id=?").run(
          op,
          job.id,
          objectId,
        );
        return op;
      });
    },
    beginPublish(lease) {
      return mutation(lease, (job) => {
        if (
          !["prepared", "uploading", "publishing"].includes(job.state) ||
          (job.binding && !job.binding.metadata_verified) ||
          job.assets.some((a) => a.state !== "verified")
        )
          throw Error("ASSETS_NOT_VERIFIED");
        const op = job.publish_op || randomUUID();
        db.prepare("UPDATE job SET state='publishing',publish_op=? WHERE id=?").run(op, job.id);
        return op;
      });
    },
    connected(lease, receipt) {
      return mutation(lease, (job) => {
        if (job.binding) throw Error("FULL_WORKSPACE_COORDINATOR_REQUIRED");
        if (!["publishing", "cancel_requested"].includes(job.state)) throw Error("PUBLICATION_STATE");
        if (
          receipt?.status !== "verified" ||
          receipt.workspaceId !== job.workspace_id ||
          receipt.manifestHash !== job.manifest_hash ||
          receipt.generation !== "1"
        )
          throw Error("RECEIPT_MISMATCH");
        db.prepare("UPDATE job SET state='connected' WHERE id=?").run(job.id);
      });
    },
    cancelFenced(lease, result) {
      return mutation(lease, (job) => {
        if (
          job.state !== "cancel_requested" ||
          result?.state !== "cancel_fenced" ||
          result.publishBlocked !== true ||
          result.jobId !== job.id ||
          result.epoch !== job.epoch ||
          result.manifestHash !== job.manifest_hash
        )
          throw Error("CANCEL_NOT_FENCED");
        db.prepare("UPDATE job SET state='cancel_fenced' WHERE id=?").run(job.id);
      });
    },
    canceled(lease, result) {
      return mutation(lease, (job) => {
        if (
          job.state !== "cancel_fenced" ||
          job.assets.some((a) => a.state !== "deleted") ||
          result?.state !== "canceled" ||
          result.jobId !== job.id ||
          result.epoch !== job.epoch ||
          result.manifestHash !== job.manifest_hash
        )
          throw Error("CANCEL_NOT_COMPLETE");
        db.prepare("UPDATE job SET state='canceled' WHERE id=?").run(job.id);
      });
    },
  };
}
