import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  linkSync,
  symlinkSync,
  existsSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { workspaceSessionFixture } from "../v2-migration/workspace-session-fixture.mjs";
import { mapWorkspace } from "../v2-migration/workspace-map.mjs";
import { sourceHash, hash } from "../v2-sync/model.mjs";
import { createOnlineCache, openOnlineCache, appendCacheEnvelope, ONLINE_CACHE } from "./online-cache.mjs";
import { openVerifiedOnlineCache } from "./online-cache-activation.mjs";
import { openRegisteredWorkspace, openWorkspaceRegistry } from "./workspace-registry.mjs";
const wait = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
function fixture(t, version = 19) {
  const root = mkdtempSync(join(tmpdir(), "wjb-cache-")),
    e = workspaceSessionFixture(root, { version });
  const cacheRoot = join(e.stateRoot, "cache");
  mkdirSync(cacheRoot);
  writeFileSync(join(cacheRoot, ".v2-poc-only"), "synthetic");
  const identity = {
    ownerId: e.actor.ownerId,
    workspaceId: e.workspaceId,
    deviceId: e.actor.deviceId,
    generation: "1",
  };
  const mapped = mapWorkspace(e.directory, e.workspaceId),
    input = {
      assets: mapped.envelope.assets,
      records: mapped.envelope.records.map((r) => ({
        entityType: r.table,
        entityId: r.key,
        revision: "1",
        body: r.value,
      })),
    };
  const options = { identity, snapshot: input, protectedLocalRoots: [e.localRoot] },
    file = join(cacheRoot, ONLINE_CACHE.fileName),
    before = sourceHash(e.source),
    files = readdirSync(e.localRoot),
    handles = [];
  t.after(() => {
    for (const h of handles) h.close();
    assert.equal(sourceHash(e.source), before);
    assert.deepEqual(readdirSync(e.localRoot), files);
    rmSync(root, { recursive: true, force: true });
  });
  const create = () => createOnlineCache(cacheRoot, options),
    open = () => {
      const h = openOnlineCache(cacheRoot, options);
      handles.push(h);
      return h;
    };
  let now = 1800000000000;
  const remote = async (r) => ({
    status: "verified",
    contract: "wjb-online-activation-v1",
    assetsState: "verified",
    ...r,
    issuedAt: now,
    expiresAt: now + 120000,
  });
  const activation = {
    root: cacheRoot,
    ...options,
    verifyRemote: remote,
    isCurrent: () => true,
    clock: () => now,
  };
  const activate = async (extra = {}) => {
    const h = await openVerifiedOnlineCache({ ...activation, ...extra });
    handles.push(h);
    return h;
  };
  return {
    ...e,
    ownerId: e.actor.ownerId,
    deviceId: e.actor.deviceId,
    root,
    cacheRoot,
    identity,
    input,
    options,
    file,
    create,
    open,
    activate,
    activation,
    remote,
    handles,
    get now() {
      return now;
    },
    set now(v) {
      now = v;
    },
  };
}
for (const version of [18, 19])
  test(`DB${version} original is preserved; cache has different header, every mapped row, refs only`, (t) => {
    const e = fixture(t, version),
      manifest = e.create(),
      h = e.open();
    assert.equal(manifest.productActivationAllowed, false);
    assert.equal(h.readRecords().length, e.input.records.length);
    assert.equal(
      hash(h.readRecords()),
      hash(
        [...e.input.records].sort(
          (a, b) => a.entityType.localeCompare(b.entityType) || a.entityId.localeCompare(b.entityId),
        ),
      ),
    );
    if (version === 19)
      assert.equal(
        h.readRecords().find((r) => r.entityType === "cabi_note" && r.body.id === "n1").body.delete_locked,
        1,
      );
    assert(
      h
        .readAssets()
        .every((a) => a.storeId === "supabase-private" && a.objectKey === `${e.workspaceId}/${a.objectId}`),
    );
    h.close();
    const db = new DatabaseSync(e.file, { readOnly: true });
    try {
      assert.equal(db.prepare("PRAGMA application_id").get().application_id, ONLINE_CACHE.applicationId);
      assert.equal(db.prepare("PRAGMA user_version").get().user_version, 1);
      for (const table of ["cache_info", "records", "assets", "envelopes"])
        assert(
          !db
            .prepare(`PRAGMA table_info(${table})`)
            .all()
            .some((c) => c.type === "BLOB"),
        );
      assert.equal(db.prepare("SELECT count(*) AS n FROM envelopes").get().n, 0);
    } finally {
      db.close();
    }
    const raw = readFileSync(e.file);
    assert(!raw.includes(Buffer.from("iVBORw0KGgoAAAANSUhEUg")));
    assert(!raw.includes(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
    assert.deepEqual(readdirSync(e.cacheRoot).sort(), [".v2-poc-only", ONLINE_CACHE.fileName].sort());
  });
test("cache creation is exclusive and repeat leaves bytes unchanged", (t) => {
  const e = fixture(t);
  e.create();
  const before = sourceHash(e.file);
  assert.throws(e.create, /CACHE_ALREADY_EXISTS/);
  assert.equal(sourceHash(e.file), before);
});
test("empty online snapshot is supported without original conversion", (t) => {
  const e = fixture(t);
  e.options.snapshot = { records: [], assets: [] };
  e.create();
  assert.deepEqual(e.open().readRecords(), []);
});
for (const key of ["ownerId", "workspaceId", "deviceId", "generation"])
  test(`cache scope rejects mismatched ${key} without changing file`, (t) => {
    const e = fixture(t);
    e.create();
    const before = sourceHash(e.file);
    assert.throws(
      () =>
        openOnlineCache(e.cacheRoot, {
          ...e.options,
          identity: { ...e.identity, [key]: key === "generation" ? "2" : randomUUID() },
        }),
      /CACHE_SCOPE_MISMATCH/,
    );
    assert.equal(sourceHash(e.file), before);
  });
test("legacy DB19 cannot be interpreted or migrated as cache", (t) => {
  const e = fixture(t);
  linkSync(e.source, e.file);
  assert.throws(e.open, /CACHE_FILE_ALIAS/);
});
test("independent copy of legacy DB19 fails header check before any modification", (t) => {
  const e = fixture(t);
  writeFileSync(e.file, readFileSync(e.source));
  const before = sourceHash(e.file);
  assert.throws(e.open, /CACHE_FORMAT_REQUIRED/);
  assert.equal(sourceHash(e.file), before);
});
test("PoC extraction metadata DB cannot be upgraded just by pointing at it", (t) => {
  const e = fixture(t);
  writeFileSync(e.file, readFileSync(join(e.directory, "metadata.db")));
  assert.throws(e.open, /CACHE_FORMAT_REQUIRED/);
});
test("wrong application id and future schema are rejected", (t) => {
  const e = fixture(t);
  e.create();
  let db = new DatabaseSync(e.file);
  db.exec("PRAGMA application_id=0");
  db.close();
  assert.throws(e.open, /CACHE_FORMAT_REQUIRED/);
  db = new DatabaseSync(e.file);
  db.exec(`PRAGMA application_id=${ONLINE_CACHE.applicationId};PRAGMA user_version=2`);
  db.close();
  assert.throws(e.open, /CACHE_FORMAT_REQUIRED/);
});
test("extra table, column or trigger cannot hide image bytes", (t) => {
  const e = fixture(t);
  e.create();
  const db = new DatabaseSync(e.file);
  db.exec("CREATE TABLE hidden(data BLOB)");
  db.close();
  assert.throws(e.open, /CACHE_SCHEMA_CHANGED/);
});
test("tampered snapshot cannot retain the original digest", (t) => {
  const e = fixture(t);
  e.create();
  const db = new DatabaseSync(e.file);
  db.prepare("UPDATE records SET body=? WHERE rowid=(SELECT min(rowid) FROM records)").run(
    JSON.stringify({ text: "changed" }),
  );
  db.close();
  assert.throws(e.open, /CACHE_SNAPSHOT_CHANGED/);
});
test("database BLOB parameter cannot bypass STRICT JSON body columns", (t) => {
  const e = fixture(t);
  e.create();
  const db = new DatabaseSync(e.file);
  try {
    assert.throws(() => db.prepare("UPDATE records SET body=?").run(Buffer.from("raw-image")));
  } finally {
    db.close();
  }
});
for (const value of [
  "data:image/png;base64,AAAA",
  "data : image/webp;base64,AAAA",
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
  "/9j/4AAQSkZJRgABAQAAAQABAAD",
  "R0lGODlhAQABAIAAAP",
  "UklGRlgAAABXRUJQ",
  "SUkqAAgAAAA",
])
  test(`inline image representation is rejected (${value.slice(0, 12)})`, (t) => {
    const e = fixture(t);
    e.input.records[0].body = { text: value };
    assert.throws(e.create, /CACHE_IMAGE_BODY_FORBIDDEN/);
    assert.equal(existsSync(e.file), false);
    assert.deepEqual(readdirSync(e.cacheRoot), [".v2-poc-only"]);
  });
for (const key of ["data", "thumb", "base64", "binary", "access_token"])
  test(`forbidden metadata field ${key} never reaches SQLite`, (t) => {
    const e = fixture(t);
    e.input.records[0].body = { [key]: "opaque" };
    assert.throws(e.create, /CACHE_PAYLOAD_FIELD_FORBIDDEN/);
    assert(!existsSync(e.file));
  });
test("typed binary object and cyclic metadata are rejected before publication", (t) => {
  const e = fixture(t);
  e.input.records[0].body = { bytes: new Uint8Array([1, 2]) };
  assert.throws(e.create, /CACHE_JSON_REQUIRED/);
  const cyclic = {};
  cyclic.child = cyclic;
  e.input.records[0].body = cyclic;
  assert.throws(e.create, /CACHE_METADATA_DEPTH/);
});
test("dangling or mismatched Blob references are rejected", (t) => {
  const e = fixture(t);
  e.input.records[0].body = { ref: { objectId: randomUUID(), sha256: "a".repeat(64), bytes: 1 } };
  assert.throws(e.create, /CACHE_ASSET_REFERENCE/);
});
test("duplicate record identity and duplicate logical asset id are rejected", (t) => {
  const e = fixture(t);
  e.input.records.push(e.input.records[0]);
  assert.throws(e.create, /CACHE_DUPLICATE_RECORD/);
  e.input.records.pop();
  e.input.assets.push(e.input.assets[0]);
  assert.throws(e.create, /CACHE_ASSET_DESCRIPTOR/);
});
test("same content hash may belong to distinct logical assets", (t) => {
  const e = fixture(t);
  e.input.assets.push({ ...e.input.assets[0], objectId: randomUUID() });
  e.create();
  const assets = e.open().readAssets();
  assert.equal(assets.length, e.input.assets.length);
});
for (const stream of ["outbox", "inbox", "conflict"])
  test(`${stream} accepts metadata refs and rejects inline image bytes atomically`, (t) => {
    const e = fixture(t);
    e.create();
    appendCacheEnvelope(e.cacheRoot, {
      ...e.options,
      stream,
      envelopeId: randomUUID(),
      payload: { ref: e.input.assets[0], text: "한글 / English" },
    });
    assert.equal(e.open().pendingCount, 1);
    e.handles.at(-1).close();
    const before = sourceHash(e.file);
    assert.throws(
      () =>
        appendCacheEnvelope(e.cacheRoot, {
          ...e.options,
          stream,
          envelopeId: randomUUID(),
          payload: { text: "data:image/png;base64,AAAA" },
        }),
      /CACHE_IMAGE_BODY_FORBIDDEN/,
    );
    assert.equal(sourceHash(e.file), before);
  });
test("injected JSON payloads in saved envelope are rechecked on reopen", (t) => {
  const e = fixture(t);
  e.create();
  const db = new DatabaseSync(e.file);
  db.prepare("INSERT INTO envelopes VALUES(?,?,?)").run(
    "outbox",
    randomUUID(),
    JSON.stringify({ text: "data:image/jpeg;base64,AAAA" }),
  );
  db.close();
  assert.throws(e.open, /CACHE_IMAGE_BODY_FORBIDDEN/);
});
test("cache inside protected original or Classic config is never created", (t) => {
  const e = fixture(t);
  assert.throws(() => createOnlineCache(e.localRoot, e.options), /LOCAL_ONLINE_PATH_OVERLAP/);
  assert(!existsSync(join(e.localRoot, ONLINE_CACHE.fileName)));
});
test("cache symlink and hardlink aliases are rejected", (t) => {
  const e = fixture(t);
  e.create();
  const alternate = join(e.stateRoot, "other");
  mkdirSync(alternate);
  writeFileSync(join(alternate, ".v2-poc-only"), "synthetic");
  symlinkSync(e.file, join(alternate, ONLINE_CACHE.fileName));
  assert.throws(() => openOnlineCache(alternate, e.options), /CACHE_FILE_ALIAS/);
  rmSync(join(alternate, ONLINE_CACHE.fileName));
  linkSync(e.file, join(alternate, ONLINE_CACHE.fileName));
  assert.throws(e.open, /CACHE_FILE_ALIAS/);
});
test("late root symlink toward original is rejected", (t) => {
  const e = fixture(t);
  e.create();
  renameSync(e.cacheRoot, e.cacheRoot + "-saved");
  symlinkSync(e.localRoot, e.cacheRoot, "dir");
  assert.throws(e.open, /CACHE_PATH_ALIAS/);
});
test("metadata returned to caller is isolated from cached content", (t) => {
  const e = fixture(t);
  e.create();
  const h = e.open(),
    rows = h.readRecords();
  rows[0].body = { text: "outside mutation" };
  assert.notDeepEqual(rows, h.readRecords());
  h.close();
  assert.throws(() => h.readRecords(), /CACHE_CLOSED/);
});
test("matching trusted short-lived attestation opens read-only snapshot", async (t) => {
  const e = fixture(t);
  e.create();
  const h = await e.activate();
  assert.equal(h.productActivationAllowed, false);
  assert.equal(h.activation.status, "cache-verified");
  assert.equal(h.readRecords().length, e.input.records.length);
  assert.equal(typeof h.exec, "undefined");
  assert.equal(typeof h.appendCacheEnvelope, "undefined");
});
for (const [key, value] of [
  ["status", "poc-verified"],
  ["contract", "wjb-migration-poc-1"],
  ["capability", "workspace-runtime"],
  ["family", "legacy-db19"],
  ["version", 2],
  ["ownerId", "00000000-0000-4000-8000-000000000001"],
  ["workspaceId", "00000000-0000-4000-8000-000000000001"],
  ["deviceId", "00000000-0000-4000-8000-000000000001"],
  ["generation", "2"],
  ["snapshotHash", "f".repeat(64)],
])
  test(`activation rejects mismatched ${key}`, async (t) => {
    const e = fixture(t);
    e.create();
    await assert.rejects(
      e.activate({ verifyRemote: async (r) => ({ ...(await e.remote(r)), [key]: value }) }),
      /CACHE_ACTIVATION_REQUIRED/,
    );
  });
test("missing adapter/guard and client boolean cannot activate cache", async (t) => {
  const e = fixture(t);
  e.create();
  await assert.rejects(e.activate({ isCurrent: undefined }), /CACHE_ACTIVATION_ADAPTER_REQUIRED/);
  await assert.rejects(e.activate({ verifyRemote: async () => true }), /CACHE_ACTIVATION_REQUIRED/);
});
for (const variant of ["expired", "future", "old", "long", "nan-clock"])
  test(`activation lifetime rejects ${variant}`, async (t) => {
    const e = fixture(t);
    e.create();
    await assert.rejects(
      e.activate({
        clock: variant === "nan-clock" ? () => NaN : e.activation.clock,
        verifyRemote: async (r) => {
          const a = await e.remote(r);
          if (variant === "expired") a.expiresAt = e.now;
          if (variant === "future") a.issuedAt = e.now + 1;
          if (variant === "old") a.issuedAt = e.now - 60001;
          if (variant === "long") a.expiresAt = e.now + 300001;
          return a;
        },
      }),
      /CACHE_ACTIVATION_REQUIRED/,
    );
  });
test("activation expiration or account guard change prevents subsequent reads", async (t) => {
  const e = fixture(t);
  e.create();
  let current = true;
  const h = await e.activate({ isCurrent: () => current });
  assert(h.readRecords().length);
  current = false;
  assert.throws(h.readRecords, /CACHE_ACTIVATION_STALE/);
  current = true;
  assert.throws(h.readRecords, /CACHE_ACTIVATION_STALE/); // An old revoked handle never revives.
  const next = await e.activate();
  e.now += 120000;
  assert.throws(next.readRecords, /CACHE_ACTIVATION_EXPIRED/);
  const db = new DatabaseSync(e.file);
  try {
    db.exec("BEGIN EXCLUSIVE;ROLLBACK");
  } finally {
    db.close();
  }
});
test("late remote response is discarded and read lock is released", async (t) => {
  const e = fixture(t);
  e.create();
  const started = wait(),
    finish = wait();
  let current = true;
  const p = e.activate({
    isCurrent: () => current,
    verifyRemote: async (r) => {
      started.resolve();
      await finish.promise;
      return e.remote(r);
    },
  });
  await started.promise;
  current = false;
  finish.resolve();
  await assert.rejects(p, /CACHE_ACTIVATION_STALE/);
  const db = new DatabaseSync(e.file);
  try {
    db.exec("BEGIN EXCLUSIVE;ROLLBACK");
  } finally {
    db.close();
  }
});
test("unknown remote failure does not open source or retain SQLite lock", async (t) => {
  const e = fixture(t);
  e.create();
  await assert.rejects(
    e.activate({
      verifyRemote: async () => {
        throw Error("backend unavailable");
      },
    }),
    /backend unavailable/,
  );
  const db = new DatabaseSync(e.file);
  try {
    db.exec("BEGIN EXCLUSIVE;ROLLBACK");
  } finally {
    db.close();
  }
});
test("unsettled envelopes block snapshot activation rather than discard pending work", async (t) => {
  const e = fixture(t);
  e.create();
  appendCacheEnvelope(e.cacheRoot, {
    ...e.options,
    stream: "outbox",
    envelopeId: randomUUID(),
    payload: { text: "pending" },
  });
  let calls = 0;
  await assert.rejects(
    e.activate({
      verifyRemote: async () => {
        calls++;
      },
    }),
    /CACHE_PENDING_REQUIRES_SYNC/,
  );
  assert.equal(calls, 0);
  assert.equal(e.open().pendingCount, 1);
});
test("read-only cache proof cannot be promoted to application runtime activation", async (t) => {
  const e = fixture(t);
  e.create();
  const h = await e.activate();
  const registry = openWorkspaceRegistry(join(e.stateRoot, "registry.db"), {
    protectedLocalRoots: [e.localRoot],
  });
  try {
    const entry = registry.createEmptyOnline({
      ownerId: e.actor.ownerId,
      cloudWorkspaceId: e.workspaceId,
      name: "온라인",
    });
    let opened = false;
    await assert.rejects(
      openRegisteredWorkspace({
        registry,
        entryId: entry.entry_id,
        actor: { ownerId: e.ownerId },
        isCurrent: () => true,
        adapters: {
          verifyActivation: async () => h.activation,
          openOnline: async () => {
            opened = true;
          },
        },
      }),
      /PRODUCT_ACTIVATION_REQUIRED/,
    );
    assert.equal(opened, false);
  } finally {
    registry.close();
  }
});
test("escaped image URL inside rich document JSON cannot bypass metadata scan", (t) => {
  const e = fixture(t);
  e.input.records[0].body = { doc: '{"src":"\\u0064ata:image/png;base64,AAAA"}' };
  assert.throws(e.create, /CACHE_IMAGE_BODY_FORBIDDEN/);
});
test("custom JSON serialization hook is rejected before SQLite writes", (t) => {
  const e = fixture(t);
  const body = { text: "safe" };
  Object.defineProperty(body, "toJSON", { value: () => ({ text: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB" }) });
  e.input.records[0].body = body;
  assert.throws(e.create, /CACHE_JSON_REQUIRED/);
});
test("metadata accessors are rejected instead of evaluating changing getters", (t) => {
  const e = fixture(t);
  e.input.records[0].body = {
    get text() {
      return "safe";
    },
  };
  assert.throws(e.create, /CACHE_JSON_REQUIRED/);
});
test("literal metadata label does not get mistaken for a data URL", (t) => {
  const e = fixture(t);
  e.input.records[0].body = { text: "metadata: version 1" };
  e.create();
  assert(e.open().readRecords().length);
});
test("clock rollback and invalid clock values cannot prolong a verified read handle", async (t) => {
  const e = fixture(t);
  e.create();
  const h = await e.activate();
  e.now -= 1;
  assert.throws(h.readRecords, /CACHE_ACTIVATION_EXPIRED/);
  e.now = NaN;
  assert.throws(h.readRecords, /CACHE_ACTIVATION_EXPIRED/);
});
test("missing protected roots rejects writes and reads", (t) => {
  const e = fixture(t);
  assert.throws(
    () => createOnlineCache(e.cacheRoot, { ...e.options, protectedLocalRoots: [] }),
    /CACHE_PROTECTED_ROOTS_REQUIRED/,
  );
  e.create();
  assert.throws(
    () => openOnlineCache(e.cacheRoot, { ...e.options, protectedLocalRoots: [] }),
    /CACHE_PROTECTED_ROOTS_REQUIRED/,
  );
});
test("unknown envelope stream cannot smuggle an alternate binary table", (t) => {
  const e = fixture(t);
  e.create();
  assert.throws(
    () =>
      appendCacheEnvelope(e.cacheRoot, {
        ...e.options,
        stream: "images",
        envelopeId: randomUUID(),
        payload: { text: "x" },
      }),
    /CACHE_ENVELOPE_REQUIRED/,
  );
});
for (const [key, value] of [
  ["assetsState", "pending"],
  ["assetCatalogHash", "0".repeat(64)],
])
  test(`remote Blob verification rejects mismatched ${key}`, async (t) => {
    const e = fixture(t);
    e.create();
    await assert.rejects(
      e.activate({ verifyRemote: async (r) => ({ ...(await e.remote(r)), [key]: value }) }),
      /CACHE_ACTIVATION_REQUIRED/,
    );
  });
test("snapshot hash uses fixed ASCII ordering, independent of input/locale order", (t) => {
  const e = fixture(t);
  e.options.snapshot = {
    assets: [],
    records: ["a_b", "ab", "aA", "aa"].map((entityType) => ({
      entityType,
      entityId: "x",
      revision: "1",
      body: { text: entityType },
    })),
  };
  const manifest = e.create(),
    rows = e.open().readRecords();
  assert.deepEqual(
    rows.map((r) => r.entityType),
    ["aA", "a_b", "aa", "ab"],
  );
  assert.equal(manifest.snapshotHash, hash({ records: rows, assets: [] }));
});
test("an unrelated existing file is preserved by cache creation", (t) => {
  const e = fixture(t);
  writeFileSync(e.file, "unrelated bytes");
  assert.throws(e.create, /CACHE_ALREADY_EXISTS/);
  assert.equal(readFileSync(e.file, "utf8"), "unrelated bytes");
});
test("known Blob bytes cannot be duplicated as base64 even without a recognized image prefix", (t) => {
  const e = fixture(t),
    bytes = Buffer.alloc(64, 7);
  e.input.assets.push({ objectId: randomUUID(), sha256: hash(bytes), bytes: bytes.length });
  e.input.records[0].body = { text: bytes.toString("base64") };
  assert.throws(e.create, /CACHE_IMAGE_BODY_FORBIDDEN/);
  assert(!existsSync(e.file));
});
