import { describe, it, expect } from "vitest";
import { freshRepo } from "./helpers";
import { calendarDays, localToday, parseWidget } from "../../src/domain/liveWidget";
import { parseNoteDoc, emptyContent, type TextBox } from "../../src/domain/note";
import { migrate, MIGRATIONS, backupStructureMatches } from "../../src/data/migrate";
import { openSqlJsMemory, SqlJsDriver, openSqlJs } from "../../src/data/drivers/sqlJs";
import { JournalRepository } from "../../src/data/repository";
describe("v17 live widget data integrity", () => {
  it("sanitizes configuration, keeps empty live cards and prevents live cards in weekly documents", async () => {
    expect(parseWidget({ type: "unknown" })).toBeUndefined();
    expect(
      parseWidget({
        type: "timeline",
        variant: "<script>",
        milestoneEntryIds: ["a", "a", 42, "x".repeat(100)],
      }),
    ).toMatchObject({ variant: "records", milestoneEntryIds: ["a"] });
    const box: TextBox = {
      id: "w",
      kind: "text",
      x: 8,
      y: 8,
      w: 640,
      z: 1,
      bg: null,
      content: emptyContent(),
      widget: { type: "timeline", variant: "milestones", milestoneEntryIds: ["e"] },
    };
    const doc = parseNoteDoc(JSON.stringify({ v: 1, boxes: [box] }));
    expect(doc.boxes).toHaveLength(1);
    expect(doc.boxes[0]).toMatchObject({ widget: box.widget });
    const { repo, db } = await freshRepo();
    await expect(repo.saveWeekNote("2026-W45", doc)).rejects.toThrow("사본");
    await db.close();
  });
  it("reads one task only, counts all records, preserves stable selected IDs and shares completion with source", async () => {
    const { repo, db } = await freshRepo();
    const c = await repo.createCategory("정산", "2026-W40"),
      other = await repo.createCategory("다른 업무", "2026-W40");
    await db.batch([
      {
        sql: "INSERT INTO entry_item(id,date,category_id,seq,depth,text,flagged,flag_done_at,created_at,updated_at) VALUES('a','2026-10-01',?,1,0,'착수',0,NULL,'t','t'),('b','2026-11-03',?,1,0,'검토',1,NULL,'t','t'),('c','2026-11-06',?,1,0,'검증 완료',0,'2026-11-06T10:00:00Z','t','t'),('foreign','2026-11-06',?,1,0,'다른 업무 중요',1,NULL,'t','t'),('future','2026-12-01',?,1,0,'예정 업무',0,NULL,'t','t')",
        params: [c.id, c.id, c.id, other.id, c.id],
      },
    ]);
    const s = await repo.cabi.widgetSnapshot(c.id, "2026-11-07", "0000-01-01", 0, ["a", "c", "foreign"]);
    expect(s.recordCount).toBe(3);
    expect(s.importantCount).toBe(1);
    expect(s.important.map((e) => e.id)).toEqual(["b"]);
    expect(s.selected.map((e) => e.id)).toEqual(["a", "c"]);
    expect(s.recent).toBe("2026-11-06");
    expect(s.weeks.reduce((n, w) => n + w.count, 0)).toBe(3);
    await repo.completeFlag("b");
    expect((await repo.cabi.widgetSnapshot(c.id, "2026-11-07")).importantCount).toBe(0);
    expect((await repo.getItemsByIds(["b"]))[0]?.flagDoneAt).toBeTruthy();
    await repo.undoComplete("b");
    expect((await repo.cabi.widgetSnapshot(c.id, "2026-11-07")).importantCount).toBe(1);
    await db.execute("UPDATE entry_item SET text='검증 결과 확인' WHERE id='c'");
    expect(
      (await repo.cabi.widgetSnapshot(c.id, "2026-11-07", "0000-01-01", 0, ["c"])).selected[0]?.text,
    ).toBe("검증 결과 확인");
    await db.execute("DELETE FROM entry_item WHERE id='c'");
    expect((await repo.cabi.widgetSnapshot(c.id, "2026-11-07", "0000-01-01", 0, ["c"])).selected).toEqual([]);
    await db.close();
  });
  it("paginates without losing week aggregation and has no query-induced board revisions", async () => {
    const { repo, db } = await freshRepo(),
      c = await repo.createCategory("가상", "2026-W45");
    const board = (await repo.cabi.board(c.id, true))!;
    await db.batch(
      Array.from({ length: 5000 }, (_, i) => ({
        sql: "INSERT INTO entry_item(id,date,category_id,seq,depth,text,flagged,created_at,updated_at) VALUES(?,'2026-11-06',?,?,0,?,1,'t','t')",
        params: ["r" + i, c.id, i + 1, "기록 " + i],
      })),
    );
    const first = await repo.cabi.widgetSnapshot(c.id, "2026-11-07"),
      next = await repo.cabi.widgetSnapshot(c.id, "2026-11-07", "0000-01-01", 40);
    expect(first.records).toHaveLength(40);
    expect(next.records).toHaveLength(40);
    expect(first.important).toHaveLength(20);
    expect(first.weeks[0]?.count).toBe(5000);
    expect(first.recordCount).toBe(5000);
    expect(first.importantCount).toBe(5000);
    expect(next.records.some((n) => first.records.some((f) => f.id === n.id))).toBe(false);
    const found = await repo.cabi.widgetSnapshot(c.id, "2026-11-07", "0000-01-01", 0, [], "기록 17");
    expect(found.recordCount).toBe(111);
    expect(found.records.every((e) => e.text.includes("기록 17"))).toBe(true);
    expect((await repo.cabi.board(c.id))?.revision).toBe(board.revision);
    await db.close();
  });
  it("preserves v16 boards through the capability migration and backup/restore, gates older apps", async () => {
    const db = await openSqlJsMemory();
    await migrate(db, { migrations: MIGRATIONS.filter((m) => m.version <= 16) });
    const repo = new JournalRepository(db),
      c = await repo.createCategory("보존", "2026-W45");
    const board = (await repo.cabi.board(c.id, true))!;
    let backup = false;
    await migrate(db, {
      beforeMigrate: async (from, to) => {
        expect([from, to]).toEqual([16, 18]);
        backup = true;
      },
    });
    expect(backup).toBe(true);
    expect((await repo.cabi.board(c.id))?.doc).toEqual(board.doc);
    const widget: TextBox = {
      id: "widget",
      kind: "text",
      x: 16,
      y: 24,
      w: 600,
      h: 230,
      z: 1,
      bg: null,
      content: emptyContent(),
      widget: { type: "elapsed", basis: "start" },
    };
    await repo.cabi.saveBoard(c.id, board.revision, { v: 1, boxes: [widget] });
    expect(
      (await db.select<{ format_version: number }>("SELECT format_version FROM cabi_board"))[0]
        ?.format_version,
    ).toBe(2);
    const copy = await openSqlJs(undefined, (db as SqlJsDriver).exportBytes()),
      restored = new JournalRepository(copy);
    expect(await backupStructureMatches(copy, 18)).toBe(true);
    expect((await restored.cabi.board(c.id))?.doc.boxes[0]).toMatchObject({ widget: { type: "elapsed" } });
    await expect(migrate(copy, { migrations: MIGRATIONS.filter((m) => m.version <= 16) })).rejects.toThrow();
    await copy.close();
    await db.close();
  });
  it("calculates local calendar days across DST and start-day/future cases", () => {
    expect(calendarDays("2026-03-07", "2026-03-09")).toBe(2);
    expect(calendarDays("2026-11-07", "2026-11-07")).toBe(0);
    expect(calendarDays("2026-11-08", "2026-11-07")).toBe(-1);
    expect(localToday(new Date(2026, 10, 7, 23, 59))).toBe("2026-11-07");
  });
});
