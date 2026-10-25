// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { openSqlJsMemory } from "../../src/data/drivers/sqlJs";
import {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  migrate,
  NewerSchemaError,
  quickCheck,
  readSchemaVersion,
  splitSql,
} from "../../src/data/migrate";

describe("마이그레이션 (data-spec 7-5)", () => {
  it("빈 파일 → 최신 버전, 직전 백업 호출 없음(지킬 데이터가 없음)", async () => {
    const db = await openSqlJsMemory();
    const before = vi.fn();
    expect(await migrate(db, { beforeMigrate: before })).toBe(LATEST_SCHEMA_VERSION);
    expect(await readSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(before).not.toHaveBeenCalled();
    expect(await quickCheck(db)).toBe(true);
  });

  it("이미 최신이면 아무것도 안 함", async () => {
    const db = await openSqlJsMemory();
    await migrate(db);
    expect(await migrate(db)).toBe(LATEST_SCHEMA_VERSION);
  });

  it("기존 데이터가 있는 파일을 올리면 직전 백업 후 적용", async () => {
    const db = await openSqlJsMemory();
    await migrate(db);
    const next = LATEST_SCHEMA_VERSION + 1;
    const more = [...MIGRATIONS, { version: next, sql: "CREATE TABLE extra (id TEXT PRIMARY KEY);" }];
    const before = vi.fn().mockResolvedValue(undefined);
    expect(await migrate(db, { migrations: more, beforeMigrate: before })).toBe(next);
    expect(before).toHaveBeenCalledWith(LATEST_SCHEMA_VERSION, next);
    expect(await db.select("SELECT name FROM sqlite_master WHERE name = 'extra'")).toHaveLength(1);
  });

  it("실패하면 전부 롤백(버전·테이블 그대로)", async () => {
    const db = await openSqlJsMemory();
    await migrate(db);
    const bad = [
      ...MIGRATIONS,
      { version: LATEST_SCHEMA_VERSION + 1, sql: "CREATE TABLE ok2 (id TEXT);\nCREATE TABLE broken (;" },
    ];
    await expect(migrate(db, { migrations: bad })).rejects.toThrow();
    expect(await readSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(await db.select("SELECT name FROM sqlite_master WHERE name = 'ok2'")).toHaveLength(0);
  });

  it("0002(중요 표시·매주 반복): v1 파일의 기록을 그대로 두고 표시 칸을 더한다 — 직전 백업 호출", async () => {
    const db = await openSqlJsMemory();
    await migrate(db, { migrations: MIGRATIONS.slice(0, 1) });
    const ts = "2026-10-22T00:00:00.000Z";
    await db.execute(
      "INSERT INTO category (id, name, color, sort_order, created_at, updated_at) VALUES ('c', '업무 가', 'c1', 1, ?, ?)",
      [ts, ts],
    );
    await db.execute(
      "INSERT INTO entry_item (id, date, category_id, seq, depth, text, created_at, updated_at) VALUES ('i', '2026-10-22', 'c', 1, 0, '가상 기록', ?, ?)",
      [ts, ts],
    );
    const before = vi.fn().mockResolvedValue(undefined);
    expect(await migrate(db, { beforeMigrate: before, migrations: MIGRATIONS.slice(0, 2) })).toBe(2);
    expect(before).toHaveBeenCalledWith(1, 2);
    const [row] = await db.select<Record<string, unknown>>(
      "SELECT text, flagged, flag_done_at, recurrence_id FROM entry_item WHERE id = 'i'",
    );
    expect(row).toEqual({ text: "가상 기록", flagged: 0, flag_done_at: null, recurrence_id: null });
    for (const t of ["recurrence", "recurrence_line", "recurrence_week"]) {
      expect(
        await db.select("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [t]),
      ).toHaveLength(1);
    }
    expect(await quickCheck(db)).toBe(true);
  });

  it("v2 → v3(주간 메모): 직전 백업 호출, 요일 메모는 그대로 남고 새 표가 생긴다", async () => {
    const db = await openSqlJsMemory();
    await migrate(db, { migrations: MIGRATIONS.slice(0, 2) });
    await db.execute(
      "INSERT INTO day_memo (date, text, updated_at) VALUES ('2026-10-22', '가상 메모', '2026-10-22T00:00:00.000Z')",
    );
    const before = vi.fn().mockResolvedValue(undefined);
    expect(await migrate(db, { beforeMigrate: before })).toBe(3);
    expect(before).toHaveBeenCalledWith(2, 3);
    expect(await db.select("SELECT date, text FROM day_memo")).toEqual([
      { date: "2026-10-22", text: "가상 메모" },
    ]);
    for (const t of ["week_note", "note_asset"]) {
      expect(
        await db.select("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [t]),
      ).toHaveLength(1);
    }
    expect(await quickCheck(db)).toBe(true);
  });

  it("앱보다 새 버전 파일은 열지 않는다", async () => {
    const db = await openSqlJsMemory();
    await migrate(db);
    await db.execute("UPDATE app_meta SET value = '99' WHERE key = 'schema_version'");
    await expect(migrate(db)).rejects.toBeInstanceOf(NewerSchemaError);
  });

  it("SQL 분할: 주석 제거, 줄 끝 세미콜론 기준", () => {
    expect(splitSql("-- 주석\nCREATE TABLE a (x TEXT);\n\nCREATE INDEX i ON a(x);")).toEqual([
      "CREATE TABLE a (x TEXT)",
      "CREATE INDEX i ON a(x)",
    ]);
  });
});
