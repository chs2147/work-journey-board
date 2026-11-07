import { test, expect, type Page } from "@playwright/test";

async function universe(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?today=2026-10-22&sample=showcase");
  await page.getByTestId("rail-universe").click();
  await expect(page.getByTestId("universe-back")).toHaveCount(0);
}
test("A/C icons, automatic motion, pause, mode safety and preference persistence", async ({ page }) => {
  await universe(page);
  const canvas = page.getByTestId("universe-3d-canvas");
  await expect(canvas).toBeVisible();
  const drift = page.getByRole("button", { name: "미세 궤도", exact: true });
  const orbit = page.getByRole("button", { name: "느린 순환", exact: true });
  await expect(drift).toHaveAttribute("aria-pressed", "true");
  await expect(drift.locator("svg")).toHaveCount(1);
  await expect(orbit.locator("svg")).toHaveCount(1);
  const labels = () =>
    page
      .getByTestId("universe-3d-labels")
      .locator("span")
      .evaluateAll((es) => es.map((e) => (e as HTMLElement).style.transform));
  await expect(canvas).toHaveAttribute("data-auto-playing", "true", { timeout: 12000 });
  const initial = await labels();
  await expect.poll(labels).not.toEqual(initial);
  const original = await canvas.elementHandle();
  await page.getByRole("button", { name: "자동 움직임 일시정지", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-auto-playing", "false");
  await page.waitForTimeout(150);
  const paused = await labels();
  await page.waitForTimeout(350);
  expect(await labels()).toEqual(paused);
  await orbit.click();
  await expect(orbit).toHaveAttribute("aria-pressed", "true");
  expect(await original!.evaluate((el) => el.isConnected)).toBe(true);
  await expect(page.getByTestId("u-mode-focus")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("rail-board").click();
  await page.getByTestId("rail-universe").click();
  await expect(orbit).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "자동 움직임 재생", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "자동 움직임 재생", exact: true }).click();
  await page.getByTestId("u-mode-galaxy").click();
  await expect(canvas).toHaveAttribute("data-auto-playing", "true", { timeout: 12000 });
  await page.waitForTimeout(1000);
  await expect(page.getByTestId("u-mode-galaxy")).toHaveAttribute("aria-pressed", "true");
  // A real manual key rotation pauses automatic movement, then resumes after idle.
  await canvas.focus();
  await canvas.press("ArrowRight");
  await expect(canvas).toHaveAttribute("data-auto-playing", "false");
  await expect(canvas).toHaveAttribute("data-auto-playing", "true", { timeout: 8000 });
  await page.getByTestId("u-static").click();
  await expect(orbit).toBeDisabled();
  await page.getByTestId("u-dynamic").click();
  await page.getByTestId("u-view-list").click();
  await expect(orbit).toBeDisabled();
});
test("OS reduced motion suppresses automatic playback without erasing the chosen style", async ({ page }) => {
  await universe(page);
  await page.getByRole("button", { name: "느린 순환", exact: true }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.getByRole("button", { name: "자동 움직임 일시정지", exact: true })).toBeDisabled();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByTestId("u-dynamic").click();
  await expect(page.getByRole("button", { name: "느린 순환", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
test("board export is anchored, keyboard accessible and does not reduce the canvas", async ({ page }) => {
  await page.goto("/?today=2026-10-22&sample=showcase");
  await page.getByTestId("week-title").waitFor();
  await page.keyboard.press("Alt+4");
  await page.getByLabel("업무를 선택해 주세요", { exact: true }).selectOption({ index: 1 });
  const popup = page.waitForEvent("popup");
  await page.getByTestId("cabi-open-board").click();
  const board = await popup;
  await board.setViewportSize({ width: 800, height: 700 });
  const canvas = board.getByTestId("note-scroll");
  await expect(canvas).toBeVisible();
  const before = await canvas.boundingBox();
  const trigger = board.getByRole("button", { name: "내보내기", exact: true });
  await trigger.focus();
  await trigger.press("ArrowDown");
  const items = board.getByRole("menuitem");
  await expect(items).toHaveCount(2);
  await expect(items.first()).toBeFocused();
  await items.first().press("ArrowDown");
  await expect(items.last()).toBeFocused();
  expect(await canvas.boundingBox()).toEqual(before);
  const menu = await board.getByRole("menu", { name: "내보내기", exact: true }).boundingBox();
  expect(menu!.x).toBeGreaterThanOrEqual(0);
  expect(menu!.x + menu!.width).toBeLessThanOrEqual(800);
  await board.keyboard.press("Escape");
  await expect(items).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await board.getByTestId("note-view-spacer").click();
  await expect(items).toHaveCount(0);
});
