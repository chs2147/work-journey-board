// 개선 v3 W1 E2E(improve-1027v3-spec 2·3·4·6·7절): 상자를 판 밖으로 끌면 제자리 + 꼬리표 · Esc 취소 ·
// 행을 상자 둘레 16px에 놓으면 그 상자에 연결 · 빈 곳 자리는 겹치면 비킴 · 배경색 칩 색 · 연결점 4개 · 중요 업무 날짜 띠.
// 브라우저 모드, 가상 샘플만. 오늘 = 2026-10-22(목).
import { expect, test, type Locator, type Page } from "@playwright/test";

const TODAY = "2026-10-22";
const SETTLE = "차세대 정산 시스템 구축";
const SEC = "협력사 보안 점검";
const FIRST = "테스트 데이터 이관 스크립트 작성 착수";

const cell = (page: Page, cat: string, date: string) => page.getByTestId(`cell-${cat}-${date}`);
const rowOf = (page: Page, cat: string) => cell(page, cat, TODAY).locator("[data-item-index]").first();
const grip = (box: Locator) => box.getByRole("button", { name: "상자 위치 이동(끌기)" });
/** 위 막대 가운데 — 위 연결점은 막대 바로 위에 있어 막대 가운데를 잡아도 옮기기 */
const gripPoint = async (box: Locator) => {
  const b = (await grip(box).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const center = async (l: Locator) => {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

/** 메모 판 (x, y)에 글 상자 하나를 만들고 그 상자 */
async function makeBox(page: Page, text: string, x = 640, y = 40) {
  const c = (await page.getByTestId("note-canvas").boundingBox())!;
  await page.mouse.click(c.x + x, c.y + y);
  await expect(page.locator(":focus")).toHaveClass(/note-prose/);
  await page.keyboard.type(text);
  await page.keyboard.press("Escape");
  return page.locator("[data-box-id]", { has: page.locator(".note-prose", { hasText: text }) });
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?today=${TODAY}`);
  await expect(page.locator(":focus")).toHaveValue(FIRST);
  await expect(page.getByTestId("note-box").first()).toBeVisible();
});

test("#2 상자를 판 밖으로 끌면 상자는 제자리 · 꼬리표만 따라감 · 항목에 놓으면 연결 · 판 안으로 오면 다시 옮기기", async ({
  page,
}) => {
  const box = await makeBox(page, "가상 일정 메모");
  const before = (await box.boundingBox())!;
  await box.hover();
  const g = await gripPoint(box);
  await page.mouse.move(g.x, g.y);
  await page.mouse.down();
  await page.mouse.move(g.x + 8, g.y + 8, { steps: 2 });
  const r = await center(rowOf(page, SEC));
  await page.mouse.move(r.x, r.y, { steps: 12 });
  const tag = page.getByTestId("link-tag");
  await expect(tag).toHaveText("⛓ 가상 일정 메모");
  await expect(box).toHaveClass(/linkingBox/);
  expect((await box.boundingBox())!).toMatchObject({ x: before.x, y: before.y });
  await expect(page.getByTestId("link-drop-label")).toBeVisible();
  await page.mouse.up();
  await expect(tag).toHaveCount(0);
  await expect(box).not.toHaveClass(/linkingBox/);
  await expect(box.getByTestId("link-line")).toHaveCount(1);
  await expect(box.getByTestId("link-line").first()).toContainText(SEC);
  expect((await box.boundingBox())!.x).toBe(before.x);

  // 판 밖으로 나갔다가 판 안으로 돌아오면 꼬리표가 사라지고 상자가 커서를 따라 옮겨진다
  await box.hover();
  const g2 = await gripPoint(box);
  await page.mouse.move(g2.x, g2.y);
  await page.mouse.down();
  await page.mouse.move(g2.x + 8, g2.y + 8, { steps: 2 });
  await page.mouse.move(r.x, r.y, { steps: 10 });
  await expect(tag).toBeVisible();
  await page.mouse.move(g2.x - 200, g2.y + 120, { steps: 10 });
  await expect(tag).toHaveCount(0);
  await page.mouse.up();
  const after = (await box.boundingBox())!;
  expect(after.x).toBeLessThan(before.x - 100);
});

test("#2 판 밖으로 끌다가 Esc = 취소(연결 없음, 제자리) · 판 밖 아무 데나 놓아도 그대로", async ({
  page,
}) => {
  const box = await makeBox(page, "가상 취소 메모");
  const before = (await box.boundingBox())!;
  for (const how of ["esc", "nowhere"] as const) {
    await box.hover();
    const g = await gripPoint(box);
    await page.mouse.move(g.x, g.y);
    await page.mouse.down();
    await page.mouse.move(g.x + 8, g.y + 8, { steps: 2 });
    const r = await center(rowOf(page, SETTLE));
    await page.mouse.move(r.x, how === "esc" ? r.y : 4, { steps: 10 });
    await expect(page.getByTestId("link-tag")).toBeVisible();
    if (how === "esc") await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(page.getByTestId("link-tag")).toHaveCount(0);
    await expect(box.getByTestId("link-line")).toHaveCount(0);
    expect((await box.boundingBox())!).toMatchObject({ x: before.x, y: before.y });
  }
});

test("#3 행을 상자 둘레 16px 안에 놓으면 그 상자에 연결(새 상자 없음) · 빈 곳 자리는 상자와 겹치면 아래로 비킴", async ({
  page,
}) => {
  const box = await makeBox(page, "가상 경계 메모", 80, 40);
  const count = await page.locator("[data-box-id]").count();
  const b = (await box.boundingBox())!;
  const row = rowOf(page, SEC);
  await row.hover();
  const h = await center(row.getByTestId("drag-row"));
  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  await page.mouse.move(h.x + 6, h.y + 6, { steps: 2 });
  // 상자 아래 10px(둘레 안)
  await page.mouse.move(b.x + b.width / 2, b.y + b.height + 10, { steps: 12 });
  await expect(page.getByTestId("link-box-chip")).toContainText("놓으면 연결 추가");
  await expect(page.getByTestId("link-drop-spot")).toHaveCount(0);
  // 상자 오른쪽 위 빈 곳 → 미리보기 자리는 상자와 겹치지 않게 상자 아래로
  await page.mouse.move(b.x + b.width + 40, b.y + 10, { steps: 6 });
  const spot = page.getByTestId("link-drop-spot");
  await expect(spot).toBeVisible();
  const s = (await spot.boundingBox())!;
  const overlaps = s.x < b.x + b.width && s.x + s.width > b.x && s.y < b.y + b.height && s.y + s.height > b.y;
  expect(overlaps).toBe(false);
  // 다시 둘레 안으로 와서 놓기 → 그 상자에 연결
  await page.mouse.move(b.x + b.width / 2, b.y + b.height + 10, { steps: 6 });
  await page.mouse.up();
  await expect(box.getByTestId("link-line")).toHaveCount(1);
  await expect(page.locator("[data-box-id]")).toHaveCount(count);
});

test("#4 배경색 칩 5개가 각자 색으로 보인다", async ({ page }) => {
  const box = await makeBox(page, "가상 색 메모");
  await box.hover();
  await box.getByRole("button", { name: "상자 메뉴" }).click();
  const chips = page.getByRole("group", { name: "배경색" }).getByRole("menuitemradio");
  await expect(chips).toHaveCount(5);
  const colors = await chips.evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
  expect(new Set(colors).size).toBe(5);
});

test("#7 연결점 4개(위·오른쪽·아래·왼쪽) — 위·오른쪽에서 끌어도 잇기 · 폭 조절은 오른쪽 아래 모서리", async ({
  page,
}) => {
  const a = await makeBox(page, "가상 왼쪽 상자", 40, 200);
  const b = await makeBox(page, "가상 오른쪽 상자", 560, 200);
  await a.hover();
  const knobs = a.getByTestId("edge-knob");
  await expect(knobs).toHaveCount(4);
  const sides = await knobs.evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.side));
  expect(sides).toEqual(["top", "right", "bottom", "left"]);
  const ab = (await a.boundingBox())!;
  const right = (await a.locator('[data-testid="edge-knob"][data-side="right"]').boundingBox())!;
  expect(right.x + right.width / 2).toBeCloseTo(ab.x + ab.width, -1);
  const resize = (await a.getByRole("button", { name: "폭 조절(끌기)" }).boundingBox())!;
  expect(resize.y + resize.height / 2).toBeGreaterThan(ab.y + ab.height - 10);

  for (const side of ["right", "top"] as const) {
    await a.hover();
    const k = await center(a.locator(`[data-testid="edge-knob"][data-side="${side}"]`));
    const t = await center(b);
    await page.mouse.move(k.x, k.y);
    await page.mouse.down();
    await page.mouse.move(t.x, t.y, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByTestId("note-edge")).toHaveCount(1); // 같은 쌍은 하나만
  }
});

test("#6 중요 업무: 지난 날짜·오늘 띠가 서로 다른 바탕 · 오늘 띠에 날짜", async ({ page }) => {
  await page.keyboard.press("Alt+KeyI"); // 오늘 첫 항목
  const past = cell(page, SEC, "2026-10-21").locator('[class*="item_"]').first();
  await past.hover();
  await past.getByRole("button", { name: "중요 표시 (Alt+I)" }).click();
  await page.getByTestId("rail-important").click();
  const panel = page.getByTestId("important-panel");
  const late = panel.locator('h3[data-group="late"]');
  const today = panel.locator('h3[data-group="today"]');
  await expect(today).toHaveText(/오늘 · 10\/22 \(목\)/);
  await expect(late).toContainText("지난 날짜");
  const bg = (l: Locator) => l.evaluate((el) => getComputedStyle(el).backgroundColor);
  const [lb, tb] = [await bg(late), await bg(today)];
  expect(lb).not.toBe(tb);
  expect(tb).not.toBe("rgba(0, 0, 0, 0)");
});
