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

test("D-4: 복제 → 내 온라인 공간 목록 → 열기 → 앱 화면(읽기 전용 띠) → 목록으로", async ({ page }) => {
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
  await row.getByTestId("online-space-open").click();
  // 지금 앱 화면 그대로 + 위 띠
  await expect(page.getByTestId("online-workspace")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("온라인 공간 · 읽기 전용")).toBeVisible();
  await expect(page.getByTestId("rail-settings")).toBeVisible({ timeout: 30_000 });
  // 복제된 가상 업무가 보인다(가상 샘플 showcase의 업무 이름 중 하나)
  await expect(page.locator("body")).toContainText(/정산|보안|가상/);
  expect(external(requests)).toEqual([]);
  await page.getByTestId("online-workspace-close").click();
  await expect(page.getByTestId("connected-preview")).toBeVisible();
});
