// 정식 릴리스 준비 2(release-phase2-spec 1·5절): 처음 설치 = 시그니처, 이미 쓰던 사용자 = 그대로, 설정 › 정보 "만든 이".
import { expect, test } from "@playwright/test";
import { openSettings } from "./settings-helper";

test("처음 설치(설정·사본 없음)는 시그니처로 시작", async ({ page }) => {
  await page.goto("/?today=2026-10-22&fresh=1");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "signature");
});

test("이미 쓰던 일지(설정 있음·테마 미선택·화면 사본 없음)는 시스템 설정 그대로", async ({ page }) => {
  await page.goto("/?today=2026-10-22");
  await expect(page.getByTestId("category-header").first()).toBeVisible();
  // 브라우저 모드 기본 일지 = 설정이 있는 기존 사용자 흉내 → 시스템 설정(여기서는 라이트)
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("설정 › 화면: 시그니처가 맨 앞·기본 배지 · 업데이트·정보: 만든 이(M1 로고, Copyright, 브랜드 사이트는 OS 브라우저로)", async ({
  page,
}) => {
  await page.goto("/?today=2026-10-22");
  await openSettings(page, "screen");
  const names = await page
    .getByTestId("theme-settings")
    .getByRole("radio")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  expect(names).toEqual(["시그니처", "라이트", "다크", "시스템 설정"]);
  await page.locator("#settings-tab-update").click();
  const row = page.getByTestId("maker-row");
  await expect(row.getByRole("img", { name: "sanbonjini" })).toHaveAttribute("src", /m1-en-color/);
  await expect(row).toContainText("Copyright 2026 sanbonjini");
  await row.getByRole("button", { name: /브랜드 사이트/ }).click();
  expect(
    await page.evaluate(() =>
      (globalThis as unknown as { __wjb: { openedUrls(): string[] } }).__wjb.openedUrls(),
    ),
  ).toContain("https://sanbonjini.vercel.app");
});
