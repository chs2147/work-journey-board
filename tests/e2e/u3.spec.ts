// 개선 U3 E2E(improve-1026-spec 8·11절): 오늘 뷰(전환·하루 이동·카드 편집·직전 기록·메모 왼쪽) · 메모 보드 줌·패닝·미니맵·아이콘 단추.
// 브라우저 모드, 오늘 = 2026-10-22(목, 2026-W43), 가상 샘플만.
import { expect, test, type Locator, type Page } from "@playwright/test";

const TODAY = "2026-10-22";
const SETTLE = "차세대 정산 시스템 구축";
const DASH = "사내 데이터 대시보드";
const saved = (page: Page) =>
  expect(page.locator('[data-testid="save-state"][data-idle="true"]')).toHaveText("저장됨");
const cellTexts = (page: Page, name: string, day: string) =>
  page.getByTestId(`cell-${name}-${day}`).locator("textarea");
const geom = (box: Locator) =>
  box.evaluate((el) => {
    const s = (el as HTMLElement).style;
    return { x: parseFloat(s.left), y: parseFloat(s.top), w: parseFloat(s.width) };
  });
const zoomOf = (page: Page) =>
  page.getByTestId("note-canvas").evaluate((el) => Number((el as HTMLElement).dataset.zoom));

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?today=${TODAY}`);
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
});

test("Alt+V → 오늘 뷰: 날짜·카드·첫 카드에 커서, 카드 편집은 보드와 같은 편집기, 하루씩 이동(주 넘김), 다시 주간 뷰", async ({
  page,
}) => {
  await page.keyboard.press("Alt+KeyV");
  await expect(page.getByTestId("today-view")).toBeVisible();
  await expect(page.getByTestId("view-today")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("today-date")).toHaveText("10/22(목)");
  await expect(page.getByTestId("week-title")).toHaveText("10/22(목) · 2026-W43");
  await expect(page.getByTestId("board-grid")).toHaveCount(0);
  // 아래 메모 도크 대신 왼쪽 메모
  await expect(page.getByTestId("note-dock")).toHaveAttribute("data-dock-mode", "side");

  // 첫 카드 기록 끝에 커서 → Enter로 새 항목, ↓로 다음 카드
  await expect(page.locator(":focus")).toHaveValue("테스트 데이터 이관 스크립트 작성 착수");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("오늘 뷰에서 쓴 가상 기록");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(":focus")).toHaveAttribute("aria-label", `협력사 보안 점검 · 목 ${TODAY} 기록`);
  await saved(page);

  // 하루씩: 금 → 토 → 일 → 다음 주 월
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("today-date")).toHaveText("10/23(금)");
  await page.getByRole("button", { name: "다음 날 (Alt+→)" }).click();
  await page.keyboard.press("Alt+ArrowRight");
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("today-date")).toHaveText("10/26(월)");
  await expect(page.getByTestId("week-title")).toContainText("2026-W44");
  await page.keyboard.press("Alt+KeyT");
  await expect(page.getByTestId("today-date")).toHaveText("10/22(목)");
  await expect(cellTexts(page, SETTLE, TODAY)).toHaveText([
    "테스트 데이터 이관 스크립트 작성 착수",
    "오늘 뷰에서 쓴 가상 기록",
  ]);

  // 주간 뷰로: 그 날이 든 주, 쓴 기록 그대로
  await page.getByTestId("view-week").click();
  await expect(page.getByTestId("board-grid")).toBeVisible();
  await expect(cellTexts(page, SETTLE, TODAY)).toHaveCount(2);
  await expect(page.getByTestId("note-dock")).not.toHaveAttribute("data-dock-mode", "side");
});

test("오늘 뷰 카드: 직전 기록 한 줄 + [가져오기], [전체 가져오기], [근무 ▾]로 연차, 마지막 카드 ↓ = 왼쪽 메모", async ({
  page,
}) => {
  await page.getByTestId("view-today").click();
  const dash = page.getByTestId(`today-card-${DASH}`);
  await expect(dash.getByTestId("today-prev")).toContainText("10/20(화): 지표 정의서 v0.3 공유");
  // 빈 칸 단추는 카드에서 미리보기 줄이 대신한다
  await expect(dash.getByTestId("pull-previous")).toHaveCount(0);
  await dash.getByRole("button", { name: "가져오기" }).click();
  await expect(cellTexts(page, DASH, TODAY)).toHaveText(["지표 정의서 v0.3 공유"]);
  await saved(page);

  await expect(page.getByTestId("today-pull-all")).toHaveText("10/21(수) 전체 가져오기");
  await page.getByTestId("today-pull-all").click();
  await expect(page.getByRole("status").filter({ hasText: "10/21(수) 업무 2개" })).toBeVisible();
  await expect(cellTexts(page, SETTLE, TODAY)).toHaveCount(2);

  await page.getByTestId("today-mark").click();
  await page.getByRole("menuitemradio", { name: "오전 반차" }).click();
  await expect(page.getByTestId("today-mark")).toHaveText("오전 반차 ▾");

  // 마지막 카드(온보딩) 칸에서 ↓ → 왼쪽 메모
  await page
    .getByTestId("today-card-신규 입사자 온보딩")
    .getByRole("button", { name: "+ 기록 추가" })
    .click();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(":focus")).toHaveClass(/note-prose/);
  await expect(page.locator(":focus").locator("xpath=ancestor::*[@data-dock-mode='side']")).toHaveCount(1);
});

test("메모 줌: 아이콘 단추·배율 목록·Ctrl+휠(커서 중심)·Ctrl+0·화면에 맞춤, 배율에서도 클릭 자리·끌기는 문서 좌표", async ({
  page,
}) => {
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("week-title")).toContainText("2026-W44");
  const dock = page.getByTestId("note-dock");
  // 아이콘 단추에 이름(aria-label)과 툴팁(단축키)
  await expect(dock.getByRole("button", { name: "텍스트 상자 추가" })).toHaveAttribute(
    "title",
    /Ctrl\+Enter/,
  );
  await expect(dock.getByRole("button", { name: "화면에 맞춤" })).toHaveAttribute("title", /Ctrl\+1/);
  await expect(dock.getByRole("button", { name: "크게 보기" })).toBeVisible();

  await dock.getByRole("button", { name: "축소" }).click();
  await expect(page.getByTestId("note-zoom")).toHaveValue("0.9");
  await page.getByTestId("note-zoom").selectOption("0.5");
  expect(await zoomOf(page)).toBe(0.5);

  // 50%에서 빈 곳 클릭 → 화면 (200, 100) = 문서 (400, 200)
  const canvas = page.getByTestId("note-canvas");
  const c = (await canvas.boundingBox())!;
  await page.mouse.click(c.x + 200, c.y + 100);
  await page.keyboard.type("배율 상자");
  const box = page.getByTestId("note-box").first();
  expect(await geom(box)).toEqual({ x: 400, y: 200, w: 320 });
  // 서식 막대는 배율과 상관없이 100% 크기
  const barH = (await page.getByTestId("note-toolbar").boundingBox())!.height;
  expect(barH).toBeGreaterThan(30);

  // 50%에서 막대를 화면 40px 끌면 문서 80px
  await page.keyboard.press("Escape");
  const grip = box.getByRole("button", { name: "상자 위치 이동(끌기)" });
  const g = (await grip.boundingBox())!;
  await page.mouse.move(g.x + 20, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + 60, g.y + g.height / 2, { steps: 5 });
  await page.mouse.up();
  expect((await geom(box)).x).toBe(480);

  // Ctrl+0 = 100%(메모 안에서), Ctrl+휠 = 확대
  await box.click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+Digit0");
  expect(await zoomOf(page)).toBe(1);
  await page.mouse.move(c.x + 100, c.y + 60);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -300);
  await page.keyboard.up("Control");
  await expect.poll(() => zoomOf(page)).toBeGreaterThan(1.3);

  // 화면에 맞춤: 상자가 보이는 배율(100% 넘지 않음), 왼쪽 위로
  await dock.getByRole("button", { name: "화면에 맞춤" }).click();
  await expect.poll(() => zoomOf(page)).toBeLessThan(1.3); // 맞춤이 적용될 때까지(휠로 키운 값에서 내려옴)
  expect(await zoomOf(page)).toBeLessThanOrEqual(1);
  await expect(page.getByTestId("note-scroll")).toHaveJSProperty("scrollTop", 0);
  await expect(page.getByTestId("note-scroll")).toHaveJSProperty("scrollLeft", 0);

  // 배율은 앱 전체 하나 — 오늘 뷰 왼쪽 메모도 같은 값
  const z = await zoomOf(page);
  await page.keyboard.press("Alt+KeyV");
  await expect(page.getByTestId("today-view")).toBeVisible();
  await expect.poll(() => zoomOf(page)).toBe(z);
});

test("메모 패닝·미니맵: 판이 넘치면 미니맵, 누르면 그곳으로, 접기 · Space+끌기·가운데 단추 끌기로 이동", async ({
  page,
}) => {
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("week-title")).toContainText("2026-W44");
  const scroll = page.getByTestId("note-scroll");
  await expect(page.getByTestId("note-minimap")).toHaveCount(0); // 넘치지 않으면 없음
  // 상자 하나 만들고 200%로 → 판이 넘친다
  const c = (await page.getByTestId("note-canvas").boundingBox())!;
  await page.mouse.click(c.x + 40, c.y + 40);
  await page.keyboard.type("멀리 보기");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape"); // 보드로
  await page.getByTestId("note-zoom").selectOption("2");
  const mm = page.getByTestId("note-minimap");
  await expect(mm).toBeVisible();
  // 미니맵 아래쪽을 누르면 그쪽으로 스크롤(이 판은 세로로 넘친다)
  const top = () => scroll.evaluate((el) => el.scrollTop);
  const m = (await mm.getByRole("img").boundingBox())!;
  await page.mouse.click(m.x + 4, m.y + m.height - 2);
  await expect.poll(top).toBeGreaterThan(60);

  // Space+끌기: 판 위에서 Space를 누른 채 아래로 끌면 위로 스크롤
  const before = await top();
  const s = (await scroll.boundingBox())!;
  await page.mouse.move(s.x + s.width / 2, s.y + 20);
  await page.keyboard.down("Space");
  await page.mouse.down();
  await page.mouse.move(s.x + s.width / 2, s.y + 80, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  await expect.poll(top).toBeLessThan(before - 40);
  await expect(page.getByTestId("note-ghost")).toHaveCount(0); // 끌기는 상자를 만들지 않는다

  // 가운데 단추 끌기: 위로 끌면 아래로 스크롤
  const mid = await top();
  await page.mouse.move(s.x + s.width / 2, s.y + 80);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(s.x + s.width / 2, s.y + 20, { steps: 4 });
  await page.mouse.up({ button: "middle" });
  await expect.poll(top).toBeGreaterThan(mid + 30);

  // 미니맵 접기 → 지도 단추만, 다시 펴기
  await mm.getByRole("button", { name: "미니맵 접기" }).click();
  await expect(mm).toHaveCount(0);
  await page.getByRole("button", { name: "미니맵 보기" }).click();
  await expect(page.getByTestId("note-minimap")).toBeVisible();
});

test("좁은 창(1100px 미만)의 오늘 뷰: 메모는 위쪽 접힌 띠 — 펼치면 메모, 마지막 카드 ↓도 메모를 편다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.getByTestId("view-today").click();
  const band = page.getByRole("button", { name: /이번 주 메모 펼치기/ });
  await expect(band).toBeVisible();
  await expect(page.getByTestId("note-dock")).toHaveCount(0);
  await band.click();
  await expect(page.getByTestId("note-dock")).toBeVisible();
  await page
    .getByRole("button", { name: /메모 접기/ })
    .first()
    .click();
  await expect(page.getByTestId("note-dock")).toHaveCount(0);
  await page
    .getByTestId("today-card-신규 입사자 온보딩")
    .getByRole("button", { name: "+ 기록 추가" })
    .click();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("note-dock")).toBeVisible();
});
