// Trusted callback reference, no HTTP/credentials or product IPC wiring.
import { hash } from "../v2-sync/model.mjs";
import { openOnlineCache, ONLINE_CACHE } from "./online-cache.mjs";
export async function openVerifiedOnlineCache({
  root,
  identity,
  protectedLocalRoots,
  verifyRemote,
  isCurrent,
  clock = Date.now,
}) {
  if (typeof verifyRemote !== "function" || typeof isCurrent !== "function")
    throw Error("CACHE_ACTIVATION_ADAPTER_REQUIRED");
  const ensure = () => {
    if (isCurrent() !== true) throw Error("CACHE_ACTIVATION_STALE");
  };
  ensure();
  const handle = openOnlineCache(root, { identity, protectedLocalRoots });
  try {
    if (handle.pendingCount) throw Error("CACHE_PENDING_REQUIRES_SYNC");
    const request = Object.freeze({
      ...identity,
      snapshotHash: handle.manifest.snapshotHash,
      assetCatalogHash: hash(
        handle.readAssets().map((a) => ({ objectId: a.objectId, sha256: a.sha256, bytes: a.bytes })),
      ),
      family: ONLINE_CACHE.family,
      version: ONLINE_CACHE.version,
      capability: "snapshot-read",
    });
    const receipt = await verifyRemote(request);
    ensure();
    const now = clock();
    if (
      !Number.isSafeInteger(now) ||
      now < 0 ||
      receipt?.status !== "verified" ||
      receipt.contract !== "wjb-online-activation-v1" ||
      receipt.capability !== "snapshot-read" ||
      receipt.assetsState !== "verified" ||
      receipt.assetCatalogHash !== request.assetCatalogHash ||
      receipt.family !== request.family ||
      receipt.version !== request.version ||
      ["ownerId", "workspaceId", "deviceId", "generation", "snapshotHash"].some(
        (k) => receipt[k] !== request[k],
      ) ||
      !Number.isSafeInteger(receipt.issuedAt) ||
      !Number.isSafeInteger(receipt.expiresAt) ||
      receipt.issuedAt > now ||
      receipt.expiresAt <= now ||
      receipt.expiresAt - receipt.issuedAt > 300000 ||
      now - receipt.issuedAt > 60000
    )
      throw Error("CACHE_ACTIVATION_REQUIRED");
    const expiresAt = receipt.expiresAt;
    let lastObserved = now;
    let terminal = null;
    const allowed = () => {
      if (terminal) throw terminal;
      try {
        ensure();
        const currentTime = clock();
        if (!Number.isSafeInteger(currentTime) || currentTime < lastObserved || currentTime >= expiresAt)
          throw Error("CACHE_ACTIVATION_EXPIRED");
        lastObserved = currentTime;
      } catch (error) {
        terminal = error;
        handle.close();
        throw error;
      }
    };
    return Object.freeze({
      capability: "snapshot-read",
      productActivationAllowed: false,
      activation: Object.freeze({
        status: "cache-verified",
        schemaFamily: ONLINE_CACHE.family,
        capability: "snapshot-read",
        ownerId: request.ownerId,
        workspaceId: request.workspaceId,
        generation: request.generation,
        snapshotHash: request.snapshotHash,
        expiresAt,
      }),
      readRecords() {
        allowed();
        return handle.readRecords();
      },
      readAssets() {
        allowed();
        return handle.readAssets();
      },
      close: () => handle.close(),
    });
  } catch (e) {
    handle.close();
    throw e;
  }
}
