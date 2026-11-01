// 휴일 설정·국내 공휴일 E2E(features-1102-spec F2·F3): 내장 공휴일 배지 · 기타 휴가(사유 칩) · 공휴일 직접 이름 ·
// 내장 공휴일을 근무로(끈 날짜) · 설정 › 달력·휴일(켜기/끄기·날짜별·회사 휴일·사유) · 주간 요약 줄 · 데일리 뷰.
// 브라우저 모드, 오늘 = 2026-10-08(목, W41 — 10/5 개천절 대체공휴일·10/9 한글날), 가상 샘플만.
import { expect, test, type Page } from "@playwright/test";
import { openSettings } from "./settings-helper";

const badge = (page: Page, day: string) => page.getByTestId(`day-${day}`).getByTestId("day-mark");

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/?today=2026-10-08");
  await expect(page.getByTestId("week-title")).toContainText("2026-W41");
});

test("내장 공휴일 배지 → 기타 휴가(사유 칩)·공휴일 직접 이름 → 내장 공휴일을 근무로 → 실행 취소 → 주간 요약 줄", async ({
  page,
}) => {
  await expect(badge(page, "2026-10-05")).toHaveText("대체휴일");
  await expect(badge(page, "2026-10-05")).toHaveAttribute("title", "내장 공휴일 · 개천절 대체공휴일");
  await expect(badge(page, "2026-10-09")).toHaveText("한글날");
  await expect(page.getByTestId("day-2026-10-09")).toHaveAttribute("data-mark", "holiday");

  // 수요일: 기타 휴가 → 사유 칩 [야유회]
  await page.getByTestId("day-menu-2026-10-07").click();
  await page.getByRole("menuitemradio", { name: "기타 휴가" }).click();
  await page.getByRole("menuitem", { name: "야유회" }).click();
  await expect(badge(page, "2026-10-07")).toHaveText("야유회");
  await expect(page.getByTestId("day-2026-10-07")).toHaveAttribute("data-mark", "other");

  // 화요일: 공휴일 + 직접 이름
  await page.getByTestId("day-menu-2026-10-06").click();
  await page.getByRole("menuitemradio", { name: "공휴일" }).click();
  await page.getByRole("textbox", { name: "공휴일 이름(예: 창립기념일)" }).fill("창립기념일");
  await page.keyboard.press("Enter");
  await expect(badge(page, "2026-10-06")).toHaveText("창립기념일");

  // 금요일 한글날을 근무로 → 배지 사라짐, 실행 취소로 되살아남
  await page.getByTestId("day-menu-2026-10-09").click();
  await expect(page.getByTestId("mark-source")).toHaveText("내장 공휴일 · 한글날");
  await page.getByRole("menuitemradio", { name: "근무" }).click();
  await expect(badge(page, "2026-10-09")).toHaveCount(0);
  await page.getByTestId("cell-차세대 정산 시스템 구축-2026-10-08").click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+KeyZ");
  await expect(badge(page, "2026-10-09")).toHaveText("한글날");

  // 주간 요약 끝 줄
  await page.getByTestId("summary-toggle").click();
  await expect(page.getByTestId("summary-panel")).toContainText("공휴일: 월(10/5)");
  await expect(page.getByTestId("summary-panel")).toContainText("창립기념일: 화(10/6)");
  await expect(page.getByTestId("summary-panel")).toContainText("한글날: 금(10/9)");
  await expect(page.getByTestId("summary-panel")).toContainText("야유회: 수(10/7)");
});

test("설정 › 달력·휴일: 공휴일 표(연도 이동)·날짜별 끄기·전체 끄기·회사 휴일·사유 추가가 보드·메뉴에 바로", async ({
  page,
}) => {
  await openSettings(page, "calendar");
  const table = page.getByTestId("holiday-table");
  await expect(page.getByTestId("holiday-year")).toHaveText("2026");
  await expect(table).toContainText("개천절 대체공휴일");
  await expect(table).toContainText("전국동시지방선거");
  await page.getByRole("checkbox", { name: "10/9(금) 한글날 보드에 표시" }).uncheck();
  await page.getByRole("button", { name: "다음 해" }).click();
  await expect(page.getByTestId("holiday-year")).toHaveText("2027");
  await page.getByRole("button", { name: "이전 해" }).click();

  // 회사 휴일(그 해만) + 사유 추가
  const company = page.getByTestId("company-holidays");
  await company.getByLabel("날짜").fill("2026-10-07");
  await company.getByLabel("이름").fill("가상 창립기념일");
  await company.getByRole("checkbox", { name: "매년" }).uncheck();
  await company.getByRole("button", { name: "추가" }).click();
  await expect(company).toContainText("가상 창립기념일");
  const reasons = page.getByTestId("leave-reasons");
  await reasons.getByRole("textbox").fill("가상 워크숍");
  await reasons.getByRole("button", { name: "+ 사유 추가" }).click();
  await expect(reasons).toContainText("가상 워크숍");

  await page.keyboard.press("Escape");
  await expect(badge(page, "2026-10-09")).toHaveCount(0);
  await expect(badge(page, "2026-10-07")).toHaveText("가상 창립기념일");
  await page.getByTestId("day-menu-2026-10-08").click();
  await page.getByRole("menuitemradio", { name: "기타 휴가" }).click();
  await expect(page.getByRole("menuitem", { name: "가상 워크숍" })).toBeVisible();
  await page.keyboard.press("Escape");

  // 전체 끄기 → 내장 공휴일 배지 없음(회사 휴일은 그대로)
  await openSettings(page, "calendar");
  await page.getByRole("switch", { name: "대한민국 공휴일 보드에 표시" }).uncheck();
  await page.keyboard.press("Escape");
  await expect(badge(page, "2026-10-05")).toHaveCount(0);
  await expect(badge(page, "2026-10-07")).toHaveText("가상 창립기념일");
});

test("데일리 뷰 [근무 ▾]: 내장 공휴일 이름 표시·기타 휴가 고르기", async ({ page }) => {
  await page.getByTestId("view-today").click();
  await page.getByRole("button", { name: "다음 날 (Alt+→)" }).nth(1).click();
  await expect(page.getByTestId("today-date")).toHaveText("10/9(금)");
  await expect(page.getByTestId("today-mark")).toContainText("한글날");
  await page.getByRole("button", { name: "이전 날 (Alt+←)" }).nth(1).click();
  await page.getByTestId("today-mark").click();
  await page.getByRole("menuitemradio", { name: "기타 휴가" }).click();
  await page.getByRole("menuitem", { name: "공가" }).click();
  await expect(page.getByTestId("today-mark")).toContainText("공가");
});
