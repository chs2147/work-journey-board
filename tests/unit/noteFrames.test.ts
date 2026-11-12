import { it, expect } from "vitest";
import { parseNoteDoc, type TextBox } from "../../src/domain/note";
import { freshRepo } from "./helpers";
import { layoutSnapshot } from "../../src/export/noteSnapshot";
import { migrate, MIGRATIONS, LATEST_SCHEMA_VERSION } from "../../src/data/migrate";
import { openSqlJsMemory } from "../../src/data/drivers/sqlJs";
it("manual frame geometry persists in weekly/task boards, export and migration gate", async () => {
  const box: TextBox = {
    id: "frame",
    kind: "text",
    x: 24,
    y: 24,
    w: 320,
    z: 1,
    bg: null,
    frameH: 160,
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "가상 크기 검증" }] }],
    },
  };
  const doc = parseNoteDoc(JSON.stringify({ v: 1, boxes: [box] }));
  expect(doc.boxes[0]?.frameH).toBe(160);
  const { repo, db } = await freshRepo();
  await repo.saveWeekNote("2026-W45", doc);
  expect((await repo.getWeekNote("2026-W45")).doc.boxes[0]?.frameH).toBe(160);
  const cat = await repo.createCategory("가상 업무", "2026-W45"),
    board = (await repo.cabi.board(cat.id, true))!;
  await repo.cabi.saveBoard(cat.id, board.revision, doc);
  expect((await repo.cabi.board(cat.id))?.doc.boxes[0]?.frameH).toBe(160);
  const snap = layoutSnapshot(
    {
      doc,
      images: {},
      lines: {},
      title: "가상",
      subtitle: "",
      goneText: "원본 없음",
      moreText: (n) => String(n),
    },
    () => 10,
  );
  expect(snap.boxes[0]?.rect.h).toBe(160);
  await db.close();
  const old = await openSqlJsMemory();
  await migrate(old, { migrations: MIGRATIONS.filter((m) => m.version <= 17) });
  let backup = false;
  await migrate(old, {
    beforeMigrate: async (from, to) => {
      expect([from, to]).toEqual([17, LATEST_SCHEMA_VERSION]);
      backup = true;
    },
  });
  expect(backup).toBe(true);
  await expect(migrate(old, { migrations: MIGRATIONS.filter((m) => m.version <= 17) })).rejects.toThrow();
  await old.close();
});
it("height-only resize preserves each object type width limits", async () => {
  const { useNote, resizeFrameLive } = await import("../../src/ui/note/noteStore");
  useNote.setState({
    doc: {
      v: 1,
      boxes: [
        { id: "img", kind: "image", asset: "virtual", caption: "", x: 0, y: 0, w: 1400, z: 1 },
        {
          id: "link",
          kind: "link",
          url: "https://example.com",
          title: "가상",
          note: "",
          x: 0,
          y: 0,
          w: 640,
          z: 2,
        },
      ],
    },
  });
  resizeFrameLive("img", 0, 0, 1400, 300);
  resizeFrameLive("link", 0, 0, 640, 200);
  expect(useNote.getState().doc.boxes.map((b) => [b.w, b.frameH])).toEqual([
    [1400, 300],
    [640, 200],
  ]);
  useNote.setState({ doc: { v: 1, boxes: [] } });
});
