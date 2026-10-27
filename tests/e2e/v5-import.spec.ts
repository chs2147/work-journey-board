// 디자인 개선 v5 Y2 E2E(improve-1027v5-spec 3절): 가져오기 마법사 — 원 + 선 단계 표시(지난 단계 눌러 돌아가기) ·
// 진행 순서 상자(묶음 제목 글상자 A·B·C, 1·2단계 줄 안 단추) · AI 지시문 코드 블록(빈칸 강조·[복사] → 복사됨). 가상 샘플만.
import { expect, test, type Page } from "@playwright/test";
import { openSettings } from "./settings-helper";

const wizard = (page: Page) => page.getByTestId("import-wizard");
const steps = (page: Page) => page.getByTestId("import-steps");
const clipboard = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as { __wjb: { clipboard(): string | null } }).__wjb.clipboard());

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?today=2026-10-22");
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
  await openSettings(page, "import");
  await page.getByRole("button", { name: "기존 일지 가져오기…" }).click();
  await expect(wizard(page)).toBeVisible();
});

test("단계 표시: 지금 단계 강조 · 다음으로 가면 지난 단계 ✓ — 누르면 그 단계로 돌아감", async ({ page }) => {
  const current = steps(page).locator('[aria-current="step"]');
  await expect(current).toContainText("준비");
  await expect(current).toContainText("양식·지시문");
  await expect(steps(page)).toContainText("엑셀·표 붙여넣기");
  await expect(wizard(page)).toContainText("1 / 4 단계");

  await wizard(page).getByRole("button", { name: "다음 — 파일 고르기" }).click();
  await expect(current).toContainText("파일");
  await expect(wizard(page)).toContainText("2 / 4 단계");
  const back = steps(page).getByRole("button", { name: "1단계 준비(으)로 돌아가기" });
  await expect(back).toBeVisible();
  // 남은 단계는 누를 수 없다
  await expect(steps(page).getByRole("button")).toHaveCount(1);
  await back.click();
  await expect(current).toContainText("준비");
  await expect(page.getByTestId("import-procedure")).toBeVisible();
});

test("진행 순서: 다른 바탕 상자 + 묶음 제목 글상자 A·B·C(정사각형) · 1·2단계 줄 끝에 그 단추", async ({
  page,
}) => {
  const proc = page.getByTestId("import-procedure");
  await expect(proc.locator("li")).toHaveCount(8);
  await expect(proc).toContainText("진행 순서");
  for (const name of ["앱에서 준비", "사내 AI로 옮기기", "앱으로 가져오기"])
    await expect(proc.getByText(name, { exact: true })).toBeVisible();
  const look = await proc.evaluate((el) => {
    const head = el.querySelector("[class*='phaseHead']")!;
    const key = el.querySelector("[class*='phaseKey']")!;
    const k = getComputedStyle(key);
    return {
      box: getComputedStyle(el).backgroundColor,
      head: getComputedStyle(head).backgroundColor,
      key: { w: k.width, h: k.height, border: k.borderTopWidth, radius: parseFloat(k.borderTopLeftRadius) },
    };
  });
  expect(look.box).toBe("rgb(241, 239, 232)"); // --surface-sub
  expect(look.head).toBe("rgb(255, 255, 255)"); // 상자와 다른 글상자 바탕
  expect(look.key.w).toBe(look.key.h); // 정사각형
  expect(parseFloat(look.key.border)).toBeGreaterThanOrEqual(1);
  expect(look.key.radius).toBeLessThan(5);
  await expect(proc.locator("li").nth(0).getByRole("button", { name: "양식 엑셀 받기" })).toBeVisible();
  await expect(proc.locator("li").nth(1).getByRole("button", { name: "AI 지시문 복사" })).toBeVisible();
});

test("AI 지시문: 접힘 → 펼치면 코드 블록(머리 띠·N줄·빈칸 강조) · [복사] → 2초 '복사됨'", async ({
  page,
}) => {
  const toggle = page.getByTestId("import-prompt-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("import-prompt")).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const pre = page.getByTestId("import-prompt");
  await expect(pre).toContainText("[이 캡처의 주 시작일(월요일)]");
  await expect(pre.locator("mark")).toHaveText("____-__-__");
  expect(await pre.evaluate((el) => getComputedStyle(el).fontFamily)).toContain("Consolas");
  await expect(wizard(page)).toContainText(/일반 텍스트 · \d+줄/);

  const copy = page.getByTestId("import-prompt-copy");
  await expect(copy).toHaveText("복사");
  await copy.click();
  await expect(copy).toHaveText("복사됨");
  expect(await clipboard(page)).toContain("요일이나 날짜에 속하지 않는 칸");
  await expect(copy).toHaveText("복사", { timeout: 4000 });
});
