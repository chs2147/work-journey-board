// M3-S2 E2E(m3-s2-spec): 탭 줄 · 업무 고르기(두 탭 공통) · 활동 히트맵(12주·일 / 연간·주, 툴팁, 이동, 키보드, 표, 좁은 창).
// 가상 샘플 ?sample=insights(fixtures/sample-insights.json). 오늘 = 2026-10-22(목, W43), 10/21 연차.
import { expect, test, type Page } from "@playwright/test";

const TODAY = "2026-10-22";
const A = "가상 정산 시스템 구축";
const B = "가상 보안 점검";
const C = "가상 이관 작업";
const FLAGGED = "테스트 데이터 이관 스크립트 작성 착수";

const insights = (page: Page) => page.getByTestId("insights");
const heatRows = (page: Page) => page.getByTestId("heat-row");
const row = (page: Page, cat: string) => page.locator(`[data-heat-cat="${cat}"]`);
const heatCell = (page: Page, cat: string, key: string) => row(page, cat).locator(`[data-heat-key="${key}"]`);
const tip = (page: Page) => page.getByTestId("heat-tip");

async function openOverview(page: Page) {
  await page.getByTestId("rail-insights").click();
  await expect(insights(page)).toBeVisible();
  await page.getByTestId("insight-tab-overview").click();
  await expect(page.getByTestId("activity-heatmap")).toBeVisible();
  await expect(heatRows(page)).toHaveCount(3);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?today=${TODAY}&sample=insights`);
  await expect(page.locator(":focus")).toHaveValue(FLAGGED);
});

test("탭 줄: 활동 개요 = 업무 고르기·종료 업무 포함·기간은 차트마다, 마지막 본 탭으로 열림 · 업무 머리 메뉴는 늘 타임라인", async ({
  page,
}) => {
  await page.getByTestId("rail-insights").click();
  await expect(page.getByTestId("insight-tab-timeline")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("insight-period")).toBeVisible();
  await page.getByTestId("insight-tab-overview").click();
  await expect(page.getByTestId("insight-tab-overview")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("insight-period")).toHaveCount(0);
  await expect(page.getByTestId("insight-pick")).toHaveText(/업무: 전체 2/);
  await expect(insights(page)).toContainText("기간은 차트마다");
  await expect(page.getByTestId("insight-list")).toHaveCount(0);

  // 보드로 갔다가 Alt+3 → 마지막에 본 탭(활동 개요)
  await page.keyboard.press("Alt+Digit1");
  await expect(insights(page)).toHaveCount(0);
  await page.keyboard.press("Alt+Digit3");
  await expect(page.getByTestId("activity-heatmap")).toBeVisible();

  // 탭 줄에서 ← → 로 바꿈
  await page.getByTestId("insight-tab-overview").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("insight-tab-timeline")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("insight-tab-timeline")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("insight-tab-overview")).toHaveAttribute("aria-selected", "true");

  // 업무 머리 ⋯ [경과 타임라인 보기] = 늘 타임라인 탭
  await page.keyboard.press("Alt+Digit1");
  await page.getByRole("button", { name: `${B} 메뉴` }).click();
  await page.getByRole("menuitem", { name: /경과 타임라인 보기/ }).click();
  await expect(page.getByTestId("insight-tab-timeline")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("insight-title")).toContainText(B);
});

test("12주·일: 모든 업무 + 업무 행, 84칸, 주말 폭 절반, 오늘 ▼·연차 '연', 오지 않은 날·기간 밖, 기록 N일, ◀ ▶", async ({
  page,
}) => {
  await openOverview(page);
  await expect(page.getByTestId("heat-range")).toHaveText("2026-W32 ~ W43");
  await expect(heatRows(page).first()).toContainText("모든 업무");
  await expect(row(page, "cat-a")).toContainText(A);
  await expect(row(page, "cat-b")).toContainText(B);
  await expect(row(page, "cat-a").locator("[data-heat-key]")).toHaveCount(84);
  const sat = await heatCell(page, "cat-a", "2026-10-17").boundingBox();
  const fri = await heatCell(page, "cat-a", "2026-10-16").boundingBox();
  // 보이는 폭 6·12px + 투명 테두리 2px(눌리는 영역 = 칸 사이 간격 포함)
  expect(Math.round(sat!.width)).toBe(8);
  expect(Math.round(fri!.width)).toBe(14);
  await expect(page.locator('[data-heat-mark="today"]')).toHaveCount(1);
  await expect(page.locator('[data-heat-mark="today"]')).toHaveText("▼");
  await expect(page.locator('[data-heat-mark="leave"]')).toHaveText("연");
  // 값 = 본 항목 수(10/12: 본 1 + 세부 1 → 1)
  await expect(heatCell(page, "cat-a", "2026-10-12")).toHaveAttribute("data-value", "1");
  await expect(heatCell(page, "__all__", "2026-10-14")).toHaveAttribute("data-value", "2");
  await expect(heatCell(page, "cat-a", "2026-10-23")).toHaveAttribute("data-level", "future");
  await expect(heatCell(page, "cat-b", "2026-09-30")).toHaveAttribute("data-level", "outside");
  await expect(heatCell(page, "cat-b", "2026-10-06")).toHaveAttribute("data-level", "0");
  await expect(row(page, "cat-b").getByTestId("heat-days")).toHaveText("기록 2일");

  await expect(page.getByTestId("heat-next")).toBeDisabled();
  await page.getByTestId("heat-prev").click();
  await expect(page.getByTestId("heat-range")).toHaveText("2026-W20 ~ W31");
  await expect(page.locator('[data-heat-mark="today"]')).toHaveCount(0);
  await page.getByTestId("heat-next").click();
  await expect(page.getByTestId("heat-range")).toHaveText("2026-W32 ~ W43");
});

test("툴팁: 업무·날짜·본/세부 수·첫 본 항목 글 / 기록 없음·연차 / 모든 업무 업무별 / 기간 밖", async ({
  page,
}) => {
  await openOverview(page);
  await heatCell(page, "cat-a", "2026-10-12").hover();
  await expect(tip(page)).toContainText(`${A} · 10/12(월)`);
  await expect(tip(page)).toContainText("본 항목 1개 · 세부 1개");
  await expect(tip(page)).toContainText("「정산 구축 주간 작업 W42」");
  await expect(tip(page)).toContainText("누르면 보드의 그 칸으로");
  await expect(heatCell(page, "cat-a", "2026-10-12")).toHaveAttribute(
    "aria-label",
    `${A} · 10/12(월) · 본 항목 1개 · 세부 1개`,
  );

  await heatCell(page, "cat-a", "2026-10-21").hover();
  await expect(tip(page)).toContainText("기록 없음 · 연차");
  await heatCell(page, "__all__", "2026-10-14").hover();
  await expect(tip(page)).toContainText("모든 업무 · 10/14(수)");
  await expect(tip(page)).toContainText("본 항목 2개 · 업무 2개");
  await expect(tip(page)).toContainText("가상 정산 시스템… 1 · 가상 보안 점검 1");
  await heatCell(page, "cat-b", "2026-09-30").hover();
  await expect(tip(page)).toContainText("업무 기간 밖");
  await expect(tip(page)).not.toContainText("누르면");
  await page.mouse.move(5, 5);
  await expect(tip(page)).toHaveCount(0);
});

test("칸 → 보드의 그 날·그 업무 칸 첫 항목, Alt+3으로 복귀 · 기간 밖 칸은 이동 없음 · 행 이름 → 타임라인 탭", async ({
  page,
}) => {
  await openOverview(page);
  // 기간 밖 칸은 aria-disabled — 눌러도 그대로
  await heatCell(page, "cat-b", "2026-09-30").click({ force: true });
  await expect(insights(page)).toBeVisible();

  await heatCell(page, "cat-a", "2026-10-14").click();
  await expect(insights(page)).toHaveCount(0);
  await expect(page.getByTestId("week-title")).toContainText("2026-W42");
  await expect(page.locator(":focus")).toHaveValue("설계 검토 W42");
  await page.keyboard.press("Alt+Digit3");
  await expect(page.getByTestId("activity-heatmap")).toBeVisible();

  await row(page, "cat-b").getByTestId("heat-row-name").click();
  await expect(page.getByTestId("insight-tab-timeline")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("insight-title")).toContainText(B);
});

test("연간·주: 53칸, 이번 주 ▼, 값 = 기록한 날 수, 주 칸 → 보드 그 주 첫 기록일", async ({ page }) => {
  await openOverview(page);
  await page.getByTestId("heat-unit-week").click();
  await expect(page.getByTestId("heat-range")).toHaveText("2026년 (53주)");
  await expect(row(page, "cat-a").locator("[data-heat-key]")).toHaveCount(53);
  await expect(page.locator('[data-heat-mark="today"]')).toHaveCount(1);
  await expect(heatCell(page, "cat-a", "2026-W42")).toHaveAttribute("data-value", "3");
  await expect(heatCell(page, "cat-a", "2026-W10")).toHaveAttribute("data-level", "outside");
  await heatCell(page, "cat-a", "2026-W42").hover();
  await expect(tip(page)).toContainText(`${A} · 2026-W42 (10/12~10/18)`);
  await expect(tip(page)).toContainText("기록한 날 3 · 본 항목 3개");
  await page.getByTestId("heat-prev").click();
  await expect(page.getByTestId("heat-range")).toHaveText("2025년 (52주)");
  await page.getByTestId("heat-next").click();
  await heatCell(page, "cat-b", "2026-W42").click();
  await expect(insights(page)).toHaveCount(0);
  await expect(page.getByTestId("week-title")).toContainText("2026-W42");
  await expect(page.locator(":focus")).toHaveValue("협력사 점검 결과 정리");
  // 범위·단위는 앱 실행 중 유지
  await page.keyboard.press("Alt+Digit3");
  await expect(page.getByTestId("heat-range")).toHaveText("2026년 (53주)");
});

test("키보드: 격자는 Tab 한 번(오늘·첫 업무 칸), 방향키·Home/End·PageUp/Down, Enter = 보드 / 행 이름 Enter = 타임라인", async ({
  page,
}) => {
  await openOverview(page);
  await page.getByTestId("heat-table-toggle").focus();
  await page.keyboard.press("Tab");
  const focused = page.locator(":focus");
  await expect(focused).toHaveAttribute("data-heat-key", TODAY);
  await expect(focused).toHaveAttribute("aria-label", new RegExp(`^${A} · 10/22\\(목\\)`));
  await expect(tip(page)).toContainText(`${A} · 10/22(목)`);
  await page.keyboard.press("ArrowUp");
  await expect(focused).toHaveAttribute("aria-label", /^모든 업무 · 10\/22/);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowLeft");
  await expect(focused).toHaveAttribute("aria-label", new RegExp(`^${B} · 10/21\\(수\\)`));
  await page.keyboard.press("Home");
  await expect(focused).toHaveAttribute("data-heat-key", "2026-08-03");
  await page.keyboard.press("End");
  await expect(focused).toHaveAttribute("data-heat-key", TODAY);
  // 격자 밖으로 Tab 한 번에 나간다(칸마다 Tab 아님)
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus[data-heat-key]")).toHaveCount(0);
  await page.keyboard.press("Shift+Tab");
  await expect(focused).toHaveAttribute("data-heat-key", TODAY);

  await page.keyboard.press("PageUp");
  await expect(page.getByTestId("heat-range")).toHaveText("2026-W20 ~ W31");
  await page.keyboard.press("PageDown");
  await expect(page.getByTestId("heat-range")).toHaveText("2026-W32 ~ W43");

  // 행 이름(←로 첫 칸 앞) Enter → 타임라인
  await page.locator(":focus").press("Home");
  await page.keyboard.press("ArrowLeft");
  await expect(focused).toHaveAttribute("data-testid", "heat-row-name");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("insight-tab-timeline")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("insight-title")).toContainText(B);

  // 칸 Enter → 보드
  await page.getByTestId("insight-tab-overview").click();
  await page.getByTestId("heat-table-toggle").focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(insights(page)).toHaveCount(0);
  await expect(page.locator(":focus")).toHaveValue(FLAGGED);
});

test("업무 고르기: 두 탭 공통, 종료 업무는 포함일 때만, 모두 풀기 = 빈 안내, 일부 고른 상태", async ({
  page,
}) => {
  await openOverview(page);
  await page.getByTestId("insight-pick").click();
  const opts = page.getByTestId("pick-option");
  await expect(opts).toHaveCount(3);
  await expect(opts.filter({ hasText: C })).toBeDisabled();
  await opts.filter({ hasText: B }).click();
  await expect(page.getByTestId("insight-pick")).toHaveText(/업무: 1개 골랐음/);
  await expect(heatRows(page)).toHaveCount(2);
  await expect(row(page, "cat-b")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("insight-pick")).toBeFocused();

  // 타임라인 탭 목록도 고른 업무만
  await page.getByTestId("insight-tab-timeline").click();
  await expect(page.getByTestId("insight-category")).toHaveCount(1);
  await expect(page.getByTestId("insight-pick")).toHaveText(/업무: 1개 골랐음/);

  // 종료 업무 포함 → 종료 업무를 고를 수 있음(일부 고른 상태라 저절로 들어가지 않음)
  await page.getByTestId("insight-tab-overview").click();
  await page.getByTestId("insight-include-ended").check();
  await expect(heatRows(page)).toHaveCount(2);
  await page.getByTestId("insight-pick").click();
  await opts.filter({ hasText: C }).click();
  await expect(row(page, "cat-c")).toHaveCount(1);
  await expect(row(page, "cat-c").getByTestId("heat-days")).toHaveText("기록 0일");

  await page.getByTestId("pick-none").click();
  await expect(page.getByTestId("heat-none")).toContainText("고른 업무가 없습니다");
  await page.getByTestId("pick-all").click();
  await expect(page.getByTestId("insight-pick")).toHaveText(/업무: 전체 3/);
  await expect(heatRows(page)).toHaveCount(4);
});

test("[표로 보기]: 일 = 업무 × 주(본 항목 · 기록한 날), 연간 = 업무 × 달 + 합계, — = 업무 기간 밖", async ({
  page,
}) => {
  await openOverview(page);
  await page.getByTestId("heat-table-toggle").click();
  const table = page.getByTestId("heat-table");
  await expect(table.locator("thead th")).toHaveCount(14);
  await expect(table.locator("tbody tr")).toHaveCount(3);
  const b = table.locator("tbody tr").filter({ hasText: B });
  await expect(b.locator("td").first()).toHaveText("—");
  await expect(b.locator("td").last()).toHaveText("2 · 2일");
  await page.getByTestId("heat-unit-week").click();
  await expect(table.locator("thead th")).toHaveCount(14);
  await expect(table.locator("thead th").nth(1)).toHaveText("1월");
  await expect(table.locator("tbody tr").filter({ hasText: A }).locator("td").first()).toHaveText("—");
});

test("좁은 창: 카드 안 가로 스크롤 + 업무 이름 열 고정, 끝(오늘)이 보임", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.getByTestId("rail-insights").click();
  // 좁은 창에서는 중요 업무 패널이 겹쳐 뜨므로 탭 줄은 키보드로
  await page.getByTestId("insight-tab-timeline").focus();
  await page.keyboard.press("ArrowRight");
  await expect(heatRows(page)).toHaveCount(3);
  const scroll = page.getByTestId("heat-grid").locator("..");
  const { sw, cw, sl } = await scroll.evaluate((el) => ({
    sw: el.scrollWidth,
    cw: el.clientWidth,
    sl: el.scrollLeft,
  }));
  expect(sw).toBeGreaterThan(cw);
  expect(sl).toBeGreaterThan(0);
  await expect(heatCell(page, "cat-a", TODAY)).toBeInViewport();
  await expect(row(page, "cat-a").getByTestId("heat-row-name")).toBeInViewport();
  await scroll.evaluate((el) => (el.scrollLeft = 0));
  await expect(row(page, "cat-a").getByTestId("heat-row-name")).toBeInViewport();
});
