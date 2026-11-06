// v14 승인 A안: 실제 본문에서 묶음 이동/취소/편집, 지도 상시 표시와 유동 격자.
import { expect, test, type Page, type Locator } from "@playwright/test";
const selected = (p: Page) => p.locator('[data-box-id][data-multi="1"]');
const boxes = (p: Page) => p.locator('[data-testid="note-canvas"] > [data-box-id]');
const positions = (p: Page) =>
  boxes(p).evaluateAll((els) =>
    els.map((el) => ({
      id: (el as HTMLElement).dataset.boxId,
      x: parseFloat((el as HTMLElement).style.left),
      y: parseFloat((el as HTMLElement).style.top),
    })),
  );
async function choose(p: Page) {
  await p.getByTestId("note-scroll").evaluate((el) => {
    el.scrollLeft = 0;
    el.scrollTop = 0;
  });
  const r = (await p.getByTestId("note-canvas").boundingBox())!;
  await p.mouse.move(r.x + 4, r.y + 4);
  await p.mouse.down();
  await p.mouse.move(r.x + 1000, r.y + 500, { steps: 8 });
  await p.mouse.up();
  await expect(selected(p)).toHaveCount(5);
}
async function drag(p: Page, body: Locator, dx = 40, dy = 24, cancel = false) {
  await body.scrollIntoViewIfNeeded();
  const r = (await body.boundingBox())!;
  await p.mouse.move(r.x + r.width / 2, r.y + Math.min(r.height / 2, 25));
  await p.mouse.down();
  await p.mouse.move(r.x + r.width / 2 + dx, r.y + Math.min(r.height / 2, 25) + dy, { steps: 6 });
  if (cancel) await p.keyboard.press("Escape");
  await p.mouse.up();
}
async function memo(p: Page) {
  await p.setViewportSize({ width: 1440, height: 1000 });
  await p.goto("/?today=2026-10-22&sample=showcase");
  await expect(p.getByTestId("note-box").first()).toBeVisible();
  await p.getByRole("button", { name: "크게 보기", exact: true }).click();
  await choose(p);
}
test("선택한 텍스트/이미지/링크 본문 모두 묶음 이동, 클릭 유지, 한 번에 되돌리기와 Esc 원복", async ({
  page,
}) => {
  await memo(page);
  const before = await positions(page);
  for (const body of [
    page.getByTestId("note-box").first().locator(".note-prose"),
    page.getByTestId("note-image").locator("canvas"),
    page.getByTestId("note-link").locator("[data-testid=link-title]"),
  ]) {
    await body.click();
    await expect(selected(page)).toHaveCount(5);
    await drag(page, body);
    expect(await positions(page)).toEqual(before.map((b) => ({ ...b, x: b.x + 40, y: b.y + 24 })));
    await expect(selected(page)).toHaveCount(5);
    await page.keyboard.press("Control+Z");
    expect(await positions(page)).toEqual(before);
  }
  await drag(page, page.getByTestId("note-box").first().locator(".note-prose"), 48, 32, true);
  expect(await positions(page)).toEqual(before);
  await expect(selected(page)).toHaveCount(5);
  await drag(page, page.getByRole("button", { name: "선택한 메모 함께 이동" }));
  expect(await positions(page)).toEqual(before.map((b) => ({ ...b, x: b.x + 40, y: b.y + 24 })));
  await page.keyboard.press("Control+Z");
  expect(await positions(page)).toEqual(before);
  await page.getByTestId("note-box").first().locator(".note-prose").dblclick();
  await expect(selected(page)).toHaveCount(0);
  await expect(page.getByTestId("note-box").first().locator(".note-prose")).toBeFocused();
});
test("묶음 경계에서 간격 보존, pointercancel 원복, 빈 곳 해제는 새 메모를 만들지 않음", async ({ page }) => {
  await memo(page);
  const before = await positions(page);
  await drag(page, page.getByTestId("note-box").first().locator(".note-prose"), -80, -40);
  const after = await positions(page);
  const dx = after[0]!.x - before[0]!.x,
    dy = after[0]!.y - before[0]!.y;
  expect(after).toEqual(before.map((b) => ({ ...b, x: b.x + dx, y: b.y + dy })));
  expect(Math.min(...after.map((b) => b.x))).toBe(0);
  await page.keyboard.press("Control+Z");
  const body = page.getByTestId("note-box").first().locator(".note-prose");
  const r = (await body.boundingBox())!;
  await page.mouse.move(r.x + 80, r.y + 25);
  await page.mouse.down();
  await page.mouse.move(r.x + 140, r.y + 60, { steps: 4 });
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1 })));
  await page.mouse.up();
  expect(await positions(page)).toEqual(before);
  await expect(selected(page)).toHaveCount(5);
  const c = (await page.getByTestId("note-canvas").boundingBox())!;
  await page.mouse.click(c.x + 8, c.y + 8);
  await expect(selected(page)).toHaveCount(0);
  await expect(boxes(page)).toHaveCount(5);
});
test("업무 타임라인: 지도 상시 표시, 메뉴/표/월 아이콘과 글자 위계/구분선", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/?today=2026-10-22&sample=insights");
  await page.getByTestId("rail-insights").click();
  await expect(page.getByTestId("journey-map")).toBeVisible();
  await expect(page.getByRole("button", { name: "경과 지도 접기", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("insight-tab-timeline")).toHaveText("업무 타임라인");
  await expect(page.getByTestId("insight-tab-overview")).toHaveText("활동");
  await expect(page.getByTestId("insight-tab-timeline").locator("svg")).toHaveCount(1);
  const table = page.getByTestId("map-table-toggle");
  await expect(table.locator("svg")).toHaveCount(1);
  await table.click();
  await expect(table).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("insight-period").selectOption("all");
  const folded = page.getByTestId("month-folded").first();
  await expect(folded.locator("svg")).toHaveCount(1);
  await folded.click();
  const layout = await page.getByTestId("timeline").evaluate((el) => {
    const month = el.querySelector("[data-month-head]")!,
      week = el.querySelector("[data-week]")!,
      head = week.firstElementChild!,
      detail = week.lastElementChild!;
    return {
      month: getComputedStyle(month).fontSize,
      week: getComputedStyle(head).fontSize,
      rule: getComputedStyle(week).borderBottomWidth,
      monthRule: getComputedStyle(month).borderBottomWidth,
      below: detail.getBoundingClientRect().top >= head.getBoundingClientRect().bottom,
    };
  });
  expect(layout).toEqual({ month: "20px", week: "16px", rule: "1px", monthRule: "1px", below: true });
});
test("활동: 넓은 창에서 격자 확장, 좁으면 유동 축소, 날짜/월/합계 정렬 및 표 아이콘", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  await page.goto("/?today=2026-10-22&sample=insights");
  await page.getByTestId("rail-insights").click();
  await page.getByTestId("insight-tab-overview").click();
  const measure = () =>
    page.getByTestId("heat-grid").evaluate((el) => ({
      width: el.getBoundingClientRect().width,
      parent: el.parentElement!.clientWidth,
      columns: [...el.querySelectorAll("[role=row]")].map((r) => getComputedStyle(r).gridTemplateColumns),
    }));
  const wide = await measure();
  expect(Math.abs(wide.width - wide.parent)).toBeLessThan(2);
  expect(new Set(wide.columns).size).toBe(1);
  await page.setViewportSize({ width: 900, height: 900 });
  const narrow = await measure();
  expect(Math.abs(narrow.width - narrow.parent)).toBeLessThan(2);
  expect(wide.width).toBeGreaterThan(narrow.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const toggle = page.getByTestId("heat-table-toggle");
  await expect(toggle.locator("svg")).toHaveCount(1);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("heat-table")).toBeVisible();
});

test("그룹 선택의 Shift 추가/제외, 50% 배율 이동, 이미지/링크 더블클릭 개별 보기·편집", async ({ page }) => {
  await memo(page);
  const text = page.getByTestId("note-box").first().locator(".note-prose");
  await text.click({ modifiers: ["Shift"] });
  await expect(selected(page)).toHaveCount(4);
  await text.click({ modifiers: ["Shift"] });
  await expect(selected(page)).toHaveCount(5);
  await page.getByTestId("note-zoom").selectOption("0.5");
  const before = await positions(page);
  await drag(page, text);
  expect(await positions(page)).toEqual(before.map((b) => ({ ...b, x: b.x + 80, y: b.y + 48 })));
  await page.getByTestId("note-zoom").selectOption("1");
  await page.getByTestId("note-image").locator("canvas").dblclick();
  await expect(page.getByTestId("note-image-preview")).toBeVisible();
  await expect(selected(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("note-image-preview")).toHaveCount(0);
  await choose(page);
  await page.getByTestId("note-link").getByTestId("link-title").dblclick();
  await expect(selected(page)).toHaveCount(0);
  await expect(page.getByTestId("note-link").getByRole("textbox").first()).toBeFocused();
});
