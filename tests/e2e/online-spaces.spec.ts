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
  // 지금 앱 화면 그대로 + 위 띠
  await expect(page.getByTestId("online-workspace")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("online-workspace")).toContainText("온라인 공간");
  await expect(page.getByTestId("rail-settings")).toBeVisible({ timeout: 30_000 });
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
