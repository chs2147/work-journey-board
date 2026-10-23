// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { openSqlJsMemory } from "../../src/data/drivers/sqlJs";
import {
  LATEST_SCHEMA_VERSION,
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
    const v2 = [
      { version: 1, sql: "" },
      { version: 2, sql: "CREATE TABLE extra (id TEXT PRIMARY KEY);" },
    ];
    const before = vi.fn().mockResolvedValue(undefined);
    expect(await migrate(db, { migrations: v2, beforeMigrate: before })).toBe(2);
    expect(before).toHaveBeenCalledWith(1, 2);
    expect(await db.select("SELECT name FROM sqlite_master WHERE name = 'extra'")).toHaveLength(1);
  });

  it("실패하면 전부 롤백(버전·테이블 그대로)", async () => {
    const db = await openSqlJsMemory();
    await migrate(db);
    const bad = [
      { version: 1, sql: "" },
      { version: 2, sql: "CREATE TABLE ok2 (id TEXT);\nCREATE TABLE broken (;" },
    ];
    await expect(migrate(db, { migrations: bad })).rejects.toThrow();
    expect(await readSchemaVersion(db)).toBe(1);
    expect(await db.select("SELECT name FROM sqlite_master WHERE name = 'ok2'")).toHaveLength(0);
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
