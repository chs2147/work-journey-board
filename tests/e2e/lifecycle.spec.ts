// G-5 데이터 수명(docs/v2-design/100) — 브라우저 모드 가짜 서버(외부 요청 없음).
// 공간 서버에서 지우기(이름을 입력해야, 지금 연 공간은 못 지움) · 내 계정 삭제(이메일 입력, 관리자는 버튼 없음) · 관리자의 계정 삭제.
import { expect, test, type Page } from "@playwright/test";
import { requestCode } from "./online-helper";

const EMAIL = "virtual@example.invalid";
const external = (requests: string[]) =>
  requests.filter((u) => !/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u) && !u.startsWith("data:"));

async function signInPreview(page: Page, query = "") {
  await page.goto(`/?profile=connected-preview${query}`);
  await page.getByTestId("preview-email-input").fill(EMAIL);
  await requestCode(page);
  await page.getByTestId("preview-code-input").fill("12345678");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page.getByTestId("online-spaces")).toBeVisible();
}
async function copyOnce(page: Page) {
  if (!(await page.getByTestId("preview-copy").isVisible()))
    await page.getByTestId("online-create-open").click();
  await page.getByTestId("create-mode-local").click();
  await page.getByTestId("create-next").click();
  await page.getByTestId("copy-pick").click();
  await page.getByTestId("copy-start").click({ timeout: 30_000 });
  await expect(page.getByTestId("copy-done")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("create-online-close").click();
}

test("G-5 공간 서버에서 지우기: 지금 연 공간은 못 지움, 이름을 입력해야 지워지고 목록·사용량에서 빠짐", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await signInPreview(page);
  await copyOnce(page);
  await copyOnce(page);
  await expect(page.getByTestId("online-space-row")).toHaveCount(2);
  // 첫 공간을 열고 설정 › 워크스페이스
  await page.getByTestId("online-space-open").first().click();
  await expect(page.getByTestId("rail-settings")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("rail-settings").click();
  await page.locator("#settings-tab-workspace").click();
  const rows = page.getByTestId("workspace-settings").getByTestId("workspace-row");
  await expect(rows).toHaveCount(2);
  const current = rows.filter({ has: page.locator("[class*=wsTag]") });
  await expect(current.getByTestId("ws-delete-server")).toBeDisabled();
  const other = rows.filter({ hasNot: page.locator("[class*=wsTag]") });
  const name = (await other.locator("[class*=wsName]").innerText()).trim();
  await other.getByTestId("ws-delete-server").click();
  const confirm = page.getByTestId("ws-delete-confirm");
  await expect(confirm).toContainText("되돌릴 수 없습니다");
  const ok = confirm.getByTestId("ws-delete-confirm-ok");
  await expect(ok).toBeDisabled();
  await confirm.getByTestId("ws-delete-confirm-input").fill("다른 이름");
  await expect(ok).toBeDisabled();
  await confirm.getByTestId("ws-delete-confirm-input").fill(name);
  await ok.click();
  await expect(page.getByTestId("ws-delete-done")).toContainText("서버에서 지웠습니다");
  await expect(rows).toHaveCount(1);
  // 계정 사용량의 공간 수도 줄어든다
  await page.locator("#settings-tab-account").click();
  await expect(page.getByTestId("account-spaces")).toHaveText("1개");
  expect(external(requests)).toEqual([]);
});

test("G-5 내 계정 삭제: 이메일을 입력해야, 지우면 로그아웃(첫 화면) · 관리자 계정은 버튼 없음", async ({
  page,
}) => {
  await signInPreview(page);
  const card = page.getByTestId("account-card");
  await card.getByTestId("account-delete").click();
  const confirm = page.getByTestId("account-delete-confirm");
  await expect(confirm).toContainText("이 PC 워크스페이스는 그대로입니다");
  await expect(confirm.getByTestId("account-delete-confirm-ok")).toBeDisabled();
  await confirm.getByTestId("account-delete-confirm-input").fill(EMAIL);
  await confirm.getByTestId("account-delete-confirm-ok").click();
  await expect(page.getByTestId("preview-email-input")).toBeVisible({ timeout: 15_000 });
  // 관리자로 로그인하면 내 계정 삭제 버튼이 없다(관리자 고정)
  await signInPreview(page, "&previewAdmin=1");
  await expect(page.getByTestId("admin-card")).toBeVisible();
  await expect(page.getByTestId("account-card").getByTestId("account-delete")).toHaveCount(0);
});

test("G-5 관리자의 계정 삭제: 초대한 계정을 이메일 입력 뒤 삭제 → 목록에서 빠짐, 관리자 줄에는 버튼 없음", async ({
  page,
}) => {
  await signInPreview(page, "&previewAdmin=1");
  const admin = page.getByTestId("admin-card");
  await expect(admin.getByTestId("admin-account")).toHaveCount(2);
  const row = admin.locator("[data-testid=admin-account]", { hasText: "invited@example.invalid" });
  await expect(row).toBeVisible();
  await expect(admin.getByTestId("admin-delete")).toHaveCount(1); // 관리자 줄 제외
  await admin.getByTestId("admin-delete").click();
  const confirm = page.getByTestId("admin-delete-confirm");
  await confirm.getByTestId("admin-delete-confirm-input").fill("invited@example.invalid");
  await confirm.getByTestId("admin-delete-confirm-ok").click();
  await expect(admin.getByTestId("admin-account")).toHaveCount(1);
});
