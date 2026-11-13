// 개선 v21(improve-v21-spec): 칸반 보드 — 레일·Alt+6·카드·끌어 놓기·세부 자동 완료·섹션·이력·항목 추가·일괄 완료·중요 업무 연동. 가상 샘플만.
import { expect, test, type Page } from "@playwright/test";

const TODAY = "2026-10-22";

async function openKanban(page: Page, sample = "&sample=showcase") {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?today=${TODAY}${sample}`);
  await page.getByTestId("week-title").waitFor();
  await page.getByTestId("rail-kanban").click();
  await expect(page.getByTestId("kanban-view")).toBeVisible();
}
const col = (page: Page, which: "todo" | "done" | "section") => page.getByTestId(`kanban-col-${which}`);
const card = (page: Page, text: string) =>
  page
    .getByTestId("kanban-card")
    .filter({ has: page.getByTestId("kanban-card-text").getByText(text, { exact: true }) });

test("레일·Alt+6: 칸반 = 주간 보드와 인사이트 사이, 기본 기간 이번 주, Alt+1로 주간 보드", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?today=${TODAY}&sample=showcase`);
  await page.getByTestId("week-title").waitFor();
  const rail = await page
    .locator("nav [data-testid^='rail-']")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
  expect(rail.indexOf("rail-kanban")).toBe(rail.indexOf("rail-board") + 1);
  expect(rail.indexOf("rail-insights")).toBe(rail.indexOf("rail-kanban") + 1);
  await page.keyboard.press("Alt+Digit6");
  await expect(page.getByTestId("kanban-view")).toBeVisible();
  // 상단 한 줄(improve-v22-spec 5절): 제목 글자 없이 업무 거르기·기간부터, 오른쪽은 주간 보드와 같은 [업무 추가]
  await expect(page.getByTestId("kanban-title")).toHaveCount(0);
  await expect(page.getByTestId("category-add")).toBeVisible();
  // 기간 = 아이콘 세그먼트(A안): 이름은 aria-label, 툴팁에 실제 날짜
  const on = page.getByTestId("kanban-period").locator("[aria-pressed=true]");
  await expect(on).toHaveAttribute("aria-label", "이번 주");
  await expect(on).toHaveAttribute("title", "이번 주 · 10/19 (월) ~ 10/25 (일)");
  await expect(page.getByTestId("kanban-period").locator("button")).toHaveCount(7);
  await expect(page.getByTestId("kanban-period").locator("button").first()).toHaveText("");
  await expect(card(page, "테스트 데이터 이관 스크립트 작성 착수")).toHaveCount(1);
  // 중요 업무 패널은 그대로 왼쪽
  await expect(page.getByTestId("important-panel")).toBeVisible();
  await page.keyboard.press("Alt+Digit1");
  await expect(page.getByTestId("kanban-view")).toHaveCount(0);
  await expect(page.getByTestId("week-title")).toBeVisible();
});

test("끌어 DONE에 놓으면 완료 + 세부 함께 · 되돌리기 · 주간 보드에도 완료 표시", async ({ page }) => {
  await openKanban(page);
  const c = card(page, "A협력사 현장 점검");
  await expect(c.getByTestId("kanban-card-child")).toHaveCount(1);
  await c.dragTo(col(page, "done"));
  const row = page.getByTestId("kanban-done-row").filter({ hasText: "A협력사 현장 점검" });
  await expect(row).toHaveCount(1);
  // 놓은 뒤 끌기 표시(반투명)가 남지 않음 — 원래 요소는 다른 열로 옮겨져 dragend를 받지 못함
  await expect(row).not.toHaveClass(/cardDragging/);
  await expect(page.getByRole("status").filter({ hasText: "세부 항목 1개도 함께 완료" })).toBeVisible();
  // 펼치면 세부도 취소선(완료)
  await row.click();
  const open = card(page, "A협력사 현장 점검");
  await expect(open.getByTestId("kanban-card-child")).toHaveClass(/childDone/);
  // 주간 보드에서도 완료
  await page.keyboard.press("Alt+Digit1");
  await expect(
    page.getByTestId("cell-협력사 보안 점검-2026-10-21").getByTestId("done-badge").first(),
  ).toBeVisible();
  // 칸반으로 돌아와 되돌리기(알림)
  await page.keyboard.press("Alt+Digit6");
  await page
    .getByTestId("kanban-done-row")
    .filter({ hasText: "A협력사 현장 점검" })
    .dragTo(col(page, "todo"));
  await expect(card(page, "A협력사 현장 점검").getByTestId("kanban-card-child")).not.toHaveClass(/childDone/);
});

test("섹션 추가 → 카드 옮기기 → 상태 이력 · ★ 항목은 사용자 섹션에서도 중요 목록에(섹션 칩) · 섹션 삭제 = TODO로", async ({
  page,
}) => {
  await openKanban(page);
  await page.getByTestId("kanban-add-section").click();
  await page.getByTestId("kanban-section-dialog").getByRole("textbox").fill("Parking Lot");
  await page.getByTestId("kanban-section-save").click();
  await expect(col(page, "section").getByTestId("kanban-col-name")).toHaveText("Parking Lot");
  // 섹션 색 = 무채색 2가지: TODO·사용자 섹션 같은 회색, DONE만 다름(채도 0)
  const headColor = (w: "todo" | "done" | "section") =>
    col(page, w).evaluate((el) => getComputedStyle(el.firstElementChild as Element).borderTopColor);
  const todoC = await headColor("todo");
  expect(await headColor("section")).toBe(todoC);
  expect(await headColor("done")).not.toBe(todoC);
  for (const c of [todoC, await headColor("done")]) {
    const [r, g, b] = c.match(/\d+/g)!.map(Number);
    expect(r === g && g === b).toBe(true);
  }
  await expect(page.getByTestId("kanban-section-dialog")).toHaveCount(0);
  // 같은 이름은 거절
  await page.getByTestId("kanban-add-section").click();
  await page.getByTestId("kanban-section-dialog").getByRole("textbox").fill("parking lot");
  await page.getByTestId("kanban-section-save").click();
  await expect(page.getByTestId("kanban-section-error")).toContainText("같은 이름");
  await page.keyboard.press("Escape");
  const star = card(page, "개발계 1차 배포 일정 확정(11/2)");
  await expect(page.getByTestId("important-panel")).toContainText("개발계 1차 배포 일정 확정(11/2)");
  await star.dragTo(col(page, "section"));
  await expect(col(page, "section").getByTestId("kanban-card")).toHaveCount(1);
  await expect(col(page, "section").getByTestId("kanban-since")).toBeVisible();
  // v23: 사용자 섹션으로 옮겨도 미완료 ★는 중요 목록에 남고 섹션 칩이 붙는다
  await expect(page.getByTestId("important-panel")).toContainText("개발계 1차 배포 일정 확정(11/2)");
  await expect(page.getByTestId("important-section-chip").first()).toContainText("Parking Lot");
  // 이력
  const moved = col(page, "section").getByTestId("kanban-card");
  await moved.hover();
  await moved.getByTestId("kanban-card-menu").click();
  await page.getByTestId("kanban-history").click();
  await expect(page.getByTestId("kanban-history-table")).toContainText("TODO");
  await expect(page.getByTestId("kanban-history-table")).toContainText("Parking Lot");
  await expect(page.getByTestId("kanban-history-table")).toContainText("칸반");
  await page.keyboard.press("Escape");
  // 섹션 삭제 → 카드는 TODO로, ★ 다시 중요 목록에
  await col(page, "section").getByTestId("kanban-col-menu").click();
  await page.getByTestId("kanban-section-delete").click();
  await expect(page.getByTestId("kanban-section-confirm")).toContainText("카드 1개");
  await page.getByTestId("kanban-section-confirm-delete").click();
  await expect(col(page, "section")).toHaveCount(0);
  await expect(card(page, "개발계 1차 배포 일정 확정(11/2)")).toHaveCount(1);
  await expect(page.getByTestId("important-panel")).toContainText("개발계 1차 배포 일정 확정(11/2)");
});

test("업무 항목 추가 창: 업무·날짜(기본 오늘)·세부(Tab)·★ → 카드 + 주간 보드 칸에 기록", async ({ page }) => {
  await openKanban(page);
  await col(page, "todo").getByTestId("kanban-add-card").click();
  const dlg = page.getByTestId("kanban-item-dialog");
  await expect(dlg.getByTestId("kanban-item-date")).toHaveValue(TODAY);
  await dlg.getByTestId("kanban-item-category").selectOption({ label: "사내 데이터 대시보드" });
  const line = dlg.getByTestId("kanban-item-line");
  await line.first().fill("가상 칸반 추가 항목");
  await page.keyboard.press("Alt+KeyI");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.type("가상 세부 하나");
  await expect(line).toHaveCount(2);
  await dlg.getByTestId("kanban-item-save").click();
  await expect(dlg).toHaveCount(0);
  const c = card(page, "가상 칸반 추가 항목");
  await expect(c).toHaveCount(1);
  await expect(c.getByTestId("kanban-card-child")).toHaveText(["가상 세부 하나"]);
  await expect(page.getByTestId("important-panel")).toContainText("가상 칸반 추가 항목");
  await page.keyboard.press("Alt+Digit1");
  await expect(
    page.getByTestId(`cell-사내 데이터 대시보드-${TODAY}`).locator("textarea").first(),
  ).toHaveValue("가상 칸반 추가 항목");
});

test("일괄 완료: 미리 보기 → 완료(기록일로) → 최근 일괄 처리에서 되돌리기", async ({ page }) => {
  await openKanban(page);
  await page.getByTestId("kanban-period").locator("[data-period=all]").click();
  const before = await col(page, "todo").getByTestId("kanban-card").count();
  await col(page, "todo").getByTestId("kanban-col-menu").click();
  await page.getByTestId("kanban-bulk").click();
  const dlg = page.getByTestId("kanban-bulk-dialog");
  await dlg.getByTestId("kanban-bulk-before").fill("2026-10-21");
  await expect(dlg.getByTestId("kanban-bulk-summary")).toContainText("대상 본 항목");
  const n = Number((await dlg.getByTestId("kanban-bulk-run").textContent())!.match(/\d+/)![0]);
  expect(n).toBeGreaterThan(0);
  await dlg.getByTestId("kanban-bulk-run").click();
  await expect(col(page, "todo").getByTestId("kanban-card")).toHaveCount(before - n);
  await col(page, "todo").getByTestId("kanban-col-menu").click();
  await page.getByRole("button", { name: "최근 일괄 처리" }).click();
  await page.getByTestId("kanban-bulk-undo").first().click();
  await expect(col(page, "todo").getByTestId("kanban-card")).toHaveCount(before);
});

test("중요 업무 목록에서 체크 = DONE · 누르면 칸반 카드 강조(주간 보드로 가지 않음)", async ({ page }) => {
  await openKanban(page);
  const panel = page.getByTestId("important-panel");
  await panel.getByText("개발계 1차 배포 일정 확정(11/2)").first().click();
  await expect(page.getByTestId("kanban-view")).toBeVisible();
  await expect(card(page, "개발계 1차 배포 일정 확정(11/2)")).toHaveClass(/cardHighlight/);
  await panel
    .getByRole("button", { name: /처리 완료: 개발계 1차 배포 일정 확정/ })
    .first()
    .click();
  await expect(
    page.getByTestId("kanban-done-row").filter({ hasText: "개발계 1차 배포 일정 확정(11/2)" }),
  ).toHaveCount(1);
});

test("타임라인 T1 요일별 묶음 · T2 기록일이 아닌 날 완료 = 실제 완료일", async ({ page }) => {
  await openKanban(page);
  // 10/21(수) 기록을 칸반에서 완료 → 완료일(오늘 시계) ≠ 기록일 → 완료일 칩
  await card(page, "A협력사 현장 점검").dragTo(col(page, "done"));
  await expect(page.getByTestId("kanban-done-row").filter({ hasText: "A협력사 현장 점검" })).toHaveCount(1);
  await page.getByTestId("rail-insights").click();
  await page.getByTestId("insight-category").filter({ hasText: "협력사 보안 점검" }).click();
  const w43 = page.locator('[data-testid="timeline-week"][data-week="2026-W43"]');
  await expect(w43).toBeVisible();
  // T1: 날짜마다 요일 묶음 하나(같은 날짜가 두 번 나오지 않음)
  const dates = await w43
    .getByTestId("timeline-day")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-date")));
  expect(dates.length).toBeGreaterThan(0);
  expect(new Set(dates).size).toBe(dates.length);
  const wed = w43.locator('[data-testid="timeline-day"][data-date="2026-10-21"]');
  await expect(wed).toContainText("수");
  await expect(wed).toContainText("10/21");
  // T2: 완료 항목에 실제 완료일
  const item = wed.getByTestId("timeline-item").filter({ hasText: "A협력사 현장 점검" });
  await expect(item.getByTestId("timeline-done")).toBeVisible();
  await expect(item.getByTestId("timeline-done-later")).toHaveText(
    /^완료 \d{4}-\d{2}-\d{2} \([월화수목금토일]\)$/,
  );
});

test("설정 › 화면 › 시작 화면 = 칸반 보드 저장", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?today=${TODAY}&sample=showcase`);
  await page.getByTestId("week-title").waitFor();
  await page.getByTestId("rail-settings").click();
  await page.locator("#settings-tab-screen").click();
  await expect(page.getByTestId("start-view-select")).toHaveValue("board");
  await page.getByTestId("start-view-select").selectOption("kanban");
  await page.getByTestId("rail-board").click();
  await page.getByTestId("rail-settings").click();
  await page.locator("#settings-tab-screen").click();
  await expect(page.getByTestId("start-view-select")).toHaveValue("kanban");
});

test("Cabi.NET 줄을 카드에 끌어 놓으면 그 항목에 연결(카드에 🗄 수)", async ({ page }) => {
  await openKanban(page);
  const c = card(page, "A협력사 현장 점검");
  await expect(c.getByTestId("kanban-cabinet-count")).toHaveCount(0);
  await page.getByTestId("rail-cabinet").click();
  await expect(page.getByTestId("cabinet")).toBeVisible();
  // Cabi.NET은 별도 창(실앱)·떠 있는 창(브라우저 모드)이라 같은 DataTransfer로 끌기 → 놓기를 이어 보낸다
  const row = await page.getByTestId("cabinet-row").first().elementHandle();
  await c.evaluate((target, src) => {
    const dt = new DataTransfer();
    src!.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    src!.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
  }, row);
  await expect(page.getByRole("status").filter({ hasText: "이 항목에 연결했습니다" })).toBeVisible();
  await expect(c.getByTestId("kanban-cabinet-count")).toBeVisible();
});
