// DB20 (kanban) copy contract: synthetic local files only, no network/Cloud/product write.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture18 } from "../v2-sync/fixture18.mjs";
import { captureWorkspace, createWorkspaceDB } from "../v2-sync/db18.mjs";
import { hash, sourceHash } from "../v2-sync/model.mjs";
import { createConnectedCopy } from "../v2-assets/connected-copy.mjs";
import { restoreConnectedCopy } from "../v2-assets/restore-connected-copy.mjs";
import { mapWorkspace } from "./workspace-map.mjs";
import { enrich } from "./fixture-full-workspace.mjs";
import { upgradeFixture } from "./fixture-db20.mjs";
import { createMigrationRPC } from "./server-rpc.mjs";
import contract20 from "./db20-contract.json" with { type: "json" };

function setup(t, mutate) {
  const dir = mkdtempSync(join(tmpdir(), "wjb-db20-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const local = join(dir, "original"),
    target = join(dir, "target");
  for (const p of [local, target]) {
    mkdirSync(p);
    writeFileSync(join(p, ".v2-poc-only"), "synthetic");
  }
  const source = join(local, "source.db");
  fixture18(source);
  const db = new DatabaseSync(source);
  try {
    enrich(db);
    upgradeFixture(db, 20);
    mutate?.(db);
  } finally {
    db.close();
  }
  return {
    local,
    target,
    source,
    destination: join(target, "copy"),
    sourceWorkspaceId: randomUUID(),
    workspaceId: randomUUID(),
  };
}
const settingsOf = (envelope) =>
  JSON.parse(envelope.records.find((r) => r.table === "app_meta" && r.value.key === "settings").value.value);

test("DB20: extract/map/restore keeps kanban sections, status history, bulk undo data and original", (t) => {
  const e = setup(t),
    before = sourceHash(e.source),
    files = readdirSync(e.local);
  const original = captureWorkspace(e.source, { allowNoteImages: true });
  assert.equal(original.rows.kanban_section.length, 2);
  assert.ok(original.rows.item_status_log.length >= 4); // migrate + kanban + bulk + kept deleted-section line
  assert.ok(original.rows.entry_item.some((r) => r.kanban_section_id === "ks-review"));
  const copy = createConnectedCopy(e.source, e.destination, e);
  assert.equal(copy.manifest.sourceSchema, 20);
  assert.equal(copy.imagePayloadRows, 0);
  const restored = join(e.target, "restored.db");
  restoreConnectedCopy(e.destination, restored, e.workspaceId);
  assert.deepEqual(captureWorkspace(restored, { allowNoteImages: true }).rows, original.rows);
  assert.equal(sourceHash(e.source), before);
  assert.deepEqual(readdirSync(e.local), files);
  assert.throws(() => restoreConnectedCopy(e.destination, e.source, e.workspaceId), /DESTINATION_EXISTS/);
});

test("DB20 envelope: profile, kanban tables mapped, write context and per-device layout excluded", (t) => {
  const e = setup(t);
  createConnectedCopy(e.source, e.destination, e);
  const { envelope, productActivationAllowed } = mapWorkspace(e.destination, e.workspaceId);
  assert.equal(productActivationAllowed, false);
  assert.equal(envelope.profile, "workspace-db20-map-poc-1");
  assert.equal(envelope.contractFingerprint, contract20.fingerprint);
  const tables = new Set(envelope.records.map((r) => r.table));
  for (const t of ["kanban_section", "item_status_log", "kanban_bulk"]) assert.ok(tables.has(t), t);
  assert.ok(!tables.has("kanban_ctx"));
  assert.equal(envelope.tableStats.kanban_ctx.excludedRows, 1);
  assert.ok(envelope.exclusions.some((x) => x.table === "kanban_ctx" && x.reason === "local-write-context"));
  const s = settingsOf(envelope);
  assert.deepEqual(s.ui, {
    kanbanColumns: {
      order: ["ks-hold", "todo", "ks-review", "done"],
      icons: { todo: "rocket", "ks-review": "eyes" },
    },
  });
  const ui = envelope.exclusions.find((x) => x.key === "settings.ui");
  assert.deepEqual(ui.kept, ["kanbanColumns"]);
  assert.ok(!JSON.stringify(envelope).includes("lastExportDir"));
  assert.ok(!JSON.stringify(envelope).includes('"rects"'));
  // The deleted-section history line is kept as written (history has no foreign key).
  assert.ok(envelope.records.some((r) => r.table === "item_status_log" && r.value.from_key === "ks-removed"));
});

test("DB20 restored triggers still log section moves with the recreated write context", (t) => {
  const e = setup(t);
  createConnectedCopy(e.source, e.destination, e);
  const dest = join(e.target, "restored.db");
  restoreConnectedCopy(e.destination, dest, e.workspaceId);
  const db = new DatabaseSync(dest);
  try {
    assert.deepEqual(
      { ...db.prepare("SELECT * FROM kanban_ctx").get() },
      { id: 1, source: "board", batch_id: null, at: null },
    );
    const n = db.prepare("SELECT count(*) AS n FROM item_status_log").get().n;
    const maxId = db.prepare("SELECT max(id) AS m FROM item_status_log").get().m;
    const item = db.prepare("SELECT id FROM entry_item WHERE kanban_section_id='ks-review'").get().id;
    db.prepare("UPDATE entry_item SET kanban_section_id='ks-hold' WHERE id=?").run(item);
    const last = db.prepare("SELECT * FROM item_status_log ORDER BY id DESC LIMIT 1").get();
    assert.equal(db.prepare("SELECT count(*) AS n FROM item_status_log").get().n, n + 1);
    assert.ok(last.id > maxId); // AUTOINCREMENT continues after restored ids
    assert.deepEqual(
      [last.from_key, last.to_key, last.to_name, last.source],
      ["ks-review", "ks-hold", "보류", "board"],
    );
    db.prepare("DELETE FROM kanban_section WHERE id='ks-hold'").run(); // ON DELETE SET NULL is restored
    assert.equal(db.prepare("SELECT kanban_section_id AS k FROM entry_item WHERE id=?").get(item).k, null);
  } finally {
    db.close();
  }
});

const refusals = {
  "interrupted kanban write": [
    (db) => db.exec("UPDATE kanban_ctx SET source='kanban', at='2026-11-12T09:00:00.000Z'"),
    /KANBAN_WRITE_IN_PROGRESS/,
  ],
  "unknown column icon": [
    (db) => {
      const s = JSON.parse(db.prepare("SELECT value FROM app_meta WHERE key='settings'").get().value);
      s.ui.kanbanColumns.icons.todo = "not-an-icon";
      db.prepare("UPDATE app_meta SET value=? WHERE key='settings'").run(JSON.stringify(s));
    },
    /KANBAN_COLUMNS_REFERENCE/,
  ],
  "column order naming a missing section": [
    (db) => {
      const s = JSON.parse(db.prepare("SELECT value FROM app_meta WHERE key='settings'").get().value);
      s.ui.kanbanColumns.order.push("ks-missing");
      db.prepare("UPDATE app_meta SET value=? WHERE key='settings'").run(JSON.stringify(s));
    },
    /KANBAN_COLUMNS_REFERENCE/,
  ],
  "malformed bulk undo items": [
    (db) => db.exec(`UPDATE kanban_bulk SET items='[["x"]]'`),
    /KANBAN_BULK_FORMAT/,
  ],
};
for (const [name, [mutate, error]] of Object.entries(refusals))
  test(`DB20 ${name} refuses before any online envelope, original unchanged`, (t) => {
    const e = setup(t, mutate),
      before = sourceHash(e.source);
    assert.throws(() => {
      createConnectedCopy(e.source, e.destination, e);
      mapWorkspace(e.destination, e.workspaceId);
    }, error);
    assert.equal(sourceHash(e.source), before);
  });

test("DB20 restore refuses a copy whose kanban data is invalid, without output", (t) => {
  const e = setup(t, (db) => db.exec(`UPDATE kanban_bulk SET items='[["x"]]'`));
  createConnectedCopy(e.source, e.destination, e);
  const dest = join(e.target, "restored.db");
  assert.throws(() => restoreConnectedCopy(e.destination, dest, e.workspaceId), /KANBAN_BULK_FORMAT/);
  assert.equal(existsSync(dest), false);
});

test("DB19-expecting reader and unknown DB21 are refused without touching the source", (t) => {
  const e = setup(t),
    before = sourceHash(e.source);
  assert.throws(() => captureWorkspace(e.source, { expectedVersion: 19 }), /SCHEMA_VERSION/);
  const db = new DatabaseSync(e.source);
  db.prepare("UPDATE app_meta SET value='21' WHERE key='schema_version'").run();
  db.close();
  const changed = sourceHash(e.source);
  assert.notEqual(changed, before);
  assert.throws(() => createConnectedCopy(e.source, e.destination, e), /SCHEMA_VERSION/);
  assert.equal(sourceHash(e.source), changed);
  assert.equal(existsSync(e.destination), false);
});

test("DB20 contract matches the generated product schema and keeps DB18/19 contracts separate", () => {
  const { fingerprint, ...body } = contract20;
  assert.equal(hash(body), fingerprint);
  assert.equal(contract20.sourceSchema, 20);
  const db = createWorkspaceDB(":memory:", 20);
  try {
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((r) => r.name);
    assert.deepEqual(Object.keys(contract20.tables).sort(), names);
    for (const [t, s] of Object.entries(contract20.tables))
      assert.deepEqual(
        db
          .prepare(`PRAGMA table_info("${t}")`)
          .all()
          .map((c) => ({ name: c.name, type: c.type, nullable: !c.notnull, pk: c.pk })),
        s.columns,
      );
    assert.ok(
      contract20.tables.entry_item.foreignKeys.some(
        (f) => f.table === "kanban_section" && f.from === "kanban_section_id",
      ),
    );
    assert.equal(names.length, 30);
  } finally {
    db.close();
  }
});

test("server RPC stays fail-closed for the DB20 profile until its server contract exists", async (t) => {
  const e = setup(t);
  createConnectedCopy(e.source, e.destination, e);
  const { envelope } = mapWorkspace(e.destination, e.workspaceId);
  let calls = 0;
  const client = createMigrationRPC({
    projectRef: "vsphftnmfzfoufasjttd",
    serviceRoleKey: "fictional-local-runtime-key",
    allowWorkspaceProfiles: true,
    fetchTransport: async () => {
      calls++;
      throw Error("TRANSPORT_MUST_NOT_RUN");
    },
  });
  const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  await assert.rejects(
    () =>
      client.call(
        { action: "start", jobId: id(4), params: envelope },
        { userId: id(1), sessionId: id(2), role: "authenticated" },
        id(3),
      ),
    (err) => err.code === "MIGRATION_PROFILE_UNSUPPORTED",
  );
  assert.equal(calls, 0);
});
