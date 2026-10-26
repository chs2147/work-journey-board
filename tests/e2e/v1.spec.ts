// 개선 v2 V1 E2E(improve-1026v2-spec 1·2·8·9·10절): 행 삭제(단추·Alt+Delete·묶음째·미리보기·되돌리기) ·
// 중요 업무 목록 업무명 묶기 · 주간/오늘 보기 아이콘. 브라우저 모드, 오늘 = 2026-10-22(목), 가상 샘플만.
import { expect, test, type Page } from "@playwright/test";

const TODAY = "2026-10-22";
const SETTLE = "차세대 정산 시스템 구축";
const SEC = "협력사 보안 점검";
const FIRST = "테스트 데이터 이관 스크립트 작성 착수"; // 오늘 SETTLE 칸 첫 항목(시작 시 커서)

const cell = (page: Page, cat: string, date: string) => page.getByTestId(`cell-${cat}-${date}`);
const saved = (page: Page) => expect(page.getByTestId("save-state")).toHaveText("저장됨 ✓");
const values = (page: Page) =>
  cell(page, SETTLE, TODAY)
    .locator("textarea")
    .evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value));

/** 오늘 SETTLE 칸: 첫 항목 아래에 본 항목 + 세부 항목 2개 */
async function typeGroup(page: Page) {
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("배포 리허설 결과 정리");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.type("롤백 소요 시간 기록");
  await page.keyboard.press("Enter");
  await page.keyboard.type("점검표 갱신");
  await saved(page);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?today=${TODAY}`);
  await expect(page.locator(":focus")).toHaveValue(FIRST);
});

test("행 삭제 단추: 본 항목에 올리면 묶음이 붉게 미리 보이고, 누르면 세부 항목까지 지운 뒤 토스트 되돌리기", async ({
  page,
}) => {
  await typeGroup(page);
  await page.keyboard.press("Escape");
  const c = cell(page, SETTLE, TODAY);
  const parent = c
    .locator('[class*="item_"]')
    .filter({ has: page.locator("textarea") })
    .nth(1);
  await parent.hover();
  const del = parent.getByTestId("delete-row");
  await expect(del).toHaveAttribute("aria-label", "이 항목과 세부 항목 2개 삭제 (Alt+Delete)");
  await expect(del).toHaveAttribute("tabindex", "-1"); // Tab 순서에서 빠짐(2분 기록 흐름)
  await del.hover();
  await expect(c.locator('[class*="deleting"]')).toHaveCount(3);
  await del.click();
  await expect(page.getByRole("status")).toContainText("항목 3개를 지웠습니다(세부 2개 포함)");
  expect(await values(page)).toEqual([FIRST]);
  await saved(page);

  await page.getByRole("status").getByRole("button", { name: "되돌리기" }).click();
  await expect
    .poll(() => values(page))
    .toEqual([FIRST, "배포 리허설 결과 정리", "롤백 소요 시간 기록", "점검표 갱신"]);
  await saved(page);
});

test("Alt+Delete: 세부 항목은 그 항목만 지우고 커서는 위 항목 끝, 본 항목은 묶음째 · Ctrl+Z로 되돌림", async ({
  page,
}) => {
  await typeGroup(page);
  // 지금 커서 = 마지막 세부 항목 "점검표 갱신"
  await page.keyboard.press("Alt+Delete");
  await expect(page.getByRole("status")).toContainText("항목 1개를 지웠습니다");
  expect(await values(page)).toEqual([FIRST, "배포 리허설 결과 정리", "롤백 소요 시간 기록"]);
  const focused = page.locator(":focus");
  await expect(focused).toHaveValue("롤백 소요 시간 기록");
  expect(await focused.evaluate((e) => (e as HTMLTextAreaElement).selectionStart)).toBe(
    "롤백 소요 시간 기록".length,
  );

  // 본 항목으로 올라가 Alt+Delete = 남은 세부 항목까지
  await page.keyboard.press("ArrowUp");
  await expect(focused).toHaveValue("배포 리허설 결과 정리");
  await page.keyboard.press("Alt+Delete");
  await expect(page.getByRole("status")).toContainText("항목 2개를 지웠습니다(세부 1개 포함)");
  expect(await values(page)).toEqual([FIRST]);
  await expect(focused).toHaveValue(FIRST);

  await page.keyboard.press("Control+KeyZ");
  await expect.poll(() => values(page)).toEqual([FIRST, "배포 리허설 결과 정리", "롤백 소요 시간 기록"]);
});

test("빈 칸의 유일한 빈 항목에는 삭제 단추가 없고, 글을 쓰면 생긴다 · 빈 항목 Backspace 삭제는 그대로", async ({
  page,
}) => {
  const add = page.getByRole("button", { name: "+ 기록 추가" }).first();
  const id = await page
    .locator('[data-testid^="cell-"]')
    .filter({ has: add })
    .first()
    .getAttribute("data-testid");
  const empty = page.getByTestId(id!);
  await add.click();
  const row = empty.locator('[class*="item_"]').first();
  await row.hover();
  await expect(row.getByTestId("delete-row")).toHaveCount(0);
  await page.keyboard.type("가");
  await expect(row.getByTestId("delete-row")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(empty.getByTestId("delete-row")).toHaveCount(2); // 빈 항목도 다른 항목과 함께면 지울 수 있다
  await page.keyboard.press("Backspace");
  await expect(empty.locator("textarea")).toHaveCount(1);
  await expect(page.locator(":focus")).toHaveValue("가");
});

test("중요 업무 목록: 오늘 › 업무명 › 항목 — 업무 머리(점·이름·수), 항목 줄에 업무명·날짜 없음, ↑↓는 항목만", async ({
  page,
}) => {
  await page.keyboard.press("Alt+KeyI");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("이관 대상 테이블 확정");
  await page.keyboard.press("Alt+KeyI");
  // 다른 업무의 지난 날짜 항목
  const late = cell(page, SEC, "2026-10-21").locator('[class*="item_"]').first();
  await late.hover();
  await late.getByRole("button", { name: "중요 표시 (Alt+I)" }).click();
  await saved(page);

  await page.keyboard.press("Alt+Digit2");
  const panel = page.getByTestId("important-panel");
  const todayGroup = panel.getByRole("region", { name: "오늘" });
  const settle = todayGroup.getByRole("group", { name: SETTLE });
  await expect(settle.getByRole("heading")).toContainText(SETTLE);
  await expect(settle.getByRole("heading")).toContainText("2");
  await expect(settle.getByTestId("important-row")).toHaveText([FIRST, "이관 대상 테이블 확정"]);
  const lateGroup = panel.getByRole("region", { name: "지난 날짜" });
  await expect(lateGroup.getByRole("group", { name: SEC })).toBeVisible();
  const lateRow = lateGroup.getByTestId("important-row");
  await expect(lateRow).toContainText("10/21");
  await expect(lateRow).toContainText("지남");
  await expect(lateRow).not.toContainText(SEC);

  // Alt+2 = 첫 항목에 포커스, ↓는 업무 머리를 건너 항목만
  const rows = panel.getByTestId("important-row");
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(rows.nth(2)).toBeFocused();
});

test("보기 아이콘: 주간 = 달력 칸, 오늘 = 일력 + 날짜 숫자(그 뷰가 보여 주는 날) — 이름은 aria-label·title", async ({
  page,
}) => {
  const week = page.getByTestId("view-week");
  const day = page.getByTestId("view-today");
  await expect(week).toHaveAttribute("aria-label", "주간 뷰 (Alt+V)");
  await expect(week).toHaveAttribute("aria-pressed", "true");
  await expect(day).toHaveAttribute("aria-label", "오늘 뷰 · 10/22(목) (Alt+V)");
  await expect(day).toHaveAttribute("title", "오늘 뷰 · 10/22(목) (Alt+V)");
  await expect(day.locator("svg text")).toHaveText("22");
  await expect(page.getByRole("button", { name: "주간 뷰 (Alt+V)" })).toBeVisible();

  await day.click();
  await expect(day).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "다음 날 (Alt+→)" }).click();
  await expect(day).toHaveAttribute("aria-label", "오늘 뷰 · 10/23(금) (Alt+V)");
  await expect(day.locator("svg text")).toHaveText("23");
  // 주간 뷰로 돌아가면 다시 오늘 날짜
  await week.click();
  await expect(day.locator("svg text")).toHaveText("22");
});
