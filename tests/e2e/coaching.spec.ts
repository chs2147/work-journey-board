// 앱 안 코칭(coaching-spec 11절): 처음 1회 카드(새 사용자 V1 · 기존 사용자 V3), 코칭 메뉴(F1·레일 ?·설정),
// 모든 투어의 단계 대상, 건너뛰기·이어서, 끝나면 내 일지·시작 화면 복귀. 예시 일지는 메모리 가상 샘플만.
// 자동 카드는 자동 시험에서 쉬므로 주소에 `coach=1`을 붙여 켠다.
import { expect, test, type Page } from "@playwright/test";
import { openSettings, settingsView } from "./settings-helper";

const TODAY = "2026-10-22";
const q = (extra = "") => `/?today=${TODAY}&coach=1${extra}`;

type Flags = {
  existingUser: boolean;
  introShown?: boolean;
  done: Record<string, number>;
  progress?: { tour: string; step: number } | null;
  seenScreens: string[];
  suggest: boolean;
};
const config = (page: Page) =>
  page.evaluate(() =>
    (
      globalThis as unknown as { __wjb: { config(): { dataDir: string; coaching?: Flags } | null } }
    ).__wjb.config(),
  );
const counts = (page: Page) =>
  page.evaluate(() =>
    (
      globalThis as unknown as { __wjbApp: { journalCounts(): Promise<Record<string, number>> } }
    ).__wjbApp.journalCounts(),
  );

const overlay = (page: Page) => page.getByTestId("coach-overlay");
const bubble = (page: Page) => page.getByTestId("coach-bubble");
const count = (page: Page) => page.getByTestId("coach-count");
const status = (page: Page) => page.getByTestId("journal-status");

async function openMenu(page: Page) {
  await page.keyboard.press("F1");
  await expect(page.getByTestId("coach-menu")).toBeVisible();
}

/** 메뉴에서 투어를 골라 끝까지 넘긴다 — 단계마다 말풍선·단계 수·(대상이 있으면) 밝힌 테두리를 확인 */
async function runTour(page: Page, id: string, total: number) {
  await openMenu(page);
  await page.getByTestId(`coach-tour-${id}`).click();
  await expect(status(page)).toContainText("coaching-sample");
  for (let i = 1; i <= total; i++) {
    await expect(count(page)).toHaveText(`${i} / ${total}`);
    await expect(bubble(page)).toBeVisible();
    // 말풍선은 대상 위치를 따라 다시 그려진다 — 잰 순간 사라졌다 다시 생기면 null이라 잡힐 때까지 기다린다(WebKit CI)
    let box: { x: number; y: number; width: number; height: number } | null = null;
    await expect
      .poll(async () => (box = await bubble(page).boundingBox()) !== null, { timeout: 5000 })
      .toBe(true);
    const vp = page.viewportSize()!;
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height);
    await page.getByTestId("coach-next").click();
  }
  await expect(overlay(page)).toHaveCount(0);
  await expect(status(page)).not.toContainText("coaching-sample");
}

test.describe("처음 1회 카드", () => {
  test("새 사용자: 첫 실행 → 보드에 환영 카드(V1) → 1분 둘러보기 → Esc 건너뛰기 → 이어서", async ({
    page,
  }) => {
    await page.goto(q("&fresh=1"));
    await page.getByRole("button", { name: "새로 시작하기" }).click();
    await page.getByRole("button", { name: "다음" }).click();
    const input = page.getByRole("textbox", { name: "업무 이름 입력 후 Enter" });
    await input.fill("가 업무");
    await input.press("Enter");
    await page.getByRole("button", { name: "보드 열기 →" }).click();
    await expect(page.getByTestId("category-header")).toHaveCount(1);

    await expect(page.getByTestId("coach-welcome")).toBeVisible();
    await expect(page.getByTestId("coach-feature")).toHaveCount(0);
    expect((await config(page))!.coaching!.existingUser).toBe(false);
    await page
      .getByTestId("coach-welcome")
      .getByRole("button", { name: /1분 둘러보기/ })
      .click();

    // 빈 일지여도 예시 화면으로 — 업무가 여럿 보인다
    await expect(count(page)).toHaveText("1 / 10");
    await expect(status(page)).toContainText("coaching-sample");
    expect(await page.getByTestId("category-header").count()).toBeGreaterThan(1);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(count(page)).toHaveText("3 / 10");
    await page.keyboard.press("Escape");
    await expect(overlay(page)).toHaveCount(0);

    // 내 일지로 — 업무 1개 그대로
    await expect(page.getByTestId("category-header")).toHaveCount(1);
    await expect(page.getByTestId("category-header")).toContainText("가 업무");
    const f = (await config(page))!.coaching!;
    expect(f.introShown).toBe(true);
    expect(f.progress).toEqual({ tour: "T0", step: 2 });

    // 메뉴에 "3 / 10" → 누르면 그 단계부터
    await openMenu(page);
    await expect(page.getByTestId("coach-tour-T0")).toContainText("3 / 10");
    await page.getByTestId("coach-tour-T0").click();
    await expect(count(page)).toHaveText("3 / 10");
    await page.getByTestId("coach-skip").click();
    await expect(overlay(page)).toHaveCount(0);
  });

  test("기존 사용자: 업데이트 뒤 ? 단추 소개(V3) 한 번 — [다음에]면 다시 띄우지 않는다", async ({ page }) => {
    await page.goto(q());
    await expect(page.getByTestId("coach-feature")).toBeVisible();
    await expect(page.getByTestId("coach-welcome")).toHaveCount(0);
    expect((await config(page))!.coaching!.existingUser).toBe(true);
    await page.getByTestId("coach-feature").getByRole("button", { name: "다음에" }).click();
    await expect(page.getByTestId("coach-feature")).toHaveCount(0);
    expect((await config(page))!.coaching!.introShown).toBe(true);

    // 다른 화면을 열고 와도 카드는 다시 나오지 않는다(화면별 제안 칩만)
    await page.getByTestId("rail-kanban").click();
    await expect(page.getByTestId("coach-suggest")).toBeVisible();
    await page.getByTestId("rail-board").click();
    await expect(page.getByTestId("coach-feature")).toHaveCount(0);
  });

  test("T0을 끝까지 보면 다음 투어 고르기 카드, 메뉴에 완료 표시", async ({ page }) => {
    await page.goto(q());
    await page
      .getByTestId("coach-feature")
      .getByRole("button", { name: /1분 둘러보기/ })
      .click();
    await expect(count(page)).toHaveText("1 / 10");
    for (let i = 0; i < 10; i++) await page.keyboard.press("Enter");
    await expect(overlay(page)).toHaveCount(0);
    await expect(page.getByTestId("coach-after")).toBeVisible();
    expect((await config(page))!.coaching!.done.T0).toBe(2); // T0 콘텐츠 판(개선 v26 = 2)
  });
});

test.describe("코칭 메뉴", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/?today=${TODAY}`); // 자동 카드 없이
    await expect(page.getByTestId("week-title")).toContainText("2026-W43");
  });

  test("F1·레일 ?로 열고 Esc·바깥 클릭으로 닫는다, 칸반에서는 '이 화면' 투어가 맨 위", async ({ page }) => {
    await openMenu(page);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("coach-menu")).toHaveCount(0);
    await page.getByTestId("rail-coach").click();
    await expect(page.getByTestId("coach-menu")).toBeVisible();
    await page.getByTestId("week-title").click();
    await expect(page.getByTestId("coach-menu")).toHaveCount(0);

    await page.getByTestId("rail-kanban").click();
    await openMenu(page);
    await expect(page.getByTestId("coach-tour-T4-here")).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("설정 › 기능 둘러보기: 메뉴 열기·제안 끄기·처음 설치처럼 다시 보기", async ({ page }) => {
    await openSettings(page, "update");
    const card = settingsView(page).getByTestId("coaching-settings");
    await card.getByTestId("settings-coach-suggest").uncheck();
    expect((await config(page))!.coaching!.suggest).toBe(false);
    await card.getByTestId("settings-coach-open").click();
    await expect(page.getByTestId("coach-menu")).toBeVisible();
    await expect(page.getByTestId("coach-suggest-toggle")).not.toBeChecked();
    await page.keyboard.press("Escape");

    await openSettings(page, "update");
    await settingsView(page).getByTestId("settings-coach-replay").click();
    await expect(page.getByTestId("coach-welcome")).toBeVisible();
    expect((await config(page))!.coaching!.existingUser).toBe(false);
  });

  test("모든 투어(T0~T8): 단계마다 말풍선이 화면 안에, 끝나면 내 일지·주간 보드, 기록은 그대로", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    const before = await counts(page);
    const dataDir = (await config(page))!.dataDir;
    const tours: [string, number][] = [
      ["T0", 10],
      ["T1", 9],
      ["T2", 9],
      ["T3", 6],
      ["T4", 7],
      ["T5", 7],
      ["T6", 10],
      ["T7", 6],
      ["T8", 7],
    ];
    for (const [id, n] of tours) await runTour(page, id, n);
    expect(await counts(page)).toEqual(before);
    const c = (await config(page))!;
    expect(c.dataDir).toBe(dataDir);
    expect(Object.keys(c.coaching!.done).sort()).toEqual(tours.map(([id]) => id));
    await expect(page.getByTestId("week-title")).toContainText("2026-W43");
  });

  test("업무노트(T9)·업무 메모보드(T10): 예시 문서 창 안에서 투어 → 끝나면 창이 닫히고 내 일지로, 내 일지에 노트·보드 없음", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const before = await counts(page);
    for (const [id, n, kind] of [
      ["T9", 10, "note"],
      ["T10", 9, "board"],
    ] as const) {
      await openMenu(page);
      const popup = page.waitForEvent("popup");
      await page.getByTestId(`coach-tour-${id}`).click();
      const win = await popup;
      // 메인 창은 예시 일지를 연 채 기다린다
      await expect(page.getByTestId("coach-away")).toBeVisible();
      await expect(status(page)).toContainText("coaching-sample");
      await expect(win.getByTestId(kind === "note" ? "cabi-note-editor" : "cabi-task-board")).toBeVisible();
      await expect(win.locator("body")).toContainText("가상 예시");
      for (let i = 1; i <= n; i++) {
        await expect(win.getByTestId("coach-count")).toHaveText(`${i} / ${n}`);
        await expect(win.getByTestId("coach-bubble")).toBeVisible();
        await win.getByTestId("coach-next").click();
      }
      await expect.poll(() => win.isClosed()).toBe(true);
      await expect(page.getByTestId("coach-overlay")).toHaveCount(0);
      await expect(status(page)).not.toContainText("coaching-sample");
      expect((await config(page))!.coaching!.done[id]).toBe(1);
    }
    // 예시 노트·보드는 메모리 예시 일지에만 — 내 일지는 그대로
    expect(await counts(page)).toEqual(before);
  });

  test("업무노트 투어 중 창을 닫거나 메인 창 [그만 보기]면 건너뛰기로 끝나고 내 일지로", async ({ page }) => {
    await openMenu(page);
    let popup = page.waitForEvent("popup");
    await page.getByTestId("coach-tour-T9").click();
    let win = await popup;
    await expect(win.getByTestId("coach-count")).toHaveText("1 / 10");
    await win.getByTestId("coach-next").click();
    await expect(win.getByTestId("coach-count")).toHaveText("2 / 10");
    await win.close();
    await expect(page.getByTestId("coach-overlay")).toHaveCount(0, { timeout: 15_000 });
    await expect(status(page)).not.toContainText("coaching-sample");
    expect((await config(page))!.coaching!.done.T9).toBeUndefined();

    await openMenu(page);
    popup = page.waitForEvent("popup");
    await page.getByTestId("coach-tour-T9").click();
    win = await popup;
    await expect(win.getByTestId("coach-count")).toBeVisible();
    await page.getByTestId("coach-away-stop").click();
    await expect(page.getByTestId("coach-overlay")).toHaveCount(0);
    await expect.poll(() => win.isClosed()).toBe(true);
    await expect(status(page)).not.toContainText("coaching-sample");
  });

  test("칸반에서 시작한 투어는 끝나면 칸반으로 돌아온다", async ({ page }) => {
    await page.getByTestId("rail-kanban").click();
    await expect(page.getByTestId("kanban-board")).toBeVisible();
    await openMenu(page);
    await page.getByTestId("coach-tour-T2").click();
    await expect(count(page)).toHaveText("1 / 9");
    await expect(page.getByTestId("kanban-board")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(overlay(page)).toHaveCount(0);
    await expect(page.getByTestId("kanban-board")).toBeVisible();
  });

  test("좁은 창(1024px)·맥 표기에서도 말풍선이 화면 안에", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 720 });
    await page.goto(`/?today=${TODAY}&os=mac`);
    await expect(page.getByTestId("week-title")).toContainText("2026-W43");
    await runTour(page, "T2", 9);
    await openMenu(page);
    await page.getByTestId("coach-tour-T1").click();
    await expect(bubble(page)).not.toContainText("Ctrl+");
    await page.keyboard.press("Escape");
  });
});
