// 가상 원본 일지(DB18 기본 → 풍부하게 → DB19/20, 선택: 가상 항목 N개) — 실제 업무 기록 아님
import { DatabaseSync } from "node:sqlite";
import { enrich } from "./fixture-full-workspace.mjs";
import { upgradeFixture } from "./fixture-db20.mjs";
import { fixture18 } from "../v2-sync/fixture18.mjs";

export function buildSourceFixture(source, version, extraItems = 0) {
  if (![18, 19, 20].includes(version)) throw Error("FIXTURE_VERSION");
  if (!Number.isInteger(extraItems) || extraItems < 0 || extraItems > 30000)
    throw Error("FIXTURE_EXTRA_ITEMS");
  fixture18(source);
  const enriched = new DatabaseSync(source);
  try {
    enrich(enriched);
  } finally {
    enriched.close();
  }
  if (version >= 19) {
    const db = new DatabaseSync(source);
    try {
      upgradeFixture(db, version);
    } finally {
      db.close();
    }
  }
  if (extraItems) {
    const db = new DatabaseSync(source);
    try {
      const cols = db
        .prepare("PRAGMA table_info(entry_item)")
        .all()
        .map((c) => c.name);
      const base = db
        .prepare("SELECT * FROM entry_item WHERE depth=0 AND recurrence_id IS NULL ORDER BY id LIMIT 1")
        .get();
      const insert = db.prepare(
        `INSERT INTO entry_item(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")})`,
      );
      db.exec("BEGIN");
      for (let i = 0; i < extraItems; i++) {
        const day = new Date(Date.UTC(2025, 0, 1) + (i % 365) * 86400000).toISOString().slice(0, 10);
        const row = {
          ...base,
          id: `synthetic-item-${i}`,
          date: day,
          seq: 100 + Math.floor(i / 365),
          text: `가상 기록 ${i}`,
        };
        for (const k of ["flagged", "flag_done_at", "due_date", "import_id"])
          if (k in row) row[k] = k === "flagged" ? 0 : null;
        insert.run(...cols.map((c) => row[c]));
      }
      db.exec("COMMIT");
    } finally {
      db.close();
    }
  }
}
