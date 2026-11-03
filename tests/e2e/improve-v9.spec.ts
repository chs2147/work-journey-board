import { expect, test, type Page } from "@playwright/test";

// improve-1103v9-spec — N1 C안(⋮⋮ 손잡이 = 끌면 옮기기·누르면 메뉴) · N2 시 00~23 · N3 중요 업무 "오늘" 바탕
const TODAY = "2026-10-22";
const SETTLE = "차세대 정산 시스템 구축";
const FIRST = "테스트 데이터 이관 스크립트 작성 착수";
const cell = (page: Page, cat: string, date: string) => page.getByTestId(`cell-${cat}-${date}`);

async function openBoard(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?today=${TODAY}`);
  await expect(page.locator(":focus")).toHaveValue(FIRST);
}

test("⋮⋮ 누르기 = 항목 메뉴(메모·반복·시각·옮기기·삭제), 글 오른쪽에는 겹치는 단추 없음", async ({
  page,
}) => {
  await openBoard(page);
  const row = cell(page, SETTLE, TODAY).locator("[data-item-index='0']");
  await row.hover();
  await expect(row.getByTestId("memo-row")).toHaveCount(0);
  await expect(row.getByTestId("item-more")).toHaveCount(0);
  await expect(row.getByTestId("delete-row")).toHaveCount(0);
  const grip = row.getByTestId("drag-row");
  await expect(grip).toBeVisible();
  const box = await grip.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(18); // 노션처럼 잘 보이는 크기
  expect(box!.height).toBeGreaterThanOrEqual(24);
  await grip.click();
  await expect(grip).toHaveAttribute("aria-expanded", "true");
  const menu = page.getByTestId("item-menu");
  const names = await menu.getByRole("menuitem").allTextContents();
  expect(names.join("|")).toMatch(/연결된 메모 만들기.*매주 반복 켜기.*시작 시각.*다른 날로 옮기기.*삭제/);
  // 첫 메뉴에 포커스, ↓로 다음
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem").nth(1)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
});

test("시작 시각: 시 00~23 24칸을 한 번에", async ({ page }) => {
  await openBoard(page);
  await cell(page, SETTLE, TODAY).locator("textarea").first().focus();
  await page.keyboard.press("Alt+KeyO");
  const pop = page.getByTestId("start-time-popover");
  for (const h of ["00", "06", "18", "23"])
    await expect(pop.getByRole("button", { name: h, exact: true })).toBeVisible();
  await expect(pop.getByRole("button", { name: /더 보기/ })).toHaveCount(0);
});

test("중요 업무 패널: 오늘 묶음만 다른 바탕", async ({ page }) => {
  await openBoard(page);
  await cell(page, SETTLE, TODAY).locator("textarea").first().focus();
  await page.keyboard.press("Alt+KeyI");
  await page.keyboard.press("Alt+Digit2");
  const today = page.getByTestId("important-group-today");
  await expect(today).toBeVisible();
  const bg = await today.evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(bg).not.toBe("rgba(0, 0, 0, 0)");
  const late = page.getByTestId("important-group-late");
  if (await late.count())
    expect(await late.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe(bg);
});
