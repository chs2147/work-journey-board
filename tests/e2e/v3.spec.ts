// 개선 v2 V3 E2E(improve-1026v2-spec 4~7절): 업무연계 메모 — 행의 [메모] · 행을 메모 판으로 끌기 · 메모 상자를 항목으로 끌기 ·
// 타이틀 띠(누르면 그 항목으로) · 연결 해제 · 항목 삭제 시 "연결된 항목이 삭제됨" · 보드 배지. 브라우저 모드, 가상 샘플만.
import { expect, test, type Locator, type Page } from "@playwright/test";

const TODAY = "2026-10-22";
const SETTLE = "차세대 정산 시스템 구축";
const SEC = "협력사 보안 점검";
const FIRST = "테스트 데이터 이관 스크립트 작성 착수"; // 오늘 SETTLE 칸 첫 항목(시작 시 커서)

const cell = (page: Page, cat: string, date: string) => page.getByTestId(`cell-${cat}-${date}`);
const saved = (page: Page) =>
  expect(page.locator('[data-testid="save-state"][data-idle="true"]')).toHaveText("저장됨");
const firstRow = (page: Page) => cell(page, SETTLE, TODAY).locator("[data-item-index]").first();
const stripBox = (page: Page) => page.locator('[data-box-id]:has([data-testid="link-strip"])');

/** 첫 글자를 칠 수 있게 새 상자 편집기가 커서를 받을 때까지 */
async function typeInNewBox(page: Page, text: string) {
  await expect(page.locator(":focus")).toHaveClass(/note-prose/);
  await page.keyboard.type(text);
}

async function pointerDrag(
  page: Page,
  from: Locator,
  to: Locator,
  opts: { drop?: boolean; fy?: number } = {},
) {
  const f = (await from.boundingBox())!;
  await page.mouse.move(f.x + f.width / 2, f.y + f.height / 2);
  await page.mouse.down();
  await page.mouse.move(f.x + f.width / 2 + 6, f.y + f.height / 2 + 6, { steps: 2 });
  const t = (await to.boundingBox())!;
  await page.mouse.move(t.x + t.width / 2, t.y + t.height * (opts.fy ?? 0.5), { steps: 10 });
  if (opts.drop !== false) await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?today=${TODAY}`);
  await expect(page.locator(":focus")).toHaveValue(FIRST);
  // 메모 판이 이 주 문서를 다 읽은 뒤에(이 주는 예전 요일 메모 상자가 하나 있다)
  await expect(page.getByTestId("note-box").first()).toBeVisible();
});

test("행의 [메모] → 연결된 글 상자(본문 비움, 띠에 업무명·날짜·항목 글) · 보드 배지 · 띠를 누르면 그 항목으로 · 주를 다녀와도 그대로", async ({
  page,
}) => {
  await firstRow(page).hover();
  await firstRow(page).getByTestId("memo-row").click();
  const ghost = page.getByTestId("note-ghost");
  await expect(ghost.getByTestId("link-strip")).toContainText(SETTLE);
  await expect(ghost.getByTestId("link-strip")).toContainText("10/22 (목)");
  await expect(ghost.getByTestId("link-strip")).toContainText(FIRST);
  await typeInNewBox(page, "이관 대상 테이블 목록 정리 필요");
  await page.keyboard.press("Escape");
  await saved(page);

  const badge = firstRow(page).getByTestId("memo-badge");
  await expect(badge).toHaveText("1");
  await expect(badge).toHaveAttribute("aria-label", "연결된 메모 1개 — 메모로 가기");

  // 띠 = 그 항목으로(커서 + 잠깐 강조)
  await stripBox(page)
    .getByRole("button", { name: /이 항목으로 가기/ })
    .click();
  await expect(page.locator(":focus")).toHaveValue(FIRST);

  // 배지 = 그 메모 상자로(선택)
  await badge.click();
  await expect(stripBox(page)).toBeFocused();

  // 항목 글을 고치면 띠가 따라 바뀐다
  await firstRow(page).locator("textarea").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" 완료");
  await expect(stripBox(page).getByTestId("link-strip")).toContainText(`${FIRST} 완료`);
  await page.keyboard.press("Escape");
  await saved(page);

  // 다른 주에 다녀와도 연결 그대로(저장·다시 읽기)
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("week-title")).toContainText("2026-W44");
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
  await expect(stripBox(page).getByTestId("link-strip")).toContainText(`${FIRST} 완료`);
  await expect(firstRow(page).getByTestId("memo-badge")).toHaveText("1");

  // 자동 집계에는 메모 글만(타이틀 없음, 12절 #7)
  await page.keyboard.press("Alt+KeyS");
  await expect(page.getByTestId("summary-auto")).toContainText("이관 대상 테이블 목록 정리 필요");
});

test("아무것도 안 치고 떠나면 연결 상자도 사라진다(빈 상자 규칙)", async ({ page }) => {
  const before = await page.locator("[data-box-id]").count();
  await firstRow(page).hover();
  await firstRow(page).getByTestId("memo-row").click();
  await expect(page.getByTestId("note-ghost")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("note-ghost")).toHaveCount(0);
  await expect(page.locator("[data-box-id]")).toHaveCount(before);
  await expect(firstRow(page).getByTestId("memo-badge")).toHaveCount(0);
});

test("연결 해제(끊긴 사슬) → 띠·배지 사라짐, 되돌리기 · 항목을 지우면 '연결된 항목이 삭제됨', 삭제를 되돌리면 정상", async ({
  page,
}) => {
  await firstRow(page).hover();
  await firstRow(page).getByTestId("memo-row").click();
  await typeInNewBox(page, "연결 해제 확인용");
  await page.keyboard.press("Escape");
  await saved(page);

  await stripBox(page).getByRole("button", { name: "연결 해제" }).click();
  await expect(page.getByTestId("link-strip")).toHaveCount(0);
  await expect(firstRow(page).getByTestId("memo-badge")).toHaveCount(0);
  await expect(page.locator(".note-prose", { hasText: "연결 해제 확인용" })).toHaveCount(1); // 상자·본문은 그대로
  await page.getByRole("status").getByRole("button", { name: "되돌리기" }).last().click();
  await expect(stripBox(page).getByTestId("link-strip")).toContainText(FIRST);

  // 항목 삭제 → 띠가 회색 안내 + [연결 해제]
  await firstRow(page).locator("textarea").click();
  await page.keyboard.press("Alt+Delete");
  const strip = stripBox(page).getByTestId("link-strip");
  await expect(strip).toContainText("연결된 항목이 삭제됨");
  await expect(strip.getByRole("button", { name: "연결 해제" })).toBeVisible();
  // 삭제를 되돌리면(같은 id) 다시 정상
  await page.getByRole("status").getByRole("button", { name: "되돌리기" }).last().click();
  await expect(strip).toContainText(FIRST);
});

test("행을 ⋮⋮로 끌어 메모 판에 놓기 → 놓은 자리에 연결된 상자(행은 그대로)", async ({ page }) => {
  await page.keyboard.press("Alt+ArrowRight"); // 빈 메모의 주
  await expect(page.getByTestId("week-title")).toContainText("2026-W44");
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
  const row = firstRow(page);
  await row.hover();
  await pointerDrag(page, row.getByTestId("drag-row"), page.getByTestId("note-scroll"), {
    drop: false,
    fy: 0.4,
  });
  await expect(page.getByTestId("link-drop-spot")).toContainText("여기에 놓으면 이 항목과 연결된 메모");
  await page.mouse.up();
  await expect(page.getByTestId("link-drop-spot")).toHaveCount(0);
  const ghost = page.getByTestId("note-ghost");
  await expect(ghost.getByTestId("link-strip")).toContainText(FIRST);
  await typeInNewBox(page, "끌어서 만든 메모");
  await page.keyboard.press("Escape");
  await saved(page);
  await expect(cell(page, SETTLE, TODAY).locator("textarea").first()).toHaveValue(FIRST); // 행은 그대로
  await expect(firstRow(page).getByTestId("memo-badge")).toHaveText("1");
});

test("기존 메모 상자를 위 막대로 끌어 보드 항목에 놓기 → '+ 여기에 연결 추가', 상자는 제자리 + 띠 · 다른 항목에 놓으면 연결이 더해짐(multi-link-spec 2-1)", async ({
  page,
}) => {
  const c = (await page.getByTestId("note-canvas").boundingBox())!;
  await page.mouse.click(c.x + 600, c.y + 60);
  await typeInNewBox(page, "나중에 연결할 메모");
  await page.keyboard.press("Escape");
  await saved(page);
  const box = page.locator("[data-box-id]", {
    has: page.locator(".note-prose", { hasText: "나중에 연결할 메모" }),
  });
  const pos0 = (await box.boundingBox())!;

  await box.hover();
  await pointerDrag(page, box.getByRole("button", { name: "상자 위치 이동(끌기)" }), firstRow(page), {
    drop: false,
  });
  await expect(firstRow(page)).toContainText("여기에 연결");
  await page.mouse.up();
  await expect(box.getByTestId("link-strip")).toContainText(FIRST);
  const pos1 = (await box.boundingBox())!;
  expect(Math.round(pos1.x)).toBe(Math.round(pos0.x));
  await expect(firstRow(page).getByTestId("memo-badge")).toHaveText("1");

  // 다른 항목에 놓으면 연결이 더해진다(줄 2개, 두 항목 모두 배지)
  const other = cell(page, SEC, TODAY).locator("[data-item-index]").first();
  await box.hover();
  await pointerDrag(page, box.getByRole("button", { name: "상자 위치 이동(끌기)" }), other);
  await expect(box.getByTestId("link-line")).toHaveCount(2);
  await expect(box.getByTestId("link-strip")).toContainText(SEC);
  await expect(firstRow(page).getByTestId("memo-badge")).toHaveText("1");
  await expect(other.getByTestId("memo-badge")).toHaveText("1");
});

test("오늘 뷰: 카드 항목의 [메모] → 왼쪽 메모에 연결 상자", async ({ page }) => {
  await page.getByTestId("view-today").click();
  const row = cell(page, SETTLE, TODAY).locator("[data-item-index]").first();
  await row.hover();
  await row.getByTestId("memo-row").click();
  await expect(page.getByTestId("note-ghost").getByTestId("link-strip")).toContainText(SETTLE);
  await typeInNewBox(page, "오늘 뷰 연결 메모");
  await page.keyboard.press("Escape");
  await expect(row.getByTestId("memo-badge")).toHaveText("1");
});
