// 검색 E2E(features-1102-spec F1): Ctrl+Shift+F·결과 꼬리표·거르기·기간·바로가기(칸·메모 상자·주 넘김)·F3 이동·
// 패널을 닫아도 띠 유지·[검색 초기화]·주간 요약과 자리 바꾸기·데일리 뷰. 브라우저 모드, 오늘 = 2026-10-29(목, W44), 가상 샘플만.
import { expect, test, type Page } from "@playwright/test";

async function open(page: Page) {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/?today=2026-10-29&sample=showcase");
  await expect(page.getByTestId("week-title")).toContainText("2026-W44");
}

async function search(page: Page, q: string) {
  await page.keyboard.press("Control+Shift+KeyF");
  const input = page.getByTestId("search-input");
  await expect(input).toBeFocused();
  await input.fill(q);
  await expect(page.getByTestId("search-band")).toBeVisible();
}

test("찾기 → 꼬리표·주 묶음·거르기 → Enter/F3로 주를 넘어 이동 → 메모 상자로 → 패널 닫아도 띠 유지 → 초기화", async ({
  page,
}) => {
  await open(page);
  await search(page, "배치");
  const panel = page.getByTestId("search-panel");
  await expect(panel).toContainText("‘배치’ · 8건");
  const hits = page.getByTestId("search-results").locator("[data-hit-index]");
  await expect(hits).toHaveCount(8);
  await expect(page.getByTestId("search-results")).toContainText("2026-W43 (10/19~10/25)");
  await expect(page.getByTestId("search-results")).toContainText("2026-W42 (10/12~10/18)");
  await expect(hits.nth(0)).toContainText("업무 기록");
  await expect(page.locator('[data-hit-kind="subitem"]')).toContainText("업무 기록 · 세부");
  await expect(page.locator('[data-hit-kind="text"]')).toContainText("메모 · 글 상자");
  await expect(page.locator('[data-hit-kind="image"]')).toContainText("메모 · 이미지 설명");
  await expect(page.locator('[data-hit-kind="link"]')).toContainText("메모 · 링크 카드");
  await expect(hits.nth(0).locator("mark")).toHaveText("배치");

  // 거르기
  await panel.getByRole("button", { name: "메모 보드 3" }).click();
  await expect(hits).toHaveCount(3);
  await panel.getByRole("button", { name: "전체 8" }).click();

  // Enter = 첫 결과(W43 월 업무 기록) → 그 주로·그 항목에 커서·강조
  await page.getByTestId("search-input").press("Enter");
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
  await expect(page.getByTestId("search-position")).toHaveText("1 / 8");
  const cur = page.locator("[data-search-current]");
  await expect(cur).toHaveCount(1);
  await expect(cur).toHaveAttribute("data-item-id", /.+/);
  await expect(page.locator("[data-search-hit]")).not.toHaveCount(0);

  // 메모 결과 → 메모 상자 선택·강조
  await page.locator('[data-hit-kind="image"]').click();
  await expect(page.getByTestId("search-position")).toHaveText("5 / 8");
  await expect(page.locator('[data-box-id="box-flow"][data-search-current]')).toHaveCount(1);

  // 패널 닫기(Esc) → 띠는 남고 F3로 계속(W42로 넘어감)
  await page.getByTestId("search-panel").getByRole("button", { name: "검색 패널 닫기" }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId("search-band")).toBeVisible();
  await page.keyboard.press("F3");
  await page.keyboard.press("F3");
  await page.keyboard.press("F3");
  await expect(page.getByTestId("search-position")).toHaveText("8 / 8");
  await expect(page.getByTestId("week-title")).toContainText("2026-W42");
  await page.keyboard.press("F3"); // 끝 → 처음
  await expect(page.getByTestId("search-position")).toHaveText("1 / 8");
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
  await page.keyboard.press("Shift+F3");
  await expect(page.getByTestId("search-position")).toHaveText("8 / 8");
  // 띠 [결과 목록]으로 패널 다시
  await page.getByTestId("search-band").getByRole("button", { name: "결과 목록" }).click();
  await expect(panel).toBeVisible();

  // 초기화 → 띠·강조·결과 모두 사라짐
  await page.getByTestId("search-reset").click();
  await expect(page.getByTestId("search-band")).toHaveCount(0);
  await expect(page.locator("[data-search-hit], [data-search-current]")).toHaveCount(0);
  await expect(page.getByTestId("search-input")).toHaveValue("");
});

test("관계선 이름표·링크 주소 · 기간(최근 12주·올해) · 없는 낱말 · 2글자 미만 안내", async ({ page }) => {
  await open(page);
  await search(page, "후속");
  await expect(page.locator('[data-hit-kind="edge"]')).toContainText("메모 · 관계선");
  await page.getByTestId("search-input").fill("batch-design");
  await expect(page.locator('[data-hit-kind="link"]')).toHaveCount(1);
  await page.getByTestId("search-input").fill("없는가상낱말");
  await expect(page.getByTestId("search-results")).toContainText("찾은 결과가 없습니다");
  await page.getByTestId("search-input").fill("배");
  await expect(page.getByTestId("search-results")).toContainText("2글자 이상 입력하면");
  await page.getByTestId("search-input").fill("배치");
  await expect(page.getByTestId("search-panel")).toContainText("8건");
  await page.getByRole("combobox", { name: "검색 기간" }).selectOption("12w");
  await expect(page.getByTestId("search-panel")).toContainText("8건"); // 샘플은 모두 최근 12주 안
});

test("주간 요약을 열면 검색 패널은 닫히고(띠 유지), Ctrl+Shift+F로 다시 · 데일리 뷰에서도 결과로 이동", async ({
  page,
}) => {
  await open(page);
  await search(page, "배치");
  await page.getByTestId("summary-toggle").click();
  await expect(page.getByTestId("summary-panel")).toBeVisible();
  await expect(page.getByTestId("search-panel")).toHaveCount(0);
  await expect(page.getByTestId("search-band")).toBeVisible();
  await page.keyboard.press("Control+Shift+KeyF");
  await expect(page.getByTestId("search-panel")).toBeVisible();
  await expect(page.getByTestId("summary-panel")).toHaveCount(0);

  await page.getByTestId("view-today").click();
  await page.locator('[data-hit-kind="subitem"]').click();
  await expect(page.getByTestId("today-date")).toHaveText("10/20(화)");
  await expect(page.locator("[data-search-current]")).toHaveCount(1);
});
