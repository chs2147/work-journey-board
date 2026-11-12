// 개선 v21(improve-v21-spec): 칸반 규칙·저장소·상태 이력·일괄 완료·마이그레이션 v19 → v20. 가상 샘플만.
import { describe, expect, it, vi } from "vitest";
import { clockAt, freshRepo } from "./helpers";
import {
  DONE,
  TODO,
  bulkTargets,
  doneGroupOf,
  groupCell,
  laterDoneDate,
  moveKind,
  periodRange,
  recordDayDoneAt,
  sectionKeyOf,
  sectionNameProblem,
  sortCards,
  DEFAULT_KANBAN_FILTER,
} from "../../src/domain/kanban";
import { KanbanError } from "../../src/data/kanbanRepository";
import { migrate, MIGRATIONS, quickCheck } from "../../src/data/migrate";
import { openSqlJsMemory } from "../../src/data/drivers/sqlJs";
import { prepareConnection } from "../../src/data/driver";

const TODAY = "2026-10-23"; // 금 · 2026-W43
const F = { ...DEFAULT_KANBAN_FILTER, period: "all" as const };

describe("칸반 규칙(순수)", () => {
  it("기간: 오늘·이번 주(기본)·최근 2/4/12주·전체·지정일(뒤집히면 바로)", () => {
    expect(DEFAULT_KANBAN_FILTER.period).toBe("week");
    expect(periodRange({ period: "today", from: null, to: null }, TODAY)).toEqual({ from: TODAY, to: TODAY });
    expect(periodRange({ period: "week", from: null, to: null }, TODAY)).toEqual({
      from: "2026-10-19",
      to: "2026-10-25",
    });
    expect(periodRange({ period: "2w", from: null, to: null }, TODAY)).toEqual({
      from: "2026-10-12",
      to: "2026-10-25",
    });
    expect(periodRange({ period: "4w", from: null, to: null }, TODAY).from).toBe("2026-09-28");
    expect(periodRange({ period: "12w", from: null, to: null }, TODAY).from).toBe("2026-08-03");
    expect(periodRange({ period: "all", from: null, to: null }, TODAY)).toEqual({ from: null, to: null });
    expect(periodRange({ period: "custom", from: "2026-10-20", to: "2026-10-01" }, TODAY)).toEqual({
      from: "2026-10-01",
      to: "2026-10-20",
    });
  });
  it("섹션 판정·옮기기 종류·이름 검사", () => {
    expect(sectionKeyOf({ flagged: false, flagDoneAt: null })).toBe(TODO);
    expect(sectionKeyOf({ flagged: false, flagDoneAt: "x", sectionId: "s" })).toBe(DONE);
    expect(sectionKeyOf({ flagged: true, flagDoneAt: null, sectionId: "s" })).toBe("s");
    expect(moveKind(TODO, DONE)).toBe("complete");
    expect(moveKind(DONE, "s")).toBe("reopen");
    expect(moveKind("s", TODO)).toBe("section");
    expect(moveKind(TODO, TODO)).toBe("none");
    const ex = [{ id: "a", name: "Parking Lot" }];
    expect(sectionNameProblem(" ", ex)).toBe("empty");
    expect(sectionNameProblem("x".repeat(21), ex)).toBe("long");
    expect(sectionNameProblem("done", ex)).toBe("reserved");
    expect(sectionNameProblem("parking lot", ex)).toBe("duplicate");
    expect(sectionNameProblem("parking lot", ex, "a")).toBeNull();
  });
  it("정렬·DONE 묶음·완료일 표시·기록일 정오·칸 묶기", () => {
    const cs = [
      { id: "a", date: "2026-10-20", seq: 1, categoryOrder: 1, dueDate: null },
      { id: "b", date: "2026-10-22", seq: 1, categoryOrder: 1, dueDate: "2026-10-30" },
      { id: "c", date: "2026-10-21", seq: 1, categoryOrder: 1, dueDate: "2026-10-24" },
    ];
    expect(sortCards(cs, "new").map((c) => c.id)).toEqual(["b", "c", "a"]);
    expect(sortCards(cs, "old").map((c) => c.id)).toEqual(["a", "c", "b"]);
    expect(sortCards(cs, "due").map((c) => c.id)).toEqual(["c", "b", "a"]);
    const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 10).toISOString();
    expect(doneGroupOf(at(2026, 10, 23), TODAY).key).toBe("today");
    expect(doneGroupOf(at(2026, 10, 19), TODAY).key).toBe("week");
    expect(doneGroupOf(at(2026, 10, 14), TODAY).key).toBe("last");
    expect(doneGroupOf(at(2026, 9, 2), TODAY).key).toBe("m2026-09");
    expect(laterDoneDate("2026-10-21", at(2026, 10, 21))).toBeNull();
    expect(laterDoneDate("2026-10-21", at(2026, 10, 27))).toBe("2026-10-27");
    expect(laterDoneDate("2026-10-21", recordDayDoneAt("2026-10-21"))).toBeNull();
    const g = groupCell([
      { id: "p", seq: 1, depth: 0 },
      { id: "p1", seq: 2, depth: 1 },
      { id: "q", seq: 3, depth: 0 },
    ]);
    expect(g.map((x) => [x.head.id, x.children.map((c) => c.id)])).toEqual([
      ["p", ["p1"]],
      ["q", []],
    ]);
  });
  it("일괄 대상: 기록일·업무·★·남은 마감·섹션 제외", () => {
    const open = [
      { id: "1", date: "2026-09-01", categoryId: "c1" },
      { id: "2", date: "2026-09-02", categoryId: "c1", flagged: true },
      { id: "3", date: "2026-09-03", categoryId: "c1", dueDate: "2026-11-01" },
      { id: "4", date: "2026-09-04", categoryId: "c1", sectionId: "s" },
      { id: "5", date: "2026-10-20", categoryId: "c1" },
      { id: "6", date: "2026-09-05", categoryId: "c2" },
    ];
    const o = {
      before: "2026-09-30",
      categories: ["c1"],
      skipFlagged: true,
      skipFutureDue: true,
      skipSections: true,
      today: TODAY,
    };
    expect(bulkTargets(open, o).map((c) => c.id)).toEqual(["1"]);
    expect(
      bulkTargets(open, {
        ...o,
        categories: [],
        skipFlagged: false,
        skipFutureDue: false,
        skipSections: false,
      }).map((c) => c.id),
    ).toEqual(["1", "2", "3", "4", "6"]);
  });
});

async function seed() {
  const clock = clockAt(2026, 10, 23, 9);
  const { repo, db } = await freshRepo(clock);
  const c = await repo.createCategory("가상 업무", "2026-W43");
  await repo.saveCell("2026-10-21", c.id, [
    { id: "a", depth: 0, text: "가상 본 항목 A" },
    { id: "a1", depth: 1, text: "가상 세부 1" },
    { id: "a2", depth: 1, text: "가상 세부 2" },
    { id: "b", depth: 0, text: "가상 본 항목 B", flagged: true },
  ]);
  return { repo, db, clock, c };
}

describe("칸반 저장소", () => {
  it("TODO 카드 = 본 항목, 세부 항목은 카드 안 · DONE으로 옮기면 세부도 함께 완료 · 되돌리기", async () => {
    const { repo, db, clock } = await seed();
    let open = await repo.kanban.listOpen(F, TODAY);
    expect(open.map((x) => x.id).sort()).toEqual(["a", "b"]);
    expect(open.find((x) => x.id === "a")!.children.map((x) => x.id)).toEqual(["a1", "a2"]);
    clock.set(2026, 10, 23, 14);
    const r = await repo.kanban.move("a", DONE);
    expect(r!.changed).toEqual(["a", "a1", "a2"]);
    open = await repo.kanban.listOpen(F, TODAY);
    expect(open.map((x) => x.id)).toEqual(["b"]);
    const done = await repo.kanban.listDone(F, TODAY, 50);
    expect(done.total).toBe(1);
    expect(done.cards[0]!.children.every((x) => x.done)).toBe(true);
    const log = await repo.kanban.statusLog("a");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      fromKey: "todo",
      toKey: "done",
      source: "kanban",
      changedAt: new Date(2026, 9, 23, 14).toISOString(),
    });
    await repo.kanban.restore(r!.undo);
    expect((await repo.kanban.listOpen(F, TODAY)).map((x) => x.id).sort()).toEqual(["a", "b"]);
    expect(
      (await repo.kanban.listOpen(F, TODAY)).find((x) => x.id === "a")!.children.every((x) => !x.done),
    ).toBe(true);
    await db.close();
  });

  it("사용자 섹션: 만들기·이름 검사·최대 8개 · ★ 항목을 두면 중요 목록에서 빠짐(★ 유지) · 지우면 TODO로", async () => {
    const { repo, db } = await seed();
    const park = await repo.kanban.createSection("Parking Lot", "violet");
    await expect(repo.kanban.createSection("parking lot", "amber")).rejects.toBeInstanceOf(KanbanError);
    expect((await repo.listImportant()).map((x) => x.id)).toEqual(["b"]);
    await repo.kanban.move("b", park.id);
    expect(await repo.listImportant()).toEqual([]);
    const b = (await repo.kanban.listOpen(F, TODAY)).find((x) => x.id === "b")!;
    expect(b).toMatchObject({ sectionId: park.id, flagged: true });
    expect(b.sectionSince).toBeTruthy();
    const undo = await repo.kanban.deleteSection(park.id);
    expect(undo.itemIds).toEqual(["b"]);
    expect((await repo.listImportant()).map((x) => x.id)).toEqual(["b"]);
    expect((await repo.kanban.statusLog("b")).map((l) => `${l.fromName}>${l.toName}:${l.source}`)).toEqual([
      "TODO>Parking Lot:kanban",
      "Parking Lot>TODO:section",
    ]);
    await repo.kanban.restoreSection(undo);
    expect((await repo.kanban.listOpen(F, TODAY)).find((x) => x.id === "b")!.sectionId).toBe(park.id);
    for (let i = 0; i < 7; i++) await repo.kanban.createSection(`가상 섹션 ${i}`, "gray");
    await expect(repo.kanban.createSection("하나 더", "gray")).rejects.toMatchObject({ problem: "max" });
    await db.close();
  });

  it("주간 보드·중요 업무에서 완료해도 세부 함께 완료(D4)·이력 · 되살리면 함께 끝난 세부만(D7) · 섹션 항목 완료 = DONE", async () => {
    const { repo, db, c } = await seed();
    await repo.saveCell("2026-10-21", c.id, [
      { id: "a", depth: 0, text: "가상 본 항목 A" },
      {
        id: "a1",
        depth: 1,
        text: "가상 세부 1",
        flagDoneAt: "2026-10-21T01:00:00.000Z",
        completionWasFlagged: false,
      },
      { id: "a2", depth: 1, text: "가상 세부 2" },
      { id: "b", depth: 0, text: "가상 본 항목 B", flagged: true },
    ]);
    const done = await repo.completeFlag("a", "important");
    expect(done!.children).toEqual(["a2"]);
    expect((await repo.kanban.statusLog("a"))[0]).toMatchObject({ toKey: "done", source: "important" });
    await repo.undoComplete("a");
    const card = (await repo.kanban.listOpen(F, TODAY)).find((x) => x.id === "a")!;
    expect(card.children.map((x) => [x.id, x.done])).toEqual([
      ["a1", true],
      ["a2", false],
    ]);
    const park = await repo.kanban.createSection("대기", "amber");
    await repo.kanban.move("a", park.id);
    await repo.completeFlag("a");
    expect((await repo.kanban.listDone(F, TODAY, 10)).cards[0]).toMatchObject({ id: "a", sectionId: null });
    // ★ 켜기(주간 보드 저장)로 되살아나면 이력에 board
    const week = await repo.getWeek("2026-W43");
    const cell = Object.values(week.items).find((xs) => xs.some((x) => x.id === "a"))!;
    await repo.saveCell(
      "2026-10-21",
      c.id,
      cell.map((it) => (it.id === "a" ? { ...it, flagged: true, flagDoneAt: null } : it)),
    );
    expect((await repo.kanban.statusLog("a")).at(-1)).toMatchObject({
      fromKey: "done",
      toKey: "todo",
      source: "board",
    });
    await db.close();
  });

  it("기간 필터: TODO = 기록일, DONE = 완료일 · 업무 필터", async () => {
    const { repo, db, c, clock } = await seed();
    const other = await repo.createCategory("다른 가상 업무", "2026-W40");
    await repo.saveCell("2026-10-02", other.id, [{ id: "old", depth: 0, text: "지난 가상 항목" }]);
    const week = { ...F, period: "week" as const };
    expect((await repo.kanban.listOpen(week, TODAY)).map((x) => x.id).sort()).toEqual(["a", "b"]);
    expect((await repo.kanban.listOpen({ ...F, categories: [other.id] }, TODAY)).map((x) => x.id)).toEqual([
      "old",
    ]);
    clock.set(2026, 10, 23, 10);
    await repo.kanban.move("old", DONE); // 옛 기록이지만 이번 주에 완료 → 이번 주 DONE에 보임
    expect((await repo.kanban.listDone(week, TODAY, 10)).cards.map((x) => x.id)).toEqual(["old"]);
    expect((await repo.kanban.listOpen(week, TODAY)).some((x) => x.categoryId === c.id)).toBe(true);
    await db.close();
  });

  it("일괄 완료: 미리 보기 → 기록일 정오로 완료(세부 포함) → 되돌리기는 그 뒤 손댄 항목을 건드리지 않음", async () => {
    const { repo, db } = await seed();
    const o = {
      before: "2026-10-22",
      categories: [],
      skipFlagged: true,
      skipFutureDue: true,
      skipSections: true,
      today: TODAY,
      includeEnded: false,
    };
    const pv = await repo.kanban.bulkPreview(o);
    expect(pv.cards.map((x) => x.id)).toEqual(["a"]);
    expect(pv.children).toBe(2);
    const info = await repo.kanban.bulkComplete(pv.cards, "record");
    const done = (await repo.kanban.listDone(F, TODAY, 10)).cards[0]!;
    expect(done.flagDoneAt).toBe(recordDayDoneAt("2026-10-21"));
    expect(laterDoneDate(done.date, done.flagDoneAt)).toBeNull();
    expect((await repo.kanban.statusLog("a"))[0]).toMatchObject({ source: "bulk" });
    expect(await repo.kanban.listBulk()).toEqual([
      expect.objectContaining({ id: info.id, count: 1, undone: false }),
    ]);
    // 그 뒤 a1만 사용자가 되살림 → 되돌리기는 a·a2만
    await repo.undoComplete("a1");
    expect(await repo.kanban.undoBulk(info.id)).toBe(3);
    const a = (await repo.kanban.listOpen(F, TODAY)).find((x) => x.id === "a")!;
    expect(a.children.every((x) => !x.done)).toBe(true);
    expect((await repo.kanban.listBulk())[0]!.undone).toBe(true);
    expect(await repo.kanban.undoBulk(info.id)).toBe(0);
    await db.close();
  });
});

describe("마이그레이션 v19 → v20(칸반)", () => {
  it("직전 백업, 기존 완료 본 항목은 TODO → DONE 이력 한 줄(완료 시각), 구조 점검 통과", async () => {
    const db = await openSqlJsMemory();
    await prepareConnection(db);
    await migrate(db, { migrations: MIGRATIONS.slice(0, 19) });
    await db.execute(
      "INSERT INTO category (id, name, color, sort_order, created_at, updated_at) VALUES ('c1', '업무', 'c1', 1, 't', 't')",
    );
    await db.execute(
      `INSERT INTO entry_item (id, date, category_id, seq, depth, text, flagged, flag_done_at, created_at, updated_at) VALUES
       ('d', '2026-10-01', 'c1', 1, 0, '가상 완료', 0, '2026-10-02T01:00:00.000Z', 't', 't'),
       ('d1', '2026-10-01', 'c1', 2, 1, '가상 완료 세부', 0, '2026-10-02T01:00:00.000Z', 't', 't'),
       ('o', '2026-10-01', 'c1', 3, 0, '가상 미완료', 0, NULL, 't', 't')`,
    );
    const before = vi.fn().mockResolvedValue(undefined);
    expect(await migrate(db, { beforeMigrate: before, migrations: MIGRATIONS.slice(0, 20) })).toBe(20);
    expect(before).toHaveBeenCalledWith(19, 20);
    expect(
      await db.select("SELECT item_id, from_key, to_key, changed_at, source FROM item_status_log"),
    ).toEqual([
      {
        item_id: "d",
        from_key: "todo",
        to_key: "done",
        changed_at: "2026-10-02T01:00:00.000Z",
        source: "migrate",
      },
    ]);
    expect(await db.select("SELECT kanban_section_id FROM entry_item WHERE id = 'o'")).toEqual([
      { kanban_section_id: null },
    ]);
    expect(await quickCheck(db)).toBe(true);
  });
});
