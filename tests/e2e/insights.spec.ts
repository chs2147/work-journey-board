// M3-S1 E2E(m3-s1-spec): 인사이트 화면 틀 · 업무 경과 지도 · 경과 타임라인.
// 가상 샘플 ?sample=insights(fixtures/sample-insights.json — 약 6개월, 종료·재개, 링크, 중요, 연결 메모, 연차). 오늘 = 2026-10-22(목, W43).
import { expect, test, type Page } from "@playwright/test";

const TODAY = "2026-10-22";
const A = "가상 정산 시스템 구축";
const B = "가상 보안 점검";
const C = "가상 이관 작업";
const FLAGGED = "테스트 데이터 이관 스크립트 작성 착수";
const LINK_TEXT = "배포 절차 https://wiki.example.local/deploy/checklist 확인";

const insights = (page: Page) => page.getByTestId("insights");
const items = (page: Page) => page.getByTestId("timeline-item");
const week = (page: Page, w: string) => page.locator(`[data-week="${w}"]`);
const cell = (page: Page, key: string) => page.locator(`[data-map-cell="${key}"]`);
const wjb = <T>(page: Page, f: string) =>
  page.evaluate((name) => (globalThis as unknown as { __wjb: Record<string, () => T> }).__wjb[name]!(), f);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?today=${TODAY}&sample=insights`);
  await expect(page.locator(":focus")).toHaveValue(FLAGGED);
});

test("레일로 열기 → 인사이트 모드 상단 바, 기본 최근 12주, 맨 아래 이번 주, 머리 숫자 · Alt+1로 보드(커서 그대로)", async ({
  page,
}) => {
  await page.getByTestId("rail-insights").click();
  await expect(insights(page)).toBeVisible();
  await expect(page.getByTestId("insights-title")).toContainText("인사이트");
  await expect(page.getByTestId("week-title")).toHaveCount(0); // 주 이동 감춤
  await expect(page.getByTestId("summary-toggle")).toHaveCount(0);
  await expect(page.getByTestId("insight-title")).toContainText(A);
  await expect(page.getByTestId("insight-range")).toContainText("2026-W32 ~ W43");
  await expect(page.getByTestId("insight-meta")).toContainText("2026-05-04 시작 · 진행 중 · 25주째");
  await expect(week(page, "2026-W43")).toBeInViewport();
  await expect(week(page, "2026-W43")).toContainText("이번 주");
  await expect(week(page, "2026-W43")).toContainText("연차 10/21(수)");
  await expect(
    week(page, "2026-W43").getByTestId("timeline-item").filter({ hasText: FLAGGED }),
  ).toContainText("★");
  // 기간 밖 이전 기록 안내
  await expect(page.getByTestId("insight-earlier")).toContainText("앞에도 기록이");

  await page.keyboard.press("Alt+Digit1");
  await expect(insights(page)).toHaveCount(0);
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
  await expect(page.locator(":focus")).toHaveValue(FLAGGED);
});

test("Alt+3 = 커서가 있는 칸의 업무로, 다시 Alt+3 = 보드로 · 업무 머리 ⋯ [경과 타임라인 보기]", async ({
  page,
}) => {
  await page.keyboard.press("Alt+Digit3");
  await expect(page.getByTestId("insight-title")).toContainText(A);
  await page.keyboard.press("Alt+Digit3");
  await expect(insights(page)).toHaveCount(0);

  await page.getByRole("button", { name: `${B} 메뉴` }).click();
  await page.getByRole("menuitem", { name: /경과 타임라인 보기/ }).click();
  await expect(page.getByTestId("insight-title")).toContainText(B);
  await expect(page.getByTestId("insight-meta")).toContainText("재개 1회");
});

test("경과 지도: 시작 주~이번 주 칸, 툴팁 글, 칸 클릭 = 그 주로(기간 밖이면 전체로 넓히고 접힌 달 펼침), [월] 전환", async ({
  page,
}) => {
  await page.getByTestId("rail-insights").click();
  const map = page.getByTestId("journey-map");
  await expect(map).toBeVisible();
  await expect(map.locator("[data-map-cell]")).toHaveCount(25); // W19~W43
  await expect(cell(page, "2026-W43")).toHaveAttribute(
    "aria-label",
    /2026-W43 10\/19~10\/25 · 기록한 날 \d · 항목 \d+ · 이번 주/,
  );
  await expect(cell(page, "2026-W28")).toHaveAttribute("data-level", "0");
  await expect(cell(page, "2026-W43")).toHaveClass(/seen/); // 지금 보이는 주

  await cell(page, "2026-W35").click();
  await expect(week(page, "2026-W35")).toBeInViewport();

  await cell(page, "2026-W20").click(); // 최근 12주 밖
  await expect(page.getByTestId("insight-period")).toHaveValue("all");
  await expect(week(page, "2026-W20")).toBeInViewport();

  await map.getByRole("button", { name: "월", exact: true }).click();
  await expect(map.locator("[data-map-cell]")).toHaveCount(6); // 5월~10월
  await expect(cell(page, "2026-07")).toHaveAttribute("aria-label", /2026년 7월 · 기록한 날/);
});

test("기간 전체: 3개월 이전 달은 접힘, 눌러서 펼침 · 무기록 주 접힘 줄", async ({ page }) => {
  await page.getByTestId("rail-insights").click();
  await page.getByTestId("insight-period").selectOption("all");
  const folded = page.getByTestId("month-folded");
  await expect(folded).toHaveCount(3); // 5·6·7월
  await expect(folded.first()).toContainText("2026년 5월");
  await expect(page.getByTestId("timeline-gap").filter({ hasText: "2주 기록 없음 (W37~W38)" })).toHaveCount(
    1,
  );
  await folded.first().click();
  await expect(week(page, "2026-W19")).toBeVisible();
  await expect(page.getByTestId("timeline-boundary").first()).toContainText("▶ 시작 2026-05-04");
});

test("검색: 일치 강조·나머지 주 흐리게·n/N, Enter로 다음 · Esc로 지우기", async ({ page }) => {
  await page.getByTestId("rail-insights").click();
  await page.keyboard.press("Control+KeyF");
  await expect(page.getByTestId("insight-search")).toBeFocused();
  await page.keyboard.type("배포");
  const count = page.getByTestId("insight-search-count");
  await expect(count).toHaveText(/^1 \/ \d+ 일치$/);
  await expect(page.locator("mark").first()).toHaveText("배포");
  await expect(week(page, "2026-W43")).toHaveClass(/dim/);
  await page.keyboard.press("Enter");
  await expect(count).toHaveText(/^2 \/ \d+ 일치$/);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("insight-search")).toHaveValue("");
  await expect(week(page, "2026-W43")).not.toHaveClass(/dim/);
});

test("항목 → 보드의 그 칸(커서) · Alt+3으로 같은 업무 복귀 · 연결 메모 펼치기 · 링크 Ctrl+클릭은 브라우저로", async ({
  page,
}) => {
  await page.getByTestId("rail-insights").click();
  const link = items(page).filter({ hasText: "wiki.example.local" });
  await link.getByTestId("memo-chip").click();
  await expect(page.getByTestId("memo-box")).toContainText("배포 순서 확인 필요");

  await link.getByText("wiki.example.local/", { exact: false }).click({ modifiers: ["Control"] });
  expect(await wjb<string[]>(page, "openedUrls")).toEqual(["https://wiki.example.local/deploy/checklist"]);
  await expect(insights(page)).toBeVisible();

  await link.getByText("배포 절차").click();
  await expect(insights(page)).toHaveCount(0);
  await expect(page.getByTestId("week-title")).toContainText("2026-W42");
  await expect(page.locator(":focus")).toHaveValue(LINK_TEXT);

  await page.keyboard.press("Alt+Digit3");
  await expect(page.getByTestId("insight-title")).toContainText(A);
});

test("경과 복사 = 지금 기간 평문(자동 집계 표기, 연결 메모 [메모] 줄)", async ({ page }) => {
  await page.getByTestId("rail-insights").click();
  await page.getByTestId("insight-copy").click();
  await expect(page.getByRole("status")).toContainText("경과를 복사했습니다");
  const text = (await wjb<string>(page, "clipboard"))!;
  expect(text.split("\n")[0]).toBe(`[업무 경과] ${A}`);
  expect(text).toContain("기간 2026-W32 ~ 2026-W43");
  expect(text).toContain("■ 2026-W42 (10/12~10/18)");
  expect(text).toContain(`- (화) ${LINK_TEXT}\n  [메모] 배포 순서 확인 필요`);
  expect(text).toContain("(2026-W37~W38 기록 없음)");
  expect(text).not.toContain("★");
});

test("종료 업무 포함 → 종료된 업무 묶음 · 종료·재개 구분선·쉬는 구간 · [다시 시작]", async ({ page }) => {
  await page.getByTestId("rail-insights").click();
  await expect(page.getByTestId("insight-category").filter({ hasText: C })).toHaveCount(0);
  await page.getByTestId("insight-include-ended").check();
  await page.getByTestId("insight-category").filter({ hasText: C }).click();
  await expect(page.getByTestId("insight-meta")).toContainText("종료 (7/31)");
  await page.getByTestId("insight-period").selectOption("all");
  await expect(page.getByTestId("timeline-boundary").last()).toContainText("■ 종료 2026-07-31");

  await page.getByTestId("insight-category").filter({ hasText: B }).click();
  await expect(page.getByTestId("timeline-rest")).toContainText("쉬는 구간");
  await expect(page.getByTestId("timeline-boundary").filter({ hasText: "▶ 재개 2026-10-05" })).toHaveCount(1);

  await page.getByTestId("insight-category").filter({ hasText: C }).click();
  await page.getByRole("button", { name: "다시 시작" }).click();
  await expect(page.getByTestId("insight-meta")).toContainText("진행 중");
});

test("업무 목록 ↑↓로 고르기 · 좁은 창이면 위쪽 선택 상자", async ({ page }) => {
  await page.getByTestId("rail-insights").click();
  await page.getByTestId("insight-category").filter({ hasText: A }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("insight-title")).toContainText(B);

  await page.setViewportSize({ width: 1000, height: 800 });
  await expect(page.getByTestId("insight-list")).toHaveCount(0);
  const select = page.getByRole("combobox", { name: "업무" });
  await select.selectOption({ label: A });
  await expect(page.getByTestId("insight-title")).toContainText(A);
});
