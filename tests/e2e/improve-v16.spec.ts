import { seedV16, openCopyV16 } from "./v16-helper";
import { expect, test, type Page } from "@playwright/test";

async function start(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/?today=2026-10-22&sample=showcase");
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
}
test("parent copy dialog preserves references across weeks, badge opens original memo, undo is atomic", async ({
  page,
}) => {
  await start(page);
  await seedV16(page);
  const dialog = await openCopyV16(page);
  await expect(dialog).toContainText("항목 2개 · 메모 연결 2개 · Cabi.NET 연결 1개");
  await dialog.getByLabel("복제할 날짜").fill("2026-10-29");
  await expect(dialog).toContainText("원래 마감일 이후");
  await dialog.getByRole("button", { name: "복제", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("10/29 (목)에 항목 2개를 복제했습니다.")).toBeVisible();
  await page.getByRole("button", { name: "그 날로 가기", exact: true }).click();
  await expect(page.getByTestId("week-title")).toContainText("2026-W44");
  const copied = page
    .locator("[data-item-index]")
    .filter({ has: page.locator("textarea", { hasText: "v16 원본 본문" }) });
  await expect(copied.getByTestId("memo-badge")).toHaveAttribute("title", /원본 주차 2026-W43/);
  await copied.getByTestId("memo-badge").click();
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
  await expect(page.locator('[data-box-id="v16-memo"]')).toBeVisible();
  await expect(page.locator('[data-box-id="v16-memo"] [data-testid="link-strip"]')).toHaveAttribute(
    "data-count",
    "4",
  );
  await page.getByTestId("rail-board").focus();
  await page.keyboard.press("Control+z");
  await expect(page.locator('[data-box-id="v16-memo"] [data-testid="link-strip"]')).toHaveAttribute(
    "data-count",
    "2",
  );
  await page.keyboard.press("Control+Shift+z");
  await expect(page.locator('[data-box-id="v16-memo"] [data-testid="link-strip"]')).toHaveAttribute(
    "data-count",
    "4",
  );
});

test("Activity name resizing flexes all heat cells without record counts or horizontal scrollbars", async ({
  page,
}) => {
  await start(page);
  await page.getByTestId("rail-insights").click();
  await page.getByTestId("insight-tab-overview").click();
  const heat = page.getByTestId("activity-heatmap");
  const handle = page.getByTestId("activity-width-resizer");
  await expect(handle).toBeVisible();
  const before = await heat.getByRole("gridcell").first().boundingBox();
  await handle.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  expect(Number(await handle.getAttribute("aria-valuenow"))).toBe(260);
  const after = await heat.getByRole("gridcell").first().boundingBox();
  expect(after!.width).toBeLessThan(before!.width);
  await expect(heat.getByTestId("heat-days")).toHaveCount(0);
  await expect(heat.getByText("기록 일수", { exact: true })).toHaveCount(0);
  const overflow = () => heat.locator('[class*="heatScroll"]').evaluate((e) => e.scrollWidth - e.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 950, height: 900 });
  expect(await overflow()).toBeLessThanOrEqual(1);
  await handle.press("Home");
  await expect(handle).toHaveAttribute("aria-valuenow", "196");
});

test("timeline list width is keyboard adjustable, persistent and independent of Activity", async ({
  page,
}) => {
  await start(page);
  await page.getByTestId("rail-insights").click();
  const handle = page.getByTestId("timeline-width-resizer");
  await handle.focus();
  await page.keyboard.press("ArrowRight");
  await expect(handle).toHaveAttribute("aria-valuenow", "288");
  await page.getByTestId("rail-board").click();
  await page.getByTestId("rail-insights").click();
  await expect(handle).toHaveAttribute("aria-valuenow", "288");
  await page.getByTestId("insight-tab-overview").click();
  await expect(page.getByTestId("activity-width-resizer")).toHaveAttribute("aria-valuenow", "196");
});

test("daily child copy becomes a standalone root on the same day and keeps its memo link", async ({
  page,
}) => {
  await start(page);
  await seedV16(page);
  await page.getByRole("button", { name: /데일리 뷰/ }).click();
  const dialog = await openCopyV16(page, "v16 하위 본문");
  await expect(dialog).toContainText("하위 항목 하나를 독립 본 항목");
  await dialog.getByLabel("복제할 날짜").fill("2026-10-22");
  await expect(dialog).toContainText("같은 날짜의 기존 항목 끝");
  await dialog.getByRole("button", { name: "복제", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const rows = page
    .locator("[data-item-index]")
    .filter({ has: page.locator("textarea", { hasText: "v16 하위 본문" }) });
  await expect(rows).toHaveCount(2);
  await expect(rows.last()).not.toHaveClass(/itemSub/);
  await expect(rows.last().getByTestId("memo-badge")).toBeVisible();
});

test("previous import adds shared links on the target date and one undo removes those additions", async ({
  page,
}) => {
  await start(page);
  await seedV16(page);
  // Select Friday's blank task cell and invoke the existing previous-record shortcut.
  const target = page.getByTestId("cell-v16 가상 업무-2026-10-23");
  await target.locator("[data-cell-editor]").click({ position: { x: 8, y: 8 } });
  await page.keyboard.press("Alt+p");
  await expect(page.locator("textarea").filter({ hasText: "v16 원본 본문" })).toHaveCount(2);
  await expect(target.getByTestId("memo-badge")).toHaveCount(2);
  await expect(target.getByTestId("cabinet-badge")).toHaveCount(1);
  await page.getByTestId("rail-board").focus();
  await page.keyboard.press("Control+z");
  await expect(page.locator("textarea").filter({ hasText: "v16 원본 본문" })).toHaveCount(1);
});
