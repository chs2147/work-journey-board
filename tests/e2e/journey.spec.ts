// 통합 시나리오(i-m1-plan S5): 첫 실행 → 업무 3개 → 1주 기록 → 다음 주 이월·매주 반복 → 3주 비우면 무기록 배지
// → 종료·다시 시작 → 실행 취소. 브라우저 모드에서 앱을 켠 채 날짜만 넘긴다(__wjb.setToday + Alt+T). 가상 업무.
import { expect, test, type Page } from "@playwright/test";

const PLAN = "신규 서비스 기획";
const TEAM = "팀 운영";
const ENV = "개발 환경 구축";

const cell = (page: Page, cat: string, date: string) => page.getByTestId(`cell-${cat}-${date}`);
const header = (page: Page, cat: string) => page.getByTestId("category-header").filter({ hasText: cat });
const values = (page: Page, cat: string, date: string) =>
  cell(page, cat, date)
    .locator("textarea")
    .evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value));
const saved = (page: Page) => expect(page.getByTestId("save-state")).toHaveText("저장됨 ✓");

/** 앱을 켠 채 날짜가 지나고, 사용자가 [오늘](Alt+T)로 이번 주를 연다 */
async function passTo(page: Page, date: string, week: string) {
  await saved(page);
  await page.evaluate(
    (d) => (globalThis as unknown as { __wjb: { setToday(d: string): void } }).__wjb.setToday(d),
    date,
  );
  await page.keyboard.press("Alt+KeyT");
  await expect(page.getByTestId("week-title")).toContainText(week);
}

test("첫 실행부터 5주 사용: 이월 · 매주 반복 · 무기록 배지 · 종료/다시 시작 · 실행 취소", async ({
  page,
}) => {
  // ── 첫 실행: 추천 폴더 → 업무 3개 → 보드 (2026-10-05 월, W41)
  await page.goto("/?today=2026-10-05&fresh=1");
  await page.getByRole("button", { name: "새로 시작하기" }).click();
  await page.getByRole("button", { name: "다음" }).click();
  const name = page.getByRole("textbox", { name: "업무 이름 입력 후 Enter" });
  for (const n of [PLAN, TEAM, ENV]) {
    await name.fill(n);
    await name.press("Enter");
  }
  await page.getByRole("button", { name: "보드 열기 →" }).click();
  await expect(page.getByTestId("week-title")).toContainText("2026-W41");
  await expect(page.locator(":focus")).toHaveAttribute("aria-label", `${PLAN} · 월 2026-10-05 기록`);

  // ── W41: 키보드만으로 업무 3칸 + 주간 메모(마지막 업무 아래 ↓), "팀 운영" 항목은 매주 반복
  await page.keyboard.type("기획안 초안 작성");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type("주간 회의 정리");
  await page.keyboard.press("Alt+KeyR");
  await expect(page.getByText("다음 주부터 월요일에 들어옵니다", { exact: false })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type("개발 서버 구성");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type("분기 목표 정리");
  await page.keyboard.press("Escape");

  // ── W42(10-13 화): 업무 3개가 이월되고, 반복 항목이 월요일 칸에 들어와 있다
  await passTo(page, "2026-10-13", "2026-W42");
  await expect(page.getByTestId("category-header")).toHaveCount(3);
  await expect(page.getByText("↻ 반복 항목 1개가 이번 주에 들어왔습니다")).toBeVisible();
  expect(await values(page, TEAM, "2026-10-12")).toEqual(["주간 회의 정리"]);
  await expect(page.locator(":focus")).toHaveAttribute("aria-label", `${PLAN} · 화 2026-10-13 기록`);
  await page.keyboard.type("기획안 1차 리뷰");
  // 들어온 반복 항목을 고치면 사용자 기록이 된다
  const team = cell(page, TEAM, "2026-10-12").locator("textarea").first();
  await team.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" — 결정 사항 3건");

  // ── W43·W44: "신규 서비스 기획"만 기록. "팀 운영"은 들어온 반복 항목을 그대로 두고, "개발 환경 구축"은 비운다
  await passTo(page, "2026-10-20", "2026-W43");
  await page.keyboard.type("기획안 리뷰 반영");
  await passTo(page, "2026-10-27", "2026-W44");
  await page.keyboard.type("기획안 확정");

  // ── W45(11-03 월): 3주(W42~W44) 기록이 없는 "개발 환경 구축"에만 종료 제안
  await passTo(page, "2026-11-03", "2026-W45");
  await expect(header(page, ENV).getByTestId("nudge")).toContainText("3주째 기록 없음");
  await expect(page.getByTestId("nudge")).toHaveCount(1); // 팀 운영은 W42에 고친 기록이 있어 제안 없음

  // 종료 → 다음 주에서 사라짐(반복 "예정"은 그대로) → 설정에서 다시 시작
  await header(page, ENV).getByTestId("nudge").getByRole("button", { name: "종료" }).click();
  await expect(page.getByText(`"${ENV}" 종료됨`)).toBeVisible();
  await expect(header(page, ENV)).toContainText("종료됨");
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("week-title")).toContainText("2026-W46");
  await expect(header(page, ENV)).toHaveCount(0);
  await expect(cell(page, TEAM, "2026-11-09").getByTestId("repeat-preview")).toContainText("주간 회의 정리");
  await page.keyboard.press("Alt+ArrowLeft");

  await page.getByRole("button", { name: "설정" }).click();
  const dialog = page.getByRole("dialog", { name: "설정" });
  await expect(dialog.getByTestId("repeat-list")).toContainText("2026-W42부터 반복 중");
  await dialog.getByRole("button", { name: "다시 시작" }).click();
  await expect(dialog).toContainText("종료된 업무가 없습니다");
  await page.keyboard.press("Escape");
  await expect(header(page, ENV)).not.toContainText("종료됨");
  // 같은 주에 다시 시작하면 원래 구간을 다시 연다(data-spec 4-3) → 제안이 다시 보이고, [유지]로 N주 조용히
  await header(page, ENV).getByTestId("nudge").getByRole("button", { name: "유지" }).click();
  await expect(page.getByTestId("nudge")).toHaveCount(0);

  // ── 실행 취소: 입력 → Ctrl+Z로 되돌리고, 다시 읽어도 되돌린 상태
  await page.keyboard.press("Alt+KeyT");
  await page.keyboard.type("실수로 쓴 줄");
  await saved(page);
  await page.keyboard.press("Control+KeyZ");
  await expect.poll(() => values(page, PLAN, "2026-11-03")).not.toContain("실수로 쓴 줄");
  await saved(page);

  // ── 지난 주들을 다시 열어 기록이 그대로인지
  await page.keyboard.press("Alt+ArrowRight");
  await page.keyboard.press("Alt+ArrowLeft");
  expect(await values(page, PLAN, "2026-11-03")).not.toContain("실수로 쓴 줄");
  for (let i = 0; i < 4; i++) await page.keyboard.press("Alt+ArrowLeft");
  await expect(page.getByTestId("week-title")).toContainText("2026-W41");
  expect(await values(page, PLAN, "2026-10-05")).toEqual(["기획안 초안 작성"]);
  expect(await values(page, TEAM, "2026-10-05")).toEqual(["주간 회의 정리"]);
  expect(await values(page, ENV, "2026-10-05")).toEqual(["개발 서버 구성"]);
  await expect(page.locator(".note-prose")).toHaveText("분기 목표 정리");
  await page.keyboard.press("Alt+ArrowRight");
  expect(await values(page, TEAM, "2026-10-12")).toEqual(["주간 회의 정리 — 결정 사항 3건"]);
  await page.keyboard.press("Alt+ArrowRight");
  expect(await values(page, TEAM, "2026-10-19")).toEqual(["주간 회의 정리"]);
});
