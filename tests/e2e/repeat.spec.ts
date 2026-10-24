// 매주 반복(important-repeat-spec 3절). 브라우저 모드, 오늘 = 2026-10-22(목, W43), 가상 샘플.
// "새 주가 되면 자동으로 들어옴"은 저장소 단위 테스트(materializeWeek)로, 여기서는 화면 흐름을 본다.
import { expect, test, type Page } from "@playwright/test";

const TODAY = "2026-10-22";
const SETTLE = "차세대 정산 시스템 구축";
const SEC = "협력사 보안 점검";
const FIRST = "테스트 데이터 이관 스크립트 작성 착수"; // 오늘 SETTLE 칸 첫 항목(시작 시 커서)

const cell = (page: Page, cat: string, date: string) => page.getByTestId(`cell-${cat}-${date}`);
const repeating = (page: Page) => page.locator('[data-repeating="true"]');
const previews = (page: Page) => page.getByTestId("repeat-preview");

test.beforeEach(async ({ page }) => {
  await page.goto(`/?today=${TODAY}`);
  await expect(page.locator(":focus")).toHaveValue(FIRST);
});

test("Alt+R로 켜기 → ↻ 표시, 다음 주에 '예정' → 누르면 그 주에 만들고 커서", async ({ page }) => {
  await page.keyboard.press("Alt+KeyR");
  await expect(page.getByText("↻ 매주 반복 — 다음 주부터 목요일에 들어옵니다")).toBeVisible();
  await expect(repeating(page)).toHaveCount(1);
  await expect(page.locator(":focus")).toHaveValue(FIRST); // 커서는 그대로

  await page.keyboard.press("Alt+ArrowRight");
  const next = cell(page, SETTLE, "2026-10-29");
  await expect(next.getByTestId("repeat-preview")).toContainText(FIRST);
  await expect(next.getByTestId("repeat-preview")).toContainText("이 주가 시작되면 자동으로 들어옵니다");
  await next.getByTestId("repeat-preview").click();
  await expect(previews(page)).toHaveCount(0);
  await expect(next.locator("textarea")).toHaveValue(FIRST);
  await expect(page.locator(":focus")).toHaveValue(FIRST);
  await expect(next.locator('[data-repeating="true"]')).toHaveCount(1);
});

test("켠 주에 바로 끄면 다음 주 '예정'도 사라지고, 토스트로 되돌린다", async ({ page }) => {
  await page.keyboard.press("Alt+KeyR");
  await expect(repeating(page)).toHaveCount(1);
  await page.keyboard.press("Alt+KeyR");
  await expect(page.getByText("반복을 껐습니다", { exact: false })).toBeVisible();
  await expect(repeating(page)).toHaveCount(0);
  await page.getByRole("button", { name: "되돌리기" }).last().click();
  await expect(repeating(page)).toHaveCount(1);
  await page.keyboard.press("Alt+ArrowRight");
  await expect(previews(page)).toHaveCount(1);
});

test("세부 항목에서 켜도 본 항목 묶음째 반복된다", async ({ page }) => {
  await cell(page, SETTLE, "2026-10-19").locator('[class*="itemSub"] textarea').first().focus();
  await page.keyboard.press("Alt+KeyR");
  await expect(page.getByText("다음 주부터 월요일에 들어옵니다", { exact: false })).toBeVisible();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(cell(page, SETTLE, "2026-10-26").getByTestId("repeat-preview")).toContainText("세부 1개");
});

test("마우스로 ↻ 켜기 → 설정 > 반복 항목에 보이고, 중지하면 다음 주 '예정'이 사라진다", async ({ page }) => {
  const item = cell(page, SEC, "2026-10-21").locator('[class*="item_"]').first();
  await item.hover();
  await item.getByRole("button", { name: "매주 반복 (Alt+R)" }).click();
  await expect(page.getByText("다음 주부터 수요일에 들어옵니다", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "설정" }).click();
  const list = page.getByTestId("repeat-list");
  await expect(list).toContainText("수");
  await expect(list).toContainText(SEC);
  await expect(list).toContainText("2026-W44부터 반복 중");
  await list.getByRole("button", { name: "중지" }).click();
  await expect(list).toContainText("중지됨(2026-W43까지)");
  await page.keyboard.press("Escape");

  await expect(repeating(page)).toHaveCount(0);
  await page.keyboard.press("Alt+ArrowRight");
  await expect(previews(page)).toHaveCount(0);
});
