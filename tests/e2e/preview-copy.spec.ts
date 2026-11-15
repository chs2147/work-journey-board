// C-4 온라인 사본 만들기(브라우저 모드 가짜 원본·가짜 서버, 외부 요청 없음) — docs/v2-design/85
import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, query = "") {
  await page.goto(`/?profile=connected-preview${query}`);
  await expect(page.getByTestId("preview-copy")).toContainText("로그인한 뒤 사용할 수 있습니다.");
  await page.getByTestId("preview-email-input").fill("virtual@example.invalid");
  await page.getByRole("button", { name: "인증번호 받기" }).click();
  await page.getByTestId("preview-code-input").fill("12345678");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page.getByTestId("copy-pick")).toBeVisible();
}
const external = (requests: string[]) =>
  requests.filter((u) => !/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u) && !u.startsWith("data:"));

test("C-4: 폴더 고르기 → 미리 보기 → 올리기 → 게시", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await signIn(page);
  await page.getByTestId("copy-pick").click();
  await expect(page.getByTestId("copy-summary")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("copy-summary")).toContainText("v20");
  await expect(page.getByTestId("copy-images")).toContainText(/\d+개 · /);
  await page.getByTestId("copy-start").click({ timeout: 30_000 });
  await expect(page.getByTestId("copy-done")).toContainText("온라인 사본을 만들었습니다.");
  expect(external(requests)).toEqual([]);
});

test("C-4: 끊김 → 이어서 올리기, 멈추기 → 작업 취소", async ({ page }) => {
  await signIn(page, "&migrationFail=publication");
  await page.getByTestId("copy-pick").click();
  await page.getByTestId("copy-start").click({ timeout: 30_000 });
  await expect(page.getByTestId("copy-paused")).toContainText("서버에 연결하지 못했습니다");
  await page.getByTestId("copy-resume").click();
  await expect(page.getByTestId("copy-done")).toBeVisible();

  await page.getByRole("button", { name: "다른 일지 복제" }).click();
  await page.getByTestId("copy-pick").click();
  await page.getByTestId("copy-start").click({ timeout: 30_000 });
  await expect(page.getByTestId("copy-step")).toBeVisible();
  await page.getByTestId("copy-stop").click();
  await expect(page.getByTestId("copy-paused")).toContainText("멈췄습니다");
  await page.getByTestId("copy-cancel").click();
  await expect(page.getByTestId("copy-canceled")).toBeVisible();
});

test("C-4: 고른 폴더 아래 일지가 여럿이면 고르기 → 고른 일지로 미리 보기", async ({ page }) => {
  await signIn(page, "&copyParent=1");
  await page.getByTestId("copy-pick").click();
  const choose = page.getByTestId("copy-choose");
  await expect(choose).toContainText("회사");
  await expect(choose).toContainText("개인");
  await choose.getByRole("button", { name: "이 일지 복제" }).nth(1).click();
  await expect(page.getByTestId("copy-summary")).toContainText("개인", { timeout: 30_000 });
});
