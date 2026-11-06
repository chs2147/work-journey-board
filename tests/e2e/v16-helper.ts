import type { Page } from "@playwright/test";

export async function seedV16(page: Page) {
  await page.evaluate(async () => {
    const loaded = (path: string) =>
      performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find((url) => new URL(url).pathname === path) ?? path;
    const { useAppStore } = await import(loaded("/src/ui/common/appStore.ts"));
    const board = await import(loaded("/src/ui/board/boardStore.ts"));
    const note = await import(loaded("/src/ui/note/noteStore.ts"));
    await board.flushAll();
    await note.flushNote();
    const repo = useAppStore.getState().journal.repo;
    const cat = await repo.createCategory("v16 가상 업무", "2026-W43");
    await repo.saveCell("2026-10-22", cat.id, [
      {
        id: "v16-parent",
        depth: 0,
        text: "v16 원본 본문",
        flagged: true,
        startTime: "09:15",
        dueDate: "2026-10-26",
      },
      { id: "v16-child", depth: 1, text: "v16 하위 본문" },
    ]);
    const { doc } = await repo.getWeekNote("2026-W43");
    doc.boxes.push({
      id: "v16-memo",
      kind: "text",
      x: 20,
      y: 1500,
      w: 300,
      z: 100,
      bg: null,
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "v16 공유 메모" }] }],
      },
      refs: [{ item: "v16-parent" }, { item: "v16-child" }],
    });
    await repo.saveWeekNote("2026-W43", doc);
    await repo.addCabinetItems([
      {
        kind: "link",
        title: "v16 Cabinet",
        target: "https://example.test/v16",
        links: [{ entryId: "v16-parent" }],
      },
    ]);
    await board.reload();
    await note.reloadNote();
  });
}
export async function openCopyV16(page: Page, text = "v16 원본 본문") {
  const row = page
    .locator('[data-testid="item-row"]')
    .filter({ has: page.locator("textarea", { hasText: text }) });
  // textarea values are DOM properties, so find the row through its accessible textbox.
  const field = page.locator("textarea").filter({ visible: true }).filter({ hasText: text });
  const actual = (await row.count()) ? row : page.locator("[data-item-index]").filter({ has: field });
  await actual.first().getByTestId("drag-row").click();
  await page.getByRole("menuitem", { name: "날짜로 복제…" }).click();
  return page.getByTestId("copy-date-dialog");
}
