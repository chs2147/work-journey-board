// 개선 U1 E2E(improve-1026-spec 1·2·3·7절): 오늘 머리 강조 · 연차 표시 · 직전 기록 가져오기 · 빈 메모 상자 안 만듦.
// 브라우저 모드, 오늘 = 2026-10-22(목, 2026-W43), 가상 샘플만.
import { expect, test, type Page } from "@playwright/test";

const TODAY = "2026-10-22";
const saved = (page: Page) => expect(page.getByTestId("save-state")).toHaveText("저장됨 ✓");
const cellTexts = (page: Page, name: string, day: string) =>
  page.getByTestId(`cell-${name}-${day}`).locator("textarea");

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?today=${TODAY}`);
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
});

test("오늘 머리는 포커스와 무관하게 채운 파랑 + [오늘] 배지, 포커스 열은 따로(위쪽 선)", async ({ page }) => {
  const today = page.getByTestId(`day-${TODAY}`);
  await expect(today).toHaveClass(/colToday/);
  await expect(today).toHaveClass(/colFocus/);
  const bg = () => today.evaluate((e) => getComputedStyle(e).backgroundColor);
  const filled = await bg();
  // 다른 요일을 누르면 포커스만 옮겨 가고 오늘 머리는 그대로
  await page.getByTestId("day-2026-10-20").click();
  await expect(page.getByTestId("day-2026-10-20")).toHaveClass(/colFocus/);
  await expect(today).not.toHaveClass(/colFocus/);
  expect(await bg()).toBe(filled);
  await expect(today).toContainText("오늘");
  await expect(page.getByTestId("day-2026-10-20")).not.toHaveClass(/colToday/);
});

test("요일 머리 ⋯ → 연차: 배지·열 음영, 반차는 테두리 배지, 근무로 되돌리기 · Ctrl+Z", async ({ page }) => {
  const head = page.getByTestId("day-2026-10-21");
  await head.hover();
  await page.getByTestId("day-menu-2026-10-21").click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitemradio", { name: "근무" })).toHaveAttribute("aria-checked", "true");
  await menu.getByRole("menuitemradio", { name: "연차(종일)" }).click();
  await expect(head.getByTestId("day-mark")).toHaveText("연차");
  await expect(head).toHaveClass(/colLeave/);
  await expect(page.getByTestId("cell-차세대 정산 시스템 구축-2026-10-21")).toHaveClass(/cellLeave/);
  await saved(page);

  // 반차로 바꾸면 음영 없이 배지만
  await page.getByTestId("day-menu-2026-10-21").click();
  await page.getByRole("menuitemradio", { name: "오후 반차" }).click();
  await expect(head.getByTestId("day-mark")).toHaveText("오후 반차");
  await expect(head).not.toHaveClass(/colLeave/);

  // 실행 취소 → 다시 연차, 다른 주에 다녀와도 그대로
  await page.keyboard.press("Control+KeyZ");
  await expect(head.getByTestId("day-mark")).toHaveText("연차");
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("week-title")).toContainText("2026-W44");
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(head.getByTestId("day-mark")).toHaveText("연차");

  // 주간 요약 자동 집계 끝에 연차 줄
  await page.keyboard.press("Alt+KeyS");
  await expect(page.getByTestId("summary-auto")).toContainText("※ 연차: 수(10/21)");
  await page.keyboard.press("Escape");

  // 근무로 되돌리기
  await page.getByTestId("day-menu-2026-10-21").click();
  await page.getByRole("menuitemradio", { name: "근무" }).click();
  await expect(head.getByTestId("day-mark")).toHaveCount(0);
  await expect(head).not.toHaveClass(/colLeave/);
});

test("Alt+P: 칸 안에서 그 업무의 직전 기록일 내역을 끝에 · 같은 내역은 건너뜀 · 되돌리기", async ({
  page,
}) => {
  const cell = cellTexts(page, "차세대 정산 시스템 구축", TODAY);
  await expect(page.locator(":focus")).toHaveValue("테스트 데이터 이관 스크립트 작성 착수");
  await page.keyboard.press("Alt+KeyP");
  await expect(cell).toHaveText([
    "테스트 데이터 이관 스크립트 작성 착수",
    "설계안 팀 리뷰, 수정 의견 5건 반영 중",
  ]);
  await expect(page.getByRole("status")).toContainText("10/21(수) 항목 1개를 가져왔습니다");
  await expect(page.locator(":focus")).toHaveValue("설계안 팀 리뷰, 수정 의견 5건 반영 중");
  await saved(page);
  // 한 번 더 → 이미 있음
  await page.keyboard.press("Alt+KeyP");
  await expect(page.getByRole("status")).toContainText("10/21(수) 내역은 이미 모두 들어 있습니다");
  await expect(cell).toHaveCount(2);
  // 되돌리기
  await page.getByRole("status").getByRole("button", { name: "되돌리기" }).first().click();
  await expect(cell).toHaveCount(1);
});

test("빈 칸(포커스 열)의 [직전 기록일 내역 가져오기] 단추 — 본·세부 항목 그대로", async ({ page }) => {
  const btn = page.getByTestId("cell-사내 데이터 대시보드-2026-10-22").getByTestId("pull-previous");
  await expect(btn).toContainText("10/20(화) 내역 가져오기");
  // 업무마다 그 업무의 직전 기록일(4주 안)
  await expect(
    page.getByTestId("cell-신규 입사자 온보딩-2026-10-22").getByTestId("pull-previous"),
  ).toContainText("10/15(목) 내역 가져오기");
  await btn.click();
  await expect(cellTexts(page, "사내 데이터 대시보드", TODAY)).toHaveText(["지표 정의서 v0.3 공유"]);
  await saved(page);
  // 금요일로 옮기면 금요일 기준(목요일 기록이 직전)
  await page.getByTestId("day-2026-10-23").click();
  await expect(
    page.getByTestId("cell-협력사 보안 점검-2026-10-23").getByTestId("pull-previous"),
  ).toContainText("10/22(목) 내역 가져오기");
});

test("Alt+Shift+P · 요일 머리 메뉴: 직전 기록일 업무 전체 — 종일 연차인 날은 건너뛴다, 되돌리기 한 번", async ({
  page,
}) => {
  // 10/21을 연차로 → 10/22의 직전 기록일은 10/20
  await page.getByTestId("day-2026-10-21").hover();
  await page.getByTestId("day-menu-2026-10-21").click();
  await page.getByRole("menuitemradio", { name: "연차(종일)" }).click();
  await saved(page);

  await page.getByTestId(`day-${TODAY}`).hover();
  await page.getByTestId(`day-menu-${TODAY}`).click();
  const pullAll = page.getByRole("menuitem", { name: /업무 전체 가져오기/ });
  await expect(pullAll).toContainText("10/20(화) 업무 전체 가져오기");
  await page.keyboard.press("Escape");

  await page.locator(":focus").press("Alt+Shift+KeyP");
  await expect(page.getByRole("status")).toContainText("10/20(화) 업무 2개 · 항목 3개를 가져왔습니다");
  await expect(cellTexts(page, "차세대 정산 시스템 구축", TODAY)).toHaveText([
    "테스트 데이터 이관 스크립트 작성 착수",
    "배치 스케줄러 설계안 작성",
    "야간 배치 시간대 02~04시로 협의",
  ]);
  await expect(cellTexts(page, "사내 데이터 대시보드", TODAY)).toHaveText(["지표 정의서 v0.3 공유"]);
  await saved(page);
  await page.keyboard.press("Control+KeyZ");
  await expect(cellTexts(page, "차세대 정산 시스템 구축", TODAY)).toHaveCount(1);
  await expect(cellTexts(page, "사내 데이터 대시보드", TODAY)).toHaveCount(0);
});

test("메모: 빈 곳 클릭은 커서 자리만 — 글자를 쳐야 상자, 클릭만 하고 주를 옮기면 아무것도 남지 않음", async ({
  page,
  browserName,
}) => {
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("week-title")).toContainText("2026-W44");
  const canvas = page.getByTestId("note-canvas");
  const c = (await canvas.boundingBox())!;
  await page.mouse.click(c.x + 120, c.y + 60);
  await expect(page.getByTestId("note-ghost")).toHaveCount(1);
  await expect(page.getByTestId("note-box")).toHaveCount(0);
  await expect(page.getByTestId("note-toolbar")).toHaveCount(0);
  await expect(page.getByTestId("note-counts")).toHaveText("비어 있음");
  // 클릭만 하고 다른 주에 다녀오면 아무것도 없다
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("week-title")).toContainText("2026-W44");
  await expect(page.getByTestId("note-empty")).toBeVisible();

  // 클릭 → 한글 첫 글자(조합)로 상자가 된다
  await page.mouse.click(c.x + 120, c.y + 60);
  await expect(page.getByTestId("note-ghost")).toHaveCount(1);
  if (browserName === "chromium") {
    // Chromium(= WebView2 계열): CDP로 실제 한글 조합 첫 글자
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.imeSetComposition", { text: "ㄱ", selectionStart: 1, selectionEnd: 1 });
    await cdp.send("Input.imeSetComposition", { text: "가", selectionStart: 1, selectionEnd: 1 });
    await cdp.send("Input.insertText", { text: "가" });
  } else {
    await page.keyboard.type("가");
  }
  await page.keyboard.type("상 메모");
  await expect(page.getByTestId("note-box")).toHaveCount(1);
  await expect(page.getByTestId("note-ghost")).toHaveCount(0);
  await expect(page.locator(".note-prose")).toHaveText("가상 메모");
  await expect(page.getByTestId("note-toolbar")).toBeVisible();
  // Ctrl+Z(메모 기록)는 상자째 지운다 — 편집을 끝낸 뒤
  await page.keyboard.press("Escape");
  await saved(page);
  await page.keyboard.press("Control+KeyZ");
  await expect(page.getByTestId("note-box")).toHaveCount(0);
});
