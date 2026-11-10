// 1.24.3 핫픽스: 메모 보드 크게 보기에서도 왼쪽 도구 팔레트는 메모 도크 왼쪽에(중요 업무 패널 열림/닫힘 · 주간/데일리). 가상 샘플만.
import { test, expect, type Page } from "@playwright/test";

async function expectPaletteInDock(page: Page) {
  const dock = page.getByTestId("note-dock");
  await dock.getByRole("button", { name: "크게 보기" }).click();
  await expect(
    page.getByTestId("board-grid").or(page.locator("[data-testid^='today-card-']").first()),
  ).toBeHidden();
  const d = (await dock.boundingBox())!;
  const p = (await dock.locator("[class*='palette']").first().boundingBox())!;
  expect(Math.abs(p.x - d.x)).toBeLessThan(1);
  expect(p.y).toBeGreaterThanOrEqual(d.y);
  // 레일(대메뉴)을 가리지 않는다
  const rail = (await page.getByTestId("rail-important").boundingBox())!;
  expect(p.x).toBeGreaterThan(rail.x + rail.width);
  await page.keyboard.press("Escape");
}

for (const view of ["week", "day"] as const) {
  for (const panelOpen of [true, false]) {
    test(`크게 보기 팔레트 위치 — ${view === "week" ? "주간" : "데일리"} 뷰, 중요 업무 패널 ${panelOpen ? "열림" : "닫힘"}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/?today=2026-10-22&sample=showcase");
      await page.getByTestId("week-title").waitFor();
      if (view === "day") await page.keyboard.press("Alt+KeyV");
      const panel = page.getByTestId("important-panel");
      if ((await panel.isVisible()) !== panelOpen) await page.getByTestId("rail-important").click();
      await expect(panel).toBeVisible({ visible: panelOpen });
      await expectPaletteInDock(page);
    });
  }
}
