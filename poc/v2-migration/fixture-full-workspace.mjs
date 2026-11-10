// Synthetic all-table fixture, matching the mapper regression corpus. No user data.
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
export function enrich(db) {
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
