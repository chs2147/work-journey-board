// D-4 내 온라인 공간(브라우저 모드 가짜 서버·가짜 캐시, 외부 요청 없음) — docs/v2-design/87
import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, query = "") {
  await page.goto(`/?profile=connected-preview${query}`);
  await page.getByTestId("preview-email-input").fill("virtual@example.invalid");
  await page.getByRole("button", { name: "인증번호 받기" }).click();
  await page.getByTestId("preview-code-input").fill("12345678");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page.getByTestId("online-spaces")).toBeVisible();
}
const external = (requests: string[]) =>
  requests.filter((u) => !/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u) && !u.startsWith("data:"));

test("D-4·E-1: 복제 → 내 온라인 공간 목록 → 열기 → 앱 화면 → 고치면 이 기기 대기열에 → 목록으로", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await signIn(page);
  await expect(page.getByTestId("online-spaces")).toContainText("아직 온라인 공간이 없습니다");
  await page.getByTestId("copy-pick").click();
  await page.getByTestId("copy-start").click({ timeout: 30_000 });
  await expect(page.getByTestId("copy-done")).toBeVisible({ timeout: 30_000 });
  const row = page.getByTestId("online-space-row");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(/기록 \d+행 · 그림 1개/);
  // UX-2(95): 공간 이름표 = 구름 표시 모노그램 + 이름(서버 목록의 설정 값)
  const name = row.getByTestId("online-space-name");
  await expect(name.getByTestId("workspace-cloud")).toBeVisible();
  await expect(name.locator("b")).not.toHaveText("");
  await row.getByTestId("online-space-open").click();
  // 지금 앱 화면 그대로 — 위 띠 없이 레일 공간 단추(구름 표시)·상단 동기화 알약(UX-3, 95 U1·U2·U8)
  await expect(page.getByTestId("online-workspace")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("rail-settings")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("workspace-button").getByTestId("workspace-cloud")).toBeVisible();
  await expect(page.getByTestId("online-sync-status")).toBeVisible();
  await expect(page.getByTestId("save-state")).toHaveCount(0);
  // 복제된 가상 업무가 보인다(가상 샘플 showcase의 업무 이름 중 하나)
  await expect(page.locator("body")).toContainText(/정산|보안|가상/);
  // E-1: 읽기 전용이 아니다 — 기록을 고치면 이 기기 일지에 저장되고 보낼 목록(대기열)에 쌓인다
  const outbox = () =>
    page.evaluate(() =>
      (globalThis as unknown as { __wjbApp: { syncOutbox(): Promise<number | null> } }).__wjbApp.syncOutbox(),
    );
  // 열 때 앱이 이 기기 설정을 한 번 쓴다 — 공용 설정은 그대로라 보내지 않고 대기열에서 지운다
  await expect.poll(outbox, { timeout: 10_000 }).toBe(0);
  const entry = page.locator("textarea").first();
  await entry.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" 고침");
  await page.keyboard.press("Escape");
  await expect.poll(outbox, { timeout: 10_000 }).toBeGreaterThan(0);
  expect(external(requests)).toEqual([]);
  await syncPanel(page);
  await page.getByTestId("online-workspace-close").click();
  await expect(page.getByTestId("connected-preview")).toBeVisible();
});

test("D-4: 온라인 공간의 업무 메모보드·업무노트는 정식판처럼 별도 창으로 열린다", async ({ page }) => {
  await signIn(page);
  await page.getByTestId("copy-pick").click();
  await page.getByTestId("copy-start").click({ timeout: 30_000 });
  await expect(page.getByTestId("copy-done")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("online-space-open").click();
  await expect(page.getByTestId("rail-settings")).toBeVisible({ timeout: 30_000 });
  const categoryId = await page.getByTestId("category-header").first().getAttribute("data-category-id");
  // 업무 이름의 메모보드 바로가기 → 별도 창(브라우저 모드 = 팝업, 실앱 = OS 창)
  const boardWindow = page.waitForEvent("popup");
  await page.getByTestId("task-board-cat-badge").first().click();
  const board = await boardWindow;
  await expect(board.getByTestId("note-scroll")).toBeVisible({ timeout: 15_000 });
  expect(new URL(board.url()).searchParams.get("id")).toBe(categoryId);
  await board.close();
});

async function openCopied(page: Page) {
  await page.getByTestId("copy-pick").click();
  await page.getByTestId("copy-start").click({ timeout: 30_000 });
  await expect(page.getByTestId("copy-done")).toBeVisible({ timeout: 30_000 });
  const ws = await page
    .getByTestId("online-space-row")
    .locator(":scope > span[title]")
    .first()
    .getAttribute("title");
  await page.getByTestId("online-space-open").click();
  await expect(page.getByTestId("rail-settings")).toBeVisible({ timeout: 30_000 });
  return ws!;
}
const syncStatus = (page: Page) => page.getByTestId("online-sync-status");
/** S3 동기화 패널 열기(알약을 누름) */
async function syncPanel(page: Page) {
  if (!(await page.getByTestId("online-sync-panel").isVisible())) await syncStatus(page).click();
  await expect(page.getByTestId("online-sync-panel")).toBeVisible();
}

test("E-3·E-5: 고치면 약 1초 뒤 보내 '동기화됨', 다른 기기 변경은 [지금 동기화]로 받아 화면에", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await signIn(page);
  const ws = await openCopied(page);
  await expect(syncStatus(page)).toContainText(/동기화됨|이 기기에 저장됨/, { timeout: 15_000 });
  const entry = page.locator("textarea").first();
  await entry.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" 동기화");
  await page.keyboard.press("Escape");
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await expect(syncStatus(page)).toContainText("동기화됨", { timeout: 15_000 });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          globalThis as unknown as { __wjbApp: { syncOutbox(): Promise<number | null> } }
        ).__wjbApp.syncOutbox(),
      ),
    )
    .toBe(0);
  // 가만히 두면 동기화를 되풀이하지 않는다(E-3 실기: 엔진 자기 쓰기 → 보내기 예약 고리로 매초 동기화)
  const runs = async () => Number(await syncStatus(page).getAttribute("data-runs"));
  const before = await runs();
  await page.waitForTimeout(5000);
  expect((await runs()) - before).toBeLessThanOrEqual(1);
  // 다른 기기가 화면에 보이는 기록 하나를 고침 → 지금 동기화 → 화면에 보인다
  const shown = await page.locator("[data-item-id]").last().getAttribute("data-item-id");
  await page.evaluate(
    ([w, id]) =>
      (
        globalThis as unknown as {
          __wjbFakeSync: { editEntryElsewhere(w: string, t: string, id?: string): Promise<string> };
        }
      ).__wjbFakeSync.editEntryElsewhere(w!, "다른 기기에서 고친 가상 기록", id!),
    [ws, shown],
  );
  await syncPanel(page);
  await expect(page.getByTestId("online-sync-panel")).toContainText("virtual@example.invalid");
  await page.getByTestId("online-sync-now").click();
  await expect
    .poll(
      () => page.locator("textarea").evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value)),
      {
        timeout: 15_000,
      },
    )
    .toContain("다른 기기에서 고친 가상 기록");
  // E+: 일지를 다시 열지 않고 화면만 새로 고쳐 반영(깜박임·입력 끊김 없음)
  await expect(syncStatus(page)).toHaveAttribute("data-refreshed", "1");
  expect(external(requests)).toEqual([]);
});

test("E-5: 서버에 닿지 못하면 '오프라인 · 이 기기에 저장됨 · 대기 N건'", async ({ page }) => {
  await signIn(page, "&syncOffline=1");
  await openCopied(page);
  const entry = page.locator("textarea").first();
  await entry.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" 오프라인");
  await page.keyboard.press("Escape");
  await expect(syncStatus(page)).toContainText(/오프라인 · 이 기기에 저장됨 · 대기 \d+건/, {
    timeout: 15_000,
  });
  await expect(syncStatus(page)).toHaveAttribute("data-phase", "offline");
});

async function copyOnce(page: Page) {
  const again = page.getByRole("button", { name: "다른 일지 복제" });
  if (await again.isVisible()) await again.click();
  await page.getByTestId("copy-pick").click();
  await page.getByTestId("copy-start").click({ timeout: 30_000 });
  await expect(page.getByTestId("copy-done")).toBeVisible({ timeout: 30_000 });
}
const counts = (page: Page) =>
  page.evaluate(() =>
    (
      globalThis as unknown as { __wjbApp: { journalCounts(): Promise<Record<string, number> | null> } }
    ).__wjbApp.journalCounts(),
  );

test("UX-3: 레일 공간 메뉴로 온라인 공간을 오간다 — 구름 표시·계정 묶음, 고친 내용은 그 공간에만(3번 왕복, CLAUDE.md 4-7)", async ({
  page,
}) => {
  await signIn(page);
  await copyOnce(page);
  await copyOnce(page);
  await expect(page.getByTestId("online-space-row")).toHaveCount(2);
  await page.getByTestId("online-space-open").first().click();
  await expect(page.getByTestId("rail-settings")).toBeVisible({ timeout: 30_000 });
  const before = JSON.stringify(await counts(page));
  // 첫 공간 기록 하나를 고친다
  const entry = page.locator("textarea").first();
  await entry.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" 첫 공간만");
  await page.keyboard.press("Escape");
  // 저장된 뒤의 행 수를 기준으로(빈 칸에 쓰면 기록이 하나 생긴다)
  await expect.poll(async () => JSON.stringify(await counts(page)), { timeout: 10_000 }).not.toBe(before);
  const first = JSON.stringify(await counts(page));
  const menu = page.getByTestId("workspace-menu");
  await page.getByTestId("workspace-button").click();
  await expect(menu).toContainText("온라인 · virtual@example.invalid");
  const items = menu.getByTestId("workspace-item");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0).getByTestId("workspace-cloud")).toBeVisible();
  await expect(items.nth(0)).toHaveAttribute("data-current", "true");
  for (let i = 0; i < 3; i++) {
    // 둘째 공간으로 — 고친 글은 거기 없다
    if (!(await menu.isVisible())) await page.getByTestId("workspace-button").click();
    await items.nth(1).click();
    await expect
      .poll(
        () =>
          page
            .locator("textarea")
            .evaluateAll((els) => els.some((e) => (e as HTMLTextAreaElement).value.includes("첫 공간만"))),
        { timeout: 15_000 },
      )
      .toBe(false);
    await page.getByTestId("workspace-button").click();
    await expect(items.nth(1)).toHaveAttribute("data-current", "true");
    await page.keyboard.press("Escape");
    // Ctrl+Alt+1 = 첫 공간으로 — 고친 글이 그대로, 저장소 행 수도 그대로
    await page.keyboard.press("Control+Alt+Digit1");
    await expect
      .poll(
        () =>
          page
            .locator("textarea")
            .evaluateAll((els) => els.some((e) => (e as HTMLTextAreaElement).value.includes("첫 공간만"))),
        { timeout: 15_000 },
      )
      .toBe(true);
    expect(JSON.stringify(await counts(page))).toBe(first);
  }
});

test("UX-3 실기: 온라인 공간의 설정 › 워크스페이스 = 온라인 공간 목록 — 이 PC 새 공간은 만들지 않고, 이름을 고치면 레일·메뉴에 바로", async ({
  page,
}) => {
  await signIn(page);
  await copyOnce(page);
  await copyOnce(page);
  await page.getByTestId("online-space-open").first().click();
  await expect(page.getByTestId("rail-settings")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("workspace-button").click();
  await page.getByTestId("workspace-manage").click();
  const view = page.getByTestId("workspace-settings");
  await expect(view).toBeVisible();
  await expect(view).toContainText("온라인 · virtual@example.invalid");
  const rows = view.getByTestId("workspace-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).getByTestId("workspace-cloud")).toBeVisible();
  // 이 PC 새 공간·기존 폴더 추가 단추가 없다(온라인 공간 안에서 일반 일지를 만들던 실기 문제)
  await expect(page.getByTestId("ws-settings-new")).toHaveCount(0);
  await expect(view.getByTestId("ws-remove")).toHaveCount(0);
  // 지금 공간의 이름·색·아이콘 → 레일 단추·메뉴에 바로
  await rows.nth(0).getByTestId("ws-edit").click();
  const edit = view.getByTestId("ws-edit-row");
  await edit.getByTestId("ws-name").fill("가상 온라인");
  await edit.getByTestId("ws-icons").locator('[data-icon="chartUp"]').click();
  await edit.getByTestId("ws-edit-save").click();
  await expect(rows.nth(0)).toContainText("가상 온라인");
  await expect(page.getByTestId("workspace-button").locator("[data-icon]")).toHaveAttribute(
    "data-icon",
    "chartUp",
  );
  // 다른 공간 [열기] = 한 길 전환, 동기화는 그 공간 일지로(오류 없음)
  await rows.nth(1).getByTestId("ws-open").click();
  await expect(page.getByTestId("rail-settings")).toBeVisible({ timeout: 30_000 });
  await expect(syncStatus(page)).not.toHaveAttribute("data-phase", "error", { timeout: 5_000 });
  await syncStatus(page).click();
  await page.getByTestId("online-sync-now").click();
  await expect(syncStatus(page)).toContainText(/동기화됨|이 기기에 저장됨/, { timeout: 15_000 });
  await expect(syncStatus(page)).not.toHaveAttribute("data-phase", "error");
});

test("UX-4: 설정 › 계정(온라인 공간에서만) → 로그아웃… 확인 → 보내고 저장 후 첫 화면(로그인 전)", async ({
  page,
}) => {
  await signIn(page);
  await openCopied(page);
  await page.getByTestId("rail-settings").click();
  const tab = page.getByRole("tab", { name: /계정/ });
  await expect(tab).toBeVisible();
  await tab.click();
  const card = page.getByTestId("account-settings");
  await expect(card).toContainText("virtual@example.invalid");
  await expect(card.getByTestId("account-spaces")).toHaveText("1개");
  // 로그아웃은 확인을 거친다
  await card.getByTestId("preview-sign-out").click();
  await expect(card.getByTestId("sign-out-confirm")).toContainText("보내지 못한 변경은 이 기기에 남아");
  await card.getByTestId("sign-out-confirm-ok").click();
  // 창을 새로 불러 첫 화면 — 로그인 전(브라우저 모드는 가짜 서버가 메모리라 새로 시작)
  await expect(page.getByTestId("connected-preview")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("preview-email-input")).toBeVisible();
});

test("UX-4: 충돌은 설정과 같은 전체 화면 — 이 기기 / 서버 나란히, 고르면 사라진다", async ({ page }) => {
  await signIn(page);
  const ws = await openCopied(page);
  await expect(syncStatus(page)).toContainText(/동기화됨|이 기기에 저장됨/, { timeout: 15_000 });
  // 이번 주에 기록 하나를 만들고 서버에 보낸다
  await page.locator("textarea").first().click();
  await page.keyboard.type("충돌 시험 가상 기록");
  await page.keyboard.press("Escape");
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await expect(syncStatus(page)).toContainText("동기화됨", { timeout: 15_000 });
  const item = page.locator("[data-item-id]").last();
  const id = await item.getAttribute("data-item-id");
  // 다른 기기가 서버에서 먼저 고침 → 이 기기도 같은 기록을 고침(받기 전) → 보내면 충돌
  await page.evaluate(
    ([w, i]) =>
      (
        globalThis as unknown as {
          __wjbFakeSync: { editEntryElsewhere(w: string, t: string, id?: string): Promise<string> };
        }
      ).__wjbFakeSync.editEntryElsewhere(w!, "다른 기기 쪽 가상 글", i!),
    [ws, id],
  );
  await item.locator("textarea").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" 이 기기 쪽");
  await page.keyboard.press("Escape");
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await expect(syncStatus(page)).toContainText("충돌 1건", { timeout: 15_000 });
  await syncPanel(page);
  await page.getByTestId("online-sync-conflicts").click();
  const view = page.getByTestId("online-conflicts");
  await expect(view).toBeVisible();
  // 전체 화면(창 크기만큼)
  const box = await view.boundingBox();
  const vp = page.viewportSize()!;
  expect(box!.width).toBeGreaterThanOrEqual(vp.width - 1);
  expect(box!.height).toBeGreaterThanOrEqual(vp.height - 1);
  const c = view.getByTestId("online-conflict");
  await expect(c).toHaveCount(1);
  await expect(c).toContainText("이 기기 쪽");
  await expect(c).toContainText("다른 기기 쪽 가상 글");
  await c.getByTestId("conflict-mine").click();
  await expect(view.getByTestId("online-conflict")).toHaveCount(0, { timeout: 15_000 });
  await view.getByTestId("online-conflicts-close").click();
  await expect(view).toHaveCount(0);
  await expect(syncStatus(page)).not.toContainText("충돌", { timeout: 15_000 });
});
