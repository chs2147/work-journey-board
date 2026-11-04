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
    expect(await migrate(db, { beforeMigrate: before, migrations: MIGRATIONS.slice(0, 3) })).toBe(3);
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

  it("v3 → v4(기존 일지 가져오기): 직전 백업 호출, 기록은 그대로 두고 가져오기 표·칸이 생긴다", async () => {
    const db = await openSqlJsMemory();
    await migrate(db, { migrations: MIGRATIONS.slice(0, 3) });
    await db.batch([
      {
        sql: "INSERT INTO category (id, name, color, sort_order, created_at, updated_at) VALUES ('c', '가상 업무', 'c1', 1, 't', 't')",
      },
      {
        sql: "INSERT INTO entry_item (id, date, category_id, seq, depth, text, created_at, updated_at) VALUES ('i', '2026-10-22', 'c', 1, 0, '가상 기록', 't', 't')",
      },
    ]);
    const before = vi.fn().mockResolvedValue(undefined);
    expect(await migrate(db, { beforeMigrate: before, migrations: MIGRATIONS.slice(0, 4) })).toBe(4);
    expect(before).toHaveBeenCalledWith(3, 4);
    expect(await db.select("SELECT id, text, import_id FROM entry_item")).toEqual([
      { id: "i", text: "가상 기록", import_id: null },
    ]);
    expect(
      await db.select("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'import_batch'"),
    ).toHaveLength(1);
    expect(await quickCheck(db)).toBe(true);
  });

  it("v4 → v5(연차 표시): 직전 백업 호출, 기록은 그대로 두고 날짜 표시 표가 생긴다", async () => {
    const db = await openSqlJsMemory();
    await migrate(db, { migrations: MIGRATIONS.slice(0, 4) });
    await db.batch([
      {
        sql: "INSERT INTO category (id, name, color, sort_order, created_at, updated_at) VALUES ('c', '가상 업무', 'c1', 1, 't', 't')",
      },
      {
        sql: "INSERT INTO entry_item (id, date, category_id, seq, depth, text, created_at, updated_at) VALUES ('i', '2026-10-22', 'c', 1, 0, '가상 기록', 't', 't')",
      },
    ]);
    const before = vi.fn().mockResolvedValue(undefined);
    expect(await migrate(db, { beforeMigrate: before, migrations: MIGRATIONS.slice(0, 5) })).toBe(5);
    expect(before).toHaveBeenCalledWith(4, 5);
    expect(await db.select("SELECT id, text FROM entry_item")).toEqual([{ id: "i", text: "가상 기록" }]);
    await db.execute("INSERT INTO day_mark (date, kind, updated_at) VALUES ('2026-10-27', 'leave', 't')");
    await expect(
      db.execute("INSERT INTO day_mark (date, kind, updated_at) VALUES ('2026-10-28', 'sick', 't')"),
    ).rejects.toThrow();
    expect(await quickCheck(db)).toBe(true);
  });

  it("v5 → v6(업무 태그): 직전 백업 호출, 이름은 대소문자 무시 중복 금지, 업무를 지우면 연결도 지워진다", async () => {
    const db = await openSqlJsMemory();
    await migrate(db, { migrations: MIGRATIONS.slice(0, 5) });
    await db.execute(
      "INSERT INTO category (id, name, color, sort_order, created_at, updated_at) VALUES ('c', '가상 업무', 'c1', 1, 't', 't')",
    );
    const before = vi.fn().mockResolvedValue(undefined);
    expect(await migrate(db, { beforeMigrate: before, migrations: MIGRATIONS.slice(0, 6) })).toBe(6);
    expect(before).toHaveBeenCalledWith(5, 6);
    await db.execute("INSERT INTO tag (id, name, sort_order, created_at) VALUES ('t', 'Dev', 1, 't')");
    await expect(
      db.execute("INSERT INTO tag (id, name, sort_order, created_at) VALUES ('t2', 'dev', 2, 't')"),
    ).rejects.toThrow();
    await expect(
      db.execute("INSERT INTO tag (id, name, sort_order, created_at) VALUES ('t3', '   ', 3, 't')"),
    ).rejects.toThrow();
    await db.execute("INSERT INTO category_tag (category_id, tag_id) VALUES ('c', 't')");
    await db.execute("PRAGMA foreign_keys = ON");
    await db.execute("DELETE FROM category WHERE id = 'c'");
    expect(await db.select("SELECT * FROM category_tag")).toEqual([]);
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

  it("v6 → v7(메모 이미지 썸네일 열): 직전 백업 호출, 기존 이미지는 그대로·썸네일 비어 있음", async () => {
    const db = await openSqlJsMemory();
    await migrate(db, { migrations: MIGRATIONS.slice(0, 6) });
    await db.execute(
      "INSERT INTO note_asset (id, week_id, mime, data, width, height, bytes, created_at) VALUES ('a', '2026-W44', 'image/png', 'AAAA', 10, 10, 3, 't')",
    );
    const before = vi.fn().mockResolvedValue(undefined);
    expect(await migrate(db, { beforeMigrate: before, migrations: MIGRATIONS.slice(0, 7) })).toBe(7);
    expect(before).toHaveBeenCalledWith(6, 7);
    expect(await db.select("SELECT data, thumb, thumb_mime FROM note_asset WHERE id = 'a'")).toEqual([
      { data: "AAAA", thumb: null, thumb_mime: null },
    ]);
    await expect(
      db.execute("UPDATE note_asset SET thumb = 'x', thumb_mime = 'image/gif' WHERE id = 'a'"),
    ).rejects.toThrow();
    expect(await quickCheck(db)).toBe(true);
  });

  it("v7 → v8(휴일 설정): 직전 백업, 연차·반차 행 그대로 + label 비어 있음, 공휴일·기타 휴가 저장·검사", async () => {
    const db = await openSqlJsMemory();
    await migrate(db, { migrations: MIGRATIONS.slice(0, 7) });
    await db.execute(
      "INSERT INTO day_mark (date, kind, updated_at) VALUES ('2026-10-27', 'leave', 't'), ('2026-10-28', 'half_am', 't')",
    );
    await expect(
      db.execute("INSERT INTO day_mark (date, kind, updated_at) VALUES ('2026-10-29', 'holiday', 't')"),
    ).rejects.toThrow();
    const before = vi.fn().mockResolvedValue(undefined);
    expect(await migrate(db, { beforeMigrate: before, migrations: MIGRATIONS.slice(0, 8) })).toBe(8);
    expect(before).toHaveBeenCalledWith(7, 8);
    expect(await db.select("SELECT date, kind, label FROM day_mark ORDER BY date")).toEqual([
      { date: "2026-10-27", kind: "leave", label: null },
      { date: "2026-10-28", kind: "half_am", label: null },
    ]);
    await db.execute(
      "INSERT INTO day_mark (date, kind, label, updated_at) VALUES ('2026-10-29', 'holiday', '창립기념일', 't'), ('2026-10-30', 'other', '야유회', 't')",
    );
    await expect(
      db.execute("INSERT INTO day_mark (date, kind, updated_at) VALUES ('2026-10-31', 'nap', 't')"),
    ).rejects.toThrow();
    await expect(
      db.execute(
        `INSERT INTO day_mark (date, kind, label, updated_at) VALUES ('2026-11-01', 'other', '${"가".repeat(41)}', 't')`,
      ),
    ).rejects.toThrow();
    expect(await quickCheck(db)).toBe(true);
  });

  it("v8 → v9(Cabinet): 직전 백업, 폴더·링크 등록과 업무/항목 연결(둘 중 하나), 지우면 연결도 함께", async () => {
    const db = await openSqlJsMemory();
    await migrate(db, { migrations: MIGRATIONS.slice(0, 8) });
    const before = vi.fn().mockResolvedValue(undefined);
    expect(await migrate(db, { beforeMigrate: before, migrations: MIGRATIONS.slice(0, 9) })).toBe(9);
    expect(before).toHaveBeenCalledWith(8, 9);
    await db.execute(
      "INSERT INTO category (id, name, color, sort_order, created_at, updated_at) VALUES ('c1', '업무', 'c1', 1, 't', 't')",
    );
    await db.execute(
      "INSERT INTO entry_item (id, date, category_id, seq, text, created_at, updated_at) VALUES ('e1', '2026-10-21', 'c1', 1, '항목', 't', 't')",
    );
    await db.execute(
      "INSERT INTO cabinet_item (id, kind, title, target, sort_order, created_at, updated_at) VALUES ('f', 'folder', '설계 문서', 'D:\\업무\\설계', 1, 't', 't'), ('l', 'link', '위키', 'https://wiki.example.com/a', 2, 't', 't')",
    );
    await expect(
      db.execute(
        "INSERT INTO cabinet_item (id, kind, title, target, sort_order, created_at, updated_at) VALUES ('x', 'file', 'a', 'b', 3, 't', 't')",
      ),
    ).rejects.toThrow();
    await db.execute(
      "INSERT INTO cabinet_link (id, item_id, category_id, entry_id, created_at) VALUES ('k1', 'f', 'c1', NULL, 't'), ('k2', 'f', NULL, 'e1', 't'), ('k3', 'l', 'c1', NULL, 't')",
    );
    // 둘 다 비었거나 둘 다 있으면 거부, 같은 연결 두 번 거부
    await expect(
      db.execute(
        "INSERT INTO cabinet_link (id, item_id, category_id, entry_id, created_at) VALUES ('k4', 'f', NULL, NULL, 't')",
      ),
    ).rejects.toThrow();
    await expect(
      db.execute(
        "INSERT INTO cabinet_link (id, item_id, category_id, entry_id, created_at) VALUES ('k5', 'f', 'c1', 'e1', 't')",
      ),
    ).rejects.toThrow();
    await expect(
      db.execute(
        "INSERT INTO cabinet_link (id, item_id, category_id, entry_id, created_at) VALUES ('k6', 'f', 'c1', NULL, 't')",
      ),
    ).rejects.toThrow();
    await db.execute("DELETE FROM entry_item WHERE id = 'e1'");
    expect(await db.select("SELECT id FROM cabinet_link ORDER BY id")).toEqual([{ id: "k1" }, { id: "k3" }]);
    await db.execute("DELETE FROM cabinet_item WHERE id = 'l'");
    expect(await db.select("SELECT id FROM cabinet_link ORDER BY id")).toEqual([{ id: "k1" }]);
    expect(await quickCheck(db)).toBe(true);
  });
  it("v9 → v10(시작 시각): 직전 백업, 기존 항목은 시각 없음, 15분 단위 'HH:MM'만 저장", async () => {
    const db = await openSqlJsMemory();
    await migrate(db, { migrations: MIGRATIONS.slice(0, 9) });
    await db.execute(
      "INSERT INTO category (id, name, color, sort_order, created_at, updated_at) VALUES ('c1', '업무', 'c1', 1, 't', 't')",
    );
    await db.execute(
      "INSERT INTO entry_item (id, date, category_id, seq, text, created_at, updated_at) VALUES ('e1', '2026-10-21', 'c1', 1, '회의', 't', 't')",
    );
    const before = vi.fn().mockResolvedValue(undefined);
    expect(await migrate(db, { beforeMigrate: before, migrations: MIGRATIONS.slice(0, 10) })).toBe(10);
    expect(before).toHaveBeenCalledWith(9, 10);
    expect(await db.select("SELECT start_time FROM entry_item")).toEqual([{ start_time: null }]);
    for (const ok of ["10:00", "00:00", "23:45", "09:15"])
      await db.execute("UPDATE entry_item SET start_time = ? WHERE id = 'e1'", [ok]);
    for (const bad of ["10:10", "24:00", "9:00", "10:00:00", "aa:bb", "29:15"])
      await expect(
        db.execute("UPDATE entry_item SET start_time = ? WHERE id = 'e1'", [bad]),
      ).rejects.toThrow();
    expect(await quickCheck(db)).toBe(true);
  });
});
