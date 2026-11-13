// Synthetic DB19/DB20 upgrade for the copy-contract corpus. Product migration SQL only, no user data.
import { readFileSync } from "node:fs";
const sql = (name) => readFileSync(new URL(`../../src/data/migrations/${name}`, import.meta.url), "utf8");
const at = "2026-11-12T09:00:00.000Z";

/** Apply the real 0019/0020 migrations to an enriched DB18 fixture and add kanban data as the app writes it. */
export function upgradeFixture(db, target) {
  if (![19, 20].includes(target)) throw Error("FIXTURE_VERSION");
  db.exec(sql("0019_note_delete_lock.sql"));
  db.exec(
    "UPDATE app_meta SET value='19' WHERE key='schema_version'; UPDATE cabi_note SET delete_locked=1 WHERE id=(SELECT id FROM cabi_note ORDER BY id LIMIT 1)",
  );
  if (target === 19) return;
  db.exec(sql("0020_kanban.sql"));
  db.exec("UPDATE app_meta SET value='20' WHERE key='schema_version'");
  const insert = (t, row) => {
    const k = Object.keys(row);
    db.prepare(`INSERT INTO ${t}(${k.join(",")}) VALUES(${k.map(() => "?").join(",")})`).run(
      ...Object.values(row),
    );
  };
  insert("kanban_section", {
    id: "ks-review",
    name: "검토 중",
    color: "neutral",
    sort_order: 1,
    created_at: at,
    updated_at: at,
  });
  insert("kanban_section", {
    id: "ks-hold",
    name: "보류",
    color: "neutral",
    sort_order: 2,
    created_at: at,
    updated_at: at,
  });
  // Same order as the repository: set the write source, change, then put the row back at rest.
  const tops = db
    .prepare("SELECT id FROM entry_item WHERE depth=0 AND flag_done_at IS NULL ORDER BY id")
    .all();
  db.prepare("UPDATE kanban_ctx SET source='kanban', batch_id=NULL, at=? WHERE id=1").run(at);
  db.prepare("UPDATE entry_item SET kanban_section_id='ks-review' WHERE id=?").run(tops[0].id);
  db.prepare("UPDATE entry_item SET kanban_section_id='ks-hold' WHERE id=?").run(tops[1].id);
  db.prepare("UPDATE kanban_ctx SET source='bulk', batch_id='kb-1', at=? WHERE id=1").run(at);
  db.prepare("UPDATE entry_item SET flagged=0, flag_done_at=?, kanban_section_id=NULL WHERE id=?").run(
    at,
    tops[1].id,
  );
  db.prepare("UPDATE kanban_ctx SET source='board', batch_id=NULL, at=NULL WHERE id=1").run();
  insert("kanban_bulk", {
    id: "kb-1",
    created_at: at,
    count: 1,
    items: JSON.stringify([[tops[1].id, at]]),
    undone_at: null,
  });
  // A deleted section leaves its id in history only (the app keeps history without a foreign key).
  insert("item_status_log", {
    item_id: tops[0].id,
    from_key: "ks-removed",
    from_name: "(지운 섹션)",
    to_key: "todo",
    to_name: "TODO",
    changed_at: "2026-11-11T08:00:00.000Z",
    source: "section",
    batch_id: null,
  });
  const row = db.prepare("SELECT value FROM app_meta WHERE key='settings'").get();
  const s = row ? JSON.parse(row.value) : {};
  s.ui = {
    ...(s.ui || {}),
    startView: "kanban",
    kanbanLayout: { mode: "free", rects: { todo: { x: 0, y: 0, w: 300, h: 560 } } },
    kanbanColumns: {
      order: ["ks-hold", "todo", "ks-review", "done"],
      icons: { todo: "rocket", "ks-review": "eyes" },
    },
  };
  if (row) db.prepare("UPDATE app_meta SET value=? WHERE key='settings'").run(JSON.stringify(s));
  else insert("app_meta", { key: "settings", value: JSON.stringify(s) });
}
