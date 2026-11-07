import { describe, it, expect } from "vitest";
import { freshRepo, clockAt } from "./helpers";
import {
  CabiConflictError,
  cloneBoardSelection,
  cleanCabiContent,
  referenceBox,
} from "../../src/domain/cabi";
import { emptyDoc, parseNoteDoc, type NoteDoc } from "../../src/domain/note";
import { importCabiMarkdown, exportCabiMarkdown } from "../../src/domain/cabiMarkdown";
import { migrate, MIGRATIONS, backupStructureMatches } from "../../src/data/migrate";
import { openSqlJsMemory, SqlJsDriver, openSqlJs } from "../../src/data/drivers/sqlJs";
import { JournalRepository } from "../../src/data/repository";
const content = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "가상 업무 기록" }] }],
};
const image = { mime: "image/png" as const, data: "AAAA", width: 10, height: 10, bytes: 3 };
describe("Cabi.NET date-independent data", () => {
  it("one board per task, multiple notes, date navigation does not change ownership", async () => {
    const { repo, db } = await freshRepo();
    const c = await repo.createCategory("가상 업무", "2026-W43");
    const [a, b] = await Promise.all([repo.cabi.board(c.id, true), repo.cabi.board(c.id, true)]);
    expect(a?.id).toBe(b?.id);
    await repo.cabi.createNote(c.id, "첫 노트", content);
    await repo.cabi.createNote(c.id, "둘째 노트", content);
    expect(await repo.cabi.listNotes(c.id)).toHaveLength(2);
    expect(await db.select("SELECT * FROM week_note")).toEqual([]);
    expect(await db.select("SELECT * FROM note_asset")).toEqual([]);
    await db.close();
  });
  it("rejects stale document saves without losing either revision", async () => {
    const { repo, db } = await freshRepo();
    const c = await repo.createCategory("가상 업무", "2026-W43"),
      n = await repo.cabi.createNote(c.id);
    await repo.cabi.saveNote(n.id, n.revision, "저장된 제목", content);
    await expect(repo.cabi.saveNote(n.id, n.revision, "오래된 제목", content)).rejects.toBeInstanceOf(
      CabiConflictError,
    );
    expect((await repo.cabi.note(n.id)).title).toBe("저장된 제목");
    const b = (await repo.cabi.board(c.id, true))!;
    await repo.cabi.saveBoard(c.id, b.revision, emptyDoc());
    await expect(repo.cabi.saveBoard(c.id, b.revision, emptyDoc())).rejects.toBeInstanceOf(CabiConflictError);
    await db.close();
  });
  it("reference cards survive roundtrip/deletion and never delete registered resources", async () => {
    const { repo, db } = await freshRepo();
    const c = await repo.createCategory("가상 업무", "2026-W43"),
      n = await repo.cabi.createNote(c.id, "참조 노트", content),
      b = (await repo.cabi.board(c.id, true))!;
    const box = referenceBox("card", { kind: "note", id: n.id }, n.title, 10, 20, 1);
    await repo.cabi.saveBoard(c.id, b.revision, { v: 1, boxes: [box] });
    expect((await repo.cabi.board(c.id))?.doc.boxes[0]).toMatchObject({
      resource: { kind: "note", id: n.id },
    });
    expect(await repo.cabi.referenceCount("note", n.id)).toBe(1);
    await repo.cabi.removeNote(n.id, n.revision);
    expect((await repo.cabi.board(c.id))?.doc.boxes).toHaveLength(1);
    await db.close();
  });
  it("task asset cleanup cannot remove another owner's images or weekly images", async () => {
    const { repo, db } = await freshRepo();
    const c = await repo.createCategory("가상 업무", "2026-W43"),
      n = await repo.cabi.createNote(c.id),
      b = (await repo.cabi.board(c.id, true))!;
    const a = await repo.cabi.addAsset("note", n.id, image),
      d = await repo.cabi.addAsset("board", b.id, image),
      w = await repo.addNoteAsset("2026-W43", image);
    await repo.cabi.pruneAssets("note", n.id, []);
    expect(await repo.cabi.asset(a)).toBeNull();
    expect(await repo.cabi.asset(d)).not.toBeNull();
    expect(await repo.getNoteAsset(w)).not.toBeNull();
    await db.close();
  });
  it("v15 upgrade preserves old Cabinet, memos and relationships; backup roundtrip includes new data", async () => {
    const db = await openSqlJsMemory();
    await migrate(db, { migrations: MIGRATIONS.filter((m) => m.version <= 15) });
    const r = new JournalRepository(db, clockAt(2026, 10, 22).now),
      c = await r.createCategory("가상 업무", "2026-W43");
    await db.execute(
      "INSERT INTO cabinet_item(id,kind,title,target,sort_order,created_at,updated_at) VALUES('f','folder','가상 폴더','/demo',1,'t','t')",
    );
    const doc: NoteDoc = {
      v: 1,
      boxes: [{ id: "old", kind: "text", x: 0, y: 0, w: 320, z: 1, bg: null, content }],
    };
    await r.saveWeekNote("2026-W43", doc);
    let backup = false;
    await migrate(db, {
      beforeMigrate: async (from, to) => {
        expect([from, to]).toEqual([15, 18]);
        backup = true;
      },
    });
    expect(backup).toBe(true);
    expect((await r.listCabinet()).items[0]?.id).toBe("f");
    expect((await r.getWeekNote("2026-W43")).doc).toEqual(doc);
    await r.cabi.createNote(c.id, "백업 노트", content);
    await r.cabi.board(c.id, true);
    const bytes = (db as SqlJsDriver).exportBytes(),
      copy = await openSqlJs(undefined, bytes),
      restored = new JournalRepository(copy);
    expect(await backupStructureMatches(copy, 18)).toBe(true);
    expect(await restored.cabi.listNotes(c.id)).toHaveLength(1);
    expect(await restored.cabi.board(c.id)).not.toBeNull();
    await copy.close();
    await db.close();
  });
  it("task memo discovery deduplicates boxes linked to multiple entries", async () => {
    const { repo, db } = await freshRepo();
    const c = await repo.createCategory("가상 업무", "2026-W43");
    await db.execute(
      "INSERT INTO entry_item(id,date,category_id,seq,depth,text,created_at,updated_at) VALUES('e1','2026-10-22',?,1,0,'가상 항목 1','t','t'),('e2','2026-10-23',?,1,0,'가상 항목 2','t','t')",
      [c.id, c.id],
    );
    const b = {
      ...referenceBox("m", { kind: "note", id: "placeholder" }, "가상 누적 메모", 0, 0, 1),
      resource: undefined,
      refs: [{ item: "e1" }, { item: "e2" }],
    };
    await repo.saveWeekNote("2026-W42", { v: 1, boxes: [b] });
    const memos = await repo.cabi.weeklyMemos(c.id);
    expect(memos).toHaveLength(1);
    expect(memos[0]?.entryIds.sort()).toEqual(["e1", "e2"]);
    await db.close();
  });
});
describe("Cabi.NET import/copy contracts", () => {
  it("note images must be owned by that note, so deleting another note cannot break a paste", async () => {
    const { repo, db } = await freshRepo();
    const c = await repo.createCategory("가상 업무", "2026-W43"),
      a = await repo.cabi.createNote(c.id, "원본"),
      b = await repo.cabi.createNote(c.id, "목적지");
    const original = await repo.cabi.addAsset("note", a.id, image),
      wrong = { type: "doc", content: [{ type: "image", attrs: { asset: original, alt: "가상" } }] };
    await expect(repo.cabi.saveNote(b.id, b.revision, b.title, wrong)).rejects.toThrow("직접 참조");
    const copied = await repo.cabi.addAsset("note", b.id, (await repo.cabi.asset(original))!);
    await repo.cabi.saveNote(b.id, b.revision, b.title, {
      type: "doc",
      content: [{ type: "image", attrs: { asset: copied, alt: "가상" } }],
    });
    await repo.cabi.removeNote(a.id, a.revision);
    expect(await repo.cabi.asset(copied)).not.toBeNull();
    await db.close();
  });
  it("copied assets survive deleting either original board owner in both directions", async () => {
    const { repo, db } = await freshRepo();
    const c = await repo.createCategory("가상 업무", "2026-W43"),
      b = (await repo.cabi.board(c.id, true))!;
    const source = await repo.addNoteAsset("2026-W43", image);
    const toTask = await repo.cabi.copyOwnedAssets(
      { kind: "week", weekId: "2026-W43" },
      { kind: "task", categoryId: c.id },
      [source],
    );
    await repo.pruneNoteAssets("2026-W43", []);
    expect(await repo.getNoteAsset(source)).toBeNull();
    const copied = (await repo.cabi.asset(toTask[source]!))!;
    expect(copied.data).toBe(image.data);
    const toWeek = await repo.cabi.copyOwnedAssets(
      { kind: "task", categoryId: c.id },
      { kind: "week", weekId: "2026-W44" },
      [copied.id],
    );
    await repo.cabi.removeBoard(c.id, b.revision);
    expect(await repo.getNoteAsset(toWeek[copied.id]!)).toMatchObject({ data: image.data });
    await db.close();
  });
  it("task board entry links participate in entry deletion undo", async () => {
    const { repo, db } = await freshRepo();
    const c = await repo.createCategory("가상 업무", "2026-W43");
    await db.execute(
      "INSERT INTO entry_item(id,date,category_id,seq,depth,text,created_at,updated_at) VALUES('task-linked','2026-10-22',?,1,0,'가상 항목','t','t')",
      [c.id],
    );
    const b = (await repo.cabi.board(c.id, true))!,
      box = {
        ...referenceBox("linked-card", { kind: "note", id: "fallback" }, "가상 메모", 0, 0, 1),
        refs: [{ item: "task-linked" }],
      };
    await repo.cabi.saveBoard(c.id, b.revision, { v: 1, boxes: [box] });
    const relations = await repo.itemRelations(["task-linked"]);
    expect(relations.taskNotes).toHaveLength(1);
    await db.execute("DELETE FROM entry_item WHERE id='task-linked'");
    await db.execute(
      "INSERT INTO entry_item(id,date,category_id,seq,depth,text,created_at,updated_at) VALUES('task-linked','2026-10-22',?,1,0,'가상 항목','t','t')",
      [c.id],
    );
    await repo.restoreItemRelations(relations);
    expect((await repo.cabi.board(c.id))?.doc.boxes[0]?.refs).toEqual([{ item: "task-linked" }]);
    await db.close();
  });
  it("only explicitly selected relative Markdown images become owned image blocks", () => {
    const parsed = importCabiMarkdown(
      "문장\n\n![가상 첨부](./assets/example.png)\n\n![원격](https://example.com/a.png)",
      { "example.png": "owned-image" },
    );
    expect(parsed.content.content?.some((n) => n.type === "image" && n.attrs?.asset === "owned-image")).toBe(
      true,
    );
    expect(JSON.stringify(parsed.content)).not.toContain('"src"');
    expect(parsed.excluded).toBe(1);
  });
  it("clones IDs, internal edges, asset ownership; never adds date entry links", () => {
    const original: NoteDoc = {
      v: 1,
      boxes: [
        { id: "a", kind: "text", x: 32, y: 48, w: 320, z: 2, bg: null, content, refs: [{ item: "e1" }] },
        { id: "b", kind: "image", x: 80, y: 200, w: 300, z: 3, asset: "original", caption: "가상 그림" },
      ],
      edges: [{ id: "edge", from: "a", to: "b", label: "가상 관계", dir: "one", dash: false }],
    };
    let n = 0;
    const copy = cloneBoardSelection(
      original,
      ["a", "b"],
      () => "copy" + ++n,
      { x: 16, y: 24 },
      { original: "owned-copy" },
    );
    expect(copy.boxes[0]).toMatchObject({ id: "copy1", x: 16, y: 24 });
    expect(copy.boxes[0]?.refs).toBeUndefined();
    expect(copy.boxes[1]).toMatchObject({ asset: "owned-copy", x: 64, y: 176 });
    expect(copy.edges?.[0]).toMatchObject({ from: "copy1", to: "copy2" });
    expect(original.boxes[0]?.refs).toEqual([{ item: "e1" }]);
  });
  it("imports GFM structure and links, removes executable and base64 content", () => {
    const md =
      "# 가상 제목\n\n- [x] 확인\n\n| 이름 | 값 |\n|---|---|\n| 항목 | 1 |\n\n[가상 링크](https://example.com)\n\n<script>alert(1)</script>\n\n![첨부](data:image/png;base64,AAA)";
    const parsed = importCabiMarkdown(md);
    expect(parsed.title).toBe("가상 제목");
    expect(parsed.content.content?.map((n) => n.type)).toEqual(
      expect.arrayContaining(["heading", "taskList", "table", "paragraph"]),
    );
    expect(JSON.stringify(parsed.content)).toContain('"href":"https://example.com"');
    expect(JSON.stringify(parsed.content)).not.toContain("alert(1)");
    expect(JSON.stringify(parsed.content)).not.toContain("base64");
    expect(parsed.excluded).toBeGreaterThan(0);
    const exported = exportCabiMarkdown("제목", parsed.content);
    expect(exported).toContain("- [x] 확인");
    expect(exported).toContain("[가상 링크](https://example.com)");
    expect(exported).toContain("| 이름 | 값 |");
  });
  it("drops unsafe card references and external editor images", () => {
    const raw = {
      ...referenceBox("a", { kind: "note", id: "ok" }, "가상", 0, 0, 1),
      resource: { kind: "script", id: "bad" },
    };
    expect(
      (parseNoteDoc(JSON.stringify({ v: 1, boxes: [raw] })).boxes[0] as typeof raw)?.resource,
    ).toBeUndefined();
    const doc = cleanCabiContent({
      type: "doc",
      content: [{ type: "image", attrs: { src: "https://example.com/x.png", alt: "외부 그림" } }],
    });
    expect(JSON.stringify(doc)).not.toContain("https://");
  });
});
