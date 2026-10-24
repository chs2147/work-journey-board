// 주간 요약 패널(i-m2-plan M2-S1, overview 10-7, output-spec 2절). 브라우저 모드, 오늘 = 2026-10-22(목, W43), 가상 샘플.
import { expect, test, type Page } from "@playwright/test";

const TODAY = "2026-10-22";
const SETTLE = "차세대 정산 시스템 구축";
const SEC = "협력사 보안 점검";
const FIRST = "테스트 데이터 이관 스크립트 작성 착수"; // 오늘 SETTLE 칸 첫 항목(시작 시 커서)

const panel = (page: Page) => page.getByTestId("summary-panel");
const auto = (page: Page) => page.getByTestId("summary-auto");
const edited = (page: Page) => page.getByTestId("summary-edited");
const cell = (page: Page, cat: string, date: string) => page.getByTestId(`cell-${cat}-${date}`);
const saved = (page: Page) => expect(page.getByTestId("save-state")).toHaveText("저장됨 ✓");
const clipboard = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as { __wjb: { clipboard(): string | null } }).__wjb.clipboard());

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/?today=${TODAY}`);
  await expect(page.locator(":focus")).toHaveValue(FIRST);
});

test("Alt+S로 열고 닫기 — 자동 집계 탭에 포커스, Esc는 보드의 원래 칸으로", async ({ page }) => {
  await expect(panel(page)).toHaveCount(0);
  await page.keyboard.press("Alt+KeyS");
  await expect(panel(page)).toBeVisible();
  await expect(page.getByRole("tab", { name: "자동 집계" })).toBeFocused();
  await expect(auto(page)).toContainText("[주간 업무 요약] 2026-W43 (10/19~10/25)");
  await expect(auto(page)).toContainText("※ 이번 주 기록 없음: 신규 입사자 온보딩");
  await expect(page.getByTestId("summary-final")).toHaveText("최종본: 자동 집계");
  await expect(page.getByTestId("summary-toggle")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator(":focus")).toHaveValue(FIRST);
  await page.keyboard.press("Alt+KeyS");
  await expect(panel(page)).toHaveCount(0);
});

test("보드 입력이 바로 반영되고, 메모 포함을 끄면 [메모] 블록이 빠진다", async ({ page }) => {
  await page.getByTestId("summary-toggle").click();
  await page.locator(":focus").evaluate((e) => (e as HTMLElement).blur());
  await cell(page, SETTLE, TODAY).locator("textarea").first().focus();
  await page.keyboard.press("End");
  await page.keyboard.type(" 완료");
  await expect(auto(page)).toContainText(`- (목) ${FIRST} 완료`);
  await expect(auto(page)).toContainText("[메모]");
  await panel(page).getByLabel("메모 포함").uncheck();
  await expect(auto(page)).not.toContainText("[메모]");
});

test("수정본: 만들기 → 고치기(자동 저장) → 최종본 복사 → 다른 주에 갔다 와도 그대로", async ({ page }) => {
  await page.keyboard.press("Alt+KeyS");
  await panel(page).getByRole("button", { name: "수정본 만들기" }).click();
  await expect(page.getByRole("tab", { name: /수정본/ })).toHaveAttribute("aria-selected", "true");
  await expect(edited(page)).toBeFocused();
  const original = await edited(page).inputValue();
  expect(original.startsWith("[주간 업무 요약] 2026-W43")).toBe(true); // 자동 집계본으로 채워짐
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n(덧붙임) 다음 주 배포 준비");
  await saved(page);
  await expect(page.getByTestId("summary-final")).toHaveText("최종본: 수정본");

  await panel(page).getByRole("button", { name: "최종본 복사" }).click();
  await expect(page.getByText("최종본(수정본)을 복사했습니다")).toBeVisible();
  expect(await clipboard(page)).toBe(`${original}\n(덧붙임) 다음 주 배포 준비`);

  // 패널은 보고 있는 주를 따라간다
  await page.keyboard.press("Alt+ArrowRight");
  await expect(panel(page)).toContainText("2026-W44");
  await expect(page.getByTestId("summary-final")).toHaveText("최종본: 자동 집계");
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page.getByTestId("summary-final")).toHaveText("최종본: 수정본");
  await page.getByRole("tab", { name: /수정본/ }).click();
  await expect(edited(page)).toHaveValue(`${original}\n(덧붙임) 다음 주 배포 준비`);
});

test("수정본을 만든 뒤 기록이 바뀌면 안내 → 비교 → 확인함으로 닫힘", async ({ page }) => {
  await page.keyboard.press("Alt+KeyS");
  await panel(page).getByRole("button", { name: "수정본 만들기" }).click();
  await saved(page);
  await expect(page.getByTestId("summary-changed")).toHaveCount(0);

  await cell(page, SEC, TODAY).locator("textarea").first().focus();
  await page.keyboard.press("End");
  await page.keyboard.type(" — 1차 완료");
  await saved(page);
  await expect(page.getByTestId("summary-changed")).toContainText("작성 후 기록이 변경되었습니다");
  await panel(page).getByRole("button", { name: "자동 집계본과 비교" }).click();
  await expect(page.getByTestId("summary-compare")).toContainText("점검 결과 보고서 초안 작성 — 1차 완료");
  await expect(edited(page)).not.toHaveValue(/1차 완료/); // 수정본은 덮어쓰지 않는다
  await panel(page).getByRole("button", { name: "확인함" }).click();
  await expect(page.getByTestId("summary-changed")).toHaveCount(0);
});

test("메모 포함만 바꿔서는 기록 변경 안내가 뜨지 않는다", async ({ page }) => {
  await page.keyboard.press("Alt+KeyS");
  await panel(page).getByRole("button", { name: "수정본 만들기" }).click();
  await saved(page);
  await page.getByRole("tab", { name: "자동 집계" }).click();
  await panel(page).getByLabel("메모 포함").uncheck();
  await page.getByRole("tab", { name: /수정본/ }).click();
  await expect(edited(page)).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.getByTestId("summary-changed")).toHaveCount(0);
});

test("수정본 삭제 → 되돌리기, 다시 만들기는 확인 후 자동 집계로", async ({ page }) => {
  await page.keyboard.press("Alt+KeyS");
  await panel(page).getByRole("button", { name: "수정본 만들기" }).click();
  await page.keyboard.type("직접 쓴 수정본");
  await saved(page);
  await panel(page).getByRole("button", { name: "수정본 삭제" }).click();
  await expect(page.getByText("수정본을 삭제했습니다")).toBeVisible();
  await expect(page.getByTestId("summary-final")).toHaveText("최종본: 자동 집계");
  await page.getByRole("button", { name: "되돌리기" }).click();
  await expect(edited(page)).toHaveValue(/직접 쓴 수정본/);
  await expect(page.getByTestId("summary-final")).toHaveText("최종본: 수정본");

  page.once("dialog", (d) => void d.accept());
  await panel(page).getByRole("button", { name: "자동 집계로 다시 만들기" }).click();
  await expect(edited(page)).not.toHaveValue(/직접 쓴 수정본/);
  await expect(edited(page)).toHaveValue(/^\[주간 업무 요약\] 2026-W43/);
});

test("자리: 넓은 창은 보드를 밀어내고, 좁은 창(또는 중요 업무 패널과 함께)은 겹쳐 뜬다", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 }); // 1500 − 레일 52 − 요약 360 = 1088 ≥ 900
  await page.keyboard.press("Alt+KeyS");
  const position = () => panel(page).evaluate((e) => getComputedStyle(e).position);
  expect(await position()).toBe("static");
  await page.keyboard.press("Alt+Digit2"); // 중요 업무 패널(264)까지 열면 824 < 900
  await expect(page.getByTestId("important-panel")).toBeVisible();
  expect(await position()).toBe("absolute");
  await page.keyboard.press("Alt+Digit2");
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect.poll(position).toBe("absolute");
  // 겹친 상태에서 보드를 누르면 닫힌다
  await cell(page, SETTLE, "2026-10-20").click({ position: { x: 60, y: 90 } });
  await expect(panel(page)).toHaveCount(0);
});

test("패널이 열려 있어도 매일 기록 흐름은 그대로 — 보드 칸 입력·저장", async ({ page }) => {
  await page.getByTestId("summary-toggle").click();
  await cell(page, SETTLE, TODAY).locator("textarea").first().focus();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("새 항목");
  await saved(page);
  await expect(auto(page)).toContainText("- (목) 새 항목");
});
