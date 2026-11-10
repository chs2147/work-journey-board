// 1.24.1 핫픽스: 데일리 뷰 [기록 있는 업무만] 토글(깔때기 아이콘·툴팁)·"완료 묶음 N개 제외" 표기 제거. 가상 샘플만.
import { test, expect, type Page } from "@playwright/test";

async function openDaily(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?today=2026-10-22&sample=showcase");
  await page.getByTestId("week-title").waitFor();
  await page.keyboard.press("Alt+KeyV");
  await page.getByTestId("today-hide-empty").waitFor();
}
const cards = (page: Page) => page.locator("[data-testid^='today-card-']");

test("토글: 아이콘+툴팁, 켜면 기록 0건 업무 숨김·아래 [전체 보기], 다시 켜도 유지, 기록 없는 날 안내", async ({
  page,
}) => {
  await openDaily(page);
  const btn = page.getByTestId("today-hide-empty");
  await expect(btn).toHaveAttribute("aria-pressed", "false");
  await expect(btn).toHaveAccessibleName("기록 있는 업무만");
  await expect(btn).toHaveAttribute("title", /기록 있는 업무만 보기/);
  await expect(btn).toHaveText(""); // 글자 없이 아이콘·스위치만
  await expect(cards(page)).toHaveCount(4);
  await btn.click();
  await expect(btn).toHaveAttribute("aria-pressed", "true");
  await expect(btn).toHaveAttribute("title", /보는 중/);
  await expect(cards(page)).toHaveCount(2);
  await expect(page.getByTestId("today-card-사내 데이터 대시보드")).toHaveCount(0);
  await expect(page.getByTestId("today-hidden-bar")).toContainText("기록 없는 업무 2개를 숨겼습니다");
  // 주간 뷰를 다녀와도 유지(일지 설정 ui.todayHideEmpty)
  await page.keyboard.press("Alt+KeyV");
  await expect(page.getByTestId("today-hide-empty")).toHaveCount(0);
  await page.keyboard.press("Alt+KeyV");
  await expect(page.getByTestId("today-hide-empty")).toHaveAttribute("aria-pressed", "true");
  await expect(cards(page)).toHaveCount(2);
  // 기록 없는 날(10/25 일) → 안내 + [전체 보기]
  for (let i = 0; i < 3; i++) await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("today-date")).toContainText("10/25");
  await expect(page.getByTestId("today-none-recorded")).toBeVisible();
  await page.getByTestId("today-none-recorded").getByRole("button", { name: "전체 보기" }).click();
  await expect(page.getByTestId("today-hide-empty")).toHaveAttribute("aria-pressed", "false");
  await expect(cards(page)).toHaveCount(4);
});

test("켠 채 기록: 마지막 항목을 지워도 카드가 바로 사라지지 않고, 다른 날 다녀오면 정리", async ({
  page,
}) => {
  await openDaily(page);
  await page.getByTestId("today-hide-empty").click();
  await expect(cards(page)).toHaveCount(2);
  const card = page.getByTestId("today-card-협력사 보안 점검");
  const ta = card.locator("textarea").first();
  await ta.click();
  await ta.fill("");
  await page.keyboard.press("Backspace");
  await expect(card).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Alt+ArrowRight");
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page.getByTestId("today-date")).toContainText("10/22");
  await expect(page.getByTestId("today-card-협력사 보안 점검")).toHaveCount(0);
});

test("완료 묶음 제외 표기는 데일리 카드에 나오지 않는다", async ({ page }) => {
  await openDaily(page);
  await expect(page.getByText(/완료 묶음 \d+개 제외/)).toHaveCount(0);
});
