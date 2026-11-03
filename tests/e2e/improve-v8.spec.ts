// 개선 v8(improve-1103v8-spec): 첫 실행 업무 추가(T2), 메모 ⋯ 단추(T3), 시작 시각(T1), 다른 날로 옮기기(T4). 가상 샘플만.
import { expect, test, type Page } from "@playwright/test";

const TODAY = "2026-10-22";
const headers = (page: Page) => page.getByTestId("category-header");

async function toCategoriesStep(page: Page) {
  await page.goto(`/?today=${TODAY}&fresh=1`);
  await page.getByRole("button", { name: "새로 시작하기" }).click();
  await page.getByRole("button", { name: "다음" }).click();
  return page.getByRole("textbox", { name: "업무 이름 입력 후 Enter" });
}

/** 한글 조합을 확정하는 Enter — WebKit(맥)은 이 Enter를 조합 중(229)으로만 보낸다 */
const composingEnter = (page: Page, label: string) =>
  page.getByRole("textbox", { name: label }).evaluate((el) => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true }),
    );
  });

test.describe("T2 첫 실행 업무 추가", () => {
  test("이름을 쓰고 Enter 없이 [보드 열기] → 그 업무가 생긴다", async ({ page }) => {
    const input = await toCategoriesStep(page);
    await input.fill("가 업무");
    await page.getByRole("button", { name: "보드 열기 →" }).click();
    await expect(headers(page)).toHaveCount(1);
    await expect(headers(page).first()).toContainText("가 업무");
  });

  test("칩으로 넣은 업무 + 입력란에 남은 업무가 모두 생기고, 같은 이름은 한 번만", async ({ page }) => {
    const input = await toCategoriesStep(page);
    await input.fill("가 업무");
    await input.press("Enter");
    await input.fill("나 업무");
    await page.getByRole("button", { name: "보드 열기 →" }).click();
    await expect(headers(page)).toHaveCount(2);
  });

  test("[나중에 하기]는 입력란 글을 넣지 않는다", async ({ page }) => {
    const input = await toCategoriesStep(page);
    await input.fill("가 업무");
    await page.getByRole("button", { name: "나중에 하기" }).click();
    await expect(page.getByText("아직 업무가 없습니다.", { exact: false })).toBeVisible();
    await expect(headers(page)).toHaveCount(0);
  });

  test("한글 확정 Enter(조합 중 키) 한 번으로도 칩이 들어가고, 뒤따른 Enter로 두 번 들어가지 않는다", async ({
    page,
  }) => {
    const input = await toCategoriesStep(page);
    await input.fill("다 업무");
    await composingEnter(page, "업무 이름 입력 후 Enter");
    await expect(page.getByRole("button", { name: /다 업무/ })).toBeVisible();
    await expect(input).toHaveValue("");
    await input.fill("라 업무");
    await composingEnter(page, "업무 이름 입력 후 Enter");
    await input.press("Enter"); // 윈도우처럼 확정 뒤 Enter가 한 번 더 와도
    await page.getByRole("button", { name: "보드 열기 →" }).click();
    await expect(headers(page)).toHaveCount(2);
  });

  test("보드 [+ 업무 추가]도 한글 확정 Enter 한 번으로 추가", async ({ page }) => {
    const input = await toCategoriesStep(page);
    await input.fill("가 업무");
    await page.getByRole("button", { name: "보드 열기 →" }).click();
    await expect(headers(page)).toHaveCount(1);
    await page.getByRole("button", { name: "+ 업무 추가" }).click();
    await page.getByRole("textbox", { name: "+ 업무 추가" }).fill("마 업무");
    await composingEnter(page, "+ 업무 추가");
    await expect(headers(page)).toHaveCount(2);
  });
});

test("T3 메모 상자 ⋯ 단추: 흰 바탕·테두리로 보이고, 고른 상자에서 Shift+F10으로 메뉴", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?today=${TODAY}&sample=showcase`);
  const img = page.getByTestId("note-image").first();
  await img.scrollIntoViewIfNeeded();
  await img.hover();
  const btn = img.getByRole("button", { name: "상자 메뉴" });
  await expect(btn).toBeVisible();
  const style = await btn.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      bg: s.backgroundColor,
      border: s.borderTopWidth,
      w: el.getBoundingClientRect().width,
      op: s.opacity,
    };
  });
  expect(style.bg).not.toBe("rgba(0, 0, 0, 0)");
  expect(style.border).toBe("1px");
  expect(style.w).toBeGreaterThanOrEqual(28);
  expect(style.op).toBe("1");
  await img.click({ position: { x: 40, y: 2 } });
  await img.focus();
  await page.keyboard.press("Shift+F10");
  await expect(img.getByRole("menu")).toBeVisible();
});

const SETTLE = "차세대 정산 시스템 구축";
const FIRST = "테스트 데이터 이관 스크립트 작성 착수"; // 오늘 SETTLE 칸 첫 항목(시작 시 커서)
const cell = (page: Page, cat: string, date: string) => page.getByTestId(`cell-${cat}-${date}`);

async function openBoard(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?today=${TODAY}`);
  await expect(page.locator(":focus")).toHaveValue(FIRST);
}

test.describe("T1 시작 시각", () => {
  test("Alt+O → 숫자 1430 → Enter = ⏰ 14:30 꼬리표, 다른 주 다녀와도 남고, 중요 업무 패널에도", async ({
    page,
  }) => {
    await openBoard(page);
    await page.keyboard.press("Alt+KeyO");
    const pop = page.getByTestId("start-time-popover");
    await expect(pop).toBeVisible();
    await page.keyboard.type("1430");
    await expect(pop.getByRole("button", { name: "14:30 시작" })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(pop).toHaveCount(0);
    const chip = cell(page, SETTLE, TODAY).getByTestId("start-time-chip");
    await expect(chip).toHaveText("⏰ 14:30");
    await expect(page.locator(":focus")).toHaveValue(FIRST); // 커서는 그 항목으로
    // 주를 오가도 저장돼 있다
    await page.keyboard.press("Escape");
    await page.keyboard.press("Alt+ArrowRight");
    await expect(page.getByTestId("week-title")).toContainText("2026-W44");
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(page.getByTestId("week-title")).toContainText("2026-W43");
    await expect(cell(page, SETTLE, TODAY).getByTestId("start-time-chip")).toHaveText("⏰ 14:30");
    // ★로 표시하면 패널에 시각
    await cell(page, SETTLE, TODAY).locator("textarea").first().focus();
    await page.keyboard.press("Alt+KeyI");
    await page.keyboard.press("Alt+Digit2");
    await expect(page.getByTestId("important-panel").getByTestId("important-time")).toHaveText("⏰ 14:30");
  });

  test("⋯ 메뉴 → 시작 시각… → 시·분 단추로 고르기 · 꼬리표 눌러 지우기 · Ctrl+Z", async ({ page }) => {
    await openBoard(page);
    const row = cell(page, SETTLE, TODAY).locator("[data-item-index='0']");
    // 커서가 있는 항목에서만 ⋯ — 마우스만 올리면 숨김(좁은 칸에서 글을 누르는 데 방해되지 않게)
    await row.getByTestId("item-more").click(); // 시작할 때 커서가 이 항목에 있다
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("item-menu")).toHaveCount(0);
    await row.locator("textarea").click({ button: "right" }); // 오른쪽 클릭으로도 같은 메뉴
    await page.getByRole("menuitem", { name: /시작 시각/ }).click();
    const pop = page.getByTestId("start-time-popover");
    await pop.getByRole("button", { name: "10", exact: true }).click();
    await pop.getByRole("button", { name: ":45", exact: true }).click();
    await pop.getByRole("button", { name: "10:45 시작" }).click();
    await expect(row.getByTestId("start-time-chip")).toHaveText("⏰ 10:45");
    // 분은 15분 단위만 — ↑ 한 번 = 11:00
    await row.getByTestId("start-time-chip").click();
    await page.keyboard.press("ArrowUp");
    await expect(pop.getByRole("button", { name: "11:00 시작" })).toBeVisible();
    await pop.getByRole("button", { name: "지우기" }).click();
    await expect(row.getByTestId("start-time-chip")).toHaveCount(0);
    await page.keyboard.press("Control+KeyZ");
    await expect(row.getByTestId("start-time-chip")).toHaveText("⏰ 10:45");
  });
});

test.describe("T4 다른 날로 옮기기", () => {
  test("Alt+D → 다음 주 같은 요일: 세부 항목까지 함께, 알림 [그 날로 가기]·실행 취소", async ({ page }) => {
    await openBoard(page);
    const MON = "2026-10-19";
    const src = cell(page, SETTLE, MON);
    const parent = await src.locator("textarea").first().inputValue();
    const subCount = await src.locator("[data-item-index]").count();
    expect(subCount).toBeGreaterThan(1);
    await src.locator("textarea").first().focus();
    await page.keyboard.press("Alt+KeyD");
    const pop = page.getByTestId("move-date-popover");
    await expect(pop).toContainText("세부 항목");
    await pop.getByRole("button", { name: /다음 주 같은 요일 · 10\/26/ }).click();
    await expect(page.getByRole("status")).toContainText("10/26 (월)로 옮겼습니다");
    await expect(src.locator("[data-item-index]")).toHaveCount(0);
    // 실행 취소 = 원래 칸·원래 자리
    await page.keyboard.press("Control+KeyZ");
    await expect(src.locator("textarea").first()).toHaveValue(parent);
    await expect(src.locator("[data-item-index]")).toHaveCount(subCount);
    // 다시 옮기고 그 날로 가기
    await src.locator("textarea").first().focus();
    await page.keyboard.press("Alt+KeyD");
    await pop.getByRole("button", { name: /다음 주 같은 요일/ }).click();
    await page.getByRole("status").getByRole("button", { name: "그 날로 가기" }).last().click();
    await expect(page.getByTestId("week-title")).toContainText("2026-W44");
    const dst = cell(page, SETTLE, "2026-10-26");
    // 받는 칸 맨 아래에 본 항목 + 세부 항목이 그대로 붙는다
    const values = await dst
      .locator("textarea")
      .evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value));
    expect(values.slice(-subCount)[0]).toBe(parent);
  });

  test("달력에서 날짜 고르기(다른 달) · ★ 항목은 중요 업무 패널 날짜가 바뀐다", async ({ page }) => {
    await openBoard(page);
    await page.keyboard.press("Alt+KeyI"); // 오늘 첫 항목 ★
    await page.keyboard.press("Alt+KeyD");
    const pop = page.getByTestId("move-date-popover");
    await pop.getByRole("button", { name: "다음 달" }).click();
    await expect(pop.getByTestId("move-month")).toHaveText("2026년 11월");
    await pop.getByRole("gridcell", { name: "11/04 (수)" }).click();
    await expect(pop.getByTestId("move-where")).toContainText("11/04 (수)");
    await pop.getByRole("button", { name: "옮기기" }).click();
    await expect(page.getByRole("status")).toContainText("★ 항목 1개");
    await page.keyboard.press("Alt+Digit2");
    const panel = page.getByTestId("important-panel");
    await expect(panel).toContainText(FIRST);
    await expect(panel).toContainText("11/04 (수)");
  });

  test("세부 항목 하나만 옮기면 그 날에서 본 항목이 된다", async ({ page }) => {
    await openBoard(page);
    const MON = "2026-10-19";
    const src = cell(page, SETTLE, MON);
    const sub = src.locator("[data-item-index='1']");
    const text = await sub.locator("textarea").inputValue();
    await sub.locator("textarea").focus();
    await page.keyboard.press("Alt+KeyD");
    await page
      .getByTestId("move-date-popover")
      .getByRole("button", { name: /내일 · 10\/20/ })
      .click();
    const dst = cell(page, SETTLE, "2026-10-20");
    const moved = dst
      .locator("[data-item-index]")
      .filter({ has: page.locator(`textarea`) })
      .last();
    await expect(moved.locator("textarea")).toHaveValue(text);
    await expect(moved).toHaveClass(/item(?!Sub)/);
  });

  test("메모 상자에 연결된 항목을 다른 주로 옮기면 띠에 새 날짜로 보인다(D5)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/?today=${TODAY}&sample=showcase`);
    await expect(page.getByTestId("week-title")).toContainText("2026-W43");
    const line = page.getByTestId("link-line").filter({ hasText: "10/21 (수)" }).first();
    await expect(line).toBeVisible();
    const itemId = await line.getAttribute("data-item");
    const row = page.locator(`[data-item-id="${itemId}"]`);
    await row.locator("textarea, [data-testid='item-view']").first().click();
    await page.keyboard.press("Alt+KeyD");
    await page
      .getByTestId("move-date-popover")
      .getByRole("button", { name: /다음 주 같은 요일 · 10\/28/ })
      .click();
    const lines = page.locator(`[data-testid="link-line"][data-item="${itemId}"]`);
    await expect(lines.first()).toContainText("10/28 (수)");
    await expect(lines.last()).toContainText("10/28 (수)");
  });
});
