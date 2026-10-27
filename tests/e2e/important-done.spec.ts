// 중요 업무 처리 완료 E2E(improve-1027v4-spec 2~4절): 보드 완료 뱃지 · 완료 창(되돌리기·Esc·Alt+I) · 메모 띠 줄 ✓ · 상자 ✓ ·
// 패널 "이 주 완료"(보고 있는 주에 처리한 것만, 주를 바꾸면 따라 바뀜). 브라우저 모드, 가상 샘플만. 오늘 = 2026-10-22(목).
import { expect, test, type Locator, type Page } from "@playwright/test";

const TODAY = "2026-10-22";
const SETTLE = "차세대 정산 시스템 구축";
const SEC = "협력사 보안 점검";
const FIRST = "테스트 데이터 이관 스크립트 작성 착수";

const cell = (page: Page, cat: string, date: string) => page.getByTestId(`cell-${cat}-${date}`);
const rowOf = (page: Page, cat: string) => cell(page, cat, TODAY).locator("[data-item-index]").first();
const panel = (page: Page) => page.getByTestId("important-panel");
const weekDone = (page: Page) => page.getByTestId("week-done");

/** 지금 커서 항목을 중요로 켜고(Alt+I) 패널에서 처리 완료 */
async function flagAndComplete(page: Page, text: string) {
  await page.keyboard.press("Alt+KeyI");
  if (!(await panel(page).isVisible())) await page.getByTestId("rail-important").click();
  await panel(page)
    .getByRole("button", { name: `처리 완료: ${text}` })
    .click();
}

async function makeBox(page: Page, text: string) {
  const c = (await page.getByTestId("note-canvas").boundingBox())!;
  await page.mouse.click(c.x + 640, c.y + 40);
  await expect(page.locator(":focus")).toHaveClass(/note-prose/);
  await page.keyboard.type(text);
  await page.keyboard.press("Escape");
  return page.locator("[data-box-id]", { has: page.locator(".note-prose", { hasText: text }) });
}

async function dragRowOnto(page: Page, row: Locator, box: Locator) {
  await row.hover();
  const h = (await row.getByTestId("drag-row").boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + 8, h.y + 8, { steps: 2 });
  const b = (await box.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?today=${TODAY}`);
  await expect(page.locator(":focus")).toHaveValue(FIRST);
});

test("처리 완료 → 보드에 초록 완료 뱃지(노란 강조 없음) · 이 주 완료에 처리한 날로 · 뱃지 창 [되돌리기] → 다시 중요", async ({
  page,
}) => {
  await flagAndComplete(page, FIRST);
  const row = rowOf(page, SETTLE);
  const badge = row.getByTestId("done-badge");
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute("aria-label", /^중요 업무 처리 완료, \d\d\/\d\d \(.\)$/);
  await expect(row).not.toHaveAttribute("data-flagged", "true");

  await expect(weekDone(page).locator("summary")).toContainText("이 주 완료 · 2026-W43 (10/19~10/25)");
  await expect(weekDone(page).getByTestId("week-done-row")).toHaveCount(1);
  await expect(weekDone(page).getByTestId("week-done-row")).toContainText(FIRST);
  await expect(weekDone(page)).toContainText(/\d\d\/\d\d \(.\) 처리/);

  await badge.click();
  const pop = page.getByTestId("done-popover");
  await expect(pop).toContainText("중요 업무 처리 완료");
  await expect(pop.getByRole("button", { name: "되돌리기 — 다시 중요 업무로" })).toBeFocused();
  await pop.getByRole("button", { name: "되돌리기 — 다시 중요 업무로" }).click();
  await expect(row).toHaveAttribute("data-flagged", "true");
  await expect(row.getByTestId("done-badge")).toHaveCount(0);
  await expect(weekDone(page)).toContainText("이 주에 처리한 중요 업무가 없습니다.");
});

test("완료 항목에서 Alt+I = 완료 창(바로 되돌리지 않음) · Esc로 닫으면 커서는 그 항목", async ({ page }) => {
  await flagAndComplete(page, FIRST);
  await rowOf(page, SETTLE).locator("textarea").first().click();
  await page.keyboard.press("Alt+KeyI");
  const pop = page.getByTestId("done-popover");
  await expect(pop).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pop).toHaveCount(0);
  await expect(page.locator(":focus")).toHaveValue(FIRST);
  await expect(rowOf(page, SETTLE).getByTestId("done-badge")).toBeVisible();
});

test("주를 바꾸면 '이 주 완료'도 그 주 것만 — 다음 주는 0개, 돌아오면 다시", async ({ page }) => {
  await flagAndComplete(page, FIRST);
  await expect(weekDone(page).getByTestId("week-done-row")).toHaveCount(1);
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("week-title")).toContainText("2026-W44");
  await expect(weekDone(page).locator("summary")).toContainText("2026-W44");
  await expect(weekDone(page)).toContainText("이 주에 처리한 중요 업무가 없습니다.");
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(weekDone(page).getByTestId("week-done-row")).toHaveCount(1);
  // 접으면 다음에도 접힌 채
  await weekDone(page).locator("summary").click();
  await expect(weekDone(page)).not.toHaveAttribute("open", "");
});

test("연결된 메모: 처리 완료한 항목 줄에 ✓, 연결한 중요 업무가 모두 끝나야 상자 오른쪽 위 ✓", async ({
  page,
}) => {
  await expect(page.getByTestId("note-box").first()).toBeVisible();
  const box = await makeBox(page, "가상 완료 메모");
  await dragRowOnto(page, rowOf(page, SETTLE), box);
  await dragRowOnto(page, rowOf(page, SEC), box);
  await expect(box.getByTestId("link-line")).toHaveCount(2);

  // 보안 점검 항목도 중요로(처리 전)
  await rowOf(page, SEC).locator("textarea").first().click();
  await page.keyboard.press("Alt+KeyI");
  // 정산 항목 처리 완료 → 그 줄만 ✓, 상자 ✓는 아직(보안 점검이 남음)
  await rowOf(page, SETTLE).locator("textarea").first().click();
  await flagAndComplete(page, FIRST);
  await expect(box.getByTestId("link-line-done")).toHaveCount(1);
  await expect(
    box.getByTestId("link-line").filter({ has: page.getByTestId("link-line-done") }),
  ).toContainText(SETTLE);
  await expect(box.getByTestId("box-done")).toHaveCount(0);

  const secText = await rowOf(page, SEC).locator("textarea").first().inputValue();
  await panel(page)
    .getByRole("button", { name: `처리 완료: ${secText}` })
    .click();
  await expect(box.getByTestId("link-line-done")).toHaveCount(2);
  await expect(box.getByTestId("box-done")).toBeVisible();
});
