import { expect, test, type Page } from "@playwright/test";

async function checkModal(page: Page) {
  const view = page.getByRole("group", { name: "보기", exact: true });
  const palette = page.getByRole("complementary", { name: "객체 도구 팔레트", exact: true });
  await expect(view.getByRole("button", { name: "관계선 보기", exact: true })).toBeVisible();
  await expect(palette.getByRole("button", { name: "관계선 보기", exact: true })).toHaveCount(0);
  const opener = palette.getByRole("button", { name: "링크 넣기", exact: true });
  const zoom = page.getByTestId("note-zoom");
  const zoomBefore = await zoom.inputValue();
  await opener.click();
  const dialog = page.getByTestId("link-dialog");
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((el) => el.matches(":modal"))).toBe(true);
  expect(
    await dialog.evaluate(
      (el) =>
        !el.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            code: "Escape",
            bubbles: true,
            cancelable: true,
            isComposing: true,
          }),
        ),
    ),
  ).toBe(true);
  await expect(dialog).toBeVisible();
  const rect = await dialog.boundingBox();
  expect(rect!.width).toBe(page.viewportSize()!.width);
  expect(rect!.height).toBe(page.viewportSize()!.height);
  expect(await dialog.evaluate((el) => getComputedStyle(el, "::backdrop").backdropFilter)).toContain("blur");
  // Both programmatic focus and keyboard navigation must stay inside the modal.
  await zoom.evaluate((el) => (el as HTMLElement).focus());
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  for (let i = 0; i < 9; i++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Control+Equal");
  await page.keyboard.press("Alt+4");
  await expect(zoom).toHaveValue(zoomBefore);
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  // A real click at a toolbar coordinate hits the backdrop, never the underlying action.
  const target = view.getByRole("button", { name: "확대", exact: true });
  const box = await target.boundingBox();
  await opener.click();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(zoom).toHaveValue(zoomBefore);
  await expect(dialog).toHaveCount(0);
  // Normal keyboard form submission remains usable after reopening.
  await opener.click();
  await dialog.getByLabel("주소", { exact: true }).fill("https://example.com/modal-test");
  await dialog.getByRole("button", { name: "넣기", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("[data-box-id]").filter({ hasText: "example.com" }).first()).toBeVisible();
}

for (const mode of ["주간", "확대", "데일리", "업무"] as const) {
  test(`${mode} 메모보드: 보기 도구 위치·전체 모달 차단·복귀`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?today=2026-10-22&sample=showcase");
    await page.getByTestId("week-title").waitFor();
    if (mode === "업무") {
      await page.keyboard.press("Alt+4");
      await page.getByLabel("업무를 선택해 주세요", { exact: true }).selectOption({ index: 1 });
      const popup = page.waitForEvent("popup");
      await page.getByTestId("cabi-open-board").click();
      const board = await popup;
      await board.setViewportSize({ width: 1180, height: 820 });
      await checkModal(board);
    } else {
      if (mode === "확대") await page.getByRole("button", { name: "크게 보기", exact: true }).click();
      if (mode === "데일리") await page.getByRole("button", { name: /^데일리 뷰/ }).click();
      await checkModal(page);
    }
  });
}
