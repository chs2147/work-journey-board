// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { freshRepo, clockAt } from "./helpers";
import { appendCopies } from "../../src/domain/items";
import { type NoteDoc, type TextBox } from "../../src/domain/note";
import { migrate, MIGRATIONS, LATEST_SCHEMA_VERSION, quickCheck } from "../../src/data/migrate";
import { openSqlJsMemory } from "../../src/data/drivers/sqlJs";
import { prepareConnection } from "../../src/data/driver";
import { JournalRepository } from "../../src/data/repository";

const memo = (ids: string[]): NoteDoc => ({
  v: 1,
  boxes: [
    {
      id: "memo",
      kind: "text",
      x: 0,
      y: 0,
      w: 240,
      z: 1,
      bg: null,
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "가상 공유 메모" }] }],
      },
      refs: ids.map((item) => ({ item })),
    } as TextBox,
  ],
});
async function setup() {
  const { repo, db } = await freshRepo();
  const category = await repo.createCategory("가상 프로젝트", "2026-W40");
  await repo.saveCell("2026-10-23", category.id, [
    { id: "parent", depth: 0, text: "가상 본문", flagged: true, startTime: "09:15", dueDate: "2026-11-01" },
    { id: "child", depth: 1, text: "가상 세부" },
  ]);
  await repo.saveWeekNote("2026-W43", memo(["parent", "child"]));
  const [cabinet] = await repo.addCabinetItems([
    { kind: "link", title: "가상 참고", target: "https://example.test" },
  ]);
  await repo.setCabinetLinks(cabinet!.id, [{ entryId: "parent" }, { categoryId: category.id }]);
  return { repo, db, category, cabinet };
}

describe("v16 shared memo/Cabinet copies", () => {
  it("cross-week copy grows links only; undo preserves shared edits and redo preserves other target records", async () => {
    const { repo, db, category } = await setup();
    const copy = await repo.copyEntries(
      [{ date: "2026-10-30", categoryId: category.id, items: [{ id: "copy", depth: 0, text: "가상 본문" }] }],
      [{ source: "parent", target: "copy" }],
    );
    expect((await repo.getWeekNote("2026-W43")).doc.boxes[0]!.refs?.map((r) => r.item).sort()).toEqual([
      "child",
      "copy",
      "parent",
    ]);
    expect((await repo.getWeekNote("2026-W44")).doc.boxes).toHaveLength(0);
    expect(await repo.linkedMemos(["copy"])).toEqual([
      { entryId: "copy", weekId: "2026-W43", boxId: "memo" },
    ]);
    const cabinet = await repo.listCabinet();
    expect(cabinet.items).toHaveLength(1);
    expect(cabinet.links).toHaveLength(3);
    expect(
      (await repo.getUniverseSnapshot({ key: "ws", name: "가상", color: "c1" })).notes.find(
        (n) => n.weekId === "2026-W43",
      )!.doc.boxes[0]!.refs,
    ).toHaveLength(3);
    const edited = (await repo.getWeekNote("2026-W43")).doc;
    edited.boxes[0]!.x = 400;
    await repo.saveWeekNote("2026-W43", edited);
    await repo.saveCell("2026-10-30", category.id, [
      { id: "copy", depth: 0, text: "가상 본문" },
      { id: "later", depth: 0, text: "나중 기록" },
    ]);
    await repo.undoCopiedEntries(copy);
    expect((await repo.getCategoryEntries(category.id, "2026-10-30", "2026-10-30")).map((i) => i.id)).toEqual(
      ["later"],
    );
    expect((await repo.getWeekNote("2026-W43")).doc.boxes[0]!.x).toBe(400);
    await repo.redoCopiedEntries(copy);
    expect(
      (await repo.getCategoryEntries(category.id, "2026-10-30", "2026-10-30")).map((i) => i.id).sort(),
    ).toEqual(["copy", "later"]);
    expect((await repo.listCabinet()).links).toHaveLength(3);
    expect(await quickCheck(db)).toBe(true);
  });

  it("a stale memo content save preserves externally added links; an explicit unlink removes only its own link", async () => {
    const { repo, category } = await setup();
    const baseline = (await repo.getWeekNote("2026-W43")).doc;
    await repo.copyEntries(
      [{ date: "2026-10-30", categoryId: category.id, items: [{ id: "copy", depth: 0, text: "가상 본문" }] }],
      [{ source: "parent", target: "copy" }],
    );
    await repo.saveWeekNote(
      "2026-W43",
      { ...baseline, boxes: baseline.boxes.map((b) => ({ ...b, x: 88 })) },
      baseline,
    );
    expect((await repo.getWeekNote("2026-W43")).doc.boxes[0]!.refs).toHaveLength(3);
    await repo.saveWeekNote(
      "2026-W43",
      {
        ...baseline,
        boxes: baseline.boxes.map((b) => ({ ...b, refs: b.refs?.filter((r) => r.item !== "parent") })),
      },
      baseline,
    );
    expect((await repo.getWeekNote("2026-W43")).doc.boxes[0]!.refs?.map((r) => r.item).sort()).toEqual([
      "child",
      "copy",
    ]);
  });

  it("previous import only creates links for newly inserted rows and skips completed parent subtrees", async () => {
    const { repo, category } = await setup();
    const all = await repo.getCategoryEntries(category.id, "2026-10-23", "2026-10-23");
    await repo.saveCell("2026-10-23", category.id, [
      ...all,
      { id: "done", depth: 0, text: "완료 본문", flagDoneAt: "2026-10-23T10:00:00Z" },
      { id: "done-child", depth: 1, text: "완료 하위" },
    ]);
    await repo.saveCell("2026-10-26", category.id, [{ id: "existing", depth: 0, text: "가상 본문" }]);
    const previous = (await repo.previousRecord("2026-10-26", [category.id]))!;
    expect(previous.excluded).toBe(2);
    const result = appendCopies(
      [{ id: "existing", depth: 0, text: "가상 본문" }],
      previous.cells[category.id]!,
      () => "new-child",
    );
    expect(result.mapping).toEqual([{ source: "child", target: "new-child" }]);
    await repo.copyEntries(
      [{ date: "2026-10-26", categoryId: category.id, items: result.items }],
      result.mapping,
    );
    expect(await repo.linkedMemos(["existing"])).toHaveLength(0);
    expect(await repo.linkedMemos(["new-child"])).toHaveLength(1);
    expect((await repo.listCabinet()).links).toHaveLength(2);
  });

  it("20-link overflow rejects the whole multi-cell import without leaving any new entry", async () => {
    const { repo, db, category } = await setup();
    const ids = Array.from({ length: 20 }, (_, n) => `original-${n}`);
    await repo.saveCell(
      "2026-10-23",
      category.id,
      ids.map((id) => ({ id, depth: 0, text: id })),
    );
    await repo.saveWeekNote("2026-W43", memo(ids));
    await expect(
      repo.copyEntries(
        [
          {
            date: "2026-10-26",
            categoryId: category.id,
            items: [{ id: "new", depth: 0, text: "original-0" }],
          },
          {
            date: "2026-10-27",
            categoryId: category.id,
            items: [{ id: "new2", depth: 0, text: "original-1" }],
          },
        ],
        [
          { source: ids[0]!, target: "new" },
          { source: ids[1]!, target: "new2" },
        ],
      ),
    ).rejects.toThrow("한도 20");
    expect(await repo.getItemsByIds(["new", "new2"])).toHaveLength(0);
    expect(await db.select("SELECT * FROM note_entry_link")).toHaveLength(20);
  });

  it("a relation insertion failure rolls back both copied cells", async () => {
    const { repo, db, category } = await setup();
    await db.execute(
      "CREATE TRIGGER force_link_failure BEFORE INSERT ON note_entry_link BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
    );
    await expect(
      repo.copyEntries(
        [
          {
            date: "2026-10-26",
            categoryId: category.id,
            items: [{ id: "new", depth: 0, text: "가상 본문" }],
          },
          {
            date: "2026-10-27",
            categoryId: category.id,
            items: [{ id: "new2", depth: 0, text: "가상 세부" }],
          },
        ],
        [
          { source: "parent", target: "new" },
          { source: "child", target: "new2" },
        ],
      ),
    ).rejects.toThrow("injected failure");
    expect(await repo.getItemsByIds(["new", "new2"])).toHaveLength(0);
    expect((await repo.getWeekNote("2026-W43")).doc.boxes[0]!.refs).toHaveLength(2);
  });

  it("deleting a memo object removes its global links but never deletes entries or Cabinet objects", async () => {
    const { repo, db } = await setup();
    await repo.saveWeekNote("2026-W43", { v: 1, boxes: [] });
    expect(await db.select("SELECT * FROM note_entry_link")).toHaveLength(0);
    expect(await repo.getItemsByIds(["parent", "child"])).toHaveLength(2);
    expect((await repo.listCabinet()).items).toHaveLength(1);
  });

  it("blocks dates outside the category lifetime without reactivation or writes", async () => {
    const { repo, category } = await setup();
    await expect(
      repo.copyEntries(
        [
          {
            date: "2026-01-01",
            categoryId: category.id,
            items: [{ id: "new", depth: 0, text: "가상 본문" }],
          },
        ],
        [{ source: "parent", target: "new" }],
      ),
    ).rejects.toThrow("재활성");
    expect(await repo.getItemsByIds(["new"])).toHaveLength(0);
  });

  it("copy does not overwrite existing target text or metadata from a stale cell draft", async () => {
    const { repo, category } = await setup();
    await repo.saveCell("2026-10-30", category.id, [
      { id: "existing", depth: 0, text: "최신 내용", flagged: true, dueDate: "2026-11-01" },
    ]);
    await repo.copyEntries(
      [
        {
          date: "2026-10-30",
          categoryId: category.id,
          items: [
            { id: "existing", depth: 0, text: "오래된 화면" },
            { id: "new", depth: 0, text: "가상 본문" },
          ],
        },
      ],
      [{ source: "parent", target: "new" }],
    );
    expect((await repo.getItemsByIds(["existing"]))[0]).toMatchObject({
      text: "최신 내용",
      flagged: true,
      dueDate: "2026-11-01",
    });
  });

  it("concurrent stale copy requests cannot erase an earlier copy", async () => {
    const { repo, category } = await setup();
    const result = await Promise.allSettled(
      ["a", "b"].map((id) =>
        repo.copyEntries(
          [{ date: "2026-10-30", categoryId: category.id, items: [{ id, depth: 0, text: "가상 본문" }] }],
          [{ source: "parent", target: id }],
        ),
      ),
    );
    expect(result.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
    expect((await repo.getCategoryEntries(category.id, "2026-10-30", "2026-10-30")).map((r) => r.id)).toEqual(
      ["a"],
    );
  });

  it("redo restores an imported child beside its original parent and leaves later roots intact", async () => {
    const { repo, category } = await setup();
    const existing = [
      { id: "existing", depth: 0 as const, text: "가상 본문" },
      { id: "other", depth: 0 as const, text: "다른 업무" },
    ];
    await repo.saveCell("2026-10-30", category.id, existing);
    const result = appendCopies(
      existing,
      [
        { id: "parent", depth: 0, text: "가상 본문" },
        { id: "child", depth: 1, text: "가상 세부" },
      ],
      () => "new-child",
    );
    const copy = await repo.copyEntries(
      [{ date: "2026-10-30", categoryId: category.id, items: result.items }],
      result.mapping,
    );
    await repo.undoCopiedEntries(copy);
    await repo.redoCopiedEntries(copy);
    expect(
      (await repo.getCategoryEntries(category.id, "2026-10-30", "2026-10-30")).map((i) => [i.id, i.depth]),
    ).toEqual([
      ["existing", 0],
      ["new-child", 1],
      ["other", 0],
    ]);
    expect(await repo.getWeekNotesBetween("2026-W44", "2026-W44", true)).toHaveProperty("2026-W43");
  });

  it("round-trips an unlinked memo without an empty refs field", async () => {
    const { repo } = await setup();
    await repo.saveWeekNote("2026-W43", memo([]));
    expect((await repo.getWeekNote("2026-W43")).doc.boxes[0]).not.toHaveProperty("refs");
  });

  it("v14 migration preserves legacy refs and images, backup precedes migration, normalized refs survive reopen", async () => {
    const db = await openSqlJsMemory();
    await prepareConnection(db);
    await migrate(db, { migrations: MIGRATIONS.filter((m) => m.version <= 14) });
    const clock = clockAt(2026, 10, 23);
    const before = new JournalRepository(db, clock.now);
    const c = await before.createCategory("이전 데이터", "2026-W43");
    // v14 구조 그대로 쓰기(새 저장소의 저장 문장은 v20 표를 쓴다)
    await db.execute(
      "INSERT INTO entry_item (id, date, category_id, seq, depth, text, created_at, updated_at) VALUES ('old', '2026-10-23', ?, 1, 0, '이전 항목', 't', 't')",
      [c.id],
    );
    const legacy = memo(["old"]);
    await db.execute(
      "INSERT INTO week_note (week_id, doc, updated_at) VALUES ('2026-W43', ?, '2026-10-23')",
      [JSON.stringify(legacy)],
    );
    const backup = vi.fn(async () => {
      expect(
        (await db.select<{ value: string }>("SELECT value FROM app_meta WHERE key='schema_version'"))[0]!
          .value,
      ).toBe("14");
    });
    await migrate(db, { beforeMigrate: backup });
    expect(backup).toHaveBeenCalledWith(14, LATEST_SCHEMA_VERSION);
    const after = new JournalRepository(db, clock.now);
    expect((await after.getWeekNote("2026-W43")).doc.boxes[0]!.refs).toEqual([{ item: "old" }]);
    await after.saveWeekNote("2026-W43", (await after.getWeekNote("2026-W43")).doc);
    const stored = (await db.select<{ doc: string }>("SELECT doc FROM week_note"))[0]!.doc;
    expect(JSON.parse(stored).boxes[0]).not.toHaveProperty("refs");
    const reopened = new JournalRepository(db, clock.now);
    expect((await reopened.getWeekNote("2026-W43")).doc.boxes[0]!.refs).toEqual([{ item: "old" }]);
    expect(await quickCheck(db)).toBe(true);
  });
});
