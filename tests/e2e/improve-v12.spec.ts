import { test, expect } from "@playwright/test";
const FIRST = "테스트 데이터 이관 스크립트 작성 착수";
const root = (page: import("@playwright/test").Page) =>
  page.getByTestId("cell-차세대 정산 시스템 구축-2026-10-22").locator("[data-item-index]").first();
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?today=2026-10-22");
  await expect(page.locator(":focus")).toHaveValue(FIRST);
});
test("ordinary completion uses an icon, strikes only text and survives week switching; undo preserves importance", async ({
  page,
}) => {
  const row = root(page);
  const previous = await row.getAttribute("data-flagged");
  const text = row.locator("textarea");
  const content = await text.inputValue();
  const toggle = row.getByTestId("item-completion");
  await expect(toggle.locator("svg")).toHaveCount(1);
  await toggle.click();
  await expect(row).toHaveAttribute("data-done", "true");
  await expect(text).toHaveCSS("text-decoration-line", "line-through");
  await expect(text).toHaveValue(content);
  await page.keyboard.press("Alt+ArrowRight");
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(root(page)).toHaveAttribute("data-done", "true");
  await root(page).getByTestId("item-completion").click();
  await expect(root(page)).not.toHaveAttribute("data-done", "true");
  expect(await root(page).getAttribute("data-flagged")).toBe(previous);
  await expect(root(page).locator("textarea")).toHaveCSS("text-decoration-line", "none");
});
test("completion in Important panel updates the same row and inline undo restores its star", async ({
  page,
}) => {
  await page.keyboard.press("Alt+KeyI");
  const panel = page.getByTestId("important-panel");
  if (!(await panel.isVisible())) await page.getByTestId("rail-important").click();
  await panel.getByRole("button", { name: `처리 완료: ${FIRST}`, exact: true }).click();
  await expect(root(page)).toHaveAttribute("data-done", "true");
  await expect(root(page).locator("textarea")).toHaveCSS("text-decoration-line", "line-through");
  await root(page).getByTestId("item-completion").click();
  await expect(root(page)).toHaveAttribute("data-flagged", "true");
});
test("rail gap is reserved before flagging and the body stays aligned after flagging", async ({ page }) => {
  const row = root(page);
  const before = await row.locator("textarea").boundingBox();
  await page.keyboard.press("Alt+KeyI");
  await expect(row).toHaveAttribute("data-flagged", "true");
  const after = await row.locator("textarea").boundingBox();
  expect(after?.x).toBe(before?.x);
  const marker = await row
    .locator("button")
    .filter({ has: page.locator("svg") })
    .first()
    .boundingBox();
  expect(marker).not.toBeNull();
  await expect(row).toHaveCSS("border-top-right-radius", "0px");
});

test("copy preview excludes a completed parent and its unfinished child without falling back to older records", async ({
  page,
}) => {
  await page.getByTestId("category-add").click();
  const dialog = page.getByTestId("category-create");
  await dialog.getByLabel("업무 이름", { exact: true }).fill("v12 가상");
  await dialog.getByRole("button", { name: "업무 추가", exact: true }).click();
  const write = async (date: string, text: string) => {
    const cell = page.getByTestId(`cell-v12 가상-${date}`);
    await cell.locator("[data-cell-editor]").click({ position: { x: 8, y: 8 } });
    await page.locator(":focus").fill(text);
    await page.keyboard.press("Tab");
    return cell;
  };
  await write("2026-10-20", "가상 오래된 기록");
  const source = page.getByTestId("cell-v12 가상-2026-10-21");
  await source.locator("[data-cell-editor]").click({ position: { x: 8, y: 8 } });
  await page.locator(":focus").fill("가상 부모");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.locator(":focus").fill("가상 하위");
  await source.getByTestId("item-completion").first().click();
  await expect(source.locator("[data-item-index]").first()).toHaveAttribute("data-done", "true");
  const target = page.getByTestId("cell-v12 가상-2026-10-22");
  if (await target.locator("textarea").count()) await target.locator("textarea").first().focus();
  else await target.locator("[data-cell-editor]").click({ position: { x: 8, y: 8 } });
  await page.getByTestId("summary-toggle").focus();
  await expect(target.getByTestId("pull-previous")).toBeDisabled();
  await expect(target.getByTestId("pull-previous")).toHaveAttribute(
    "title",
    "직전 기록은 모두 완료되어 가져올 항목이 없습니다.",
  );
  await source.getByTestId("item-completion").first().click();
  await page.getByTestId("summary-toggle").focus();
  await expect(target.getByTestId("pull-previous")).toBeEnabled();
  await target.getByTestId("pull-previous").click();
  await expect(target.locator("textarea").first()).toHaveValue("가상 부모");
  await expect(target.locator("textarea").nth(1)).toHaveValue("가상 하위");
});
