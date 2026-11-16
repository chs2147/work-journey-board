// 온라인 워크스페이스 만들기 4단계(브라우저 모드 가짜 원본·가짜 서버, 외부 요청 없음) — docs/v2-design/85·95 S6
import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, query = "") {
  await page.goto(`/?profile=connected-preview${query}`);
  // 로그인 전에는 만들기가 없다
  await expect(page.getByTestId("preview-email-input")).toBeVisible();
  await expect(page.getByTestId("online-create-open")).toHaveCount(0);
  await expect(page.getByTestId("invite-only-badge")).toHaveText("초대 전용");
  await page.getByTestId("preview-email-input").fill("virtual@example.invalid");
  await page.getByRole("button", { name: "인증번호 받기" }).click();
  await page.getByTestId("preview-code-input").fill("12345678");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page.getByTestId("online-create-open")).toBeVisible();
}
/** 대화상자를 열고(이미 열려 있으면 그대로) 1단계에서 고른 방식으로 다음 */
async function wizard(page: Page, mode: "local" | "fresh" = "local") {
  if (!(await page.getByTestId("preview-copy").isVisible()))
    await page.getByTestId("online-create-open").click();
  await page.getByTestId(`create-mode-${mode}`).click();
  await page.getByTestId("create-next").click();
}
const external = (requests: string[]) =>
  requests.filter((u) => !/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u) && !u.startsWith("data:"));

test("만들기 4단계 — 오프라인 기록으로 시작: 폴더 → 확인(원본 그대로 ↔ 새 공간) → 올리기 → 게시 → 바로 열기", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await signIn(page);
  await wizard(page);
  await page.getByTestId("copy-pick").click();
  const confirm = page.getByTestId("create-confirm");
  await expect(confirm).toContainText("그대로 유지", { timeout: 30_000 });
  await expect(confirm.getByTestId("workspace-cloud")).toBeVisible();
  await expect(confirm).toContainText("virtual@example.invalid");
  await expect(page.getByTestId("copy-summary")).toContainText("v20");
  await expect(page.getByTestId("copy-images")).toContainText(/\d+개 · /);
  await page.getByTestId("copy-start").click({ timeout: 30_000 });
  await expect(page.getByTestId("copy-done")).toContainText("온라인 사본을 만들었습니다.");
  await page.getByTestId("create-open").click();
  await expect(page.getByTestId("online-workspace")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("rail-settings")).toBeVisible({ timeout: 30_000 });
  expect(external(requests)).toEqual([]);
});

test("만들기 4단계 — 새로 시작하기: 이름·색·아이콘 → 빈 공간 게시 → 열면 업무 없음·이름 그대로", async ({
  page,
}) => {
  await signIn(page);
  await wizard(page, "fresh");
  await page.getByTestId("ws-name").fill("가상 새 공간");
  await page.getByTestId("ws-icons").locator('[data-icon="bulb"]').click();
  await page.getByTestId("ws-colors").locator('[data-color="c3"]').click();
  await page.getByTestId("create-fresh-next").click();
  const confirm = page.getByTestId("create-confirm");
  await expect(confirm).toContainText("빈 일지", { timeout: 30_000 });
  await expect(confirm).toContainText("가상 새 공간");
  await expect(page.getByTestId("copy-entries")).toHaveText("0");
  await page.getByTestId("copy-start").click();
  await expect(page.getByTestId("copy-done")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("create-online-close").click();
  // 목록에 이름·아이콘(서버 목록 025와 같은 규칙)
  const row = page.getByTestId("online-space-row");
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId("online-space-name")).toContainText("가상 새 공간");
  await expect(row.locator("[data-icon]").first()).toHaveAttribute("data-icon", "bulb");
  await row.getByTestId("online-space-open").click();
  await expect(page.getByTestId("rail-settings")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("workspace-button").locator("[data-icon]").first()).toHaveAttribute(
    "data-icon",
    "bulb",
  );
  await expect(page.getByTestId("category-header")).toHaveCount(0);
});

test("만들기 4단계 — 끊김 → 이어서 올리기, 멈추기 → 작업 취소", async ({ page }) => {
  await signIn(page, "&migrationFail=publication");
  await wizard(page);
  await page.getByTestId("copy-pick").click();
  await page.getByTestId("copy-start").click({ timeout: 30_000 });
  await expect(page.getByTestId("copy-paused")).toContainText("서버에 연결하지 못했습니다");
  await page.getByTestId("copy-resume").click();
  await expect(page.getByTestId("copy-done")).toBeVisible();

  await page.getByRole("button", { name: "다른 일지 복제" }).click();
  await wizard(page);
  await page.getByTestId("copy-pick").click();
  await page.getByTestId("copy-start").click({ timeout: 30_000 });
  await expect(page.getByTestId("copy-step")).toBeVisible();
  await page.getByTestId("copy-stop").click();
  await expect(page.getByTestId("copy-paused")).toContainText("멈췄습니다");
  await page.getByTestId("copy-cancel").click();
  await expect(page.getByTestId("copy-canceled")).toBeVisible();
});

test("만들기 4단계 — 고른 폴더 아래 일지가 여럿이면 고르기 → 고른 일지로 확인", async ({ page }) => {
  await signIn(page, "&copyParent=1");
  await wizard(page);
  await page.getByTestId("copy-pick").click();
  const choose = page.getByTestId("copy-choose");
  await expect(choose).toContainText("회사");
  await expect(choose).toContainText("개인");
  await choose.getByRole("button", { name: "이 일지 복제" }).nth(1).click();
  await expect(page.getByTestId("create-confirm")).toContainText("개인", { timeout: 30_000 });
});
