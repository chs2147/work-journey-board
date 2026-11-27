// 개선 v27(docs/improve-v27-spec.md): 업무일지 내보내기(연도·업무·마크다운) · 메모보드 텍스트 상자 높이 = 글에 맞춤.
// 브라우저 모드, 오늘 = 2026-10-22(목, W43), 가상 샘플.
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const dialog = (page: Page) => page.getByTestId("export-dialog");

async function saveAs(page: Page, answer: (suggested: string) => string = (s) => s) {
  let suggested = "";
  page.once("dialog", (d) => {
    suggested = d.defaultValue();
    void d.accept(answer(suggested));
  });
  const download = page.waitForEvent("download");
  await dialog(page).getByRole("button", { name: "저장 위치 선택…" }).click();
  const file = await (await download).path();
  return { file, suggested };
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?today=2026-10-22");
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
});

test("이름·구역: 업무일지 내보내기, 형식 토글(엑셀 기본)·범위·포함·미리 계산", async ({ page }) => {
  await expect(page.getByTestId("export-open")).toHaveAttribute("title", "업무일지 내보내기 (Alt+E)");
  await page.keyboard.press("Alt+KeyE");
  await expect(dialog(page).getByRole("heading")).toHaveText("업무일지 내보내기");
  await expect(page.getByTestId("export-format-xlsx")).toHaveAttribute("aria-checked", "true");
  for (const head of ["범위", "포함", "미리 계산"]) await expect(dialog(page)).toContainText(head);
  await expect(page.getByTestId("export-category")).toHaveText("전체 ▾");
});

test("마크다운 + 업무 1개(이것만) → .md 파일 이름·내용은 고른 업무만, 형식은 다음에도 기억", async ({
  page,
}) => {
  await page.keyboard.press("Alt+KeyE");
  await page.getByTestId("export-format-md").click();
  await expect(dialog(page).getByLabel("업무 기록")).toBeChecked();
  await expect(dialog(page).getByLabel("주간 요약")).toBeChecked();
  await expect(dialog(page).getByLabel("주간 메모")).not.toBeChecked();
  await dialog(page).getByRole("radio", { name: "최근 4주" }).check();
  await page.getByTestId("export-category").click();
  const row = page.getByTestId("export-category-row").filter({ hasText: "협력사 보안 점검" });
  await row.hover();
  await row.locator("xpath=..").getByRole("button", { name: "이것만" }).click();
  await expect(page.getByTestId("export-category")).toContainText("협력사 보안 점검");
  await expect(page.getByTestId("export-stats")).toContainText("업무 1개");
  await expect(page.getByTestId("export-filtered-note")).toBeVisible();

  const r = await saveAs(page);
  expect(r.suggested).toBe("/demo/WorkJourney/exports/업무일지_협력사 보안 점검_2026-W40~W43.md");
  const text = await readFile(r.file, "utf8");
  expect(text.startsWith("# 업무일지 2026-W40~W43\n업무: 협력사 보안 점검 · 내보낸 날 2026-10-22\n")).toBe(
    true,
  );
  expect(text).toContain("## 2026-W43 (10/19 ~ 10/25)");
  expect(text).toContain("### 협력사 보안 점검");
  expect(text).not.toContain("### 차세대 정산 시스템 구축");
  expect(text.indexOf("## 2026-W42")).toBeLessThan(text.indexOf("## 2026-W43")); // 오래된 주부터
  await expect(page.getByText("2026-W40~W43.md 저장됨")).toBeVisible();

  // 형식은 기억, 업무 고르기는 늘 전체로 시작
  await page.keyboard.press("Alt+KeyE");
  await expect(page.getByTestId("export-format-md")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("export-category")).toHaveText("전체 ▾");
});

test("연도 범위: 첫 기록 주 ~ 이번 주, 파일 이름 `2026년_W42~W43`", async ({ page }) => {
  await page.keyboard.press("Alt+KeyE");
  await dialog(page).getByRole("radio", { name: "연도" }).check();
  await expect(page.getByTestId("export-year")).toHaveValue("2026");
  await expect(dialog(page)).toContainText("2026-W42 ~ 2026-W43");
  await expect(page.getByTestId("export-stats")).toContainText("2주");
  const r = await saveAs(page);
  expect(r.suggested).toBe("/demo/WorkJourney/exports/업무일지_2026년_W42~W43.xlsx");
});

test("메모보드 텍스트 상자: 옆면 손잡이로 너비를 바꿔도 높이는 글에 맞춤(아래 빈칸 없음), 손잡이는 옆면 둘만", async ({
  page,
}) => {
  const box = page.getByTestId("note-box").first();
  const before = (await box.boundingBox())!.height;
  await box.click({ position: { x: 5, y: 5 } });
  await expect(box.locator("[data-frame-grip]")).toHaveCount(2);
  const grip = (await box.locator('[data-frame-grip="e"]').boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + 80, grip.y + grip.height / 2, { steps: 5 });
  await page.mouse.up();
  const after = (await box.boundingBox())!;
  expect(Math.abs(after.height - before)).toBeLessThan(2);
  const gap = await box.evaluate((b) => {
    const r = document.createRange();
    r.selectNodeContents(b.querySelector(".note-prose")!);
    return b.getBoundingClientRect().bottom - Math.max(...[...r.getClientRects()].map((x) => x.bottom));
  });
  expect(gap).toBeLessThan(14);
});
