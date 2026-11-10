import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fixture18 } from "../v2-sync/fixture18.mjs";
import { capture18 } from "../v2-sync/db18.mjs";
import { hash, sourceHash } from "../v2-sync/model.mjs";
import { createConnectedCopy } from "../v2-assets/connected-copy.mjs";
import { mapWorkspace } from "./workspace-map.mjs";
import contract from "./db18-contract.json" with { type: "json" };
const now = "2026-11-10T00:00:00Z";
const settings = {
  workspace: { name: "개인", color: "c1", icon: "memo", updatedAt: 1 },
  nudgeWeeks: 3,
  summary: { includeMemo: true },
  holiday: { krEnabled: true, off: [], company: [{ date: "12-31", name: "회사휴일" }], reasons: ["교육"] },
  ui: { lastExportDir: "C:\\private-machine\\exports" },
  backup: { path: "C:\\private-machine\\backup" },
  ai: { api: { endpoint: "https://private-api.invalid/token" } },
};
function mutate(path, fn) {
  const d = new DatabaseSync(path);
  try {
    fn(d);
  } finally {
    d.close();
  }
}
function enrich(db) {
  const insert = (t, row) => {
    const k = Object.keys(row);
    db.prepare(`INSERT INTO ${t}(${k.join(",")}) VALUES(${k.map(() => "?").join(",")})`).run(
      ...Object.values(row),
    );
  };
  insert("app_meta", { key: "created_at", value: now });
  insert("app_meta", { key: "settings", value: JSON.stringify(settings) });
  insert("day_mark", { date: "2026-10-30", kind: "other", label: "교육", updated_at: now });
  insert("day_memo", { date: "2026-10-30", text: "가상 일 메모", updated_at: now });
  insert("weekly_summary", { week_id: "2026-W44", edited_text: "가상 주간 요약" });
  const undo = {
    deletedItems: [],
    notes: [
      { weekId: "2026-W44", doc: db.prepare("SELECT doc FROM week_note WHERE week_id='2026-W44'").get().doc },
    ],
    createdCategories: [],
    periodStarts: [],
    reopened: [],
    relations: { notes: [], cabinet: [] },
  };
  insert("import_batch", {
    id: "import-1",
    file_name: "C:\\private-machine\\source.xlsx",
    week_count: 1,
    item_count: 1,
    undo_json: JSON.stringify(undo),
    created_at: now,
  });
  db.exec("UPDATE entry_item SET import_id='import-1' WHERE id='e1'");
  insert("knowledge_card", {
    id: "knowledge-1",
    card_type: "learning",
    title: "가상 지식 카드",
    created_at: now,
    updated_at: now,
  });
  insert("knowledge_card_category", { card_id: "knowledge-1", category_id: "c1" });
  insert("knowledge_card_source", {
    id: "source-1",
    card_id: "knowledge-1",
    source_kind: "entry",
    source_id: "e1",
    excerpt: "가상 발췌",
    content_fp: "fp",
    location_fp: "loc",
    locator_json: JSON.stringify({ label: "업무1 / 날짜" }),
    sort_order: 1,
    captured_at: now,
  });
  insert("universe_relation", {
    id: "relation-1",
    from_kind: "category",
    from_id: "c1",
    to_kind: "tag",
    to_id: "t1",
    relation_type: "related",
    note: "가상 연결",
    created_at: now,
    updated_at: now,
  });
  insert("cabinet_item", {
    id: "folder-1",
    kind: "folder",
    title: "로컬 자료함",
    target: "C:\\private-machine\\resources",
    sort_order: 2,
    created_at: now,
    updated_at: now,
  });
  insert("cabinet_link", { id: "folder-link", item_id: "folder-1", category_id: "c1", created_at: now });
  db.exec(
    "INSERT INTO cabi_asset(id,owner_kind,owner_id,mime,data,width,height,bytes,created_at) SELECT 'note-image','note','n1',mime,data,width,height,bytes,created_at FROM cabi_asset WHERE id='ca'",
  );
  const note = {
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                attrs: { colwidth: [200] },
                content: [
                  {
                    type: "paragraph",
                    content: [
                      {
                        type: "text",
                        text: "표 안의 한글",
                        marks: [{ type: "textColor", attrs: { color: "blue" } }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        type: "orderedList",
        attrs: { start: 1 },
        content: [
          {
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: "계층 번호" }] }],
          },
        ],
      },
      { type: "image", attrs: { asset: "note-image" } },
    ],
  };
  db.prepare("UPDATE cabi_note SET content=?,revision=revision+1 WHERE id='n1'").run(JSON.stringify(note));
  const board = JSON.parse(db.prepare("SELECT doc FROM cabi_board WHERE id='b1'").get().doc);
  board.boxes[0].widget = { type: "timeline", variant: "milestones", milestoneEntryIds: ["e1"] };
  board.boxes.push({
    id: "folder-card",
    kind: "text",
    x: 0,
    y: 100,
    w: 200,
    z: 3,
    bg: null,
    resource: { kind: "folder", id: "folder-1" },
    content: { type: "doc", content: [{ type: "paragraph" }] },
  });
  db.prepare("UPDATE cabi_board SET doc=?,revision=revision+1 WHERE id='b1'").run(JSON.stringify(board));
  for (const t of ["note_asset", "cabi_asset"]) db.exec(`UPDATE ${t} SET thumb=data,thumb_mime=mime`);
}
function setup(t, change = () => {}) {
  const root = mkdtempSync(join(tmpdir(), "wjb-workspace-map-")),
    local = join(root, "local"),
    online = join(root, "online");
  for (const d of [local, online]) {
    mkdirSync(d);
    writeFileSync(join(d, ".v2-poc-only"), "synthetic only");
  }
  const source = join(local, "source.db"),
    directory = join(online, "copy"),
    workspaceId = randomUUID();
  fixture18(source);
  mutate(source, (d) => {
    enrich(d);
    change(d);
  });
  const before = sourceHash(source),
    original = capture18(source, { allowNoteImages: true });
  createConnectedCopy(source, directory, { sourceWorkspaceId: randomUUID(), workspaceId });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, source, directory, workspaceId, before, original };
}
const map = (e) => mapWorkspace(e.directory, e.workspaceId);
const row = (m, table, id) =>
  m.envelope.records.find((r) => r.table === table && (r.value.id === id || r.value.key === id))?.value;
test("all 26 tables are accounted for and all domain records preserve primary keys", (t) => {
  const e = setup(t),
    m = map(e);
  assert.equal(Object.keys(m.envelope.tableStats).length, 26);
  for (const [table, stats] of Object.entries(m.envelope.tableStats)) {
    assert.ok(e.original.rows[table].length > 0, table);
    assert.equal(stats.sourceRows, e.original.rows[table].length);
    assert.equal(stats.mappedRows + stats.excludedRows, stats.sourceRows);
    for (const r of m.envelope.records.filter((r) => r.table === table)) {
      const pk = contract.tables[table].columns
        .filter((c) => c.pk)
        .sort((a, b) => a.pk - b.pk)
        .map((c) => c.name);
      assert.ok(e.original.rows[table].some((old) => pk.every((k) => old[k] === r.value[k])));
    }
  }
  assert.equal(sourceHash(e.source), e.before);
  assert.equal(m.productActivationAllowed, false);
});
test("device paths and API settings omitted with explicit exclusion reasons", (t) => {
  const e = setup(t),
    m = map(e),
    body = JSON.stringify(m.envelope);
  assert.ok(!body.includes("private-machine"));
  assert.ok(!body.includes("private-api.invalid"));
  const folder = row(m, "cabinet_item", "folder-1");
  assert.equal(folder.target, null);
  assert.equal(folder.targetState, "device-local-unbound");
  assert.ok(m.envelope.exclusions.some((x) => x.field === "target"));
  assert.ok(m.envelope.exclusions.some((x) => x.key === "settings.ui"));
  assert.equal(row(m, "import_batch", "import-1").file_name, "source.xlsx");
});
test("workspace metadata and calendar business settings survive settings projection", (t) => {
  const e = setup(t),
    s = JSON.parse(row(map(e), "app_meta", "settings").value);
  assert.deepEqual(s.workspace, settings.workspace);
  assert.deepEqual(s.holiday, settings.holiday);
  assert.equal(s.summary.includeMemo, true);
  assert.equal("ui" in s, false);
  assert.equal("backup" in s, false);
  assert.equal("ai" in s, false);
});
test("logical assets and thumbnails stay independent while binary is outside DB", (t) => {
  const e = setup(t),
    m = map(e),
    assets = m.envelope.records.filter((r) => ["note_asset", "cabi_asset"].includes(r.table));
  assert.equal(assets.length, 3);
  assert.equal(m.envelope.assets.length, 1);
  const originalData = e.original.rows.note_asset[0].data;
  assert.ok(!JSON.stringify(m.envelope).includes(originalData));
  for (const r of assets)
    for (const f of ["dataRef", "thumbRef"]) {
      assert.equal(r.value[f].objectId, m.envelope.assets[0].objectId);
      assert.equal(r.value[f].sha256, m.envelope.assets[0].sha256);
      assert.equal("data" in r.value, false);
      assert.equal("thumb" in r.value, false);
    }
  assert.equal(row(m, "cabi_asset", "note-image").owner_kind, "note");
});
test("rich tables, numbering, color, image refs, geometry and live widgets preserved", (t) => {
  const e = setup(t),
    m = map(e);
  assert.equal(
    row(m, "cabi_note", "n1").content,
    e.original.rows.cabi_note.find((r) => r.id === "n1").content,
  );
  assert.equal(row(m, "cabi_board", "b1").doc, e.original.rows.cabi_board.find((r) => r.id === "b1").doc);
});
test("Universe, knowledge sources, tags, recurrence and completion data remain intact", (t) => {
  const e = setup(t),
    m = map(e);
  for (const table of [
    "universe_relation",
    "knowledge_card",
    "knowledge_card_category",
    "knowledge_card_source",
    "category_tag",
    "recurrence",
    "recurrence_line",
    "recurrence_week",
    "entry_item",
    "cabinet_link",
    "cabi_entry_link",
    "note_entry_link",
  ]) {
    const actual = m.envelope.records
      .filter((r) => r.table === table)
      .map((r) => r.value)
      .sort((a, b) => hash(a).localeCompare(hash(b)));
    assert.deepEqual(actual, e.original.rows[table]);
  }
});
test("persistent import undo and historical image refs are retained", (t) => {
  const e = setup(t),
    m = map(e);
  assert.equal(row(m, "import_batch", "import-1").undo_json, e.original.rows.import_batch[0].undo_json);
});
test("mapping is deterministic for a frozen copy", (t) => {
  const e = setup(t);
  assert.deepEqual(map(e), map(e));
});
test("later changes in original local workspace are not swept into mapping", (t) => {
  const e = setup(t),
    first = map(e);
  mutate(e.source, (d) => d.exec("UPDATE entry_item SET text='원본 로컬 추가 기록' WHERE id='e1'"));
  assert.notEqual(sourceHash(e.source), e.before);
  assert.equal(map(e).mappingHash, first.mappingHash);
});
test("user-written path text is kept while automatic device paths are excluded", (t) => {
  const e = setup(t, (d) => d.exec("UPDATE entry_item SET text='설명 속 C:\\work 경로' WHERE id='e1'")),
    m = map(e);
  assert.equal(row(m, "entry_item", "e1").text, "설명 속 C:\\work 경로");
});
for (const [name, change, error] of [
  [
    "unknown settings",
    (d) =>
      d
        .prepare("UPDATE app_meta SET value=? WHERE key='settings'")
        .run(JSON.stringify({ ...settings, futurePolicy: { x: true } })),
    /UNKNOWN_SETTINGS_KEY/,
  ],
  [
    "nested settings path",
    (d) =>
      d
        .prepare("UPDATE app_meta SET value=? WHERE key='settings'")
        .run(JSON.stringify({ ...settings, holiday: { ...settings.holiday, localPath: "C:\\private" } })),
    /SETTINGS_FORMAT/,
  ],
  [
    "unknown note node",
    (d) => d.exec(`UPDATE cabi_note SET content='{"type":"futureNode"}',revision=revision+1 WHERE id='n1'`),
    /UNKNOWN_DOCUMENT_NODE/,
  ],
  [
    "unknown board object",
    (d) => {
      const r = JSON.parse(d.prepare("SELECT doc FROM week_note WHERE week_id='2026-W44'").get().doc);
      r.boxes[0].kind = "future";
      d.prepare("UPDATE week_note SET doc=? WHERE week_id='2026-W44'").run(JSON.stringify(r));
    },
    /UNKNOWN_BOARD_OBJECT/,
  ],
  [
    "unknown locator fields",
    (d) => d.exec(`UPDATE knowledge_card_source SET locator_json='{"label":"ok","localPath":"private"}'`),
    /UNKNOWN_LOCATOR_FORMAT/,
  ],
  [
    "missing undo image",
    (d) => {
      const u = JSON.parse(d.prepare("SELECT undo_json FROM import_batch").get().undo_json);
      const b = JSON.parse(u.notes[0].doc);
      b.boxes[1].asset = "missing";
      u.notes[0].doc = JSON.stringify(b);
      d.prepare("UPDATE import_batch SET undo_json=?").run(JSON.stringify(u));
    },
    /BOARD_IMAGE_REFERENCE/,
  ],
])
  test(`${name} blocks mapping without touching original`, (t) => {
    const e = setup(t, change);
    assert.throws(() => map(e), error);
    assert.equal(sourceHash(e.source), e.before);
  });
test("metadata-only contract matches current frozen DB18 schema", () => {
  const { fingerprint, ...body } = contract;
  assert.equal(hash(body), fingerprint);
  assert.equal(Object.keys(contract.tables).length, 26);
});
