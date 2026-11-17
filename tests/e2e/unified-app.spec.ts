// G-1 로컬·온라인 통합 앱(A안, docs/v2-design/98) — DEV 판(?profile=local-dev) 브라우저 모드(가짜 서버, 외부 요청 없음).
// 로그인 전 = 지금 앱 그대로 + 설정 › 계정 · [온라인 로그인…]. 로그인 후 = 공간 메뉴 "이 PC" + "온라인 · 이메일".
// 이 PC ↔ 온라인 오가기 3번 뒤에도 두 일지의 행 수가 그대로(CLAUDE.md 4-7 전환 무결성).
import { expect, test, type Page } from "@playwright/test";

const EMAIL = "virtual@example.invalid";
type Counts = Record<string, number>;
const counts = (page: Page) =>
  page.evaluate(() =>
    (
      globalThis as unknown as { __wjbApp: { journalCounts(): Promise<Counts | null> } }
    ).__wjbApp.journalCounts(),
  );
const external = (requests: string[]) =>
  requests.filter((u) => !/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u) && !u.startsWith("data:"));

async function startDev(page: Page) {
  await page.goto("/?profile=local-dev&fresh=1");
  await page.getByTestId("dev-opt-sample").check();
  await page.getByTestId("dev-start").click();
  await expect(page.getByTestId("rail-settings")).toBeEnabled();
}
async function menu(page: Page) {
  await page.getByTestId("workspace-button").click();
  return page.getByTestId("workspace-menu");
}
/** 공간 메뉴 [온라인 로그인…] → 설정 › 계정에서 인증번호 로그인 */
async function signIn(page: Page) {
  await (await menu(page)).getByTestId("online-sign-in").click();
  await expect(page.getByTestId("settings-cat-account")).toBeVisible();
  await page.getByTestId("preview-email-input").fill(EMAIL);
  await page.getByRole("button", { name: "인증번호 받기" }).click();
  await page.getByTestId("preview-code-input").fill("12345678");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page.getByTestId("online-workspace-settings").or(page.getByText(EMAIL).first())).toBeVisible();
}
/** 공간 메뉴 [온라인 워크스페이스 만들기…] → 이 PC 기록으로 → 올리기 → [열기] */
async function createOnline(page: Page) {
  await page.keyboard.press("Escape");
  await (await menu(page)).getByTestId("online-create").click();
  await page.getByTestId("create-mode-local").click();
  await page.getByTestId("create-next").click();
  await page.getByTestId("copy-pick").click();
  await page.getByTestId("copy-start").click({ timeout: 30_000 });
  await expect(page.getByTestId("copy-done")).toBeVisible({ timeout: 30_000 });
}

test("G-1 로그인 전: 지금 앱 그대로 + 설정 › 계정 · 공간 메뉴 [온라인 로그인…]", async ({ page }) => {
  await startDev(page);
  const m = await menu(page);
  await expect(m.getByTestId("workspace-item")).toHaveCount(1);
  await expect(m.getByTestId("online-group")).toHaveCount(0);
  await expect(m.getByTestId("online-sign-in")).toBeVisible();
  await expect(m.getByTestId("workspace-new")).toBeVisible();
  await expect(page.getByTestId("save-state")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByTestId("rail-settings").click();
  await expect(page.locator("#settings-tab-account")).toBeVisible();
});

test("G-1 로그인 후: 이 PC ↔ 온라인 오가기 3번 — 두 일지 행 수 그대로, 외부 요청 없음", async ({ page }) => {
  test.setTimeout(120_000);
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await startDev(page);
  const local0 = await counts(page);
  expect(local0?.entry_item).toBeGreaterThan(0);
  await signIn(page);
  await createOnline(page);
  await page.getByTestId("create-open").click();
  // 온라인 공간: 구름 표시 레일 단추·동기화 알약
  await expect(page.getByTestId("workspace-button")).toHaveAttribute("data-online", "", { timeout: 30_000 });
  await expect(page.getByTestId("online-sync-status")).toBeVisible();
  await expect(page.getByTestId("online-workspace-close")).toHaveCount(0);
  const online0 = await counts(page);
  expect(online0?.entry_item).toBe(local0?.entry_item);

  for (let i = 0; i < 3; i++) {
    // 온라인 → 이 PC
    let m = await menu(page);
    await expect(m.getByTestId("online-group")).toContainText(EMAIL);
    await m.getByTestId("workspace-item").and(page.locator(":not([data-online])")).first().click();
    await expect(page.getByTestId("workspace-button")).not.toHaveAttribute("data-online", "", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("save-state")).toBeVisible();
    expect(await counts(page)).toEqual(local0);
    // 이 PC → 온라인
    m = await menu(page);
    await m.locator("[data-testid=workspace-item][data-online]").first().click();
    await expect(page.getByTestId("workspace-button")).toHaveAttribute("data-online", "", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("online-sync-status")).toBeVisible();
    expect(await counts(page)).toEqual(online0);
  }
  // 설정 › 워크스페이스 = 이 PC 목록 + 온라인 목록
  await page.getByTestId("rail-settings").click();
  await page.locator("#settings-tab-workspace").click();
  await expect(page.getByTestId("workspace-settings")).toBeVisible();
  await expect(page.getByTestId("online-workspace-settings")).toBeVisible();
  expect(external(requests)).toEqual([]);
});
