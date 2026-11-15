// Local synthetic DB only; stdin/URL/credentials are never accepted.
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { enrich } from "./fixture-full-workspace.mjs";
import { upgradeFixture } from "./fixture-db20.mjs";
import { fixture18 } from "../v2-sync/fixture18.mjs";
import { createConnectedCopy } from "../v2-assets/connected-copy.mjs";
import { mapWorkspace } from "./workspace-map.mjs";
const version = Number(process.argv[2]);
if (![18, 19, 20].includes(version)) throw Error("FIXTURE_VERSION");
// 선택: 큰 일지 흉내(가상 업무 항목 N개 추가, C-1 페이지 업로드 시험용) — 기존 항목 1개를 새 ID·날짜로 복제
const extraItems = process.argv[3] === "--extra-items" ? Number(process.argv[4]) : 0;
if (!Number.isInteger(extraItems) || extraItems < 0 || extraItems > 30000) throw Error("FIXTURE_EXTRA_ITEMS");
const dir = mkdtempSync(join(tmpdir(), "wjb-workspace-sql-"));
try {
  for (const n of ["source", "target"]) {
    mkdirSync(join(dir, n));
    writeFileSync(join(dir, n, ".v2-poc-only"), "synthetic");
  }
  const source = join(dir, "source", "source.db");
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
  const destination = join(dir, "target", "copy"),
    workspaceId = randomUUID();
  createConnectedCopy(source, destination, { workspaceId, sourceWorkspaceId: randomUUID() });
  process.stdout.write(JSON.stringify(mapWorkspace(destination, workspaceId).envelope));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
