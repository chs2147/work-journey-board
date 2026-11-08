import { Buffer } from "node:buffer";
import { create18 } from "./db18.mjs";
import { transaction } from "./model.mjs";
export function fixture18(path, n = 17) {
  const db = create18(path),
    now = "2026-11-08T00:00:00.000Z";
  const insert = (table, r) => {
    const keys = Object.keys(r);
    db.prepare(`INSERT INTO ${table}(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`).run(
      ...Object.values(r),
    );
  };
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/s0AAAAASUVORK5CYII=";
  const text = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: `가상 원문 ${n} 한글 / English` }] }],
  };
  const box = (id) => ({ id, kind: "text", x: 0, y: 0, w: 320, z: 1, bg: null, content: text });
  transaction(db, () => {
    for (let i = 1; i <= 2; i++) {
      insert("category", {
        id: `c${i}`,
        name: `업무 ${i}`,
        color: `c${i}`,
        sort_order: i,
        created_at: now,
        updated_at: now,
      });
      insert("category_period", { id: `p${i}`, category_id: `c${i}`, start_date: "2026-10-26" });
      insert("tag", { id: `t${i}`, name: `태그${i}`, sort_order: i, created_at: now });
      insert("category_tag", { category_id: `c${i}`, tag_id: `t${i}` });
      insert("cabi_note", {
        id: `n${i}`,
        category_id: `c${i}`,
        title: `업무노트${i}`,
        content: JSON.stringify(text),
        plain_text: `가상 원문 ${n} 한글 / English`,
        created_at: now,
        updated_at: now,
      });
      insert("cabi_board", {
        id: `b${i}`,
        category_id: `c${i}`,
        doc: JSON.stringify({ v: 1, boxes: [box(`cb${i}`)], edges: [] }),
        updated_at: now,
      });
    }
    insert("recurrence", {
      id: "r1",
      category_id: "c1",
      weekday: 5,
      start_week: "2026-W44",
      created_at: now,
      updated_at: now,
    });
    insert("recurrence_line", { recurrence_id: "r1", seq: 1, depth: 0, text: "반복 표본" });
    insert("recurrence_week", { recurrence_id: "r1", week_id: "2026-W44", created_at: now });
    for (let i = 1; i <= 8; i++)
      insert("entry_item", {
        id: `e${i}`,
        date: i <= 4 ? "2026-10-30" : "2026-11-02",
        category_id: i <= 4 ? "c1" : "c2",
        seq: ((i - 1) % 4) + 1,
        depth: i === 2 || i === 6 ? 1 : 0,
        text: `항목 ${i} / ${n}`,
        flagged: i === 1 ? 1 : 0,
        flag_done_at: i === 3 ? now : null,
        recurrence_id: i === 1 ? "r1" : null,
        created_at: now,
        updated_at: now,
      });
    for (const [week, id] of [
      ["2026-W44", "w1"],
      ["2026-W45", "w2"],
    ])
      insert("week_note", {
        week_id: week,
        doc: JSON.stringify({ v: 1, boxes: [box(id)], edges: [] }),
        updated_at: now,
      });
    insert("note_asset", {
      id: "wa",
      week_id: "2026-W44",
      mime: "image/png",
      data: png,
      width: 1,
      height: 1,
      bytes: Buffer.from(png, "base64").length,
      created_at: now,
    });
    const weekly = {
      v: 1,
      boxes: [
        box("w1"),
        { id: "wi", kind: "image", x: 0, y: 80, w: 160, z: 2, asset: "wa", caption: "가상 그림" },
      ],
      edges: [{ id: "edge1", from: "w1", to: "wi" }],
    };
    db.prepare("UPDATE week_note SET doc=? WHERE week_id=?").run(JSON.stringify(weekly), "2026-W44");
    insert("cabi_asset", {
      id: "ca",
      owner_kind: "board",
      owner_id: "b1",
      mime: "image/png",
      data: png,
      width: 1,
      height: 1,
      bytes: Buffer.from(png, "base64").length,
      created_at: now,
    });
    const board = {
      v: 1,
      boxes: [
        box("cb1"),
        { id: "ci", kind: "image", x: 0, y: 80, w: 160, z: 2, asset: "ca", caption: "업무 그림" },
      ],
      edges: [{ id: "edge2", from: "cb1", to: "ci" }],
    };
    db.prepare("UPDATE cabi_board SET doc=?,revision=revision+1 WHERE id=?").run(JSON.stringify(board), "b1");
    insert("note_entry_link", { note_week_id: "2026-W44", box_id: "w1", entry_id: "e1", created_at: now });
    insert("cabi_entry_link", { board_id: "b1", box_id: "cb1", entry_id: "e1" });
    insert("cabinet_item", {
      id: "resource",
      kind: "link",
      title: "가상 자료",
      target: "https://example.com",
      sort_order: 1,
      created_at: now,
      updated_at: now,
    });
    insert("cabinet_link", { id: "cl1", item_id: "resource", entry_id: "e1", created_at: now });
  });
  db.close();
}
