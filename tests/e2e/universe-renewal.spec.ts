import { test, expect } from "@playwright/test";
test("panels start collapsed, preserve camera area, and close with focus restoration", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?today=2026-10-22&sample=showcase");
  await page.getByTestId("rail-universe").click();
  await expect(page.getByTestId("u-toggle-filter")).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("u-toggle-detail")).toHaveAttribute("aria-expanded", "false");
  await page.getByTestId("u-static").click();
  const before = await page.getByTestId("universe-map").boundingBox();
  await page.getByTestId("u-toggle-filter").click();
  await page.getByTestId("u-search").fill("배치");
  await page.getByTestId("u-toggle-detail").click();
  await expect(page.getByTestId("universe-detail")).toBeVisible();
  expect(await page.getByTestId("universe-map").boundingBox()).toEqual(before);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("u-toggle-detail")).toBeFocused();
  await page.getByRole("button", { name: "필터 접기", exact: true }).click();
  await page.getByTestId("u-toggle-filter").click();
  await expect(page.getByTestId("u-search")).toHaveValue("배치");
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.getByTestId("u-toggle-detail").click();
  await expect(page.getByTestId("universe-filters")).toHaveCount(0);
});
test("real WebGL scene or explicit fallback, static view remains available", async ({ page }) => {
  await page.goto("/?today=2026-10-22&sample=showcase");
  await page.getByTestId("rail-universe").click();
  await expect(
    page
      .getByTestId("universe-3d-canvas")
      .or(page.getByRole("status").filter({ hasText: "3D를 사용할 수 없어" })),
  ).toBeVisible();
  await page.getByTestId("u-static").click();
  await expect(page.getByTestId("universe-3d-canvas")).toHaveCount(0);
  await expect(page.getByTestId("universe-map")).toBeVisible();
});
