// V2 6-B: Connected Preview 프로필(브라우저 모드 ?profile=connected-preview)은 기존 앱 시작 흐름에 들어가지 않는다.
// 실앱에서는 Rust가 같은 값을 `app_profile`로 알려 주고, 일지·업데이트 명령 자체를 등록하지 않는다(docs/v2-design/78).
import { expect, test } from "@playwright/test";

test("Preview: 시작 화면만 — 일지(sql.js)·첫 실행·새 판 확인 없음, 외부 요청 없음", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (req) => requests.push(req.url()));
  await page.goto("/?profile=connected-preview");
  const screen = page.getByTestId("connected-preview");
  await expect(screen).toBeVisible();
  await expect(screen.getByRole("heading", { name: "Work Journey Board Connected Preview" })).toBeVisible();
  await expect(page.getByTestId("preview-updates")).toHaveText("꺼짐");
  await expect(page.getByTestId("preview-local-journal")).toHaveText("열지 않음");
  await expect(page).toHaveTitle("Work Journey Board Connected Preview");
  // 기존 앱 화면(레일·첫 실행·일지 상태)이 없다
  await page.waitForTimeout(2500); // 앱이 켜졌다면 새 판 확인(1.5초 뒤)까지 지날 시간
  await expect(page.getByTestId("rail-settings")).toHaveCount(0);
  await expect(page.getByTestId("journal-status")).toHaveCount(0);
  expect(requests.filter((u) => u.includes("sql-wasm"))).toEqual([]);
  expect(
    requests.filter((u) => !/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u) && !u.startsWith("data:")),
  ).toEqual([]);
});

test("Preview: 별도 창 주소(?win=cabinet 등)로 열어도 기존 창을 그리지 않는다", async ({ page }) => {
  await page.goto("/?profile=connected-preview&win=cabinet");
  await page.waitForTimeout(500);
  expect(await page.locator("#root").innerHTML()).toBe("");
});

test("Classic(기본): 지금처럼 앱이 뜬다", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("rail-settings")).toBeEnabled();
  await expect(page.getByTestId("connected-preview")).toHaveCount(0);
});
