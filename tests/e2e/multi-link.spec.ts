// 메모 상자 여러 업무 항목 연결 E2E(multi-link-spec): 여러 줄 띠(보드 순서) · 끌어 놓기 = 더하기/"연결됨" · 행을 상자에 놓기 ·
// ⋯ [업무 항목 연결…] 고르기 목록 · 줄 ✂ / [연결 모두 해제] · 5개 이상 접기 · 줄 hover → 보드 강조 · 줄 누르면 그 항목으로.
// 브라우저 모드, 가상 샘플만. 오늘 = 2026-10-22(목).
import { expect, test, type Locator, type Page } from "@playwright/test";

const TODAY = "2026-10-22";
const SETTLE = "차세대 정산 시스템 구축";
const SEC = "협력사 보안 점검";
const FIRST = "테스트 데이터 이관 스크립트 작성 착수";

const cell = (page: Page, cat: string, date: string) => page.getByTestId(`cell-${cat}-${date}`);
const rowOf = (page: Page, cat: string) => cell(page, cat, TODAY).locator("[data-item-index]").first();
const toasts = (page: Page) => page.locator('[role="status"][aria-live="polite"]');

async function pointerDrag(page: Page, from: Locator, to: Locator, drop = true) {
  const f = (await from.boundingBox())!;
  await page.mouse.move(f.x + f.width / 2, f.y + f.height / 2);
  await page.mouse.down();
  await page.mouse.move(f.x + f.width / 2 + 6, f.y + f.height / 2 + 6, { steps: 2 });
  const t = (await to.boundingBox())!;
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 10 });
  if (drop) await page.mouse.up();
}

/** 메모 판에 글 상자 하나를 만들고 그 상자 */
async function makeBox(page: Page, text: string) {
  const c = (await page.getByTestId("note-canvas").boundingBox())!;
  await page.mouse.click(c.x + 640, c.y + 40);
  await expect(page.locator(":focus")).toHaveClass(/note-prose/);
  await page.keyboard.type(text);
  await page.keyboard.press("Escape");
  return page.locator("[data-box-id]", { has: page.locator(".note-prose", { hasText: text }) });
}

const grip = (box: Locator) => box.getByRole("button", { name: "상자 위치 이동(끌기)" });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?today=${TODAY}`);
  await expect(page.locator(":focus")).toHaveValue(FIRST);
  await expect(page.getByTestId("note-box").first()).toBeVisible();
});

test("상자를 여러 항목에 끌어 놓기 → 줄이 쌓임(보드 순서) · 이미 연결된 항목은 '연결됨' · 배지는 항목마다", async ({
  page,
}) => {
  const box = await makeBox(page, "가상 회의 메모");
  // 보안 점검 먼저, 그다음 정산 — 줄 순서는 보드 순서(정산이 위)
  await box.hover();
  await pointerDrag(page, grip(box), rowOf(page, SEC));
  await box.hover();
  await pointerDrag(page, grip(box), rowOf(page, SETTLE));
  const lines = box.getByTestId("link-line");
  await expect(lines).toHaveCount(2);
  await expect(lines.nth(0)).toContainText(SETTLE);
  await expect(lines.nth(1)).toContainText(SEC);
  await expect(rowOf(page, SETTLE).getByTestId("memo-badge")).toHaveText("1");
  await expect(rowOf(page, SEC).getByTestId("memo-badge")).toHaveText("1");

  // 이미 연결된 항목 위 = "연결됨", 놓아도 그대로
  await box.hover();
  await pointerDrag(page, grip(box), rowOf(page, SETTLE), false);
  await expect(page.getByTestId("link-drop-label")).toHaveText("연결됨");
  await page.mouse.up();
  await expect(lines).toHaveCount(2);
  await expect(toasts(page)).toContainText("이미 연결된 항목입니다");

  // 줄을 누르면 그 항목으로(보드 칸 그 항목에 커서)
  const secText = await rowOf(page, SEC).locator("textarea").first().inputValue();
  await lines.nth(1).getByRole("button").first().click();
  await expect(page.locator(":focus")).toHaveValue(secText);
});

test("보드 행(⋮⋮)을 기존 상자 위에 놓기 → 그 상자에 연결 더하기 · 줄 hover → 보드 항목 강조", async ({
  page,
}) => {
  const box = await makeBox(page, "가상 정리 메모");
  await box.hover();
  await pointerDrag(page, grip(box), rowOf(page, SETTLE));
  await expect(box.getByTestId("link-line")).toHaveCount(1);

  const row = rowOf(page, SEC);
  await row.hover();
  await pointerDrag(page, row.getByTestId("drag-row"), box, false);
  await expect(page.getByTestId("link-box-chip")).toContainText("놓으면 연결 추가");
  await page.mouse.up();
  await expect(box.getByTestId("link-line")).toHaveCount(2);
  await expect(page.getByTestId("link-drop-spot")).toHaveCount(0);

  await box.getByTestId("link-line").nth(1).hover();
  await expect(rowOf(page, SEC)).toHaveClass(/linkTarget/);
  await page.mouse.move(5, 5);
  await expect(rowOf(page, SEC)).not.toHaveClass(/linkTarget/);
});

test("⋯ [업무 항목 연결…]: 업무별 목록 · 찾기 · Space로 켜기/끄기 · Esc는 상자로 · 5개 이상이면 접기", async ({
  page,
}) => {
  const box = await makeBox(page, "가상 주간 회고");
  await box.hover();
  await box.getByRole("button", { name: "상자 메뉴" }).click();
  await page.getByTestId("link-pick-open").click();
  const picker = page.getByTestId("link-picker");
  await expect(picker).toBeVisible();
  await expect(page.getByTestId("link-pick-search")).toBeFocused();
  const items = picker.getByTestId("link-pick-item");
  const total = await items.count();
  expect(total).toBeGreaterThanOrEqual(5);

  // 키보드: ↓로 첫 항목, Space로 켜기
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");
  await expect(items.first()).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("link-pick-count")).toHaveText("연결 1개");
  await page.keyboard.press("Space");
  await expect(items.first()).toHaveAttribute("aria-checked", "false");

  // 5개 켜기 → 띠 4줄 + "1개 더 보기"
  for (let i = 0; i < 5; i++) await items.nth(i).click();
  await expect(page.getByTestId("link-pick-count")).toHaveText("연결 5개");
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
  await expect(box).toBeFocused();
  await expect(box.getByTestId("link-line")).toHaveCount(4);
  await box.getByTestId("link-more").click();
  await expect(box.getByTestId("link-line")).toHaveCount(5);
  await expect(box.getByTestId("link-more")).toHaveText("▴ 접기");

  // 찾기로 거르기
  await box.hover();
  await box.getByRole("button", { name: "상자 메뉴" }).click();
  await page.getByTestId("link-pick-open").click();
  await page.getByTestId("link-pick-search").fill("보안");
  await expect(items.first()).toBeVisible();
  expect(await items.count()).toBeLessThan(total);
});

test("줄의 ✂ = 그 연결만 해제 → 되돌리기 · ⋯ [연결 모두 해제 (N)]", async ({ page }) => {
  const box = await makeBox(page, "가상 해제 메모");
  await box.hover();
  await pointerDrag(page, grip(box), rowOf(page, SETTLE));
  await box.hover();
  await pointerDrag(page, grip(box), rowOf(page, SEC));
  const lines = box.getByTestId("link-line");
  await expect(lines).toHaveCount(2);

  await lines.nth(0).getByTestId("link-line-unlink").click();
  await expect(lines).toHaveCount(1);
  await expect(lines.first()).toContainText(SEC);
  await expect(rowOf(page, SETTLE).getByTestId("memo-badge")).toHaveCount(0);
  await page.getByRole("button", { name: "되돌리기" }).last().click();
  await expect(lines).toHaveCount(2);

  await box.hover();
  await box.getByRole("button", { name: "상자 메뉴" }).click();
  await page.getByTestId("link-unlink-all").click();
  await expect(box.getByTestId("link-strip")).toHaveCount(0);
  await expect(toasts(page)).toContainText("연결 2개를 모두 해제했습니다");
});
