import { test, expect, type Page } from "@playwright/test";
async function note(page: Page) {
  await page.goto("/?today=2026-10-22&sample=showcase");
  await page.getByTestId("week-title").waitFor();
  await page.keyboard.press("Alt+4");
  await page.getByLabel("업무를 선택해 주세요", { exact: true }).selectOption({ index: 1 });
  const popup = page.waitForEvent("popup");
  await page.getByTestId("cabi-new-note").click();
  const child = await popup;
  await child.getByTestId("cabi-note-editor").waitFor();
  return child;
}
test("표 열 너비 조절·행열 이끌이 이동·바깥 클릭 닫기·저장", async ({ page }) => {
  const c = await note(page);
  await c.getByTestId("cabi-import-input").setInputFiles({
    name: "table.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("| A | B | C |\n|---|---|---|\n| a1 | b1 | c1 |\n| a2 | b2 | c2 |"),
  });
  await c.getByRole("dialog").getByRole("button", { name: "현재 위치에 삽입", exact: true }).click();
  const table = c.locator("[contenteditable=true] table");
  const first = table.locator("th").first();
  const before = (await first.boundingBox())!;
  await c.mouse.move(before.x + before.width - 2, before.y + before.height / 2);
  await c.mouse.down();
  await c.mouse.move(before.x + before.width + 80, before.y + before.height / 2, { steps: 10 });
  await c.mouse.up();
  await expect.poll(async () => (await first.boundingBox())!.width).toBeGreaterThan(before.width + 40);
  await table.locator("tr").nth(1).locator("td").first().click();
  const grip = c.getByRole("button", { name: "표 행 메뉴", exact: true });
  await grip.click();
  await expect(c.getByRole("menu", { name: "표 편집" })).toBeVisible();
  await c.getByLabel("노트 제목", { exact: true }).click();
  await expect(c.getByRole("menu", { name: "표 편집" })).toHaveCount(0);
  await table.locator("tr").nth(1).locator("td").first().click();
  const g = (await grip.boundingBox())!;
  const dest = (await table.locator("tr").nth(2).locator("td").first().boundingBox())!;
  await c.mouse.move(g.x + 12, g.y + 12);
  await c.mouse.down();
  await c.mouse.move(dest.x + 15, dest.y + 15, { steps: 10 });
  await c.mouse.up();
  await expect(table.locator("tr").nth(2)).toContainText("a1");
  await table.locator("th").first().click();
  const col = (await c.getByRole("button", { name: "표 열 메뉴", exact: true }).boundingBox())!;
  const colDest = (await table.locator("th").nth(2).boundingBox())!;
  await c.mouse.move(col.x + 12, col.y + 12);
  await c.mouse.down();
  await c.mouse.move(colDest.x + 15, colDest.y + 15, { steps: 10 });
  await c.mouse.up();
  await expect(table.locator("th").nth(2)).toHaveText("A");
  await c.keyboard.press("Control+z");
  await expect(table.locator("th").first()).toHaveText("A");
  await c.keyboard.press("Control+Shift+z");
  await expect(table.locator("th").nth(2)).toHaveText("A");
  await c.evaluate(async () => {
    const { flushCabiDocument } = await import("../../src/ui/cabinet/cabiService" + ".ts");
    await flushCabiDocument();
  });
  await c.reload();
  await expect(c.locator("th").nth(2)).toHaveText("A");
  await expect(c.locator("tr").nth(2)).toContainText("a1");
  await expect
    .poll(async () => (await c.locator("th").nth(2).boundingBox())!.width)
    .toBeGreaterThan(before.width + 40);
});
test("블록 메뉴 내부 스크롤이 메뉴를 닫지 않는다", async ({ page }) => {
  const c = await note(page);
  await c.setViewportSize({ width: 1100, height: 650 });
  const editor = c.locator("[contenteditable=true]");
  await editor.fill("메뉴 스크롤 검증");
  await editor.press("Shift+F10");
  const menu = c.locator("[data-cabi-block-menu]");
  await expect(menu).toBeVisible();
  await menu.hover();
  await c.mouse.wheel(0, 650);
  await expect(menu).toBeVisible();
  await expect.poll(() => menu.evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
  await expect(menu.getByRole("menuitem").last()).toBeInViewport();
});

test("목록 노트와 자료의 본문 시작선이 같다", async ({ page }) => {
  const child = await note(page);
  await child.close();
  const row = page.getByTestId("cabi-note-row").first();
  const noteText = await row.locator("button").first().boundingBox();
  const resourceText = await page.getByTestId("cabinet-row-title").first().boundingBox();
  expect(Math.abs(noteText!.x - resourceText!.x)).toBeLessThanOrEqual(1);
});
