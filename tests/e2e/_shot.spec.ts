import { test } from "@playwright/test";
const S = "/tmp/claude-0/-home-user/1940b0d6-f18d-5462-a52a-bfba3bc35c08/scratchpad/";
test("shot", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?today=2026-10-22");
  const ta = page.getByRole("textbox", { name: /목 2026-10-22 기록/ }).first();
  await ta.click();
  await page.keyboard.press("Alt+O");
  await page.waitForTimeout(200);
  await page.screenshot({ path: S + "v8-time.png" });
  await page.getByRole("button", { name: "10", exact: true }).click();
  await page.getByRole("button", { name: ":30" }).click();
  await page.getByRole("button", { name: "10:30 시작" }).click();
  await page.waitForTimeout(400);
  await ta.click();
  await page.keyboard.press("Alt+D");
  await page.waitForTimeout(200);
  await page.screenshot({ path: S + "v8-move.png" });
});
