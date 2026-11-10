// Independent synthetic registry foundation. No automatic config reads or network.
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, realpathSync, openSync, closeSync } from "node:fs";
import { dirname, join, relative, isAbsolute, sep } from "node:path";
import { guard } from "../v2-sync/db18.mjs";
import { assertSeparateWorkspacePaths } from "./isolation.mjs";
const appId = 1464487220;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function title(v) {
  if (typeof v !== "string" || !v.trim() || Buffer.byteLength(v) > 4096)
    throw Error("WORKSPACE_NAME_REQUIRED");
  return v;
}
function ids(...values) {
  if (!values.every((v) => typeof v === "string" && uuid.test(v))) throw Error("WORKSPACE_ID_REQUIRED");
}
function inside(parent, path) {
  const r = relative(parent, path);
  return r === "" || (r !== ".." && !r.startsWith(".." + sep) && !isAbsolute(r));
}
export function openWorkspaceRegistry(path, { protectedLocalRoots } = {}) {
  guard(path);
  if (!Array.isArray(protectedLocalRoots) || !protectedLocalRoots.length)
    throw Error("PROTECTED_LOCAL_ROOTS_REQUIRED");
  const roots = protectedLocalRoots.map((p) => realpathSync(p)),
    base = realpathSync(dirname(path));
  for (const root of roots) assertSeparateWorkspacePaths(process.platform, root, base);
  if (existsSync(path)) {
    const s = lstatSync(path);
    if (s.isSymbolicLink() || s.nlink !== 1) throw Error("REGISTRY_ALIAS_DENIED");
    const check = new DatabaseSync(path, { readOnly: true });
    try {
      if (
        check.prepare("PRAGMA application_id").get().application_id !== appId ||
        check.prepare("PRAGMA user_version").get().user_version !== 1
      )
        throw Error("NOT_WORKSPACE_REGISTRY");
    } finally {
      check.close();
    }
  } else closeSync(openSync(path, "wx", 0o600));
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL");
    if (db.prepare("PRAGMA application_id").get().application_id !== appId) {
      db.exec(`BEGIN IMMEDIATE;PRAGMA application_id=${appId}; PRAGMA user_version=1;
    CREATE TABLE workspace(entry_id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('offline_only','online')),name TEXT NOT NULL,
     original_dir TEXT,canonical_dir TEXT UNIQUE,legacy_meta TEXT,
     owner_id TEXT,cloud_workspace_id TEXT UNIQUE,cache_root TEXT,source_entry_id TEXT REFERENCES workspace(entry_id),
     CHECK((kind='offline_only' AND original_dir IS NOT NULL AND canonical_dir IS NOT NULL AND legacy_meta IS NOT NULL AND owner_id IS NULL AND cloud_workspace_id IS NULL AND cache_root IS NULL AND source_entry_id IS NULL) OR
     (kind='online' AND original_dir IS NULL AND canonical_dir IS NULL AND legacy_meta IS NULL AND owner_id IS NOT NULL AND cloud_workspace_id IS NOT NULL AND cache_root IS NOT NULL)));
    CREATE TRIGGER immutable_workspace_identity BEFORE UPDATE OF entry_id,kind,original_dir,canonical_dir,owner_id,cloud_workspace_id,cache_root,source_entry_id ON workspace BEGIN SELECT RAISE(ABORT,'WORKSPACE_IDENTITY_IMMUTABLE');END;
    COMMIT;`);
    }
    if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
      throw Error("REGISTRY_INTEGRITY");
  } catch (e) {
    db.close();
    throw e;
  }
  const get = (id) => {
    const r = db.prepare("SELECT * FROM workspace WHERE entry_id=?").get(id);
    if (!r) throw Error("WORKSPACE_NOT_FOUND");
    return Object.freeze({ ...r });
  };
  function transaction(fn) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      db.exec("COMMIT");
      return r;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  function online({ ownerId, cloudWorkspaceId, name, sourceEntryId = null }, existing) {
    ids(ownerId, cloudWorkspaceId);
    title(name);
    return transaction(() => {
      if (sourceEntryId) {
        const source = get(sourceEntryId);
        if (source.kind !== "offline_only" || source.entry_id === cloudWorkspaceId)
          throw Error("NEW_ONLINE_WORKSPACE_REQUIRED");
      }
      const old = db.prepare("SELECT * FROM workspace WHERE cloud_workspace_id=?").get(cloudWorkspaceId);
      if (old) {
        if (!existing || old.owner_id !== ownerId) throw Error("ONLINE_IDENTITY_CONFLICT");
        return get(old.entry_id);
      }
      if (db.prepare("SELECT 1 FROM workspace WHERE entry_id=?").get(cloudWorkspaceId))
        throw Error("NEW_ONLINE_WORKSPACE_REQUIRED");
      const cache = join(base, "online-cache", ownerId, cloudWorkspaceId);
      for (const root of roots) assertSeparateWorkspacePaths(process.platform, root, cache);
      db.prepare(
        "INSERT INTO workspace(entry_id,kind,name,owner_id,cloud_workspace_id,cache_root,source_entry_id) VALUES(?,'online',?,?,?,?,?)",
      ).run(randomUUID(), name, ownerId, cloudWorkspaceId, cache, sourceEntryId);
      return get(
        db.prepare("SELECT entry_id FROM workspace WHERE cloud_workspace_id=?").get(cloudWorkspaceId)
          .entry_id,
      );
    });
  }
  return Object.freeze({
    close: () => db.close(),
    get,
    list: () =>
      db
        .prepare("SELECT * FROM workspace ORDER BY rowid")
        .all()
        .map((r) => Object.freeze({ ...r })),
    importOffline(entries) {
      if (!Array.isArray(entries) || entries.length > 1000) throw Error("EXPLICIT_OFFLINE_ENTRIES_REQUIRED");
      return transaction(() =>
        entries.map((entry) => {
          if (
            !entry ||
            typeof entry !== "object" ||
            (Object.hasOwn(entry, "kind") && entry.kind !== "offline_only")
          )
            throw Error("LEGACY_CANNOT_BE_ONLINE");
          if (
            Object.keys(entry).some(
              (k) =>
                !["dir", "name", "color", "icon", "updatedAt", "lastOpened", "mirrorSub", "kind"].includes(k),
            )
          )
            throw Error("LEGACY_ENTRY_UNSUPPORTED");
          title(entry.name);
          if (typeof entry.dir !== "string" || !lstatSync(entry.dir).isDirectory())
            throw Error("OFFLINE_DIRECTORY_REQUIRED");
          const canonical = realpathSync(entry.dir);
          if (!roots.some((r) => inside(r, canonical))) throw Error("OFFLINE_ROOT_NOT_REGISTERED");
          assertSeparateWorkspacePaths(process.platform, canonical, base);
          const old = db.prepare("SELECT entry_id FROM workspace WHERE canonical_dir=?").get(canonical);
          if (old) return get(old.entry_id);
          const id = randomUUID();
          // This is a registry reference ID, never written into the legacy workspace/config.
          db.prepare(
            "INSERT INTO workspace(entry_id,kind,name,original_dir,canonical_dir,legacy_meta) VALUES(?,'offline_only',?,?,?,?)",
          ).run(id, entry.name, entry.dir, canonical, JSON.stringify(entry));
          return get(id);
        }),
      );
    },
    resolveOfflineRoot(entryId) {
      const entry = get(entryId);
      if (entry.kind !== "offline_only") throw Error("OFFLINE_WORKSPACE_REQUIRED");
      const actual = realpathSync(entry.original_dir);
      if (actual !== entry.canonical_dir) throw Error("OFFLINE_REFERENCE_CHANGED");
      assertSeparateWorkspacePaths(process.platform, actual, base);
      return actual;
    },
    resolveOnlineCache(entryId) {
      const entry = get(entryId);
      if (entry.kind !== "online") throw Error("ONLINE_WORKSPACE_REQUIRED");
      let parent = entry.cache_root;
      const suffix = [];
      while (!existsSync(parent)) {
        suffix.unshift(parent.slice(dirname(parent).length + 1));
        parent = dirname(parent);
      }
      if (!lstatSync(realpathSync(parent)).isDirectory()) throw Error("CACHE_PARENT_NOT_DIRECTORY");
      const cache = join(realpathSync(parent), ...suffix);
      for (const root of roots) assertSeparateWorkspacePaths(process.platform, root, cache);
      for (const source of db.prepare("SELECT original_dir FROM workspace WHERE kind='offline_only'").all())
        assertSeparateWorkspacePaths(process.platform, realpathSync(source.original_dir), cache);
      return cache;
    },
    createOnlineFromOffline: (spec) => {
      if (!spec.sourceEntryId) throw Error("OFFLINE_SOURCE_REQUIRED");
      return online(spec, false);
    },
    createEmptyOnline: (spec) => {
      if (spec.sourceEntryId) throw Error("EMPTY_WORKSPACE_SOURCE_FORBIDDEN");
      return online(spec, false);
    },
    connectExistingOnline: (spec) => {
      if (spec.sourceEntryId) throw Error("EXISTING_WORKSPACE_SOURCE_FORBIDDEN");
      return online(spec, true);
    },
  });
}

export { workspacePresentation } from "./workspace-kind.mjs";

// Trusted native adapters, not UI-supplied booleans. No cloud dependency is accessed
// in the offline branch; product activation remains forbidden for current PoC receipts.
export async function openRegisteredWorkspace({ registry, entryId, actor, adapters, isCurrent }) {
  if (typeof isCurrent !== "function") throw Error("WORKSPACE_REQUEST_GUARD_REQUIRED");
  const ensure = () => {
    if (isCurrent() !== true) throw Error("WORKSPACE_REQUEST_STALE");
  };
  const finish = async (handle) => {
    if (isCurrent() !== true) {
      if (typeof handle?.close === "function") await handle.close();
      throw Error("WORKSPACE_REQUEST_STALE");
    }
    return handle;
  };
  ensure();
  const entry = registry.get(entryId);
  if (entry.kind === "offline_only")
    return finish(
      await adapters.openOffline({
        entryId: entry.entry_id,
        originalDirectory: registry.resolveOfflineRoot(entry.entry_id),
      }),
    );
  if (entry.kind !== "online" || actor?.ownerId !== entry.owner_id) throw Error("WORKSPACE_OWNER_MISMATCH");
  if (typeof adapters.verifyActivation !== "function") throw Error("PRODUCT_ACTIVATION_REQUIRED");
  const receipt = await adapters.verifyActivation({
    ownerId: entry.owner_id,
    workspaceId: entry.cloud_workspace_id,
    cacheRoot: entry.cache_root,
  });
  if (
    receipt?.status !== "verified" ||
    receipt.ownerId !== entry.owner_id ||
    receipt.workspaceId !== entry.cloud_workspace_id ||
    receipt.schemaFamily !== "connected-product-v1" ||
    receipt.capability !== "workspace-runtime" ||
    typeof receipt.generation !== "string" ||
    !/^[1-9][0-9]*$/.test(receipt.generation) ||
    BigInt(receipt.generation) > 9223372036854775807n
  )
    throw Error("PRODUCT_ACTIVATION_REQUIRED");
  ensure();
  const cache = registry.resolveOnlineCache(entry.entry_id);
  ensure();
  return finish(
    await adapters.openOnline({
      ownerId: entry.owner_id,
      workspaceId: entry.cloud_workspace_id,
      cacheRoot: cache,
      receipt,
    }),
  );
}
