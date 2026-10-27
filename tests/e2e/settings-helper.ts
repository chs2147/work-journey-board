// 설정 화면 열기(improve-1027v5-spec 1절): 레일 맨 아래 ⚙ → 보드 자리의 설정 화면 → 분류 탭.
import { expect, type Page } from "@playwright/test";

export type SettingsCat = "screen" | "data" | "import" | "work" | "update";

export const settingsView = (page: Page) => page.getByTestId("settings-view");

export async function openSettings(page: Page, cat?: SettingsCat) {
  await page.getByTestId("rail-settings").click();
  await expect(settingsView(page)).toBeVisible();
  if (cat) {
    await page.locator(`#settings-tab-${cat}`).click();
    await expect(page.getByTestId(`settings-cat-${cat}`)).toBeVisible();
  }
}
