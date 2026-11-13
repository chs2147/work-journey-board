// Server-only DEV migration control transport; no env reads or implicit requests.
import { GatewayError, readLimited } from "../v2-gateway/io.mjs";
const dev = "vsphftnmfzfoufasjttd";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha = /^[0-9a-f]{64}$/;
const shapes = {
  status: ["manifestHash"],
  workspace: ["manifestHash"],
  renew: ["manifestHash", "objectId"],
  observe: ["manifestHash", "objectId"],
  attest: ["manifestHash", "objectId", "ioVersion", "sha256", "bytes"],
  prepare_publish: ["manifestHash", "operationId", "expectedFence"],
  publish: ["manifestHash", "operationId", "token", "fence"],
  publication: ["manifestHash", "operationId"],
  cancel: ["manifestHash", "operationId"],
  confirm_absent: ["manifestHash", "objectId", "ioVersion"],
  finish_cancel: ["manifestHash"],
};
const errors = new Set([
  "MIGRATION_PREREQUISITES",
  "MIGRATION_INVALID_MANIFEST",
  "MIGRATION_LIMIT",
  "MIGRATION_INVALID_ASSET",
  "MIGRATION_DUPLICATE_ASSET",
  "MIGRATION_DOCUMENT_FORMAT",
  "MIGRATION_DUPLICATE_DOCUMENT",
  "MIGRATION_IMAGE_REFERENCE",
  "MIGRATION_INLINE_IMAGE",
  "MIGRATION_ASSET_NOT_DECLARED",
  "MIGRATION_INVALID_REQUEST",
  "MIGRATION_ACCESS_DENIED",
  "MIGRATION_IDEMPOTENCY_MISMATCH",
  "MIGRATION_INVALID_PARAMS",
  "MIGRATION_MANIFEST_CHANGED",
  "MIGRATION_OPERATION_REQUIRED",
  "MIGRATION_OPERATION_CHANGED",
  "MIGRATION_CANCELED",
  "MIGRATION_PUBLISH_FENCED",
  "MIGRATION_PUBLISH_BUSY",
  "MIGRATION_METADATA_CHANGED",
  "MIGRATION_NOT_VERIFIED",
  "MIGRATION_CANCEL_NOT_FENCED",
  "MIGRATION_CANCEL_INCOMPLETE",
  "MIGRATION_RENEW_BLOCKED",
  "MIGRATION_IO_UNSETTLED",
  "MIGRATION_ATTESTATION_REJECTED",
  "MIGRATION_INVALID_ACTION",
  ...[
    "WORKSPACE_FORMAT",
    "WORKSPACE_SCHEMA",
    "WORKSPACE_UNAVAILABLE",
    "ROW_FORMAT",
    "ROW_COLUMNS",
    "ROW_TYPE",
    "RECORD_KEY",
    "FOREIGN_KEY",
    "DUPLICATE_RECORD",
    "ROW_COUNTS",
    "DELETE_LOCK",
    "SETTINGS",
    "LOCAL_PATH",
    "RICH_FORMAT",
    "BOARD_FORMAT",
    "BOARD_REFERENCE",
    "WIDGET_FORMAT",
    "RESOURCE_FORMAT",
    "UNDO_FORMAT",
    "EXCLUSION",
    "DEPTH",
  ].map((v) => "MIGRATION_" + v),
]);
function keys(v, wanted) {
  return (
    v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.keys(v).sort().join("\0") === [...wanted].sort().join("\0")
  );
}
const decimal = (v) => typeof v === "string" && /^\d+$/.test(v) && BigInt(v) <= 9223372036854775807n;
const workspaceProfiles = [
  "workspace-db18-map-poc-1",
  "workspace-db19-map-poc-1",
  "workspace-db20-map-poc-1",
];
// DB20 needs server SQL 007 on the target; before that the server CHECK still rejects the profile.
const workspaceSchemas = {
  "workspace-db18-map-poc-1": 18,
  "workspace-db19-map-poc-1": 19,
  "workspace-db20-map-poc-1": 20,
};
function receipt(v, operationId, manifestHash, allowedProfiles) {
  return (
    v?.status === "poc-verified" &&
    allowedProfiles.has(v.profile) &&
    uuid.test(v.workspaceId) &&
    sha.test(v.sourceManifestHash) &&
    uuid.test(v.publicationId) &&
    v.manifestHash === manifestHash &&
    v.publicationId === operationId &&
    v.generation === "1"
  );
}
export function createMigrationRPC({
  projectRef,
  serviceRoleKey,
  fetchTransport,
  allowWorkspaceProfiles = false,
}) {
  if (
    typeof allowWorkspaceProfiles !== "boolean" ||
    projectRef !== dev ||
    typeof serviceRoleKey !== "string" ||
    !serviceRoleKey ||
    /[\r\n]/.test(serviceRoleKey) ||
    serviceRoleKey.startsWith("sbp_") ||
    serviceRoleKey.startsWith("sb_secret_") ||
    typeof fetchTransport !== "function"
  )
    throw Error("DEV_SERVER_TRANSPORT_REQUIRED");
  const allowedProfiles = new Set([
    "migration-document-poc-1",
    ...(allowWorkspaceProfiles ? workspaceProfiles : []),
  ]);
  const url = new URL(`https://${dev}.supabase.co/rest/v1/rpc/wjb_v2_migration_command`);
  return Object.freeze({
    async call({ action, jobId, params }, principal, deviceId) {
      if (
        !uuid.test(jobId) ||
        !uuid.test(principal?.userId) ||
        !uuid.test(principal?.sessionId) ||
        principal.role !== "authenticated" ||
        !uuid.test(deviceId)
      )
        throw new GatewayError("MIGRATION_SCOPE_REQUIRED");
      if (action === "start") {
        const full = allowWorkspaceProfiles && workspaceProfiles.includes(params?.profile);
        if (full) {
          if (
            !keys(params, [
              "profile",
              "workspaceId",
              "sourceSchema",
              "contractFingerprint",
              "sourceManifestHash",
              "assets",
              "records",
              "tableStats",
              "exclusions",
              "policies",
            ]) ||
            params.sourceSchema !== workspaceSchemas[params.profile] ||
            !sha.test(params.contractFingerprint) ||
            !Array.isArray(params.records) ||
            params.records.length > 2048 ||
            !Array.isArray(params.assets) ||
            params.assets.length > 8
          )
            throw new GatewayError("INVALID_RPC");
        } else if (!keys(params, ["workspaceId", "sourceManifestHash", "assets", "documents"]))
          throw new GatewayError("MIGRATION_PROFILE_UNSUPPORTED");
        if (
          !uuid.test(params.workspaceId) ||
          !sha.test(params.sourceManifestHash) ||
          !Array.isArray(params.assets) ||
          (!full && !Array.isArray(params.documents))
        )
          throw new GatewayError("INVALID_RPC");
      } else {
        if (
          (action === "workspace" && !allowWorkspaceProfiles) ||
          !Object.hasOwn(shapes, action) ||
          !keys(params, shapes[action]) ||
          !sha.test(params.manifestHash)
        )
          throw new GatewayError("INVALID_RPC");
        for (const k of ["objectId", "operationId", "token"])
          if (k in params && !uuid.test(params[k])) throw new GatewayError("INVALID_RPC");
        for (const k of ["ioVersion", "fence", "expectedFence"])
          if (
            k in params &&
            (typeof params[k] !== "string" ||
              !/^\d+$/.test(params[k]) ||
              BigInt(params[k]) > 9223372036854775807n)
          )
            throw new GatewayError("INVALID_RPC");
        if ("sha256" in params && !sha.test(params.sha256)) throw new GatewayError("INVALID_RPC");
        if (
          "bytes" in params &&
          (!Number.isInteger(params.bytes) || params.bytes < 1 || params.bytes > 65536)
        )
          throw new GatewayError("INVALID_RPC");
      }
      const body = JSON.stringify({
        p_request: {
          action,
          jobId,
          params,
          userId: principal.userId,
          sessionId: principal.sessionId,
          deviceId,
        },
      });
      if (
        Buffer.byteLength(body) >
        (action === "start" && workspaceProfiles.includes(params.profile) ? 1048576 : 65536)
      )
        throw new GatewayError("INVALID_RPC");
      let response;
      try {
        response = await fetchTransport(url, {
          method: "POST",
          headers: {
            apikey: serviceRoleKey,
            authorization: `Bearer ${serviceRoleKey}`,
            "content-type": "application/json",
            "cache-control": "no-store",
          },
          body,
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        throw new GatewayError("MIGRATION_UNAVAILABLE", 503);
      }
      if (!response.ok) {
        let code;
        try {
          const v = JSON.parse((await readLimited(response, 4096)).toString("utf8"));
          if (v.code === "P0001" && errors.has(v.message)) code = v.message;
        } catch {
          // Unrecognized upstream payloads map to the fixed generic error below.
        }
        if (code) throw new GatewayError(code, code === "MIGRATION_ACCESS_DENIED" ? 403 : 409);
        throw new GatewayError("MIGRATION_UNAVAILABLE", 503);
      }
      try {
        const v = JSON.parse(
          (await readLimited(response, action === "workspace" ? 1048576 + 8192 : 8192)).toString("utf8"),
        );
        if (!v || typeof v !== "object" || Array.isArray(v)) throw Error();
        if (
          action === "start" &&
          (v.jobId !== jobId ||
            v.workspaceId !== params.workspaceId ||
            v.sourceManifestHash !== params.sourceManifestHash ||
            !allowedProfiles.has(v.profile) ||
            !sha.test(v.manifestHash) ||
            v.profile !== (params.profile || "migration-document-poc-1") ||
            !["staging", "connected", "cancel_fenced", "canceled"].includes(v.state))
        )
          throw Error();
        if ("jobId" in v && v.jobId !== jobId) throw Error();
        if (action !== "start" && "manifestHash" in v && v.manifestHash !== params.manifestHash)
          throw Error();
        if (
          (["status", "workspace", "observe", "publication", "finish_cancel"].includes(action) ||
            (action === "cancel" && v.state === "cancel_fenced")) &&
          (v.jobId !== jobId || v.manifestHash !== params.manifestHash)
        )
          throw Error();
        if (
          action === "status" &&
          (!["staging", "connected", "cancel_fenced", "canceled"].includes(v.state) ||
            !decimal(v.epoch) ||
            !allowedProfiles.has(v.profile) ||
            !uuid.test(v.workspaceId) ||
            !sha.test(v.sourceManifestHash))
        )
          throw Error();
        if (
          action === "observe" &&
          (v.objectId !== params.objectId ||
            !["reserved", "ready", "cleanup", "canceled"].includes(v.assetState) ||
            !decimal(v.ioVersion) ||
            typeof v.operationSettled !== "boolean" ||
            v.ownedByJob !== true ||
            !sha.test(v.sha256) ||
            !Number.isInteger(v.bytes) ||
            v.bytes < 1 ||
            v.bytes > 65536)
        )
          throw Error();
        if (
          action === "workspace" &&
          (v.productActivationAllowed !== false ||
            !uuid.test(v.workspaceId) ||
            !workspaceProfiles.includes(v.envelope?.profile) ||
            v.envelope.workspaceId !== v.workspaceId ||
            !sha.test(v.envelope.sourceManifestHash) ||
            !Array.isArray(v.envelope.records) ||
            !Array.isArray(v.envelope.assets))
        )
          throw Error();
        if (action === "attest" && (v.attested !== true || v.ioVersion !== params.ioVersion)) throw Error();
        if (action === "renew" && v.renewed !== true) throw Error();
        if (action === "confirm_absent" && v.absentConfirmed !== true) throw Error();
        if (
          ["publish", "prepare_publish", "publication", "cancel"].includes(action) &&
          v.state === "connected"
        ) {
          if (
            !receipt(
              v.receipt,
              action === "cancel" ? v.receipt?.publicationId : params.operationId,
              params.manifestHash,
              allowedProfiles,
            )
          )
            throw Error();
        } else if (
          action === "publish" &&
          !receipt(v, params.operationId, params.manifestHash, allowedProfiles)
        )
          throw Error();
        else if (
          action === "prepare_publish" &&
          (v.operationId !== params.operationId ||
            !uuid.test(v.token) ||
            !decimal(v.fence) ||
            v.fence === "0")
        )
          throw Error();
        else if (
          action === "publication" &&
          (v.operationId !== params.operationId ||
            !["pending", "absent"].includes(v.state) ||
            v.operationSettled !== (v.state === "absent") ||
            (v.state === "absent" && !decimal(v.serverFence)))
        )
          throw Error();
        else if (
          action === "cancel" &&
          (v.state !== "cancel_fenced" || v.publishBlocked !== true || !decimal(v.epoch))
        )
          throw Error();
        if (action === "finish_cancel" && (v.state !== "canceled" || !decimal(v.epoch))) throw Error();
        return v;
      } catch {
        throw new GatewayError("MIGRATION_UNAVAILABLE", 503);
      }
    },
  });
}

export function bindMigrationManifests(
  { jobId, workspaceId, sourceManifestHash, expectedProfile = "migration-document-poc-1" },
  reply,
) {
  if (
    !uuid.test(jobId) ||
    reply?.jobId !== jobId ||
    !uuid.test(workspaceId) ||
    !sha.test(sourceManifestHash) ||
    reply?.workspaceId !== workspaceId ||
    reply.sourceManifestHash !== sourceManifestHash ||
    !sha.test(reply.manifestHash) ||
    !["migration-document-poc-1", ...workspaceProfiles].includes(expectedProfile) ||
    reply.profile !== expectedProfile
  )
    throw Error("MANIFEST_BINDING_MISMATCH");
  return Object.freeze({
    jobId,
    workspaceId,
    sourceManifestHash,
    targetManifestHash: reply.manifestHash,
    targetProfile: reply.profile,
    productActivationAllowed: false,
  });
}
