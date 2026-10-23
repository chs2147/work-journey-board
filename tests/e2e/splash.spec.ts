// 시작 스플래시 창(splash.html, docs/splash-spec.md)을 실제 창 크기(560×340)로 열어 본다. 브라우저 모드.
// 창 2개 연출(메인 숨김 → 스플래시 닫고 메인 보이기)은 Tauri에서만 동작하므로 회사 PC 확인표로 본다.
import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 560, height: 340 } });

test("스플래시 창: 이름·소개·버전·시작 문구, 오늘 요일 강조, 창 안에 다 들어감", async ({ page }) => {
  await page.goto("/splash.html?today=2026-10-22"); // 목
  await expect(page.getByRole("heading", { name: "Work Journey Board" })).toBeVisible();
  await expect(page.getByText("오늘 한 일을, 한 줄씩")).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("시작하는 중…");
  await expect(page.locator(".ver")).toHaveText(/^v\d+\.\d+\.\d+$/);
  await expect(page.locator(".day.today")).toHaveText(/목/);
  const size = await page.evaluate(() => ({
    w: document.documentElement.scrollWidth,
    h: document.documentElement.scrollHeight,
  }));
  expect(size).toEqual({ w: 560, h: 340 });
});

test("움직임 줄이기 설정이면 애니메이션 없이 보인다", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/splash.html");
  const line = page.locator(".card i").first();
  await expect(line).toBeVisible();
  expect(await line.evaluate((e) => getComputedStyle(e).animationName)).toBe("none");
});

test("브라우저 모드의 앱 화면에는 스플래시가 없고 바로 보드", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/?today=2026-10-22");
  await expect(page.locator(":focus")).toHaveValue("테스트 데이터 이관 스크립트 작성 착수");
});
