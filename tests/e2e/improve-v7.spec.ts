// 개선 v7(improve-1102v7-spec): 주간 뷰 열 폭, 끌기 손잡이, Cabinet 폴더 놓기 이유·바로 가기·탐색기 단추·폴더 확인·경로 다시 지정,
// 폴더 창 새로 고침·자동 반영, 업무 목록 폭, 메모 보드 사각형 선택·함께 이동·Delete. 가상 샘플·가상 경로만.
import { expect, test, type Page } from "@playwright/test";

const SHOW = "/?today=2026-10-22&sample=showcase";

async function open(page: Page, url = SHOW) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
}

const calls = (page: Page) =>
  page.evaluate(() =>
    (globalThis as unknown as { __wjb: { cabinetCalls(): string[] } }).__wjb.cabinetCalls(),
  );

async function drop(page: Page, testId: string, data: Record<string, string>, files: string[] = []) {
  await page.getByTestId(testId).evaluate(
    (el, { data, files }) => {
      const dt = new DataTransfer();
      for (const [k, v] of Object.entries(data)) dt.setData(k, v);
      for (const f of files) dt.items.add(new File([""], f));
      el.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
      el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    },
    { data, files },
  );
}

const colWidth = (page: Page, testId: string) =>
  page.getByTestId(testId).evaluate((el) => Math.round(el.getBoundingClientRect().width));

test("주간 뷰 열 폭: 업무 열·요일 열 끌기, 두 번 누르면 자동, 주를 넘겨도 유지 · 끌기 손잡이가 크게 보인다", async ({
  page,
}) => {
  await open(page, "/?today=2026-10-22");
  const handle = page.getByTestId("col-resizer-label");
  const box = (await handle.boundingBox())!;
  const before = await colWidth(page, "board-grid").then(() =>
    page
      .locator('[data-testid="board-grid"] > div')
      .first()
      .evaluate((el) => el.getBoundingClientRect().width),
  );
  await page.mouse.move(box.x + 3, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 84, box.y + 20, { steps: 5 });
  await page.mouse.up();
  const after = await page
    .locator('[data-testid="board-grid"] > div')
    .first()
    .evaluate((el) => el.getBoundingClientRect().width);
  expect(Math.round(after - before)).toBeGreaterThanOrEqual(70);

  // 화요일(자리 1) 열을 넓힌다 → 다음 주에도 같은 폭
  const tue = page.getByTestId("col-resizer-1");
  const tb = (await tue.boundingBox())!;
  const w0 = await colWidth(page, "day-2026-10-20");
  await page.mouse.move(tb.x + 3, tb.y + 20);
  await page.mouse.down();
  await page.mouse.move(tb.x + 124, tb.y + 20, { steps: 5 });
  await page.mouse.up();
  const w1 = await colWidth(page, "day-2026-10-20");
  expect(w1 - w0).toBeGreaterThan(80);
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("week-title")).toContainText("2026-W44");
  expect(Math.abs((await colWidth(page, "day-2026-10-27")) - w1)).toBeLessThanOrEqual(2);
  // 두 번 누르면 자동으로
  await page.getByTestId("col-resizer-1").dblclick();
  expect(Math.abs((await colWidth(page, "day-2026-10-27")) - w1)).toBeGreaterThan(20);

  // 끌기 손잡이: 항목에 올리면 18px 폭으로 또렷하게
  await page.keyboard.press("Alt+ArrowLeft");
  const item = page.locator("[data-item-id]").first();
  await item.hover();
  const grip = item.getByTestId("drag-row");
  await expect(grip).toBeVisible();
  const g = (await grip.boundingBox())!;
  expect(g.width).toBeGreaterThanOrEqual(17);
  expect(Number(await grip.evaluate((el) => getComputedStyle(el).opacity))).toBeGreaterThan(0.8);
});

test("Cabinet: 폴더 놓기 이유 안내·바로 가기(.lnk)는 가리키는 폴더로 · 줄의 탐색기 단추 · 폴더 확인·경로 다시 지정 · 업무 목록 폭", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.press("Alt+4");
  await expect(page.getByTestId("cabinet")).toBeVisible();

  // 압축 파일·바로 가기
  await drop(page, "cabinet-drop", {}, ["백업본.zip"]);
  await expect(
    page.getByText("‘백업본.zip’은(는) 압축 파일이라 등록하지 않습니다 — 풀어 둔 폴더를 끌어 오세요"),
  ).toBeVisible();
  await drop(page, "cabinet-drop", {}, ["정산 회의록 바로 가기.lnk"]);
  // 회의록은 이미 등록돼 있어 연결만(새로 만들지 않음)
  await expect(page.getByText("이미 등록된 항목입니다 — 연결만 더했습니다")).toBeVisible();

  // 줄의 [탐색기에서 열기] 단추 = 그 폴더 안으로
  await page
    .getByTestId("cabinet-row")
    .filter({ hasText: "배치 테스트 자료" })
    .getByTestId("cabinet-row-reveal")
    .click();
  await expect.poll(() => calls(page)).toContain("open /demo/업무/정산/테스트");

  // 폴더 확인: 모두 있음 → (가상) 폴더 하나를 옮긴 뒤 다시 확인 → 찾을 수 없음
  await page.getByTestId("cabinet-check").click();
  await expect(page.getByText("등록 폴더 4개 모두 열 수 있습니다")).toBeVisible();
  await page.evaluate(() =>
    (globalThis as unknown as { __wjb: { movePath(a: string, b: string): void } }).__wjb.movePath(
      "/demo/업무/정산/설계",
      "/demo/업무/정산/설계(이전)",
    ),
  );
  await page.getByTestId("cabinet-check").click();
  await expect(page.getByText("등록 폴더 4개 중 1개를 찾을 수 없습니다 — ⋯ › 경로 다시 지정")).toBeVisible();
  const design = page.getByTestId("cabinet-row").filter({ hasText: "설계 문서" });
  await expect(design.getByTestId("cabinet-missing")).toBeVisible();
  await design.dblclick();
  await expect(page.getByText("‘설계 문서’ 폴더를 찾을 수 없습니다 — ⋯ › 경로 다시 지정")).toBeVisible();
  // 경로 다시 지정(브라우저 모드는 경로 입력)
  page.once("dialog", (d) => void d.accept("/demo/업무/정산/설계(이전)"));
  await design.getByTestId("cabinet-row-more").click();
  await page.getByTestId("cabinet-menu-relocate").click();
  await expect(page.getByText("‘설계 문서’ 경로를 바꿨습니다")).toBeVisible();
  await expect(design).toContainText("/demo/업무/정산/설계(이전)");
  await expect(design.getByTestId("cabinet-missing")).toHaveCount(0);

  // 업무 목록 폭: 구분선 끌기
  const side = page.locator('nav[aria-label="업무별"]');
  const s0 = (await side.boundingBox())!.width;
  const r = (await page.getByTestId("cabinet-side-resizer").boundingBox())!;
  await page.mouse.move(r.x + 3, r.y + 100);
  await page.mouse.down();
  await page.mouse.move(r.x + 103, r.y + 100, { steps: 5 });
  await page.mouse.up();
  expect((await side.boundingBox())!.width - s0).toBeGreaterThan(80);
});

test("폴더 창: [새로 고침]·자동 반영(밖에서 파일을 바꾸면 3초 안에)", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Alt+4");
  await page.getByTestId("cabinet-row").filter({ hasText: "배치 테스트 자료" }).dblclick();
  const win = page.getByTestId("folder-window");
  await expect(win.getByTestId("folder-row")).toHaveCount(2);
  await page.evaluate(() =>
    (globalThis as unknown as { __wjb: { writeFile(p: string): void } }).__wjb.writeFile(
      "/demo/업무/정산/테스트/새 결과표.xlsx",
    ),
  );
  // 자동(3초마다)
  await expect(win.getByTestId("folder-row")).toHaveCount(3, { timeout: 6000 });
  await page.evaluate(() =>
    (globalThis as unknown as { __wjb: { movePath(a: string, b: string): void } }).__wjb.movePath(
      "/demo/업무/정산/테스트/새 결과표.xlsx",
      "/demo/업무/정산/테스트/결과표(최종).xlsx",
    ),
  );
  await win.getByTestId("folder-refresh").click();
  await expect(win.locator('[data-testid="folder-row"][data-name="결과표(최종).xlsx"]')).toBeVisible();
  await expect(win.locator('[data-testid="folder-row"][data-name="새 결과표.xlsx"]')).toHaveCount(0);
});

test("메모 보드: 빈 곳을 끌어 사각형으로 여러 상자 고르기 → 함께 옮기기(되돌리기 한 번) · 방향키 · Delete · Esc", async ({
  page,
}) => {
  await open(page);
  const canvas = page.getByTestId("note-canvas");
  const items = page.locator('[data-testid="note-canvas"] [data-box-id]:not([data-testid="note-ghost"])');
  await expect(items.first()).toBeVisible();
  const total = await items.count();
  expect(total).toBeGreaterThanOrEqual(3);
  const pos = () =>
    items.evaluateAll((els) =>
      els.map((el) => [(el as HTMLElement).style.left, (el as HTMLElement).style.top].join(",")),
    );
  const p0 = await pos();
  const c = (await canvas.boundingBox())!;
  // 판 왼쪽 위 빈 곳에서 오른쪽 아래로 크게 끌기
  await page.mouse.move(c.x + 4, c.y + 4);
  await page.mouse.down();
  await page.mouse.move(c.x + 900, c.y + 400, { steps: 8 });
  await expect(page.getByTestId("note-marquee")).toBeVisible();
  await page.mouse.up();
  await expect(page.getByTestId("note-marquee")).toHaveCount(0);
  const chosen = await page.locator('[data-testid="note-canvas"] [data-multi="1"]').count();
  expect(chosen).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId("note-multi-hint")).toContainText(`상자 ${chosen}개 선택`);
  // 빈 곳 클릭이 아니었으니 새 상자는 없음
  expect(await items.count()).toBe(total);

  // 고른 상자 하나(첫 상자 머리)를 끌면 함께 이동
  const first = page.locator('[data-testid="note-canvas"] [data-multi="1"]').first();
  const grip = first.locator("button").first();
  await grip.scrollIntoViewIfNeeded();
  const gb = (await grip.boundingBox())!;
  await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
  await page.mouse.down();
  await page.mouse.move(gb.x + gb.width / 2 + 40, gb.y + gb.height / 2 + 24, { steps: 5 });
  await page.mouse.up();
  const p1 = await pos();
  const movedN = p1.filter((v, i) => v !== p0[i]).length;
  expect(movedN).toBe(chosen);
  // 되돌리기 한 번에 모두 제자리
  await page.keyboard.press("Control+Z");
  expect(await pos()).toEqual(p0);

  // 다시 골라 방향키 → Delete → 되돌리기
  await page.mouse.move(c.x + 4, c.y + 4);
  await page.mouse.down();
  await page.mouse.move(c.x + 900, c.y + 400, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("ArrowRight");
  expect((await pos()).filter((v, i) => v !== p0[i]).length).toBe(chosen);
  await page.keyboard.press("Delete");
  await expect(page.getByText(`메모 상자 ${chosen}개를 지웠습니다`)).toBeVisible();
  expect(await items.count()).toBe(total - chosen);
  await page.getByRole("button", { name: "되돌리기" }).click();
  expect(await items.count()).toBe(total);
  // Esc = 해제
  await page.mouse.move(c.x + 4, c.y + 4);
  await page.mouse.down();
  await page.mouse.move(c.x + 900, c.y + 400, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-testid="note-canvas"] [data-multi="1"]')).toHaveCount(0);
});
