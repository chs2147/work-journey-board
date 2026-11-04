// 개선 v10(improve-1104v10-spec): 업무 항목 마감일 — 꼬리표·Alt+U·마감일 고르기·★ 함께·"마감일이 있는 업무" 묶음. 가상 샘플만.
import { expect, test, type Page } from "@playwright/test";

const TODAY = "2026-10-22"; // 목
const SETTLE = "차세대 정산 시스템 구축";
const FIRST = "테스트 데이터 이관 스크립트 작성 착수";
const cell = (page: Page, cat: string, date: string) => page.getByTestId(`cell-${cat}-${date}`);
const panel = (page: Page) => page.getByTestId("important-panel");
const dueGroup = (page: Page) => page.getByTestId("important-group-due");

async function openBoard(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?today=${TODAY}`);
  await expect(page.locator(":focus")).toHaveValue(FIRST);
}
async function openPanel(page: Page) {
  if (!(await panel(page).isVisible())) await page.getByTestId("rail-important").click();
  await expect(panel(page)).toBeVisible();
}

test("Alt+U → 숫자 1026 → Enter: 꼬리표 D-4, ★ 함께 켜지고 패널 맨 위 '마감일이 있는 업무'", async ({
  page,
}) => {
  await openBoard(page);
  await page.keyboard.press("Alt+KeyU");
  const pop = page.getByTestId("due-date-popover");
  await expect(pop).toBeVisible();
  await expect(pop).toContainText(`마감일 — ${FIRST}`);
  // 기본 선택 = 이번 주 금
  await expect(pop.getByTestId("due-save")).toHaveText("10/23(금) 저장");
  await page.keyboard.type("1026");
  await expect(pop.getByTestId("due-save")).toHaveText("10/26(월) 저장");
  await page.keyboard.press("Enter");
  await expect(pop).toHaveCount(0);
  const row = cell(page, SETTLE, TODAY).locator("[data-item-index='0']");
  const chip = row.getByTestId("due-chip");
  await expect(chip).toHaveText("⏳ 10/26(월) D-4");
  await expect(chip).toHaveAttribute("data-due-kind", "soon");
  await expect(page.locator(":focus")).toHaveValue(FIRST);
  // 주를 오가도 남는다
  await page.keyboard.press("Escape");
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("week-title")).toContainText("2026-W44");
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(cell(page, SETTLE, TODAY).getByTestId("due-chip").first()).toHaveText("⏳ 10/26(월) D-4");
  await openPanel(page);
  const groups = panel(page).locator("[data-testid^='important-group-']");
  await expect(groups.first()).toHaveAttribute("data-testid", "important-group-due");
  await expect(dueGroup(page)).toContainText("⏳ 마감일이 있는 업무");
  const dueRows = dueGroup(page).getByTestId("important-due-row");
  await expect(dueRows).toHaveCount(1);
  await expect(dueRows.first()).toContainText(FIRST);
  await expect(dueGroup(page).getByTestId("important-due-badge")).toHaveText(["D-4"]);
  // 마감일 머리줄 + 줄에는 항목명만(업무 이름은 툴팁)
  await expect(dueGroup(page).getByTestId("important-due-day")).toContainText("10/26 (월)");
  await expect(dueRows.first()).toHaveText(`✓${FIRST}`);
  await expect(dueRows.first().getByTestId("important-row")).toHaveAttribute("title", /· 기록 10\/22 \(목\)/);
  // 날짜 묶음에는 다시 나오지 않는다(D5)
  await expect(panel(page).getByTestId("important-row").filter({ hasText: FIRST })).toHaveCount(1);
});

test("메뉴 · 빠른 단추 · 꼬리표 누르기: 마감 임박순 정렬, 지남은 맨 위·빨간 점, 지워도 ★는 남음", async ({
  page,
}) => {
  await openBoard(page);
  const c = cell(page, SETTLE, TODAY);
  const row0 = c.locator("[data-item-index='0']");
  const row1 = cell(page, SETTLE, "2026-10-23").locator("[data-item-index='0']");
  const text1 = await row1.locator("textarea").inputValue();
  // 0번 = 다음 주 금(메뉴)
  await row0.locator("textarea").click({ button: "right" });
  await page.getByRole("menuitem", { name: /마감일/ }).click();
  await page.getByTestId("due-quick-nextFri").click(); // 빠른 단추 = 바로 저장
  await expect(row0.getByTestId("due-chip")).toHaveText("⏳ 10/30(금) D-8");
  await expect(row0.getByTestId("due-chip")).toHaveAttribute("data-due-kind", "later");
  // 1번(내일 칸) = 오늘(Alt+U, 빠른 단추)
  await row1.locator("textarea").focus();
  await page.keyboard.press("Alt+KeyU");
  await page.getByTestId("due-quick-today").click();
  await expect(row1.getByTestId("due-chip")).toHaveText("⏳ 오늘 마감");
  await openPanel(page);
  await expect(dueGroup(page).getByTestId("important-due-row").first()).toContainText(text1);
  await expect(page.getByTestId("important-late")).toHaveCount(0);
  // 0번을 지난 날로(꼬리표 눌러 고치기, ← 이틀) → 맨 위 · 레일 빨간 점
  await row0.getByTestId("due-chip").click();
  await page.keyboard.press("Delete");
  await expect(row0.getByTestId("due-chip")).toHaveCount(0);
  await row0.locator("textarea").focus();
  await page.keyboard.press("Alt+KeyU");
  await page.keyboard.type("1020");
  await page.keyboard.press("Enter");
  await expect(row0.getByTestId("due-chip")).toHaveText("⏳ 10/20 · 2일 지남");
  await expect(row0.getByTestId("due-chip")).toHaveAttribute("data-due-kind", "late");
  const dueRows = dueGroup(page).getByTestId("important-due-row");
  await expect(dueRows).toHaveCount(2);
  await expect(dueRows.first()).toContainText(FIRST);
  // 마감일마다 묶음: 지남 → 오늘 마감
  await expect(dueGroup(page).getByTestId("important-due-badge")).toHaveText(["2일 지남", "오늘 마감"]);
  await expect(page.getByTestId("important-late")).toHaveCount(1);
  // 1번 마감 지우기 → 마감 묶음에서 빠지고 ★는 그대로(이번 주 묶음으로)
  await row1.getByTestId("due-chip").click();
  await page.getByTestId("due-clear").click();
  await expect(row1.getByTestId("due-chip")).toHaveCount(0);
  await expect(dueRows).toHaveCount(1);
  await expect(page.getByTestId("important-group-thisWeek")).toContainText(text1);
  // 실행 취소 = 마감일 되살림
  await row1.locator("textarea").focus();
  await page.keyboard.press("Control+KeyZ");
  await expect(row1.getByTestId("due-chip")).toHaveText("⏳ 오늘 마감");
});

test("완료하면 마감 묶음에서 빠져 '이 주 완료'로, ★를 끄면 꼬리표는 남는다", async ({ page }) => {
  await openBoard(page);
  const row0 = cell(page, SETTLE, TODAY).locator("[data-item-index='0']");
  await page.keyboard.press("Alt+KeyU");
  await page.keyboard.press("Enter"); // 기본 = 이번 주 금
  await expect(row0.getByTestId("due-chip")).toHaveText("⏳ 10/23(금) D-1");
  await openPanel(page);
  await dueGroup(page)
    .getByRole("button", { name: `처리 완료: ${FIRST}` })
    .click();
  await expect(dueGroup(page)).toHaveCount(0);
  await expect(page.getByTestId("week-done-row").filter({ hasText: FIRST })).toHaveCount(1);
  await expect(row0.getByTestId("due-chip")).toHaveText("⏳ 10/23(금) D-1");
  // 되살린 뒤 ★ 끄기(Alt+I) → 목록에서 빠지고 꼬리표 유지(D2)
  await row0.getByTestId("done-badge").click();
  await page.getByTestId("done-popover").getByRole("button", { name: "되돌리기 — 다시 중요 업무로" }).click();
  await expect(dueGroup(page).getByTestId("important-due-row")).toHaveCount(1);
  await row0.locator("textarea").focus();
  await page.keyboard.press("Alt+KeyI");
  await expect(dueGroup(page)).toHaveCount(0);
  await expect(row0.getByTestId("due-chip")).toHaveText("⏳ 10/23(금) D-1");
});

test("마감일 창: Esc 취소 · 화살표 이동 · 달 넘기기", async ({ page }) => {
  await openBoard(page);
  await page.keyboard.press("Alt+KeyU");
  const pop = page.getByTestId("due-date-popover");
  await page.keyboard.press("ArrowDown"); // 한 주 뒤
  await expect(pop.getByTestId("due-save")).toHaveText("10/30(금) 저장");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(pop.getByTestId("due-save")).toHaveText("11/01(일) 저장");
  await expect(pop.getByTestId("due-month")).toContainText("11");
  await page.keyboard.press("Escape");
  await expect(pop).toHaveCount(0);
  await expect(cell(page, SETTLE, TODAY).getByTestId("due-chip")).toHaveCount(0);
  await expect(page.locator(":focus")).toHaveValue(FIRST);
});

test("맥 표기(?os=mac): ⌥U가 조합 대기 글쇠(keyCode 229)로 와도 마감일 창이 열리고 글자는 들어가지 않는다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?today=${TODAY}&os=mac`);
  await expect(page.locator(":focus")).toHaveValue(FIRST);
  await page.locator(":focus").evaluate((el) => {
    const e = new KeyboardEvent("keydown", {
      code: "KeyU",
      key: "Dead",
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(e, "keyCode", { get: () => 229 });
    el.dispatchEvent(e);
  });
  await expect(page.getByTestId("due-date-popover")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(":focus")).toHaveValue(FIRST);
  // 메뉴 표기도 맥 기호
  const row = cell(page, SETTLE, TODAY).locator("[data-item-index='0']");
  await row.locator("textarea").click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: /마감일/ })).toContainText("⌥U");
});
