// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { freshRepo } from "./helpers";
import { uuidv7 } from "../../src/data/ids";
import { cellKey } from "../../src/data/repository";
import { copyablePrevious } from "../../src/domain/previousItems";
import { migrate, MIGRATIONS } from "../../src/data/migrate";
import { openSqlJsMemory } from "../../src/data/drivers/sqlJs";
import type { ItemDraft } from "../../src/domain/types";
const draft = (text: string, depth: 0 | 1 = 0, flagged = false): ItemDraft => ({
  id: uuidv7(),
  text,
  depth,
  flagged,
});
describe("v12 completion and copy boundaries", () => {
  it("excludes completed parent and all its children, but only a completed child of another root", () => {
    const result = copyablePrevious([
      { depth: 0, text: "done parent", flagDoneAt: "2026-11-05" },
      { depth: 1, text: "unfinished child" },
      { depth: 0, text: "remaining parent" },
      { depth: 1, text: "done child", flagDoneAt: "2026-11-05" },
      { depth: 1, text: "remaining child" },
      { depth: 0, text: "~~literal~~" },
    ]);
    expect(result.items.map((x) => x.text)).toEqual(["remaining parent", "remaining child", "~~literal~~"]);
    expect(result.excluded).toBe(3);
  });
  it("honors an empty completed parent before trimming text", () => {
    expect(
      copyablePrevious([
        { depth: 0, text: "", flagDoneAt: "now" },
        { depth: 1, text: "child" },
        { depth: 0, text: "next" },
      ]).items.map((x) => x.text),
    ).toEqual(["next"]);
  });
  it("completes ordinary items and restores their original importance even after editing", async () => {
    const { repo } = await freshRepo();
    const c = await repo.createCategory("sample", "2026-W43");
    const a = draft("ordinary");
    const b = draft("important", 0, true);
    await repo.saveCell("2026-10-22", c.id, [a, b]);
    await repo.completeFlag(a.id);
    await repo.completeFlag(b.id);
    let items = (await repo.getWeek("2026-W43")).items[cellKey("2026-10-22", c.id)]!;
    expect(items.map((i) => [i.flagged, !!i.flagDoneAt, i.completionWasFlagged])).toEqual([
      [false, true, false],
      [false, true, true],
    ]);
    await repo.saveCell(
      "2026-10-22",
      c.id,
      items.map((i) => ({ ...i, text: i.text + " edited" })),
    );
    expect(await repo.undoComplete(a.id)).toBe(false);
    expect(await repo.undoComplete(b.id)).toBe(true);
    items = (await repo.getWeek("2026-W43")).items[cellKey("2026-10-22", c.id)]!;
    expect(items.map((i) => [i.flagged, i.flagDoneAt])).toEqual([
      [false, null],
      [true, null],
    ]);
  });
  it("keeps the most recent day even when all its candidates are complete, for both query paths", async () => {
    const { repo } = await freshRepo();
    const c = await repo.createCategory("sample", "2026-W43");
    await repo.saveCell("2026-10-20", c.id, [draft("older")]);
    const p = draft("parent", 0, true);
    await repo.saveCell("2026-10-21", c.id, [p, draft("child", 1)]);
    await repo.completeFlag(p.id);
    const single = await repo.previousRecord("2026-10-22", [c.id]);
    expect(single).toMatchObject({ date: "2026-10-21", cells: { [c.id]: [] }, excluded: 2 });
    expect(await repo.previousRecordsByCategory("2026-10-22")).toEqual([single]);
    await repo.undoComplete(p.id);
    expect((await repo.previousRecord("2026-10-22", [c.id]))?.cells[c.id]).toHaveLength(2);
  });
  it("upgrades existing completed rows with their original important status and backup hook", async () => {
    const db = await openSqlJsMemory();
    await migrate(db, { migrations: MIGRATIONS.slice(0, 13) });
    await db.execute(
      "INSERT INTO category(id,name,color,sort_order,created_at,updated_at) VALUES ('c','sample','c1',1,'now','now')",
    );
    await db.execute(
      "INSERT INTO entry_item(id,date,category_id,seq,depth,text,flagged,flag_done_at,created_at,updated_at) VALUES ('i','2026-10-22','c',1,0,'done',0,'now','now','now')",
    );
    const backup = vi.fn();
    await migrate(db, { beforeMigrate: backup });
    expect(backup).toHaveBeenCalledWith(13, 14);
    const [row] = await db.select<{ completion_was_flagged: number }>(
      "SELECT completion_was_flagged FROM entry_item",
    );
    expect(row?.completion_was_flagged).toBe(1);
    await db.close();
  });
});
