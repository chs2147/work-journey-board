// macOS 판(macos-spec 3-2): 브라우저 모드 ?os=mac = 맥 표기(⌘·⌥·Finder). 동작은 같고 표기만 바뀐다. 가상 샘플만.
import { expect, test, type Page } from "@playwright/test";

async function open(page: Page, os: "" | "&os=mac") {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?today=2026-10-22&sample=showcase${os}`);
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
}

test("맥 표기: 레일·검색 상자는 ⌥·⇧⌘, 윈도우는 Alt·Ctrl 그대로", async ({ page }) => {
  await open(page, "&os=mac");
  await expect(page.getByRole("button", { name: "주간 보드 (⌥1)" })).toBeVisible();
  await expect(page.getByLabel("업무 기록·메모 검색 (⇧⌘F)")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Ctrl+");

  await open(page, "");
  await expect(page.getByRole("button", { name: "주간 보드 (Alt+1)" })).toBeVisible();
  await expect(page.getByLabel("업무 기록·메모 검색 (Ctrl+Shift+F)")).toBeVisible();
});

test("맥 표기여도 단축키 동작은 같다: ⌘⇧F 검색, ⌥→ 다음 주", async ({ page }) => {
  await open(page, "&os=mac");
  await page.keyboard.press("Meta+Shift+KeyF");
  await expect(page.getByLabel("업무 기록·메모 검색 (⇧⌘F)")).toBeFocused();
  await page.keyboard.press("Escape");
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("week-title")).toContainText("2026-W44");
});
