import { DatabaseSync } from "node:sqlite";
import { Buffer } from "node:buffer";
import { fixture18 } from "./fixture18.mjs";
import { transaction } from "./model.mjs";
export function largeFixture(path, { entries = 1000, images = 20, blobBytes = 0 } = {}) {
  fixture18(path);
  const db = new DatabaseSync(path, { timeout: 2000 });
  db.exec("PRAGMA foreign_keys=ON;");
  const now = "2026-11-08T00:00:00.000Z",
    base = db.prepare("SELECT * FROM entry_item WHERE id='e1'").get();
  const insert = (table, row, upsert = false) => {
    const keys = Object.keys(row);
    db.prepare(
      `INSERT INTO ${table}(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})${
        upsert
          ? " ON CONFLICT(id) DO UPDATE SET " +
            keys
              .filter((k) => k !== "id")
              .map((k) => `${k}=excluded.${k}`)
              .join(",")
          : ""
      }`,
    ).run(...Object.values(row));
  };
  transaction(db, () => {
    for (let i = 3; i <= 10; i++) {
      insert("category", {
        id: "c" + i,
        name: "대용량 업무 " + i,
        color: "c1",
        sort_order: i,
        created_at: now,
        updated_at: now,
      });
      insert("category_period", { id: "p" + i, category_id: "c" + i, start_date: "2026-10-26" });
      insert("cabi_board", {
        id: "b" + i,
        category_id: "c" + i,
        doc: JSON.stringify({ v: 1, boxes: [], edges: [] }),
        updated_at: now,
      });
    }
    const content = JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "가상 대용량 노트" }] }],
    });
    for (let i = 3; i <= 20; i++)
      insert("cabi_note", {
        id: "n" + i,
        category_id: "c" + (((i - 1) % 10) + 1),
        title: "표본 노트 " + i,
        content,
        plain_text: "가상 대용량 노트",
        created_at: now,
        updated_at: now,
      });
    for (const week of ["2026-W46", "2026-W47"])
      insert("week_note", {
        week_id: week,
        doc: JSON.stringify({ v: 1, boxes: [], edges: [] }),
        updated_at: now,
      });
    const days = ["2026-10-30", "2026-11-02", "2026-11-09", "2026-11-16"],
      counts = new Map(),
      keys = Object.keys(base);
    const statement = db.prepare(
      `INSERT INTO entry_item(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")}) ON CONFLICT(id) DO UPDATE SET ${keys
        .filter((k) => k !== "id")
        .map((k) => `${k}=excluded.${k}`)
        .join(",")}`,
    );
    for (let i = 1; i <= entries; i++) {
      const category = "c" + (((i - 1) % 10) + 1),
        date = days[Math.floor((i - 1) / 10) % 4],
        key = date + category,
        seq = (counts.get(key) ?? 0) + 1;
      counts.set(key, seq);
      const row = {
        ...base,
        id: "e" + i,
        category_id: category,
        date,
        seq,
        depth: seq % 5 === 2 ? 1 : 0,
        text: "가상 기록 " + i,
        recurrence_id: i === 1 ? "r1" : null,
        flagged: 0,
        flag_done_at: null,
      };
      statement.run(...keys.map((k) => row[k]));
    }
    const png = Buffer.from(db.prepare("SELECT data FROM note_asset WHERE id='wa'").get().data, "base64"),
      weeks = ["2026-W44", "2026-W45", "2026-W46", "2026-W47"];
    const docs = new Map(
      db
        .prepare("SELECT week_id,doc FROM week_note")
        .all()
        .map((r) => [r.week_id, JSON.parse(r.doc)]),
    );
    let binaryTotal = 0;
    for (let i = 0; i < images; i++) {
      const id = i === 0 ? "wa" : i === 1 ? "ca" : "large-" + i,
        table = i === 1 ? "cabi_asset" : "note_asset",
        week = weeks[i % 4],
        buffer = blobBytes ? Buffer.alloc(blobBytes, i % 251) : Buffer.concat([png, Buffer.from(String(i))]);
      if (blobBytes) {
        png.copy(buffer);
        Buffer.from(String(i)).copy(buffer, buffer.length - 16);
      }
      binaryTotal += buffer.length;
      if (i < 2)
        db.prepare(`UPDATE ${table} SET data=?,bytes=? WHERE id=?`).run(
          buffer.toString("base64"),
          buffer.length,
          id,
        );
      else {
        insert(table, {
          id,
          week_id: week,
          mime: "image/png",
          data: buffer.toString("base64"),
          width: 1,
          height: 1,
          bytes: buffer.length,
          created_at: now,
        });
        docs.get(week).boxes.push({
          id: "img-" + i,
          kind: "image",
          asset: id,
          x: (i % 5) * 180,
          y: Math.floor(i / 5) * 120,
          w: 160,
          z: i + 10,
          caption: "합성 저장 페이로드",
        });
      }
    }
    for (const [week, doc] of docs)
      db.prepare("UPDATE week_note SET doc=? WHERE week_id=?").run(JSON.stringify(doc), week);
    db.prepare("INSERT OR REPLACE INTO app_meta VALUES('poc_payload_bytes',?)").run(String(binaryTotal));
  });
  db.close();
  return { entries, images, blobBytes };
}
