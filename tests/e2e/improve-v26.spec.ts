// 개선 v26(improve-v26-spec): 업무 시작일 바꾸기 · Cabi.NET 업무노트 끌어 옮기기 · 폴더·링크 삭제 단추·‘업무’에서 빼기
import { test, expect, type Page } from "@playwright/test";

const TODAY = "2026-10-22"; // 2026-W43

test("업무 시작일 바꾸기: 이번 주에 만든 업무를 지난 주들에도 빈 업무로 · 오늘 이후는 거절 · 되돌리기", async ({
  page,
}) => {
  await page.goto(`/?today=${TODAY}`);
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
  await page.getByTestId("category-add").click();
  await page.keyboard.type("분기 결산 지원");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  const header = () => page.getByTestId("category-header").filter({ hasText: "분기 결산 지원" });
  await expect(header()).toBeVisible();
  await page.keyboard.press("Alt+ArrowLeft"); // W42 — 아직 없음
  await expect(page.getByTestId("week-title")).toContainText("2026-W42");
  await expect(header()).toHaveCount(0);
  await page.keyboard.press("Alt+ArrowRight");

  await header().getByRole("button", { name: "분기 결산 지원 메뉴" }).click();
  await page.getByTestId("category-start").click();
  const input = page.getByTestId("category-start-input");
  await expect(input).toHaveValue("2026-10-19");
  await input.fill("2026-12-01");
  await page.getByTestId("category-start-apply").click();
  await expect(page.getByRole("alert")).toHaveText("오늘 이후로는 바꿀 수 없습니다");
  await input.fill("2026-10-05");
  await page.getByTestId("category-start-apply").click();
  await expect(page.getByText("‘분기 결산 지원’ 시작일을 2026-10-05로 바꿨습니다")).toBeVisible();

  await page.keyboard.press("Alt+ArrowLeft"); // W42
  await expect(header()).toBeVisible();
  await page.keyboard.press("Alt+ArrowLeft"); // W41(10/5~)
  await expect(page.getByTestId("week-title")).toContainText("2026-W41");
  await expect(header()).toBeVisible();
  await page.keyboard.press("Alt+ArrowLeft"); // W40
  await expect(header()).toHaveCount(0);

  // 되돌리기 = 이전 시작일(W43)
  await page.getByRole("button", { name: "되돌리기" }).last().click();
  await page.keyboard.press("Alt+ArrowRight"); // W41
  await expect(header()).toHaveCount(0);
});

async function hub(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/?today=${TODAY}&sample=showcase`);
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
  await page.keyboard.press("Alt+4");
  await expect(page.getByTestId("cabi-hub")).toBeVisible();
}

test("Cabi.NET: 업무노트를 왼쪽 다른 업무에 끌어 놓으면 그 업무로 옮겨진다(본문 그대로)", async ({
  page,
}) => {
  await hub(page);
  const groups = page.locator(
    '[data-testid^="cabinet-group-"]:not([data-testid$="__all__"]):not([data-testid$="__none__"])',
  );
  const from = (await groups.nth(0).getAttribute("data-testid"))!;
  const to = (await groups.nth(1).getAttribute("data-testid"))!;
  await page.getByTestId(from).click();
  const popup = page.waitForEvent("popup");
  await page.getByTestId("cabi-new-note").click();
  const child = await popup;
  await child.getByLabel("노트 제목", { exact: true }).fill("옮길 가상 노트");
  await child.getByTestId("cabi-note-editor").click();
  await child.keyboard.type("가상 본문");
  // 자동 저장을 기다린 뒤 닫는다(CI처럼 느린 환경에서 제목이 저장되기 전에 닫히지 않게)
  const row = page.getByTestId("cabi-note-row").filter({ hasText: "옮길 가상 노트" });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await child.close();

  await row.getByRole("button", { name: "보드로 끌어 원본 연결" }).dragTo(page.getByTestId(to));
  await expect(page.getByText(/‘옮길 가상 노트’ 노트를 ‘.+’\(으\)로 옮겼습니다/)).toBeVisible();
  await expect(page.getByTestId("cabi-note-row").filter({ hasText: "옮길 가상 노트" })).toHaveCount(0);
  await page.getByTestId(to).click();
  await expect(page.getByTestId("cabi-note-row").filter({ hasText: "옮길 가상 노트" })).toBeVisible();
});
