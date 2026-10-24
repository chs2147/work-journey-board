// 중요 표시 · 중요 업무 패널 · 왼쪽 레일(important-repeat-spec 1·2절). 브라우저 모드, 오늘 = 2026-10-22(목), 가상 샘플.
import { expect, test, type Page } from "@playwright/test";

const TODAY = "2026-10-22";
const SETTLE = "차세대 정산 시스템 구축";
const SEC = "협력사 보안 점검";
const FIRST = "테스트 데이터 이관 스크립트 작성 착수"; // 오늘 SETTLE 칸 첫 항목(시작 시 커서)

const cell = (page: Page, cat: string, date: string) => page.getByTestId(`cell-${cat}-${date}`);
const panel = (page: Page) => page.getByTestId("important-panel");
const rows = (page: Page) => page.getByTestId("important-row");
const badge = (page: Page) => page.getByTestId("important-badge");
const flagged = (page: Page) => page.locator('[data-flagged="true"]');

test.beforeEach(async ({ page }) => {
  await page.goto(`/?today=${TODAY}`);
  await expect(page.locator(":focus")).toHaveValue(FIRST);
});

test("0건: 시작할 때 패널은 닫혀 있고 배지가 없다 — 열면 안내 문구", async ({ page }) => {
  await expect(panel(page)).toHaveCount(0);
  await expect(badge(page)).toHaveCount(0);
  await page.getByTestId("rail-important").click();
  await expect(panel(page)).toBeVisible();
  await expect(page.getByTestId("important-empty")).toContainText("챙길 중요 업무가 없습니다");
});

test("Alt+I로 중요 표시 → 형광펜·★, 배지 1, 목록 '오늘'에 모인다 · Ctrl+Z로 되돌림", async ({ page }) => {
  await page.keyboard.press("Alt+KeyI");
  await expect(flagged(page)).toHaveCount(1);
  await expect(flagged(page).locator("textarea")).toHaveValue(FIRST);
  await expect(page.locator(":focus")).toHaveValue(FIRST); // 커서는 그대로
  await expect(badge(page)).toHaveText("1");
  await page.keyboard.press("Alt+Digit2");
  await expect(panel(page).getByRole("region", { name: "오늘" })).toContainText(FIRST);
  // 보드에서 켠 표시는 실행 취소 기록에 들어간다
  await page.keyboard.press("Control+KeyZ");
  await expect(flagged(page)).toHaveCount(0);
  await expect(badge(page)).toHaveCount(0);
});

test("부호(☆)를 눌러 표시 — 지난 날짜 묶음과 레일의 빨간 점", async ({ page }) => {
  const item = cell(page, SEC, "2026-10-21").locator('[class*="item_"]').first();
  await item.hover();
  await item.getByRole("button", { name: "중요 표시 (Alt+I)" }).click();
  await expect(item).toHaveAttribute("data-flagged", "true");
  await expect(page.getByTestId("important-late")).toBeVisible();
  await page.getByTestId("rail-important").click();
  await expect(panel(page).getByRole("region", { name: "지난 날짜" })).toContainText("지남");
});

test("목록에서 처리 완료 → 보드 강조 해제, 되돌리기, 모두 처리하면 '모두 챙겼습니다' + 최근 완료", async ({
  page,
}) => {
  await page.keyboard.press("Alt+KeyI");
  await page.getByTestId("rail-important").click();
  await panel(page)
    .getByRole("button", { name: `처리 완료: ${FIRST}` })
    .click();
  await expect(flagged(page)).toHaveCount(0);
  await expect(page.getByText("처리 완료 — 강조를 해제했습니다")).toBeVisible();
  await page.getByRole("button", { name: "되돌리기" }).first().click();
  await expect(flagged(page)).toHaveCount(1);
  await expect(rows(page)).toHaveCount(1);

  await panel(page)
    .getByRole("button", { name: `처리 완료: ${FIRST}` })
    .click();
  await expect(page.getByTestId("important-empty")).toContainText("모두 챙겼습니다");
  await panel(page).getByText("최근 완료 1 · 7일간 보관").click();
  await panel(page)
    .getByRole("button", { name: `되돌리기: ${FIRST}` })
    .click();
  await expect(rows(page)).toHaveCount(1);
  await expect(flagged(page)).toHaveCount(1);
});

test("목록 항목을 누르면 그 주·그 칸으로 가서 그 항목에 커서", async ({ page }) => {
  await page.keyboard.press("Alt+KeyI");
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("week-title")).toContainText("2026-W44");
  await page.getByTestId("rail-important").click();
  await rows(page).first().click();
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
  await expect(page.locator(":focus")).toHaveValue(FIRST);
});

test("Alt+2로 목록에 포커스 → ↓ 이동, Space 처리 완료, Esc는 보드로", async ({ page }) => {
  await page.keyboard.press("Alt+KeyI");
  const second = cell(page, SEC, TODAY).locator("textarea").first();
  await second.focus();
  await page.keyboard.press("Alt+KeyI");
  await expect(badge(page)).toHaveText("2");
  await page.keyboard.press("Alt+Digit2");
  await expect(rows(page).first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(rows(page).nth(1)).toBeFocused();
  await page.keyboard.press("Space");
  await expect(rows(page)).toHaveCount(1);
  await expect(badge(page)).toHaveText("1");
  await page.keyboard.press("Escape");
  await expect(page.locator(":focus")).toHaveValue(FIRST);
  await page.keyboard.press("Alt+Digit2");
  await expect(panel(page)).toHaveCount(0);
});

test("좁은 창에서는 패널이 보드 위에 겹쳐 뜨고, 보드를 누르면 닫힌다", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.getByTestId("rail-important").click();
  await expect(panel(page)).toBeVisible();
  expect(await panel(page).evaluate((e) => getComputedStyle(e).position)).toBe("absolute");
  await cell(page, SETTLE, "2026-10-23").click({ position: { x: 100, y: 90 } });
  await expect(panel(page)).toHaveCount(0);
});
