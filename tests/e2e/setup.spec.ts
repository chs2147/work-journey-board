// 첫 실행·저장 위치·설정·백업 E2E (i-m1-plan S4). 브라우저 모드의 가짜 폴더(/demo/...)를 쓴다.
// 폴더 선택 대화상자는 브라우저 모드에서 경로 입력(prompt)으로 대신한다 → page.once("dialog")로 응답.
import { expect, test, type Page } from "@playwright/test";

const TODAY = "2026-10-22";
const q = (extra = "") => `/?today=${TODAY}${extra}`;

const files = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as { __wjb: { files(): string[] } }).__wjb.files());
const answerFolder = (page: Page, path: string) => page.once("dialog", (d) => void d.accept(path));
const headers = (page: Page) => page.getByTestId("category-header");

test.describe("첫 실행 (overview 10-8)", () => {
  test("새로 시작: 추천 폴더 → 첫 업무 2개 → 보드, 일지 파일과 그날 백업 생성", async ({ page }) => {
    await page.goto(q("&fresh=1"));
    await expect(
      page.getByText("기록은 이 PC의 파일 하나에만 저장되고 외부로 전송되지 않습니다."),
    ).toBeVisible();
    await page.getByRole("button", { name: "새로 시작하기" }).click();
    await expect(page.getByTestId("first-run-path")).toHaveText("/demo/WorkJourney");
    await page.getByRole("button", { name: "다음" }).click();
    const input = page.getByRole("textbox", { name: "업무 이름 입력 후 Enter" });
    await input.fill("가 업무");
    await input.press("Enter");
    await input.fill("나 업무");
    await input.press("Enter");
    await page.getByRole("button", { name: "보드 열기 →" }).click();

    await expect(headers(page)).toHaveCount(2);
    await expect(page.locator(":focus")).toHaveAttribute("aria-label", `가 업무 · 목 ${TODAY} 기록`);
    const all = await files(page);
    expect(all).toContain("/demo/WorkJourney/work-journey.db");
    expect(all).toContain("/demo/WorkJourney/backups/work-journey_2026-10-22.db");
    expect(all).toContain("/demo/WorkJourney/backups/work-journey_2026-10_monthly.db");
  });

  test("OneDrive 폴더를 고르면 경고, 추천 폴더로 되돌리기", async ({ page }) => {
    await page.goto(q("&fresh=1"));
    await page.getByRole("button", { name: "새로 시작하기" }).click();
    answerFolder(page, "/demo/OneDrive - Company/문서/WJ");
    await page.getByRole("button", { name: "찾아보기" }).click();
    await expect(page.getByRole("alert")).toContainText("OneDrive 동기화 폴더입니다");
    await expect(page.getByRole("button", { name: "다음" })).toBeDisabled();
    await page.getByRole("button", { name: "추천 폴더 사용" }).click();
    await expect(page.getByTestId("first-run-path")).toHaveText("/demo/WorkJourney");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "다음" })).toBeEnabled();
  });

  test("기존 일지 열기: 일지 있는 폴더는 열고, 없는 폴더는 안내", async ({ page }) => {
    await page.goto(q("&fresh=1&existing=/demo/Old"));
    answerFolder(page, "/demo/Empty");
    await page.getByRole("button", { name: "기존 일지 열기 (PC 교체·복원)" }).click();
    await expect(page.getByText("이 폴더에 일지 파일(work-journey.db)이 없습니다.")).toBeVisible();
    answerFolder(page, "/demo/Old");
    await page.getByRole("button", { name: "기존 일지 열기 (PC 교체·복원)" }).click();
    await expect(headers(page)).toHaveCount(4);
    await expect(page.getByTestId("journal-status")).toContainText("/demo/Old");
  });

  test("저장 폴더를 찾을 수 없으면 안내 화면 → 다른 폴더의 기존 일지 열기", async ({ page }) => {
    await page.goto(q("&config=/demo/Gone&existing=/demo/Old"));
    await expect(page.getByRole("heading", { name: "저장 폴더를 찾을 수 없습니다" })).toBeVisible();
    await expect(page.getByRole("button", { name: "설정" })).toBeDisabled();
    answerFolder(page, "/demo/Old");
    await page.getByRole("button", { name: "다른 폴더의 기존 일지 열기" }).click();
    await expect(headers(page)).toHaveCount(4);
  });
});

test.describe("설정 > 저장 위치 (overview 10-10)", () => {
  async function openSettings(page: Page) {
    await page.getByRole("button", { name: "설정" }).click();
    await expect(page.getByRole("dialog", { name: "설정" })).toBeVisible();
  }
  async function changeTo(page: Page, path: string) {
    answerFolder(page, path);
    await page.getByRole("button", { name: "저장 위치 변경…" }).click();
  }

  test.beforeEach(async ({ page }) => {
    await page.goto(q("&existing=/demo/Other"));
    await expect(headers(page)).toHaveCount(4);
    await openSettings(page);
    await expect(page.getByTestId("settings-data-dir")).toHaveText("/demo/WorkJourney");
  });

  test("같은 폴더 → 아무것도 하지 않음", async ({ page }) => {
    await changeTo(page, "/demo/WorkJourney");
    await expect(page.getByTestId("location-flow")).toHaveText("지금과 같은 폴더입니다.");
  });

  test("빈 폴더 → 옮기기(백업 포함), 원본은 그대로", async ({ page }) => {
    await changeTo(page, "/demo/New");
    await expect(page.getByTestId("location-flow")).toContainText("지금 일지를 /demo/New 로 옮깁니다.");
    await page.getByRole("button", { name: "옮기기" }).click();
    await expect(page.getByTestId("location-flow")).toContainText(
      "옮겼습니다. 이전 폴더의 파일은 그대로 남아 있습니다.",
    );
    await expect(page.getByTestId("settings-data-dir")).toHaveText("/demo/New");
    const all = await files(page);
    expect(all).toContain("/demo/New/work-journey.db");
    expect(all).toContain("/demo/New/backups/work-journey_2026-10-22.db");
    expect(all).toContain("/demo/WorkJourney/work-journey.db");
    expect(
      all.filter((p) => p.startsWith("/demo/WorkJourney/backups/") && p.endsWith("_manual.db")),
    ).toHaveLength(1);
    await page.getByRole("button", { name: "닫기" }).click();
    await expect(headers(page)).toHaveCount(4);
    await expect(page.getByTestId("journal-status")).toContainText("/demo/New");
  });

  test("다른 일지가 있는 폴더 → 덮어쓰지 않고 전환", async ({ page }) => {
    await changeTo(page, "/demo/Other");
    await expect(page.getByTestId("location-flow")).toContainText("이 폴더에 다른 일지가 있습니다.");
    await page.getByRole("button", { name: "그 일지로 전환" }).click();
    await expect(page.getByTestId("location-flow")).toContainText("다른 일지로 전환했습니다.");
    await expect(page.getByTestId("settings-data-dir")).toHaveText("/demo/Other");
  });

  test("OneDrive 폴더 → 경고 후 그래도 사용 → 옮기기 확인", async ({ page }) => {
    await changeTo(page, "/demo/OneDrive - Company/문서/WJ");
    await expect(page.getByTestId("location-flow")).toContainText("OneDrive 동기화 폴더입니다");
    await page.getByRole("button", { name: "그래도 이 폴더 사용" }).click();
    await expect(page.getByRole("button", { name: "옮기기" })).toBeVisible();
  });
});

test.describe("설정 > 백업·업무·무기록", () => {
  test("지금 백업 → 마지막 백업 표시 갱신", async ({ page }) => {
    await page.goto(q());
    await page.getByRole("button", { name: "설정" }).click();
    await expect(page.getByTestId("last-backup")).toHaveText("마지막 백업: 2026-10-22");
    await page.getByRole("button", { name: "지금 백업" }).click();
    await expect(page.getByTestId("last-backup")).toHaveText(/마지막 백업: 2026-10-22 \d{2}:\d{2}/);
  });

  test("종료된 업무 다시 시작", async ({ page }) => {
    await page.goto(q());
    const onb = headers(page).filter({ hasText: "신규 입사자 온보딩" });
    await onb.getByRole("button", { name: "신규 입사자 온보딩 메뉴" }).click();
    await page.getByRole("menuitem", { name: "종료" }).click();
    await expect(onb).toContainText("종료됨");
    await page.getByRole("button", { name: "설정" }).click();
    const dialog = page.getByRole("dialog", { name: "설정" });
    await expect(dialog).toContainText("신규 입사자 온보딩");
    await dialog.getByRole("button", { name: "다시 시작" }).click();
    await expect(dialog).toContainText("종료된 업무가 없습니다");
    await page.keyboard.press("Escape");
    await expect(onb).not.toContainText("종료됨");
  });

  test("무기록 종료 제안 기준을 끄고 켜기", async ({ page }) => {
    await page.goto(q());
    await page.getByRole("button", { name: "설정" }).click();
    const select = page.getByRole("combobox");
    await expect(select).toHaveValue("3");
    await select.selectOption("0");
    await page.getByRole("button", { name: "닫기" }).click();
    await page.getByRole("button", { name: "설정" }).click();
    await expect(page.getByRole("combobox")).toHaveValue("0");
  });
});

test("창을 닫기 직전 입력 중인 내용도 저장되고 종료 백업이 남는다", async ({ page }) => {
  await page.goto(q());
  await expect(page.locator(":focus")).toHaveValue("테스트 데이터 이관 스크립트 작성 착수");
  await page.keyboard.type(" (종료 직전)");
  await page.evaluate(() => (globalThis as unknown as { __wjb: { exit(): Promise<void> } }).__wjb.exit());
  await page.keyboard.press("Alt+ArrowRight");
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(
    page.getByTestId(`cell-차세대 정산 시스템 구축-${TODAY}`).locator("textarea").first(),
  ).toHaveValue("테스트 데이터 이관 스크립트 작성 착수 (종료 직전)");
  expect(await files(page)).toContain("/demo/WorkJourney/backups/work-journey_2026-10-22.db");
});
