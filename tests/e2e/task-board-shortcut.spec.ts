import { test, expect } from "@playwright/test";

for (const daily of [false, true]) {
  test(`${daily ? "데일리" : "주간"} 업무 이름에서 기존 업무 메모보드를 바로 열고 삭제 상태를 반영한다`, async ({
    page,
  }) => {
    await page.goto("/?today=2026-10-22&sample=showcase");
    await expect(page.getByTestId("week-title")).toBeVisible();
    const categoryId = await page.getByTestId("category-header").first().getAttribute("data-category-id");
    expect(categoryId).toBeTruthy();
    if (daily) await page.keyboard.press("Alt+V");
    await expect(page.getByTestId("task-board-cat-badge")).toHaveCount(0);
    // 노트만 있어도 보드가 있다고 오인하지 않는다.
    await page.evaluate(async (id) => {
      const { cabiClient } = await import("../../src/ui/cabinet/cabiService" + ".ts");
      await cabiClient().createNote(id);
    }, categoryId!);
    await expect(page.getByTestId("task-board-cat-badge")).toHaveCount(0);
    await page.keyboard.press("Alt+4");
    await page.getByLabel("업무를 선택해 주세요", { exact: true }).selectOption(categoryId!);
    const createdWindow = page.waitForEvent("popup");
    await page.getByTestId("cabi-open-board").click();
    const created = await createdWindow;
    await expect(created.getByTestId("note-scroll")).toBeVisible();
    await created.close();
    await page.keyboard.press("Alt+4");
    const badge = page.getByTestId("task-board-cat-badge");
    await expect(badge).toHaveCount(1);
    const reopenedWindow = page.waitForEvent("popup");
    await badge.click();
    const reopened = await reopenedWindow;
    await expect(reopened.getByTestId("note-scroll")).toBeVisible();
    expect(new URL(reopened.url()).searchParams.get("id")).toBe(categoryId);
    await reopened.close();
    await page.evaluate(async (id) => {
      const { cabiClient } = await import("../../src/ui/cabinet/cabiService" + ".ts");
      const client = cabiClient();
      const board = await client.board(id);
      await client.removeBoard(id, board!.revision);
    }, categoryId!);
    await expect(badge).toHaveCount(0);
  });
}
