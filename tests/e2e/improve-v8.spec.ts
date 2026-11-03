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
