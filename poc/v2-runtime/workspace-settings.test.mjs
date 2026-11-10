import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fixture18 } from "../v2-sync/fixture18.mjs";
import { openWorkspaceRegistry } from "./workspace-registry.mjs";
import { createWorkspaceSettingsBridge } from "./workspace-settings-bridge.mjs";
import { createWorkspaceSettingsController } from "./workspace-settings-controller.mjs";
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "wjb-settings-"));
  const local = join(root, "legacy"),
    state = join(root, "v2");
  for (const d of [local, state]) {
    mkdirSync(d);
    writeFileSync(join(d, ".v2-poc-only"), "synthetic");
  }
  const file = join(local, "source.db");
  fixture18(file);
  const db = new DatabaseSync(file);
  db.exec(
    readFileSync(new URL("../../src/data/migrations/0019_note_delete_lock.sql", import.meta.url), "utf8"),
  );
  db.exec("UPDATE app_meta SET value='19' WHERE key='schema_version'");
  db.close();
  const hash = () => createHash("sha256").update(readFileSync(file)).digest("hex"),
    before = hash();
  const registry = openWorkspaceRegistry(join(state, "registry.db"), { protectedLocalRoots: [local] });
  const a = registry.importOffline([
    { dir: local, name: "회사 <가상>", color: "c1", icon: "briefcase", updatedAt: 1 },
  ])[0];
  const account = { ownerId: randomUUID(), revision: 1 };
  const b = registry.createOnlineFromOffline({
    sourceEntryId: a.entry_id,
    name: "회사 · 온라인",
    ownerId: account.ownerId,
    cloudWorkspaceId: randomUUID(),
  });
  const events = [],
    faults = {},
    handles = [];
  const handle = (id) => {
    const h = {
      id,
      closed: false,
      close: async () => {
        events.push("close:" + id);
        if (faults.close) throw Error("disk /secret");
        h.closed = true;
      },
    };
    handles.push(h);
    return h;
  };
  const lifecycle = {
    flushPending: async (h) => {
      events.push("flush:" + h.id);
      if (faults.flush) throw Error("secret");
    },
    finishNote: async (h) => events.push("finish:" + h.id),
    backupBeforeClose: async (h) => events.push("backup:" + h.id),
    detachAll: async (h) => {
      events.push("detach:" + h.id);
      if (faults.detach) throw Error("secret");
    },
    attach: (h) => {
      events.push("attach:" + h.id);
      if (faults.attach) throw Error("secret");
    },
  };
  const adapters = {
    openOffline: async () => handle("offline"),
    verifyActivation: async () => {
      events.push("verify");
      if (faults.verify) return faults.verify();
      return { status: "poc-verified" };
    },
    openOnline: async () => {
      events.push("open-online");
      return handle("online");
    },
  };
  let reads = 0;
  const bridge = createWorkspaceSettingsBridge({
    registry,
    adapters,
    lifecycle,
    getAccountContext: () => {
      reads++;
      return { ...account };
    },
  });
  const valid = () => ({
    status: "verified",
    ownerId: account.ownerId,
    workspaceId: b.cloud_workspace_id,
    schemaFamily: "connected-product-v1",
    capability: "workspace-runtime",
    generation: "1",
  });
  t.after(async () => {
    faults.close = false;
    for (const h of handles) if (!h.closed) await h.close();
    registry.close();
    assert.equal(hash(), before);
    rmSync(root, { recursive: true, force: true });
  });
  return {
    registry,
    a,
    b,
    account,
    events,
    faults,
    handles,
    adapters,
    lifecycle,
    bridge,
    valid,
    reads: () => reads,
  };
}
test("public list exposes only reference id/name/kind, never source/cache/owner/metadata", async (t) => {
  const f = fixture(t),
    r = await f.bridge.request("list");
  assert.equal(r.ok, true);
  assert.equal(r.state.entries.length, 2);
  for (const row of r.state.entries) assert.deepEqual(Object.keys(row).sort(), ["entryId", "kind", "name"]);
  assert.equal(f.reads(), 0);
});
test("offline open initializes no account/cloud services", async (t) => {
  const f = fixture(t);
  Object.defineProperty(f.adapters, "verifyActivation", {
    get() {
      throw Error("cloud accessed");
    },
  });
  assert.equal((await f.bridge.request("select", { entryId: f.a.entry_id })).ok, true);
  assert.equal(f.reads(), 0);
  assert.deepEqual(f.events, ["attach:offline"]);
});
test("switch follows flush/finish/backup/detach/close before verify and attach", async (t) => {
  const f = fixture(t);
  f.faults.verify = f.valid;
  await f.bridge.request("select", { entryId: f.a.entry_id });
  assert.equal((await f.bridge.request("select", { entryId: f.b.entry_id })).ok, true);
  assert.deepEqual(f.events, [
    "attach:offline",
    "flush:offline",
    "finish:offline",
    "backup:offline",
    "detach:offline",
    "close:offline",
    "verify",
    "open-online",
    "attach:online",
  ]);
});
test("save failure retains old active workspace and never opens requested one", async (t) => {
  const f = fixture(t);
  await f.bridge.request("select", { entryId: f.a.entry_id });
  f.faults.flush = true;
  const r = await f.bridge.request("select", { entryId: f.b.entry_id });
  assert.equal(r.code, "WORKSPACE_SAVE_FAILED");
  assert.equal(r.state.activeId, f.a.entry_id);
  assert.deepEqual(f.events, ["attach:offline", "flush:offline"]);
});
for (const fault of ["close", "detach"])
  test(`${fault} failure blocks subsequent opens and exposes no active content`, async (t) => {
    const f = fixture(t);
    await f.bridge.request("select", { entryId: f.a.entry_id });
    f.faults[fault] = true;
    const r = await f.bridge.request("select", { entryId: f.b.entry_id });
    assert.equal(r.code, "WORKSPACE_CLOSE_FAILED");
    assert.equal(r.state.activeId, null);
    assert.equal(
      (await f.bridge.request("select", { entryId: f.a.entry_id })).code,
      "WORKSPACE_BRIDGE_BLOCKED",
    );
    assert(!f.events.includes("verify"));
  });
test("PoC completion cannot activate online and never falls back offline", async (t) => {
  const f = fixture(t);
  const r = await f.bridge.request("select", { entryId: f.b.entry_id });
  assert.equal(r.code, "PRODUCT_ACTIVATION_REQUIRED");
  assert.equal(r.state.activeId, null);
  assert(!f.events.some((x) => x.startsWith("attach")));
  assert.equal(r.state.entries[1].kind, "online");
});
test("wrong owner is rejected before closing current offline workspace", async (t) => {
  const f = fixture(t);
  await f.bridge.request("select", { entryId: f.a.entry_id });
  f.account.ownerId = randomUUID();
  const r = await f.bridge.request("select", { entryId: f.b.entry_id });
  assert.equal(r.code, "WORKSPACE_OWNER_MISMATCH");
  assert.equal(r.state.activeId, f.a.entry_id);
  assert.deepEqual(f.events, ["attach:offline"]);
});
test("rapid selection discards delayed activation; latest offline request wins", async (t) => {
  const f = fixture(t),
    started = deferred(),
    wait = deferred();
  f.faults.verify = async () => {
    started.resolve();
    await wait.promise;
    return f.valid();
  };
  const online = f.bridge.request("select", { entryId: f.b.entry_id });
  await started.promise;
  const offline = f.bridge.request("select", { entryId: f.a.entry_id });
  wait.resolve();
  assert.equal((await online).code, "WORKSPACE_REQUEST_STALE");
  assert.equal((await offline).state.activeId, f.a.entry_id);
  assert(!f.events.includes("open-online"));
});
test("native account revision change invalidates outstanding server response", async (t) => {
  const f = fixture(t),
    started = deferred(),
    wait = deferred();
  f.faults.verify = async () => {
    started.resolve();
    await wait.promise;
    return f.valid();
  };
  const pending = f.bridge.request("select", { entryId: f.b.entry_id });
  await started.promise;
  f.account.revision++;
  wait.resolve();
  assert.equal((await pending).code, "WORKSPACE_REQUEST_STALE");
  assert(!f.events.includes("open-online"));
});
test("late driver handle is closed rather than attached", async (t) => {
  const f = fixture(t),
    started = deferred(),
    wait = deferred();
  f.faults.verify = f.valid;
  const open = f.adapters.openOnline;
  f.adapters.openOnline = async () => {
    started.resolve();
    await wait.promise;
    return open();
  };
  const pending = f.bridge.request("select", { entryId: f.b.entry_id });
  await started.promise;
  const offline = f.bridge.request("select", { entryId: f.a.entry_id });
  wait.resolve();
  assert.equal((await pending).code, "WORKSPACE_REQUEST_STALE");
  await offline;
  assert(f.handles.find((h) => h.id === "online").closed);
  assert(!f.events.includes("attach:online"));
});
test("accountChanged preserves offline session without initializing auth", async (t) => {
  const f = fixture(t);
  await f.bridge.request("select", { entryId: f.a.entry_id });
  const r = await f.bridge.request("accountChanged");
  assert.equal(r.state.activeId, f.a.entry_id);
  assert.equal(f.reads(), 0);
  assert.deepEqual(f.events, ["attach:offline"]);
});
test("logout/accountChanged flushes and detaches active online session", async (t) => {
  const f = fixture(t);
  f.faults.verify = f.valid;
  await f.bridge.request("select", { entryId: f.b.entry_id });
  f.account.ownerId = null;
  const r = await f.bridge.request("accountChanged");
  assert.equal(r.state.activeId, null);
  assert.equal(r.state.phase, "idle");
  assert(f.handles[0].closed);
});
test("attach failure disposes handle and blocks further selection", async (t) => {
  const f = fixture(t);
  f.faults.attach = true;
  const r = await f.bridge.request("select", { entryId: f.a.entry_id });
  assert.equal(r.code, "WORKSPACE_ACTIVATION_FAILED");
  assert.equal(r.state.activeId, null);
  assert(f.handles[0].closed);
  assert.equal(
    (await f.bridge.request("select", { entryId: f.a.entry_id })).code,
    "WORKSPACE_BRIDGE_BLOCKED",
  );
});
test("UI cannot supply credentials, cache path, owner, receipt or arbitrary command", async (t) => {
  const f = fixture(t);
  for (const key of ["path", "ownerId", "token", "receipt"])
    assert.equal(
      (await f.bridge.request("select", { entryId: f.a.entry_id, [key]: "secret" })).code,
      "WORKSPACE_COMMAND_INVALID",
    );
  assert.equal((await f.bridge.request("createOnline", {})).code, "WORKSPACE_COMMAND_INVALID");
  assert.equal((await f.bridge.request("select", { entryId: randomUUID() })).code, "WORKSPACE_NOT_FOUND");
  assert.equal(f.reads(), 0);
});
test("unexpected native errors are converted to safe code without raw path/token", async (t) => {
  const f = fixture(t);
  f.adapters.openOffline = async () => {
    throw Error("token=secret /Users/private");
  };
  const r = await f.bridge.request("select", { entryId: f.a.entry_id });
  assert.equal(r.code, "WORKSPACE_NOT_OPENABLE");
  assert(!JSON.stringify(r).includes("secret"));
});
test("controller ignores late list response and retains latest selection", async () => {
  const pending = deferred(),
    states = [];
  const a = { entryId: "a", name: "기존", kind: "offline_only" },
    snapshot = { entries: [a], activeId: "a", phase: "active" };
  const ui = createWorkspaceSettingsController(
    { request: async (cmd) => (cmd === "list" ? pending.promise : { ok: true, state: snapshot }) },
    (s) => states.push(s),
  );
  const load = ui.load();
  await ui.select("a");
  pending.resolve({ ok: true, state: { ...snapshot, activeId: null } });
  await load;
  assert.equal(ui.getState().activeId, "a");
  assert.equal(ui.getState().busy, false);
});
test("controller maps errors to guidance and strips hidden response fields", async () => {
  const ui = createWorkspaceSettingsController(
    {
      request: async () => ({
        ok: false,
        code: "PRODUCT_ACTIVATION_REQUIRED",
        state: {
          entries: [{ entryId: "b", name: "온라인", kind: "online", token: "secret" }],
          activeId: null,
          phase: "idle",
          path: "private",
        },
      }),
    },
    () => {},
  );
  await ui.load();
  assert(ui.getState().error.includes("검증"));
  assert(!JSON.stringify(ui.getState()).includes("secret"));
  assert(!JSON.stringify(ui.getState()).includes("private"));
});
test("controller dispose prevents delayed UI writes", async () => {
  const pending = deferred();
  let calls = 0;
  const ui = createWorkspaceSettingsController({ request: () => pending.promise }, () => calls++);
  const p = ui.load();
  ui.dispose();
  pending.resolve({ ok: true, state: { entries: [], activeId: null, phase: "idle" } });
  await p;
  assert.equal(calls, 1);
});
test("controller transport failure clears uncertain active identity until authoritative reload", async () => {
  let fail = false;
  const ui = createWorkspaceSettingsController(
    {
      request: async () => {
        if (fail) throw Error("secret");
        return {
          ok: true,
          state: {
            entries: [{ entryId: "a", kind: "offline_only", name: "기존" }],
            activeId: "a",
            phase: "active",
          },
        };
      },
    },
    () => {},
  );
  await ui.load();
  fail = true;
  await ui.select("b");
  assert.equal(ui.getState().activeId, null);
  assert.equal(ui.getState().phase, "unknown");
  assert(!ui.getState().error.includes("secret"));
  fail = false;
  await ui.load();
  assert.equal(ui.getState().activeId, "a");
});
test("failure to close late handle blocks any subsequent open", async (t) => {
  const f = fixture(t),
    started = deferred(),
    wait = deferred();
  f.faults.verify = f.valid;
  const open = f.adapters.openOnline;
  f.adapters.openOnline = async () => {
    started.resolve();
    await wait.promise;
    return open();
  };
  const pending = f.bridge.request("select", { entryId: f.b.entry_id });
  await started.promise;
  const offline = f.bridge.request("select", { entryId: f.a.entry_id });
  f.faults.close = true;
  wait.resolve();
  assert.equal((await pending).code, "WORKSPACE_CLOSE_FAILED");
  assert.equal((await offline).code, "WORKSPACE_BRIDGE_BLOCKED");
  assert(!f.events.includes("attach:offline"));
});
test("account change with unsaved online data locks view rather than retaining visible content", async (t) => {
  const f = fixture(t);
  f.faults.verify = f.valid;
  await f.bridge.request("select", { entryId: f.b.entry_id });
  f.faults.flush = true;
  f.account.ownerId = null;
  const r = await f.bridge.request("accountChanged");
  assert.equal(r.code, "WORKSPACE_SAVE_FAILED");
  assert.equal(r.state.phase, "blocked");
  assert.equal(r.state.activeId, null);
  assert.equal(
    (await f.bridge.request("select", { entryId: f.a.entry_id })).code,
    "WORKSPACE_BRIDGE_BLOCKED",
  );
});
for (const hook of ["finishNote", "backupBeforeClose"])
  test(`${hook} failure prevents detach and retains old workspace`, async (t) => {
    const f = fixture(t);
    await f.bridge.request("select", { entryId: f.a.entry_id });
    f.lifecycle[hook] = async () => {
      throw Error("secret");
    };
    const r = await f.bridge.request("select", { entryId: f.b.entry_id });
    assert.equal(r.code, "WORKSPACE_SAVE_FAILED");
    assert.equal(r.state.activeId, f.a.entry_id);
    assert(!f.events.includes("detach:offline"));
    assert(!f.events.includes("verify"));
  });
test("same selection does not reopen or flush active storage", async (t) => {
  const f = fixture(t);
  await f.bridge.request("select", { entryId: f.a.entry_id });
  await f.bridge.request("select", { entryId: f.a.entry_id });
  assert.deepEqual(f.events, ["attach:offline"]);
});
test("mutable native account context is snapshotted before awaiting verification", async (t) => {
  const f = fixture(t),
    started = deferred(),
    wait = deferred();
  const bridge = createWorkspaceSettingsBridge({
    registry: f.registry,
    adapters: f.adapters,
    lifecycle: f.lifecycle,
    getAccountContext: () => f.account,
  });
  f.faults.verify = async () => {
    started.resolve();
    await wait.promise;
    return f.valid();
  };
  const pending = bridge.request("select", { entryId: f.b.entry_id });
  await started.promise;
  f.account.revision++;
  wait.resolve();
  assert.equal((await pending).code, "WORKSPACE_REQUEST_STALE");
  assert(!f.events.includes("open-online"));
});
test("native account provider failure does not leak details or close old offline space", async (t) => {
  const f = fixture(t);
  const bridge = createWorkspaceSettingsBridge({
    registry: f.registry,
    adapters: f.adapters,
    lifecycle: f.lifecycle,
    getAccountContext: () => {
      throw Error("vault token secret");
    },
  });
  await bridge.request("select", { entryId: f.a.entry_id });
  const r = await bridge.request("select", { entryId: f.b.entry_id });
  assert.equal(r.code, "WORKSPACE_NOT_OPENABLE");
  assert.equal(r.state.activeId, f.a.entry_id);
  assert(!JSON.stringify(r).includes("secret"));
});
test("disposed settings view cannot issue another native command", async () => {
  let calls = 0;
  const ui = createWorkspaceSettingsController(
    {
      request: async () => {
        calls++;
        throw Error("unexpected");
      },
    },
    () => {},
  );
  ui.dispose();
  await ui.select("old-click");
  await ui.load();
  assert.equal(calls, 0);
});
test("account context failure after opening handle still disposes it before returning", async (t) => {
  const f = fixture(t);
  let unavailable = false;
  const open = f.adapters.openOnline;
  f.faults.verify = f.valid;
  f.adapters.openOnline = async () => {
    const h = await open();
    unavailable = true;
    return h;
  };
  const bridge = createWorkspaceSettingsBridge({
    registry: f.registry,
    adapters: f.adapters,
    lifecycle: f.lifecycle,
    getAccountContext: () => {
      if (unavailable) throw Error("vault unavailable");
      return { ...f.account };
    },
  });
  const r = await bridge.request("select", { entryId: f.b.entry_id });
  assert.equal(r.code, "WORKSPACE_REQUEST_STALE");
  assert(f.handles[0].closed);
  assert(!f.events.includes("attach:online"));
});
