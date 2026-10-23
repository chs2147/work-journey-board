// 시작 스플래시 E2E(docs/splash-spec.md). 브라우저 모드, 가상 샘플.
import { expect, test } from "@playwright/test";

const TODAY = "2026-10-22"; // 목

test("JS 번들 전에도 스플래시가 그려지고, 준비되면 사라진 뒤 오늘 칸에 커서", async ({ page }) => {
  // 앱 코드를 늦춰 HTML·CSS만으로 그린 첫 장면을 확인한다.
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/src/main.tsx", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(`/?today=${TODAY}`, { waitUntil: "commit" });
  const splash = page.locator("#splash");
  await expect(splash).toBeVisible();
  await expect(splash).toContainText("Work Journey Board");
  await expect(splash).toContainText("오늘 한 일을, 한 줄씩");
  await expect(page.locator("#splash .splash-ver")).toHaveText(/^v\d+\.\d+\.\d+$/);

  release();
  await expect(splash).toHaveCount(0);
  await expect(page.locator(":focus")).toHaveValue("테스트 데이터 이관 스크립트 작성 착수");
});

test("준비가 3초를 넘기면 진행 문구가 보인다", async ({ page }) => {
  // DB 엔진(wasm) 도착을 늦춰 '일지 여는 중'을 길게 만든다.
  await page.route(/sql-wasm\.wasm$/, async (route) => {
    await new Promise((r) => setTimeout(r, 3500));
    await route.continue();
  });
  await page.goto(`/?today=${TODAY}`);
  await expect(page.locator("#splash .splash-day.today")).toHaveText(/목/); // 오늘 요일 카드 강조
  await expect(page.locator("#splash-msg")).toHaveText("일지를 여는 중…", { timeout: 5000 });
  await expect(page.locator("#splash")).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId("week-title")).toHaveText("2026-W43 (10/19~10/25)");
});

test("첫 실행 화면에서도 스플래시가 걷힌다", async ({ page }) => {
  await page.goto(`/?today=${TODAY}&fresh=1`);
  await expect(page.locator("#splash")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "새로 시작하기" })).toBeVisible();
});

test("움직임 줄이기 설정이면 애니메이션 없이 보인다", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/src/main.tsx", () => undefined); // 앱 코드를 끝내 보내지 않아 스플래시를 붙잡는다
  await page.goto(`/?today=${TODAY}`, { waitUntil: "commit" });
  const line = page.locator("#splash .splash-card i").first();
  await expect(line).toBeVisible();
  expect(await line.evaluate((e) => getComputedStyle(e).animationName)).toBe("none");
});
