import { test, expect } from "@playwright/test";
test("C 팔레트 접기/복귀·위젯 크기 조절·재열기 보존", async ({ page }) => {
  await page.goto("/?today=2026-10-22&sample=showcase");
  await page.getByTestId("week-title").waitFor();
  await page.keyboard.press("Alt+4");
  await page.getByLabel("업무를 선택해 주세요", { exact: true }).selectOption({ index: 1 });
  const p = page.waitForEvent("popup");
  await page.getByTestId("cabi-open-board").click();
  const c = await p;
  const group = c.getByRole("group", { name: "Live Widget", exact: true });
  await expect(group).toBeVisible();
  const palette = c.getByRole("complementary", { name: "객체 도구 팔레트", exact: true });
  await expect(palette.getByText("만들기", { exact: true })).toHaveCount(0);
  await expect(palette.getByText("클립보드", { exact: true })).toHaveCount(0);
  await expect(palette.getByText("Live Widget", { exact: true })).toHaveCount(0);
  await expect(c.getByTestId("note-counts")).toHaveCount(0);
  const xs = await palette
    .locator("button:not([aria-expanded])")
    .evaluateAll((es) => es.map((e) => e.getBoundingClientRect().x));
  expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(1);
  await expect(palette.getByRole("button", { name: "관계선 보기", exact: true })).toHaveCount(1);
  await expect(c.getByRole("group", { name: "보기", exact: true }).getByTestId("note-zoom")).toBeVisible();
  await c.setViewportSize({ width: 640, height: 820 });
  const barBox = await c.getByTestId("note-view-bar").boundingBox(),
    paletteBox = await palette.boundingBox();
  expect(paletteBox!.y).toBeGreaterThanOrEqual(barBox!.y + barBox!.height);
  await c.setViewportSize({ width: 1180, height: 820 });
  await c.getByRole("button", { name: "도구 팔레트 접기", exact: true }).click();
  await expect(group).toBeHidden();
  await expect(c.getByRole("group", { name: "보기", exact: true }).getByTestId("note-zoom")).toBeVisible();
  await c.getByRole("button", { name: "도구 팔레트 펼치기", exact: true }).click();
  await group.getByRole("button", { name: "업무 경과일", exact: true }).click();
  const widget = c.getByTestId("live-widget");
  await widget.hover();
  const grip = widget.locator("[data-frame-grip=se]");
  const r = await grip.boundingBox();
  await c.mouse.move(r!.x + 5, r!.y + 5);
  await c.mouse.down();
  await c.mouse.move(r!.x + 90, r!.y + 75, { steps: 8 });
  await c.mouse.up();
  const frame = await c.evaluate(async () => {
    const { useNote } = (await import(
      "../../src/ui/note/noteStore" + ".ts"
    )) as typeof import("../../src/ui/note/noteStore");
    return useNote.getState().doc.boxes[0]?.frameH;
  });
  expect(frame).toBeGreaterThan(200);
  await c.evaluate(async () => {
    const { flushCabiDocument } = (await import(
      "../../src/ui/cabinet/cabiService" + ".ts"
    )) as typeof import("../../src/ui/cabinet/cabiService");
    await flushCabiDocument();
  });
  await c.reload();
  await expect(c.getByTestId("live-widget")).toBeVisible();
  expect(
    await c.evaluate(async () => {
      const { useNote } = (await import(
        "../../src/ui/note/noteStore" + ".ts"
      )) as typeof import("../../src/ui/note/noteStore");
      return useNote.getState().doc.boxes[0]?.frameH;
    }),
  ).toBe(frame);
});
test("노트 표 행/열 추가와 명확한 버튼", async ({ page }) => {
  await page.goto("/?today=2026-10-22&sample=showcase");
  await page.getByTestId("week-title").waitFor();
  await page.keyboard.press("Alt+4");
  await page.getByLabel("업무를 선택해 주세요", { exact: true }).selectOption({ index: 1 });
  const p = page.waitForEvent("popup");
  await page.getByTestId("cabi-new-note").click();
  const c = await p;
  await c.getByTestId("cabi-note-editor").waitFor();
  await expect(c.getByText("날짜와 무관한 업무 노트", { exact: true })).toHaveCount(0);
  await expect(c.getByRole("button", { name: "이미지 추가", exact: true })).toContainText("이미지");
  await c.getByTestId("cabi-import-input").setInputFiles({
    name: "가상.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("| 구분 | 내용 |\n| --- | --- |\n| 가상 | 검토 |"),
  });
  await c.getByRole("dialog").getByRole("button", { name: "현재 위치에 삽입", exact: true }).click();
  const table = c.locator("[contenteditable=true] table");
  await table.locator("td").first().click();
  await c.getByRole("button", { name: "표 행 메뉴", exact: true }).click();
  await c.getByRole("menuitem", { name: "행 아래에 추가", exact: true }).click();
  await expect(table.locator("tr")).toHaveCount(3);
  await table.locator("td").first().click();
  await c.getByRole("button", { name: "표 열 메뉴", exact: true }).click();
  await c.getByRole("menuitem", { name: "열 오른쪽에 추가", exact: true }).click();
  await expect(table.locator("tr").first().locator("th")).toHaveCount(3);
});
test("Tab 계층 번호와 Shift+Tab 승격·저장 보존", async ({ page }) => {
  await page.goto("/?today=2026-10-22&sample=showcase");
  await page.getByTestId("week-title").waitFor();
  await page.keyboard.press("Alt+4");
  await page.getByLabel("업무를 선택해 주세요", { exact: true }).selectOption({ index: 1 });
  const p = page.waitForEvent("popup");
  await page.getByTestId("cabi-new-note").click();
  const c = await p;
  const editor = c.locator("[contenteditable=true]");
  await editor.waitFor();
  await editor.click();
  await editor.pressSequentially("1. 상위");
  await editor.press("Enter");
  await editor.pressSequentially("하위");
  await editor.press("Tab");
  await expect(editor.locator('[data-cabi-number="1-1."]')).toContainText("하위");
  await editor.press("Enter");
  await editor.pressSequentially("더 아래");
  await editor.press("Tab");
  await expect(editor.locator('[data-cabi-number="1-1-1."]')).toContainText("더 아래");
  await editor.press("Shift+Tab");
  await expect(editor.locator('[data-cabi-number="1-2."]')).toContainText("더 아래");
  await c.evaluate(async () => {
    const { flushCabiDocument } = (await import(
      "../../src/ui/cabinet/cabiService" + ".ts"
    )) as typeof import("../../src/ui/cabinet/cabiService");
    await flushCabiDocument();
  });
  await c.reload();
  await expect(c.locator('[data-cabi-number="1-2."]')).toContainText("더 아래");
});
