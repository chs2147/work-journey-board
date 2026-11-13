// 개선 v23(improve-v23-spec): 칸반 열 순서(TODO·DONE 포함)·자유 배치 새 섹션 자리·섹션 아이콘·카드 추가 창·카드 메뉴 매주 반복·
// 축하 모션 위치·상단 순서 · 타임라인 요일 구분선. 가상 샘플만.
import { expect, test, type Page } from "@playwright/test";

async function openKanban(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?today=2026-10-22&sample=showcase`);
  await page.getByTestId("week-title").waitFor();
  await page.getByTestId("rail-kanban").click();
  await expect(page.getByTestId("kanban-view")).toBeVisible();
}
async function addSection(page: Page, name: string) {
  await page.getByTestId("kanban-add-section").click();
  await page.getByTestId("kanban-section-dialog").getByRole("textbox").fill(name);
  await page.getByTestId("kanban-section-save").click();
  await expect(page.getByTestId("kanban-section-dialog")).toHaveCount(0);
}
const names = (page: Page) => page.getByTestId("kanban-col-name").allTextContents();
const head = (page: Page, which: "todo" | "done") =>
  page.getByTestId(`kanban-col-${which}`).getByTestId("kanban-col-head");

test("열 순서: TODO·DONE도 키보드·끌기로 옮김 · 되돌리기 · 오른쪽 끝 섹션 추가 단추 없음 · 상단 [균등/자유] → [업무 추가]", async ({
  page,
}) => {
  await openKanban(page);
  await addSection(page, "가상 검토");
  expect(await names(page)).toEqual(["TODO", "가상 검토", "DONE"]);
  await head(page, "todo").focus();
  await page.keyboard.press("Alt+Shift+ArrowRight");
  await expect.poll(() => names(page)).toEqual(["가상 검토", "TODO", "DONE"]);
  await page.getByRole("button", { name: "되돌리기" }).last().click();
  await expect.poll(() => names(page)).toEqual(["TODO", "가상 검토", "DONE"]);
  // DONE 머리를 TODO 왼쪽 절반에 놓으면 맨 앞
  const todo = page.getByTestId("kanban-col-todo");
  const tb = (await todo.boundingBox())!;
  await head(page, "done").dragTo(todo, { targetPosition: { x: 20, y: tb.height / 2 } });
  await expect.poll(() => names(page)).toEqual(["DONE", "TODO", "가상 검토"]);
  // 오른쪽 끝 세로 [＋ 섹션 추가] 없음
  await expect(page.getByTestId("kanban-board").getByRole("button", { name: "섹션 추가" })).toHaveCount(0);
  // 상단 순서: 배치 토글이 [업무 추가] 앞
  const x = async (id: string) => (await page.getByTestId(id).boundingBox())!.x;
  expect(await x("kanban-layout")).toBeLessThan(await x("category-add"));
  expect(await x("category-add")).toBeLessThan(await x("kanban-add-section"));
});

test("자유 배치: 새 섹션이 보이는 자리에 놓이고 잠깐 강조", async ({ page }) => {
  await openKanban(page);
  await page.getByTestId("kanban-layout-free").click();
  await addSection(page, "가상 보류");
  const item = page
    .getByTestId("kanban-free-item")
    .filter({ has: page.getByTestId("kanban-col-name").getByText("가상 보류", { exact: true }) });
  await expect(item).toBeVisible();
  const board = (await page.getByTestId("kanban-board").boundingBox())!;
  const ib = (await item.boundingBox())!;
  expect(ib.x).toBeGreaterThanOrEqual(board.x - 1);
  expect(ib.x + ib.width).toBeLessThanOrEqual(board.x + board.width + 1);
  expect(ib.y + 40).toBeLessThanOrEqual(board.y + board.height);
  await expect(item.locator("[class*='colFlash']")).toHaveCount(1);
});

test("섹션 아이콘: 머리 아이콘 → 고르기 판 → 바꾸기 · 기본 아이콘 · 섹션 추가 창의 이름 추천", async ({
  page,
}) => {
  await openKanban(page);
  await page.getByTestId("kanban-add-section").click();
  const dlg = page.getByTestId("kanban-section-dialog");
  await dlg.getByRole("textbox").fill("가상 보류");
  await expect(dlg.getByTestId("kanban-section-icon")).toHaveAttribute("data-icon", "pause-button");
  await page.getByTestId("kanban-section-save").click();
  const sec = page.getByTestId("kanban-col-section");
  await expect(sec.getByTestId("kanban-col-icon").locator("svg")).toHaveAttribute(
    "data-icon",
    "pause-button",
  );
  // TODO 기본 📋 → 🚀로
  const todoIcon = page.getByTestId("kanban-col-todo").getByTestId("kanban-col-icon");
  await expect(todoIcon.locator("svg")).toHaveAttribute("data-icon", "clipboard");
  await todoIcon.click();
  const picker = page.getByTestId("kanban-icon-picker");
  await expect(picker.getByTestId("kanban-icon-option")).toHaveCount(36);
  await picker.locator("button[data-icon='rocket']").click();
  await expect(todoIcon.locator("svg")).toHaveAttribute("data-icon", "rocket");
  // 카드 추가 창 섹션 단추에도 같은 아이콘
  await page.locator("[data-testid='kanban-col-todo'] [data-testid='kanban-add-card']").click();
  await expect(page.getByTestId("kanban-item-dialog").locator("svg[data-icon='rocket']")).toHaveCount(1);
  await page.getByTestId("kanban-item-close").click();
  // 기본 아이콘으로
  await todoIcon.click();
  await page.getByTestId("kanban-icon-reset").click();
  await expect(todoIcon.locator("svg")).toHaveAttribute("data-icon", "clipboard");
});

test("카드 추가 창: 줄마다 카드 번호 · 단추 '카드 N장 추가' · 설명 글·매주 반복 체크 없음", async ({
  page,
}) => {
  await openKanban(page);
  const before = await page.getByTestId("kanban-col-todo").getByTestId("kanban-card").count();
  await page.locator("[data-testid='kanban-col-todo'] [data-testid='kanban-add-card']").click();
  const dlg = page.getByTestId("kanban-item-dialog");
  await expect(dlg.getByTestId("kanban-item-cardnum")).toHaveCount(0);
  await dlg.getByTestId("kanban-item-line").first().fill("가상 v23 카드 하나");
  await page.keyboard.press("Enter");
  await page.keyboard.type("가상 v23 카드 둘");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.type("가상 세부");
  await expect(dlg.getByTestId("kanban-item-cardnum")).toHaveText(["카드 1", "카드 2", "세부"]);
  await expect(dlg.getByTestId("kanban-item-save")).toHaveText("카드 2장 추가");
  await expect(dlg).not.toContainText("15분 단위");
  await expect(dlg).not.toContainText("매주 반복");
  await expect(dlg).not.toContainText("DONE으로는");
  await dlg.getByTestId("kanban-item-save").click();
  await expect(page.getByTestId("kanban-col-todo").getByTestId("kanban-card")).toHaveCount(before + 2);
});

test("카드 ⋯ [매주 반복 켜기] → 끄기로 바뀜", async ({ page }) => {
  await openKanban(page);
  const c = page.getByTestId("kanban-card").filter({ hasText: "테스트 데이터 이관 스크립트 작성 착수" });
  await c.hover();
  await c.getByTestId("kanban-card-menu").click();
  await expect(page.getByTestId("kanban-card-repeat")).toContainText("매주 반복 켜기");
  await page.getByTestId("kanban-card-repeat").click();
  await expect(page.getByText(/매주 반복/).first()).toBeVisible();
  const c2 = page.getByTestId("kanban-card").filter({ hasText: "테스트 데이터 이관 스크립트 작성 착수" });
  await c2.hover();
  await c2.getByTestId("kanban-card-menu").click();
  await expect(page.getByTestId("kanban-card-repeat")).toContainText("매주 반복 끄기");
});

test("완료 축하: 끌어 놓기·메뉴 모두 창 안 좌표에 문서 맨 위 레이어로", async ({ page }) => {
  await openKanban(page);
  const inView = async () => {
    const cel = page.getByTestId("kanban-celebrate");
    await expect(cel).toBeVisible();
    const b = (await cel.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(1440);
    expect(b.y + b.height).toBeLessThanOrEqual(900);
    // body 바로 아래(보드 화면 밖) 레이어
    expect(await cel.evaluate((e) => e.parentElement === document.body)).toBe(true);
  };
  await page
    .getByTestId("kanban-card")
    .first()
    .dragTo(page.getByTestId("kanban-col-done"), { targetPosition: { x: 120, y: 300 } });
  await inView();
  await expect(page.getByTestId("kanban-celebrate")).toHaveCount(0, { timeout: 3000 });
  // 메뉴 [→ DONE]
  const c = page.getByTestId("kanban-col-todo").getByTestId("kanban-card").first();
  await c.hover();
  await c.getByTestId("kanban-card-menu").click();
  await page
    .getByRole("menuitem", { name: /DONE/ })
    .or(page.getByRole("button", { name: /DONE/ }))
    .last()
    .click();
  await inView();
});

test("업무 타임라인: 요일 묶음 위아래 실선", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?today=2026-10-22&sample=showcase`);
  await page.getByTestId("week-title").waitFor();
  await page.getByTestId("rail-insights").click();
  const days = page.getByTestId("timeline-week").first().getByTestId("timeline-day");
  await expect(days.first()).toBeVisible();
  const styles = await days.evaluateAll((els) =>
    els.map((e) => {
      const s = getComputedStyle(e);
      return [s.borderTopStyle, s.borderTopWidth, s.borderBottomStyle];
    }),
  );
  expect(styles.every(([t, w]) => t === "solid" && w === "1px")).toBe(true);
  expect(styles.at(-1)![2]).toBe("solid");
});
