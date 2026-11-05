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
  // Initial camera settling must never be interpreted as a user zoom-out.
  await page.waitForTimeout(1200);
  await expect(page.getByTestId("u-mode-focus")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("u-static").click();
  await expect(page.getByTestId("universe-3d-canvas")).toHaveCount(0);
  await expect(page.getByTestId("universe-map")).toBeVisible();
});

test("panel widths support drag, keyboard, reset and reopen; settings descriptions stay on one line", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?today=2026-10-22&sample=showcase");
  await page.getByTestId("rail-universe").click();
  await page.getByTestId("u-toggle-filter").click();
  const filter = page.getByTestId("u-filter-resizer");
  await expect(filter).toBeVisible();
  const old = Number(await filter.getAttribute("aria-valuenow"));
  const b = (await filter.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + 60);
  await page.mouse.down();
  await page.mouse.move(b.x + 70, b.y + 60, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Number(await filter.getAttribute("aria-valuenow"))).toBeGreaterThan(old + 40);
  const changed = await filter.getAttribute("aria-valuenow");
  await page.getByRole("button", { name: "필터 접기", exact: true }).click();
  await page.getByTestId("u-toggle-filter").click();
  await expect(filter).toHaveAttribute("aria-valuenow", changed!);
  await page.getByTestId("u-toggle-detail").click();
  const detail = page.getByTestId("u-detail-resizer");
  const before = Number(await detail.getAttribute("aria-valuenow"));
  await detail.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(detail).toHaveAttribute("aria-valuenow", String(before + 10));
  await detail.dblclick();
  await expect(detail).toHaveAttribute("aria-valuenow", "300");
  await page.getByTestId("rail-settings").click();
  const descriptions = page
    .locator('[role="tab"] span')
    .filter({ hasText: /공간 목록|무기록 종료 제안|저장 위치 · 백업/ });
  expect(await descriptions.count()).toBeGreaterThan(0);
  const inspect = () =>
    page.locator('[class*="catDesc"]').evaluateAll((els) =>
      els.map((el) => ({
        visible: el.getBoundingClientRect().height > 0,
        nowrap: getComputedStyle(el).whiteSpace === "nowrap",
        fits: el.scrollWidth <= el.clientWidth + 1,
      })),
    );
  for (const result of await inspect()) expect(result).toEqual({ visible: true, nowrap: true, fits: true });
  await page.setViewportSize({ width: 1024, height: 768 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const result of await inspect()) expect(result).toEqual({ visible: true, nowrap: true, fits: true });
});
