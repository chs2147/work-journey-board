// Standalone design PoC. No env/config reads, network, file writes or Tauri use.
import { win32, posix } from "node:path";

const profiles = Object.freeze({
  "local-classic": Object.freeze({
    appId: "com.chs2147.workjourneyboard",
    productName: "Work Journey Board",
    configDirectory: "WorkJourneyBoard",
    releaseRepository: "chs2147/work-journey-board",
  }),
  "connected-preview": Object.freeze({
    appId: "com.chs2147.workjourneyboard.connected.preview",
    productName: "Work Journey Board Connected Preview",
    configDirectory: "WorkJourneyBoardConnectedPreview",
    // Candidate identity only. No approved V2 release repository yet.
    releaseRepository: null,
  }),
});
function platformPath(platform) {
  if (platform === "win32") return win32;
  if (platform === "darwin" || platform === "linux") return posix;
  throw Error("PLATFORM_REQUIRED");
}
function canonical(platform, path) {
  const p = platformPath(platform);
  if (typeof path !== "string" || !path || path.includes("\0") || !p.isAbsolute(path))
    throw Error("ABSOLUTE_PATH_REQUIRED");
  if (platform === "win32" && (/^\\\\[?.]\\/.test(path) || path.slice(2).includes(":")))
    throw Error("UNSUPPORTED_WINDOWS_PATH");
  const normalized = p.normalize(path).replace(/[\\/]+$/, "");
  if (platform === "win32" && normalized.split("\\").some((part) => /[. ]$/.test(part)))
    throw Error("UNSUPPORTED_WINDOWS_PATH");
  return platform === "linux" ? normalized : normalized.normalize("NFC").toLowerCase();
}
function contains(platform, parent, child) {
  const p = platformPath(platform),
    a = canonical(platform, parent),
    b = canonical(platform, child);
  return a === b || b.startsWith(a + p.sep);
}
export function assertSeparateWorkspacePaths(platform, localRoot, onlineRoot) {
  if (contains(platform, localRoot, onlineRoot) || contains(platform, onlineRoot, localRoot))
    throw Error("LOCAL_ONLINE_PATH_OVERLAP");
}
export function resolveIsolationProfile({ profile, platform, localDataBase }) {
  if (!Object.hasOwn(profiles, profile)) throw Error("EXPLICIT_PROFILE_REQUIRED");
  canonical(platform, localDataBase);
  const p = platformPath(platform),
    identity = profiles[profile];
  return Object.freeze({
    profile,
    platform,
    ...identity,
    configRoot: p.join(localDataBase, identity.configDirectory),
    runtimeRoot: p.join(localDataBase, identity.appId),
    updateCache: p.join(localDataBase, identity.appId, "updates"),
    credentialNamespace: identity.appId + ":credentials",
    ipcNamespace: identity.appId + ":ipc",
    instanceNamespace: identity.appId + ":instance",
    fileAssociationRegistration: profile === "local-classic" ? "existing-local-only" : "disabled",
    updaterEnabled: identity.releaseRepository !== null,
  });
}
export function assertProfileSeparation(local, connected) {
  if (
    local.profile !== "local-classic" ||
    connected.profile !== "connected-preview" ||
    local.platform !== connected.platform
  )
    throw Error("PROFILE_PAIR_REQUIRED");
  for (const key of ["appId", "productName", "credentialNamespace", "ipcNamespace", "instanceNamespace"])
    if (local[key] === connected[key]) throw Error("PROFILE_NAMESPACE_COLLISION");
  for (const left of [local.configRoot, local.runtimeRoot, local.updateCache])
    for (const right of [connected.configRoot, connected.runtimeRoot, connected.updateCache])
      assertSeparateWorkspacePaths(local.platform, left, right);
  if (
    connected.releaseRepository === local.releaseRepository ||
    connected.fileAssociationRegistration !== "disabled"
  )
    throw Error("LEGACY_CHANNEL_COLLISION");
}
export function assertReleasePublication({ profile, repository }) {
  const selected = profiles[profile];
  if (!selected) throw Error("EXPLICIT_PROFILE_REQUIRED");
  if (profile === "connected-preview" && repository === profiles["local-classic"].releaseRepository)
    throw Error("LEGACY_RELEASE_FEED_FORBIDDEN");
  if (!selected.releaseRepository) throw Error("RELEASE_CHANNEL_NOT_CONFIGURED");
  if (repository !== selected.releaseRepository) throw Error("RELEASE_REPOSITORY_MISMATCH");
}

// Adapters are trusted factories; callers cannot inject storage mode via UI data.
// Local mode must work without reading credentials or constructing cloud SDKs.
export async function openWorkspaceRuntime({
  profile,
  mode,
  format,
  createLocal,
  createConnected,
  workspaceId,
  manifestHash,
  verifyMigration,
}) {
  if (!Object.hasOwn(profiles, profile)) throw Error("EXPLICIT_PROFILE_REQUIRED");
  if (mode === "local") {
    if (format !== "legacy-db18" || typeof createLocal !== "function") throw Error("LOCAL_FORMAT_REQUIRED");
    return createLocal();
  }
  if (mode !== "connected" || profile !== "connected-preview") throw Error("CONNECTED_PROFILE_REQUIRED");
  if (format !== "connected-metadata" || typeof createConnected !== "function")
    throw Error("CONNECTED_FORMAT_REQUIRED");
  if (typeof verifyMigration !== "function") throw Error("MIGRATION_RECEIPT_REQUIRED");
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(workspaceId ?? "") ||
    !/^[0-9a-f]{64}$/.test(manifestHash ?? "")
  )
    throw Error("MIGRATION_SCOPE_REQUIRED");
  // Trusted server adapter must fetch this receipt from the registered backend.
  // No UI boolean or local extraction READY file proves cloud activation.
  const receipt = await verifyMigration({ workspaceId, manifestHash });
  if (
    receipt?.status !== "verified" ||
    receipt.workspaceId !== workspaceId ||
    receipt.manifestHash !== manifestHash ||
    typeof receipt.generation !== "string" ||
    !/^[1-9][0-9]*$/.test(receipt.generation)
  )
    throw Error("MIGRATION_NOT_VERIFIED");
  return createConnected({ receipt });
}
