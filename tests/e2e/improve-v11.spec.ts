import { expect, test, type Page } from "@playwright/test";

async function dropMarkdown(page: Page, name: string, text: string) {
  await page.evaluate(
    ({ name, text }) => {
      const canvas = document.querySelector("[data-note-drop]")!;
      const dt = new DataTransfer();
      dt.items.add(new File([text], name, { type: "text/markdown" }));
      canvas.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
          clientX: canvas.getBoundingClientRect().left + 64,
          clientY: canvas.getBoundingClientRect().top + 64,
        }),
      );
    },
    { name, text },
  );
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?today=2026-10-22");
  await expect(page.getByTestId("category-header")).toHaveCount(4);
  await expect(page.locator("[data-note-drop]")).toBeVisible();
});

test("상단 세 아이콘·팝업 태그 생성/취소·연속 추가·데일리 진입", async ({ page }) => {
  for (const id of ["category-add", "summary-toggle", "export-open"])
    await expect(page.getByTestId(id).locator("svg")).toHaveCount(1);
  await page.getByTestId("category-add").click();
  const dialog = page.getByTestId("category-create");
  await expect(dialog.getByLabel("업무 이름", { exact: true })).toBeFocused();
  await dialog.getByLabel("새 태그 이름").fill("취소 태그");
  await dialog.getByRole("button", { name: "+ 태그 추가", exact: true }).click();
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await page.getByTestId("category-add").click();
  await expect(dialog.getByRole("button", { name: "취소 태그", exact: true })).toHaveCount(0);
  await dialog.getByLabel("업무 이름", { exact: true }).fill("v11 가상 업무");
  await dialog.getByLabel("새 태그 이름").fill("v11 태그");
  await dialog.getByRole("button", { name: "+ 태그 추가", exact: true }).click();
  await dialog.getByRole("button", { name: "추가하고 계속", exact: true }).click();
  await expect(dialog.getByLabel("업무 이름", { exact: true })).toHaveValue("");
  await expect(dialog.getByRole("button", { name: "v11 태그", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await dialog.getByLabel("업무 이름", { exact: true }).fill("v11 두 번째");
  await dialog.getByRole("button", { name: "업무 추가", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("category-header").filter({ hasText: "v11 가상 업무" })).toContainText(
    "v11 태그",
  );
  await page.getByTestId("view-today").click();
  await page.getByTestId("category-add").click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("category-add")).toBeFocused();
});

test("Markdown 드롭은 URL 링크를 보존하고 첨부를 제외 · 되돌리기", async ({ page }) => {
  const before = await page.locator(".note-prose").count();
  await dropMarkdown(
    page,
    "가상.md",
    "# v11 가져오기\n\n[프로젝트 문서](https://example.com/docs)\n\nhttps://example.com/guide\n\n![가상 이미지](data:image/png;base64,Aa1+/Aa1+/Aa1+/)",
  );
  await expect(page.locator(".note-prose")).toHaveCount(before + 1);
  const note = page.locator(".note-prose").filter({ hasText: "v11 가져오기" });
  await expect(note.locator('a[href="https://example.com/docs"]')).toHaveAttribute(
    "href",
    "https://example.com/docs",
  );
  await expect(note.locator('a[href="https://example.com/guide"]')).toHaveAttribute(
    "href",
    "https://example.com/guide",
  );
  await expect(note).not.toContainText("base64");
  await expect(note.locator("h1,img:not(.ProseMirror-separator)")).toHaveCount(0);
  await page.getByRole("button", { name: "되돌리기", exact: true }).click();
  await expect(page.locator(".note-prose")).toHaveCount(before);
});

test("글자색 팔레트 선택·기본색 복원·주 이동 후 저장 유지", async ({ page }) => {
  const prose = page.locator(".note-prose").first();
  await prose.click();
  await page.keyboard.press("Control+A");
  const toolbar = page.getByTestId("note-toolbar");
  await toolbar.getByRole("button", { name: "글자색", exact: true }).click();
  await toolbar.getByRole("radio", { name: "파랑", exact: true }).click();
  await expect(prose.locator(".note-c-blue")).not.toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("week-title")).toContainText("W44");
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page.getByTestId("week-title")).toContainText("W43");
  const loaded = page.locator(".note-prose").first();
  await expect(loaded.locator(".note-c-blue")).not.toHaveCount(0);
  await loaded.click();
  await page.keyboard.press("Control+A");
  await toolbar.getByRole("button", { name: "글자색", exact: true }).click();
  await toolbar.getByRole("radio", { name: "기본", exact: true }).click();
  await expect(loaded.locator(".note-c-blue")).toHaveCount(0);
});
