// @vitest-environment node
import { describe, expect, it } from "vitest";
import { openSqlJsMemory } from "../../src/data/drivers/sqlJs";

describe("sql.js 드라이버", () => {
  it("위치 기반 ? 자리표시자로 쓰기·읽기, 한글 보존", async () => {
    const db = await openSqlJsMemory();
    await db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
    const r = await db.execute("INSERT INTO t (name) VALUES (?), (?)", ["정산", "보안 점검"]);
    expect(r.changes).toBe(2);
    const rows = await db.select<{ name: string }>("SELECT name FROM t WHERE id >= ? ORDER BY id", [1]);
    expect(rows.map((x) => x.name)).toEqual(["정산", "보안 점검"]);
    await db.close();
  });

  it("외래 키가 켜져 있다", async () => {
    const db = await openSqlJsMemory();
    const [row] = await db.select<{ foreign_keys: number }>("PRAGMA foreign_keys");
    expect(row?.foreign_keys).toBe(1);
  });
});
