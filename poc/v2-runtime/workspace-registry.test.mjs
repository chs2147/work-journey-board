import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  renameSync,
  readdirSync,
  symlinkSync,
  linkSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fixture18 } from "../v2-sync/fixture18.mjs";
import { sourceHash } from "../v2-sync/model.mjs";
import {
  openWorkspaceRegistry,
  workspacePresentation,
  openRegisteredWorkspace as routeRegisteredWorkspace,
} from "./workspace-registry.mjs";
const openRegisteredWorkspace = (args) => routeRegisteredWorkspace({ isCurrent: () => true, ...args });
function setup(t, version = 19) {
  const root = mkdtempSync(join(tmpdir(), "wjb-kind-registry-")),
    local = join(root, "legacy"),
    state = join(root, "new-registry"),
    config = join(root, "classic-settings");
  for (const p of [local, state, config]) {
    mkdirSync(p);
    writeFileSync(join(p, ".v2-poc-only"), "synthetic");
  }
  const source = join(local, "source.db");
  fixture18(source);
  if (version === 19) {
    const db = new DatabaseSync(source);
    db.exec(
      readFileSync(new URL("../../src/data/migrations/0019_note_delete_lock.sql", import.meta.url), "utf8"),
    );
    db.exec("UPDATE app_meta SET value='19' WHERE key='schema_version'");
    db.close();
  }
  const entry = {
    dir: local,
    name: "기존 회사일지",
    color: "c1",
    icon: "briefcase",
    updatedAt: 1,
    lastOpened: "2026-11-10",
  };
  const configPath = join(config, "config.json");
  writeFileSync(configPath, JSON.stringify({ workspaces: [entry] }));
  const path = join(state, "registry.db"),
    options = { protectedLocalRoots: [local, config] };
  const r = openWorkspaceRegistry(path, options);
  const e = {
    root,
    local,
    state,
    config,
    source,
    entry,
    configPath,
    path,
    options,
    r,
    before: sourceHash(source),
    configBefore: readFileSync(configPath),
    files: readdirSync(local),
  };
  t.after(() => {
    e.r.close();
    rmSync(root, { recursive: true, force: true });
  });
  return e;
}
const owner = randomUUID();
const from = (e, source) =>
  e.r.createOnlineFromOffline({
    ownerId: owner,
    cloudWorkspaceId: randomUUID(),
    name: "회사일지 · 온라인",
    sourceEntryId: source.entry_id,
  });
test("legacy entries without kind remain offline-only and all original fields/files/config survive", (t) => {
  const e = setup(t),
    original = structuredClone(e.entry),
    [offline] = e.r.importOffline([e.entry]);
  assert.equal(offline.kind, "offline_only");
  assert.deepEqual(JSON.parse(offline.legacy_meta), original);
  assert.deepEqual(e.entry, original);
  const online = from(e, offline);
  assert.equal(online.kind, "online");
  assert.equal(online.source_entry_id, offline.entry_id);
  assert.notEqual(online.entry_id, offline.entry_id);
  assert.notEqual(online.cloud_workspace_id, offline.entry_id);
  assert.equal(e.r.get(offline.entry_id).original_dir, e.local);
  assert.equal(sourceHash(e.source), e.before);
  assert.deepEqual(readFileSync(e.configPath), e.configBefore);
  assert.deepEqual(readdirSync(e.local), e.files);
});
test("registry reopen preserves both workspaces and stable IDs", (t) => {
  const e = setup(t),
    [offline] = e.r.importOffline([e.entry]),
    online = from(e, offline);
  e.r.close();
  e.r = openWorkspaceRegistry(e.path, e.options);
  assert.equal(e.r.get(offline.entry_id).kind, "offline_only");
  assert.equal(e.r.get(online.entry_id).kind, "online");
  assert.equal(e.r.importOffline([e.entry])[0].entry_id, offline.entry_id);
});
test("creating empty online and connecting existing cloud space are distinct; receiving reuses cloud identity", (t) => {
  const e = setup(t),
    cloud = randomUUID(),
    blank = e.r.createEmptyOnline({ ownerId: owner, cloudWorkspaceId: cloud, name: "새 온라인" });
  assert.equal(blank.source_entry_id, null);
  const connected = e.r.connectExistingOnline({
    ownerId: owner,
    cloudWorkspaceId: cloud,
    name: "다른 표시명",
  });
  assert.equal(connected.entry_id, blank.entry_id);
  assert.equal(e.r.list().length, 1);
  assert.throws(
    () => e.r.connectExistingOnline({ ownerId: randomUUID(), cloudWorkspaceId: cloud, name: "다른 계정" }),
    /IDENTITY_CONFLICT/,
  );
});
test("source required for importing; empty/existing cannot pretend to import offline source", (t) => {
  const e = setup(t),
    spec = { ownerId: owner, cloudWorkspaceId: randomUUID(), name: "새 온라인" };
  assert.throws(() => e.r.createOnlineFromOffline(spec), /OFFLINE_SOURCE_REQUIRED/);
  const [source] = e.r.importOffline([e.entry]);
  assert.throws(() => e.r.createEmptyOnline({ ...spec, sourceEntryId: source.entry_id }), /SOURCE_FORBIDDEN/);
  assert.throws(
    () => e.r.connectExistingOnline({ ...spec, sourceEntryId: source.entry_id }),
    /SOURCE_FORBIDDEN/,
  );
  assert.throws(
    () =>
      e.r.createOnlineFromOffline({
        ...spec,
        sourceEntryId: source.entry_id,
        cloudWorkspaceId: source.entry_id,
      }),
    /NEW_ONLINE_WORKSPACE_REQUIRED/,
  );
});
test("same display name never links or merges identities", (t) => {
  const e = setup(t);
  e.r.importOffline([e.entry]);
  const a = e.r.createEmptyOnline({ ownerId: owner, cloudWorkspaceId: randomUUID(), name: e.entry.name }),
    b = e.r.createEmptyOnline({ ownerId: owner, cloudWorkspaceId: randomUUID(), name: e.entry.name });
  assert.notEqual(a.cloud_workspace_id, b.cloud_workspace_id);
  assert.equal(e.r.list().length, 3);
});
test("legacy import is atomic and cannot turn a prior workspace online", (t) => {
  const e = setup(t);
  assert.throws(
    () => e.r.importOffline([e.entry, { ...e.entry, kind: "online" }]),
    /LEGACY_CANNOT_BE_ONLINE/,
  );
  assert.equal(e.r.list().length, 0);
});
test("kind and identity are immutable even through a direct registry UPDATE", (t) => {
  const e = setup(t),
    [entry] = e.r.importOffline([e.entry]),
    db = new DatabaseSync(e.path);
  try {
    assert.throws(
      () => db.prepare("UPDATE workspace SET kind='online' WHERE entry_id=?").run(entry.entry_id),
      /WORKSPACE_IDENTITY_IMMUTABLE/,
    );
  } finally {
    db.close();
  }
});
test("registry cannot open original DB, config or journal as a writable registry", (t) => {
  const e = setup(t);
  assert.throws(() => openWorkspaceRegistry(e.source, e.options), /PATH_OVERLAP/);
  const foreign = join(e.state, "foreign.db");
  fixture18(foreign);
  const before = sourceHash(foreign);
  assert.throws(() => openWorkspaceRegistry(foreign, e.options), /NOT_WORKSPACE_REGISTRY/);
  assert.equal(sourceHash(foreign), before);
});
test("registry symlink and hardlink aliases rejected before writable open", (t) => {
  const e = setup(t);
  for (const [name, fn] of [
    ["sym", symlinkSync],
    ["hard", linkSync],
  ]) {
    const alias = join(e.state, name + ".db");
    fn(e.path, alias);
    assert.throws(() => openWorkspaceRegistry(alias, e.options), /REGISTRY_ALIAS_DENIED/);
    rmSync(alias);
  }
});
test("import only permits explicit protected workspace directories", (t) => {
  const e = setup(t),
    other = join(e.root, "unregistered");
  mkdirSync(other);
  assert.throws(() => e.r.importOffline([{ ...e.entry, dir: other }]), /ROOT_NOT_REGISTERED/);
  assert.equal(e.r.list().length, 0);
});
for (const network of ["connected", "disconnected"])
  test(`offline type ignores ${network}, auth and queue dependencies`, () => {
    const state = {
      localSave: "saved",
      get network() {
        throw Error("must not read");
      },
      get auth() {
        throw Error("must not read");
      },
      get pending() {
        throw Error("must not read");
      },
    };
    const p = workspacePresentation({ kind: "offline_only" }, state);
    assert.equal(p.label, "오프라인 전용");
    assert.equal(p.remote, null);
  });
for (const [network, auth, pending] of [
  ["connected", "valid", 0],
  ["disconnected", "valid", 3],
  ["connected", "expired", 3],
])
  test(`online kind persists for ${network}/${auth}`, () => {
    const p = workspacePresentation(
      { kind: "online" },
      { localSave: "saved", network, auth, pending, serverAck: true },
    );
    assert.equal(p.kind, "online");
    assert.equal(p.label, "온라인");
    assert.ok(p.remote);
  });
test("online reflected requires current server ack and durable local save", () => {
  const entry = { kind: "online" },
    s = { localSave: "saved", network: "connected", auth: "valid", pending: 0 };
  assert.equal(workspacePresentation(entry, s).remote, "서버 확인 중");
  assert.equal(workspacePresentation(entry, { ...s, serverAck: true }).remote, "온라인 반영됨");
  assert.notEqual(
    workspacePresentation(entry, { ...s, localSave: "failed", serverAck: true }).remote,
    "온라인 반영됨",
  );
});
test("offline open accesses only the offline adapter; cloud getters never evaluated", async (t) => {
  const e = setup(t),
    [offline] = e.r.importOffline([e.entry]);
  let calls = 0;
  const result = await openRegisteredWorkspace({
    registry: e.r,
    entryId: offline.entry_id,
    adapters: {
      openOffline: (ctx) => {
        calls++;
        assert.equal(ctx.originalDirectory, e.local);
        return "local";
      },
      get verifyActivation() {
        throw Error("cloud initialized");
      },
      get openOnline() {
        throw Error("cloud initialized");
      },
    },
  });
  assert.equal(result, "local");
  assert.equal(calls, 1);
});
test("wrong online owner rejected before activation/network or cache open", async (t) => {
  const e = setup(t),
    entry = e.r.createEmptyOnline({ ownerId: owner, cloudWorkspaceId: randomUUID(), name: "온라인" });
  await assert.rejects(
    () =>
      openRegisteredWorkspace({
        registry: e.r,
        entryId: entry.entry_id,
        actor: { ownerId: randomUUID() },
        adapters: {
          get verifyActivation() {
            throw Error("must not initialize");
          },
        },
      }),
    /WORKSPACE_OWNER_MISMATCH/,
  );
});
test("actual PoC receipt shape cannot activate product or fallback to original", async (t) => {
  const e = setup(t),
    [source] = e.r.importOffline([e.entry]),
    entry = from(e, source);
  let opened = 0;
  await assert.rejects(
    () =>
      openRegisteredWorkspace({
        registry: e.r,
        entryId: entry.entry_id,
        actor: { ownerId: owner },
        adapters: {
          verifyActivation: async () => ({ status: "poc-verified", workspaceId: entry.cloud_workspace_id }),
          openOffline: () => opened++,
          openOnline: () => opened++,
        },
      }),
    /PRODUCT_ACTIVATION_REQUIRED/,
  );
  assert.equal(opened, 0);
});
test("online failure preserves type and never calls offline adapter", async (t) => {
  const e = setup(t),
    entry = e.r.createEmptyOnline({ ownerId: owner, cloudWorkspaceId: randomUUID(), name: "온라인" });
  let local = 0;
  await assert.rejects(
    () =>
      openRegisteredWorkspace({
        registry: e.r,
        entryId: entry.entry_id,
        actor: { ownerId: owner },
        adapters: {
          verifyActivation: async () => {
            throw Error("network unavailable");
          },
          openOffline: () => local++,
        },
      }),
    /network unavailable/,
  );
  assert.equal(local, 0);
  assert.equal(e.r.get(entry.entry_id).kind, "online");
});
test("late symlink redirect into legacy roots blocks even a trusted synthetic activation", async (t) => {
  const e = setup(t),
    entry = e.r.createEmptyOnline({ ownerId: owner, cloudWorkspaceId: randomUUID(), name: "온라인" });
  symlinkSync(e.config, join(e.state, "online-cache"));
  let opened = 0;
  await assert.rejects(
    () =>
      openRegisteredWorkspace({
        registry: e.r,
        entryId: entry.entry_id,
        actor: { ownerId: owner },
        adapters: {
          verifyActivation: async () => ({
            status: "verified",
            ownerId: owner,
            workspaceId: entry.cloud_workspace_id,
            schemaFamily: "connected-product-v1",
            capability: "workspace-runtime",
            generation: "1",
          }),
          openOnline: () => opened++,
        },
      }),
    /PATH_OVERLAP/,
  );
  assert.equal(opened, 0);
});

for (const version of [18, 19])
  test(`DB${version} original stays untouched when only catalog is modified`, (t) => {
    const e = setup(t, version),
      [source] = e.r.importOffline([e.entry]);
    from(e, source);
    assert.equal(sourceHash(e.source), e.before);
    assert.deepEqual(readFileSync(e.configPath), e.configBefore);
    assert.deepEqual(readdirSync(e.local), e.files);
  });
test("unknown kind and malformed online status fail closed without local reinterpretation", () => {
  assert.throws(
    () => workspacePresentation({ kind: "future" }, { localSave: "saved" }),
    /WORKSPACE_KIND_REQUIRED/,
  );
  assert.throws(
    () =>
      workspacePresentation(
        { kind: "online" },
        { localSave: "saved", network: "connected", auth: "valid", pending: -1 },
      ),
    /ONLINE_STATE_REQUIRED/,
  );
});

test("missing native request guard is rejected before factories", async (t) => {
  const e = setup(t),
    [entry] = e.r.importOffline([e.entry]);
  await assert.rejects(
    () => routeRegisteredWorkspace({ registry: e.r, entryId: entry.entry_id, adapters: {} }),
    /WORKSPACE_REQUEST_GUARD_REQUIRED/,
  );
});
test("a superseded online activation cannot open a driver", async (t) => {
  const e = setup(t),
    entry = e.r.createEmptyOnline({ ownerId: owner, cloudWorkspaceId: randomUUID(), name: "온라인" });
  let current = true,
    opened = 0;
  await assert.rejects(
    () =>
      openRegisteredWorkspace({
        registry: e.r,
        entryId: entry.entry_id,
        actor: { ownerId: owner },
        isCurrent: () => current,
        adapters: {
          verifyActivation: async () => {
            current = false;
            return {
              status: "verified",
              ownerId: owner,
              workspaceId: entry.cloud_workspace_id,
              schemaFamily: "connected-product-v1",
              capability: "workspace-runtime",
              generation: "1",
            };
          },
          openOnline: () => opened++,
        },
      }),
    /WORKSPACE_REQUEST_STALE/,
  );
  assert.equal(opened, 0);
});
test("a superseded offline open closes the unactivated handle", async (t) => {
  const e = setup(t),
    [entry] = e.r.importOffline([e.entry]);
  let current = true,
    closed = 0;
  await assert.rejects(
    () =>
      openRegisteredWorkspace({
        registry: e.r,
        entryId: entry.entry_id,
        isCurrent: () => current,
        adapters: {
          openOffline: async () => {
            current = false;
            return { close: async () => closed++ };
          },
        },
      }),
    /WORKSPACE_REQUEST_STALE/,
  );
  assert.equal(closed, 1);
});

test("unknown legacy fields including credentials cannot enter registry metadata", (t) => {
  const e = setup(t);
  assert.throws(
    () => e.r.importOffline([{ ...e.entry, accessToken: "fictional-private-token" }]),
    /LEGACY_ENTRY_UNSUPPORTED/,
  );
  assert.equal(e.r.list().length, 0);
  assert.equal(readFileSync(e.path).includes(Buffer.from("fictional-private-token")), false);
});

test("a changed offline directory alias is rejected before opening the wrong store", async (t) => {
  const e = setup(t),
    [entry] = e.r.importOffline([e.entry]),
    saved = join(e.root, "original-saved");
  renameSync(e.local, saved);
  symlinkSync(e.state, e.local);
  let opened = 0;
  await assert.rejects(
    () =>
      openRegisteredWorkspace({
        registry: e.r,
        entryId: entry.entry_id,
        adapters: { openOffline: () => opened++ },
      }),
    /OFFLINE_REFERENCE_CHANGED/,
  );
  assert.equal(opened, 0);
  assert.equal(sourceHash(join(saved, "source.db")), e.before);
});
