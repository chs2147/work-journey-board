// 개선 v2 V2 E2E(improve-1026v2-spec 3절): 행 끌어서 옮기기 — 칸 안 순서 · 다른 요일·다른 업무 칸 · 오늘 뷰 카드 사이 ·
// 본 항목은 세부 항목과 함께 · ★ 표시가 따라감 · Esc 취소 · Ctrl+Z 한 번에 두 칸 되돌림. 브라우저 모드, 가상 샘플만.
import { expect, test, type Locator, type Page } from "@playwright/test";

const TODAY = "2026-10-22";
const FRI = "2026-10-23";
const SETTLE = "차세대 정산 시스템 구축";
const SEC = "협력사 보안 점검";
const FIRST = "테스트 데이터 이관 스크립트 작성 착수"; // 오늘 SETTLE 칸 첫 항목(시작 시 커서)

const cell = (page: Page, cat: string, date: string) => page.getByTestId(`cell-${cat}-${date}`);
const saved = (page: Page) =>
  expect(page.locator('[data-testid="save-state"][data-idle="true"]')).toHaveText("저장됨");
const values = (c: Locator) =>
  c.locator("textarea").evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value));
/** 글이 text인 항목 행(입력칸 값으로 찾음) */
async function row(c: Locator, text: string): Promise<Locator> {
  const i = (await values(c)).indexOf(text);
  expect(i, `항목 "${text}"`).toBeGreaterThanOrEqual(0);
  return c.locator("[data-item-index]").nth(i);
}

/** 항목의 ⋮⋮를 잡아 target 요소의 (fx, fy) 비율 위치로 끌어 놓는다 */
async function dragRow(
  page: Page,
  from: Locator,
  target: Locator,
  fy: number,
  opts: { drop?: boolean } = {},
) {
  await from.hover();
  const grip = from.getByTestId("drag-row");
  const g = (await grip.boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2 + 6, g.y + g.height / 2 + 6, { steps: 2 });
  const t = (await target.boundingBox())!;
  await page.mouse.move(t.x + t.width / 2, t.y + t.height * fy, { steps: 8 });
  if (opts.drop !== false) await page.mouse.up();
}

/** 오늘 SETTLE 칸: 첫 항목 아래에 본 항목 + 세부 항목, 그 아래 본 항목 하나 */
async function typeRows(page: Page) {
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("배포 리허설 결과 정리");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.type("롤백 소요 시간 기록");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.type("지표 정의서 공유");
  await page.keyboard.press("Escape");
  await saved(page);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?today=${TODAY}`);
  await expect(page.locator(":focus")).toHaveValue(FIRST);
});

test("칸 안: 본 항목은 세부 항목과 함께 맨 위로, ⋮⋮는 Tab 순서 밖", async ({ page }) => {
  await typeRows(page);
  const c = cell(page, SETTLE, TODAY);
  await expect(c.getByTestId("drag-row").first()).toHaveAttribute("tabindex", "-1");
  await dragRow(page, await row(c, "배포 리허설 결과 정리"), await row(c, FIRST), 0.2);
  await expect
    .poll(() => values(c))
    .toEqual(["배포 리허설 결과 정리", "롤백 소요 시간 기록", FIRST, "지표 정의서 공유"]);
  await saved(page);
  await page.keyboard.press("Control+KeyZ");
  await expect
    .poll(() => values(c))
    .toEqual([FIRST, "배포 리허설 결과 정리", "롤백 소요 시간 기록", "지표 정의서 공유"]);
});

test("다른 요일·다른 업무 칸으로: 묶음째 옮기고 ★가 따라감, 끄는 동안 파란 선·그림자, Ctrl+Z 한 번에 두 칸", async ({
  page,
}) => {
  await typeRows(page);
  const src = cell(page, SETTLE, TODAY);
  // ★ 표시
  await (await row(src, "배포 리허설 결과 정리")).locator("textarea").click();
  await page.keyboard.press("Alt+KeyI");
  await page.keyboard.press("Escape");
  await saved(page);
  const dst = cell(page, SEC, FRI);
  const before = await values(dst);

  await dragRow(page, await row(src, "배포 리허설 결과 정리"), dst, 0.95, { drop: false });
  await expect(page.getByTestId("drag-ghost")).toContainText("배포 리허설 결과 정리");
  await expect(dst.getByTestId("drop-line")).toHaveCount(1);
  await expect(src.locator('[class*="dragSource"]')).toHaveCount(2);
  await page.mouse.up();
  await expect(page.getByTestId("drag-ghost")).toHaveCount(0);

  await expect.poll(() => values(src)).toEqual([FIRST, "지표 정의서 공유"]);
  await expect.poll(() => values(dst)).toEqual([...before, "배포 리허설 결과 정리", "롤백 소요 시간 기록"]);
  await expect(await row(dst, "배포 리허설 결과 정리")).toHaveAttribute("data-flagged", "true");
  await saved(page);
  // 중요 업무 목록도 새 업무로
  await page.keyboard.press("Alt+Digit2");
  await expect(
    page.getByTestId("important-panel").getByRole("group", { name: SEC }).getByTestId("important-row"),
  ).toContainText("배포 리허설 결과 정리");
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+KeyZ");
  await expect
    .poll(() => values(src))
    .toEqual([FIRST, "배포 리허설 결과 정리", "롤백 소요 시간 기록", "지표 정의서 공유"]);
  await expect.poll(() => values(dst)).toEqual(before);
  await page.keyboard.press("Control+KeyY");
  await expect.poll(() => values(src)).toEqual([FIRST, "지표 정의서 공유"]);
});

test("세부 항목은 혼자 옮겨 놓은 자리 위 항목에 딸리고, 칸 맨 위에 놓으면 본 항목", async ({ page }) => {
  await typeRows(page);
  const src = cell(page, SETTLE, TODAY);
  const dst = cell(page, SETTLE, FRI);
  const first = (await values(dst))[0]!;
  await dragRow(page, await row(src, "롤백 소요 시간 기록"), await row(dst, first), 0.9);
  await expect.poll(() => values(src)).toEqual([FIRST, "배포 리허설 결과 정리", "지표 정의서 공유"]);
  await expect.poll(async () => (await values(dst)).slice(0, 2)).toEqual([first, "롤백 소요 시간 기록"]);
  await expect(await row(dst, "롤백 소요 시간 기록")).toHaveClass(/itemSub/);

  await dragRow(page, await row(dst, "롤백 소요 시간 기록"), await row(dst, first), 0.1);
  await expect.poll(async () => (await values(dst))[0]).toBe("롤백 소요 시간 기록");
  await expect(await row(dst, "롤백 소요 시간 기록")).not.toHaveClass(/itemSub/);
  await saved(page);
});

test("Esc = 취소(아무것도 바뀌지 않음), 칸 밖에 놓으면 그대로", async ({ page }) => {
  await typeRows(page);
  const src = cell(page, SETTLE, TODAY);
  const dst = cell(page, SEC, FRI);
  const before = await values(dst);
  await dragRow(page, await row(src, "지표 정의서 공유"), dst, 0.5, { drop: false });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.getByTestId("drag-ghost")).toHaveCount(0);
  expect(await values(src)).toEqual([
    FIRST,
    "배포 리허설 결과 정리",
    "롤백 소요 시간 기록",
    "지표 정의서 공유",
  ]);
  expect(await values(dst)).toEqual(before);

  await dragRow(page, await row(src, "지표 정의서 공유"), page.getByTestId("week-title"), 0.5);
  expect(await values(src)).toEqual([
    FIRST,
    "배포 리허설 결과 정리",
    "롤백 소요 시간 기록",
    "지표 정의서 공유",
  ]);
});

test("오늘 뷰: 그 날의 업무 카드끼리 옮긴다", async ({ page }) => {
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("카드 사이 이동 확인");
  await page.keyboard.press("Escape");
  await saved(page);
  await page.getByTestId("view-today").click();
  const src = cell(page, SETTLE, TODAY);
  const dst = cell(page, SEC, TODAY);
  const before = await values(dst);
  await dragRow(page, await row(src, "카드 사이 이동 확인"), dst, 0.95);
  await expect.poll(() => values(dst)).toEqual([...before, "카드 사이 이동 확인"]);
  await expect.poll(() => values(src)).toEqual([FIRST]);
});
