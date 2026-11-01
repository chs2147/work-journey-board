// 앱 안 복원·백업 보강(optimize-1031-plan O4·O5, data-spec 7-3) — 브라우저 모드 가짜 폴더.
import { expect, test, type Page } from "@playwright/test";
import { openSettings } from "./settings-helper";

const saved = (page: Page) =>
  expect(page.locator('[data-testid="save-state"][data-idle="true"]')).toHaveText("저장됨");
/** 보드 칸(textarea)에 그 글이 있는가 */
const hasItem = (page: Page, text: string) =>
  page.evaluate(
    (t) => [...document.querySelectorAll("textarea")].some((e) => (e as HTMLTextAreaElement).value === t),
    text,
  );
const files = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as { __wjb: { files(): string[] } }).__wjb.files());

test("파일이 깨졌으면: 데이터 파일 문제 화면 → 백업 고르기(검사·요약) → 복원 → 보드, 깨진 파일은 _before-restore로 보관", async ({
  page,
}) => {
  await page.goto("/?today=2026-10-22&corrupt=1");
  await expect(page.getByRole("heading", { name: "데이터 파일에 문제가 있습니다" })).toBeVisible();
  const items = page.getByTestId("restore-item");
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText("2026-10-21");
  await items.first().click();
  await expect(page.getByTestId("restore-detail")).toContainText("업무 4개");
  await page.getByRole("button", { name: "이 사본으로 복원" }).click();
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
  await expect(page.getByTestId("category-header")).toHaveCount(4);
  await expect(page.getByText(/백업\(work-journey_2026-10-21\.db\)에서 복원했습니다/)).toBeVisible();
  expect(
    (await files(page)).some((f) => /backups\/work-journey_2026-10-22_\d{4}_before-restore\.db$/.test(f)),
  ).toBe(true);
});

test("설정 › 데이터·백업: [지금 백업] 뒤에 쓴 기록이 [백업에서 복원…]으로 사라지고, [되돌리기]로 돌아온다 · 백업 용량 표시", async ({
  page,
}) => {
  await page.goto("/?today=2026-10-22");
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
  await openSettings(page, "data");
  await page.getByRole("button", { name: "지금 백업" }).click();
  await expect(page.getByTestId("backup-usage")).toContainText("백업 폴더");
  await page.keyboard.press("Escape");
  // 오늘 칸에 기록 한 줄
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("복원 시험 가상 항목");
  await saved(page);
  expect(await hasItem(page, "복원 시험 가상 항목")).toBe(true);

  await openSettings(page, "data");
  await page.getByTestId("restore-open").click();
  const manual = page.getByTestId("restore-item").filter({ hasText: "수동" });
  await manual.first().click();
  await expect(page.getByTestId("restore-detail")).toContainText("업무");
  await page.getByRole("button", { name: "이 사본으로 복원" }).click();
  await expect(page.getByTestId("settings-view")).toHaveCount(0);
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
  await expect.poll(() => hasItem(page, "복원 시험 가상 항목")).toBe(false);
  await page.getByRole("button", { name: "되돌리기" }).click();
  await expect.poll(() => hasItem(page, "복원 시험 가상 항목")).toBe(true);
});
