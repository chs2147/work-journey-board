import { expect, test, type Page } from "@playwright/test";

// 멀티 보드 = 워크스페이스(multi-board-spec): 공간마다 폴더·일지 파일 1개, 레일 맨 위 공간 단추(모노그램), 4단계 만들기
const TODAY = "2026-10-22";
const headers = (page: Page) => page.getByTestId("category-header");

async function open(page: Page, extra = "") {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?today=${TODAY}${extra}`);
  await expect(page.getByTestId("workspace-button")).toBeVisible();
}

test("예전 판에서 올라온 사용자: 공간 1개(회사·서류 가방) — 상단 이름·색 띠 없음, 창 제목 그대로", async ({
  page,
}) => {
  await open(page);
  const btn = page.getByTestId("workspace-button");
  await expect(btn).toHaveAttribute("aria-label", /워크스페이스: 회사/);
  await expect(btn.locator("[data-icon]")).toHaveAttribute("data-icon", "briefcase");
  await expect(btn).not.toContainText("회"); // 글자가 아니라 모노그램
  await expect(page.getByTestId("workspace-name")).toHaveCount(0);
  await expect(page).toHaveTitle("Work Journey Board");
  await btn.click();
  await expect(page.getByTestId("workspace-item")).toHaveCount(1);
  await expect(page.getByTestId("workspace-new")).toBeVisible();
});

test("목록 팝업·단축키로 전환: 기록이 공간마다 따로, 창 제목·상단 이름·레일 아이콘이 바뀐다", async ({
  page,
}) => {
  await open(page, "&ws=2");
  await expect(page).toHaveTitle("Work Journey Board — 회사");
  await expect(page.getByTestId("workspace-name")).toHaveText("회사");
  const companyCats = await headers(page).count();
  expect(companyCats).toBeGreaterThan(0);

  await page.getByTestId("workspace-button").click();
  const items = page.getByTestId("workspace-item");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText("Ctrl+Alt+1");
  await expect(items.nth(0)).toHaveAttribute("aria-current", "true");
  await expect(items.nth(0)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page).toHaveTitle("Work Journey Board — 개인");
  await expect(page.getByTestId("workspace-name")).toHaveText("개인");
  await expect(page.getByTestId("workspace-button").locator("[data-icon]")).toHaveAttribute(
    "data-icon",
    "notebook",
  );
  await expect(headers(page)).toHaveCount(0); // 개인 공간은 빈 일지
  await expect(page.getByRole("status").filter({ hasText: "개인 워크스페이스" })).toBeVisible();

  // 개인 공간에 업무 하나 → 회사로 갔다 와도 섞이지 않는다
  await page.getByPlaceholder("업무 이름 입력 후 Enter (Esc 닫기)").fill("운동");
  await page.keyboard.press("Enter");
  await expect(headers(page)).toHaveCount(1);
  await page.keyboard.press("Control+Alt+Digit1");
  await expect(page).toHaveTitle("Work Journey Board — 회사");
  await expect(headers(page)).toHaveCount(companyCats);
  await expect(headers(page).filter({ hasText: "운동" })).toHaveCount(0);
  await page.keyboard.press("Control+Alt+Digit2");
  await expect(page).toHaveTitle("Work Journey Board — 개인");
  await expect(headers(page).filter({ hasText: "운동" })).toHaveCount(1);
  // Ctrl+Alt+0 = 목록, Esc 닫기
  await page.keyboard.press("Control+Alt+Digit0");
  await expect(page.getByTestId("workspace-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("workspace-menu")).toHaveCount(0);
});

test("새 워크스페이스 4단계: 이름·색·아이콘·용도 → 추천 폴더 → 첫 업무 → 설정 복사 → 그 공간이 열린다", async ({
  page,
}) => {
  await open(page);
  await page.getByTestId("workspace-button").click();
  await page.getByTestId("workspace-new").click();
  const dlg = page.getByTestId("new-workspace");
  await expect(dlg.getByTestId("ws-step")).toHaveText("1 / 4");
  await expect(dlg.getByTestId("ws-next")).toBeDisabled(); // 이름이 있어야
  await dlg.getByTestId("ws-name").fill("공부");
  await dlg.locator('[data-purpose="study"]').click();
  // 용도를 고르면 기본 아이콘이 따라 바뀐다(책), 직접 고르면 그걸로
  await expect(dlg.getByTestId("ws-icons").locator('[aria-checked="true"]')).toHaveAttribute(
    "data-icon",
    "books",
  );
  await dlg.getByTestId("ws-icons").locator('[data-icon="bulb"]').click();
  await dlg.getByTestId("ws-colors").locator('[data-color="c7"]').click();
  await dlg.getByTestId("ws-next").click();

  await expect(dlg.getByTestId("ws-step")).toHaveText("2 / 4");
  await expect(dlg.getByTestId("ws-dir")).toHaveText("/demo/WorkJourney-공부");
  await dlg.getByTestId("ws-next").click();

  await expect(dlg.getByTestId("ws-step")).toHaveText("3 / 4");
  await expect(dlg).toContainText("강의");
  await dlg.getByTestId("ws-cat-input").fill("영어");
  await page.keyboard.press("Enter");
  await dlg.getByTestId("ws-next").click();

  await expect(dlg.getByTestId("ws-step")).toHaveText("4 / 4");
  await expect(dlg.getByTestId("ws-copy-holiday")).toBeChecked();
  await expect(dlg).toContainText("(개인 생활·공부는 기본 끔)");
  await dlg.getByTestId("ws-finish").click();

  await expect(dlg).toHaveCount(0);
  await expect(page).toHaveTitle("Work Journey Board — 공부");
  await expect(headers(page)).toHaveText([/강의/, /과제/, /독서/, /영어/]);
  const btn = page.getByTestId("workspace-button");
  await expect(btn.locator("[data-icon]")).toHaveAttribute("data-icon", "bulb");
  await btn.click();
  await expect(page.getByTestId("workspace-item")).toHaveCount(2);
  await expect(page.getByTestId("workspace-item").nth(1)).toContainText("/demo/WorkJourney-공부");
});

test("설정 > 워크스페이스: 이름·색·아이콘 바꾸기, 순서, 목록에서 빼기(파일은 그대로)", async ({ page }) => {
  await open(page, "&ws=2");
  await page.getByTestId("workspace-button").click();
  await page.getByTestId("workspace-manage").click();
  const view = page.getByTestId("workspace-settings");
  await expect(view).toBeVisible();
  const rows = view.getByTestId("workspace-row");
  await expect(rows).toHaveCount(2);
  // 지금 연 공간은 뺄 수 없다
  await expect(rows.nth(0).getByTestId("ws-remove")).toBeDisabled();

  await rows.nth(0).getByTestId("ws-edit").click();
  const edit = view.getByTestId("ws-edit-row");
  await edit.getByTestId("ws-name").fill("본업");
  await edit.getByTestId("ws-icons").locator('[data-icon="chartUp"]').click();
  await edit.getByTestId("ws-colors").locator('[data-color="c6"]').click();
  await edit.getByTestId("ws-edit-save").click();
  await expect(page).toHaveTitle("Work Journey Board — 본업");
  await expect(page.getByTestId("workspace-button").locator("[data-icon]")).toHaveAttribute(
    "data-icon",
    "chartUp",
  );

  // 순서: 개인을 위로 → Ctrl+Alt+1 = 개인
  await rows.nth(1).getByRole("button", { name: "개인 위로" }).click();
  await expect(rows.nth(0)).toContainText("개인");
  await expect(rows.nth(0)).toContainText("Ctrl+Alt+1");

  // 목록에서 빼기(개인 — 지금 연 공간이 아님)
  await rows.nth(0).getByTestId("ws-remove").click();
  await expect(view).toContainText("폴더와 일지 파일은 그대로 남습니다");
  await view.getByTestId("ws-remove-confirm").click();
  await expect(rows).toHaveCount(1);
  await expect(page).toHaveTitle("Work Journey Board"); // 공간이 하나면 창 제목에 이름 없음
  const files = await page.evaluate(() =>
    (globalThis as unknown as { __wjb: { files(): string[] } }).__wjb.files(),
  );
  expect(files).toContain("/demo/WorkJourney-개인/work-journey.db");
});

test("이름을 바꾼 공간은 다음에 열 때 그 일지에도 반영된다(이 PC 사본이 더 새것)", async ({ page }) => {
  await open(page, "&ws=2");
  await page.getByTestId("workspace-button").click();
  await page.getByTestId("workspace-manage").click();
  const rows = page.getByTestId("workspace-row");
  await rows.nth(1).getByTestId("ws-edit").click();
  await page.getByTestId("ws-edit-row").getByTestId("ws-name").fill("가족");
  await page.getByTestId("ws-edit-save").click();
  await expect(rows.nth(1)).toContainText("가족");
  await rows.nth(1).getByTestId("ws-open").click();
  await expect(page).toHaveTitle("Work Journey Board — 가족");
});
