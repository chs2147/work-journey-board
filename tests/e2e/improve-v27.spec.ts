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

/** W44 빈 판에 글 상자 둘: A(위) · B(아래) */
async function twoBoxes(page: Page) {
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("note-empty")).toBeVisible();
  const c = (await page.getByTestId("note-canvas").boundingBox())!;
  for (const [x, y, text] of [
    [40, 30, "가상 위 상자"],
    [40, 260, "가상 아래 상자"],
  ] as const) {
    await page.mouse.click(c.x + x, c.y + y);
    await expect(page.locator(":focus")).toHaveClass(/note-prose/);
    await page.keyboard.type(text);
    await page.keyboard.press("Escape");
  }
  return [
    page.getByTestId("note-box").filter({ hasText: "가상 위 상자" }),
    page.getByTestId("note-box").filter({ hasText: "가상 아래 상자" }),
  ] as const;
}

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 6 });
  await page.mouse.up();
}
const mid = (b: { x: number; y: number; width: number; height: number }) => ({
  x: b.x + b.width / 2,
  y: b.y + b.height / 2,
});

/** 관계선 시작점(위 상자 아래쪽)과 상자 아래 끝의 거리(판 좌표, px) */
async function edgeGap(page: Page, box: ReturnType<Page["getByTestId"]>) {
  const bottom = await box.evaluate((b) => (b as HTMLElement).offsetTop + (b as HTMLElement).offsetHeight);
  const d = (await page.getByTestId("note-edge").first().getAttribute("data-d"))!;
  const ys = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  return Math.abs(ys[1]! - bottom);
}

test("메모보드 글 상자: 손잡이 여덟 개, 옆면은 너비만(높이 글에 맞춤), 아래 손잡이로 높이 고정 → [높이를 글에 맞춤], 관계선은 늘 상자 끝에", async ({
  page,
}) => {
  const [a, b] = await twoBoxes(page);
  const h0 = (await a.boundingBox())!.height;
  await a.click({ position: { x: 5, y: 5 } });
  await expect(a.locator("[data-frame-grip]")).toHaveCount(8);

  // 옆면: 너비만 — 높이·글 아래 여백 그대로
  await drag(page, mid((await a.locator('[data-frame-grip="e"]').boundingBox())!), 80, 0);
  expect(Math.abs((await a.boundingBox())!.height - h0)).toBeLessThan(2);
  const gap = await a.evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el.querySelector(".note-prose")!);
    return el.getBoundingClientRect().bottom - Math.max(...[...r.getClientRects()].map((x) => x.bottom));
  });
  expect(gap).toBeLessThan(14);

  // 관계선 A → B
  await a.hover();
  const k = (await a.locator('[data-testid="edge-knob"][data-side="bottom"]').boundingBox())!;
  await drag(page, mid(k), 0, (await b.boundingBox())!.y + 10 - mid(k).y);
  await expect(page.getByTestId("note-edge")).toHaveCount(1);
  await page.keyboard.press("Escape");
  expect(await edgeGap(page, a)).toBeLessThan(12);

  // 아래 손잡이: 사용자가 정한 높이(80px 더) → 관계선도 새 끝에서
  await a.click({ position: { x: 5, y: 5 } });
  await drag(page, mid((await a.locator('[data-frame-grip="s"]').boundingBox())!), 0, 80);
  expect((await a.boundingBox())!.height).toBeGreaterThan(h0 + 60);
  await expect.poll(() => edgeGap(page, a)).toBeLessThan(12);

  // ⋯ [높이를 글에 맞춤] → 다시 글 높이, 관계선도 따라옴
  await a.hover();
  await a.getByRole("button", { name: "상자 메뉴" }).click();
  await page.getByTestId("note-fit-height").click();
  await expect.poll(async () => Math.abs((await a.boundingBox())!.height - h0)).toBeLessThan(2);
  await expect.poll(() => edgeGap(page, a)).toBeLessThan(12);
  await a.hover();
  await a.getByRole("button", { name: "상자 메뉴" }).click();
  await expect(page.getByTestId("note-fit-height")).toHaveCount(0);
});

test("내보내기 진행: 진행 막대·단계 글, 그동안 앱 단축키 막힘, [취소] → 파일 없이 멈추고 창은 그대로", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/?today=2026-10-22&sample=year");
  await expect(page.getByTestId("week-title")).toContainText("2026-W43", { timeout: 60_000 });
  await page.keyboard.press("Alt+KeyE");
  await dialog(page).getByRole("radio", { name: "연도" }).check();
  await page.getByTestId("export-snapshots").check();
  let downloaded = false;
  page.on("download", () => (downloaded = true));
  page.once("dialog", (d) => void d.accept(d.defaultValue()));
  await dialog(page).getByRole("button", { name: "저장 위치 선택…" }).click();
  await expect(page.getByTestId("export-progress")).toBeVisible();
  await expect(page.getByTestId("export-progress-label")).toContainText("메모 그림 만드는 중", {
    timeout: 60_000,
  });
  const bar = page.getByRole("progressbar", { name: "내보내기 진행" });
  expect(Number(await bar.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
  // 진행 중에는 앱 단축키가 듣지 않는다(주 이동 없음), 창 안 다른 조작도 막힘
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
  await expect(dialog(page).locator("[inert]")).toHaveCount(3); // 타이틀·범위·포함 막힘
  await page.getByTestId("export-stop").click();
  await expect(page.getByText("내보내기를 취소했습니다")).toBeVisible();
  await expect(page.getByTestId("export-progress")).toHaveCount(0);
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole("button", { name: "저장 위치 선택…" })).toBeEnabled();
  expect(downloaded).toBe(false);
});
