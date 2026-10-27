// 새 판 확인·설치 E2E(improve-1027v4-spec 1절 B안): 앱을 켤 때 1번 확인 → 띠·설정 점 · [나중에] · 설정 [업데이트 확인] ·
// [자세히·설치] 창(릴리스 노트, 설치 파일 표는 빼고) → 내려받기 진행 → 일지 자동 백업(_pre-update) → 설치 호출.
// 브라우저 모드는 인터넷에 묻지 않는 가짜 확인(?update=판·fail·bad)이다. 가상 샘플만.
import { expect, test, type Page } from "@playwright/test";

const calls = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as { __wjb: { updateCalls(): string[] } }).__wjb.updateCalls());
const files = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as { __wjb: { files(): string[] } }).__wjb.files());

async function open(page: Page, update?: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?today=2026-10-22${update ? `&update=${update}` : ""}`);
  await expect(page.getByTestId("journal-status")).toContainText("SQLite");
}

const openSettings = (page: Page) => page.getByRole("button", { name: "설정", exact: true }).click();

test("새 판 없음: 켤 때 1번 확인(띠 없음) · 설정 [업데이트 확인] → '최신 판입니다'", async ({ page }) => {
  await open(page);
  await expect.poll(() => calls(page)).toEqual(["check"]);
  await expect(page.getByTestId("update-banner")).toHaveCount(0);
  await expect(page.getByTestId("update-dot")).toHaveCount(0);
  await openSettings(page);
  const sec = page.getByTestId("update-settings");
  await expect(sec).toContainText("지금 판");
  await expect(sec.getByTestId("update-status")).toContainText("최신 판입니다");
  await expect(sec.getByTestId("update-status")).toContainText(/마지막 확인 \d{4}-\d\d-\d\d \d\d:\d\d/);
  await sec.getByRole("button", { name: "업데이트 확인" }).click();
  await expect.poll(() => calls(page)).toEqual(["check", "check"]);
  await expect(page.locator('[role="status"][aria-live="polite"]').last()).toContainText("최신 판입니다");
});

test("새 판 있음: 띠 + 설정 점 · [나중에]는 띠만 숨김 · [자세히·설치] → 노트 · 내려받기 → 백업 → 설치 호출", async ({
  page,
}) => {
  await open(page, "0.9.0");
  const banner = page.getByTestId("update-banner");
  await expect(banner).toContainText("새 판 0.9.0이(가) 있습니다");
  await expect(page.getByTestId("update-dot")).toBeVisible();
  await banner.getByRole("button", { name: "나중에" }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.getByTestId("update-dot")).toBeVisible();

  await openSettings(page);
  const sec = page.getByTestId("update-settings");
  await expect(sec.getByTestId("update-status")).toContainText("새 판 0.9.0이(가) 있습니다");
  await sec.getByRole("button", { name: "자세히·설치" }).click();
  const dlg = page.getByTestId("update-dialog");
  await expect(dlg).toContainText("0.9.0(으)로 업데이트");
  const notes = dlg.getByTestId("update-notes");
  await expect(notes).toContainText("새 기능");
  await expect(notes).toContainText("· 가상 기능 하나");
  await expect(notes).not.toContainText("설치 파일"); // 설치 파일 표는 빼고
  await expect(dlg.getByRole("button", { name: "내려받고 설치" })).toBeFocused();

  await dlg.getByRole("button", { name: "내려받고 설치" }).click();
  await expect(page.getByText("브라우저 모드에서는 설치하지 않습니다(실앱에서만)")).toBeVisible();
  expect(await calls(page)).toEqual(["check", "download", "install"]);
  expect((await files(page)).some((f) => /\/backups\/work-journey_.*_pre-update\.db$/.test(f))).toBe(true);
});

test("연결 실패: 띠 없이 조용히 · 설정에 '확인하지 못했습니다 — …'", async ({ page }) => {
  await open(page, "fail");
  await expect.poll(() => calls(page)).toEqual(["check"]);
  await expect(page.getByTestId("update-banner")).toHaveCount(0);
  await openSettings(page);
  await expect(page.getByTestId("update-status")).toContainText(
    "확인하지 못했습니다 — GitHub에 연결하지 못했습니다",
  );
});

test("받은 파일이 SHA256SUMS와 다르면 설치하지 않음 · 오류 + [다시 시도]", async ({ page }) => {
  await open(page, "bad");
  await page.getByTestId("update-banner").getByRole("button", { name: "자세히·설치" }).click();
  const dlg = page.getByTestId("update-dialog");
  await dlg.getByRole("button", { name: "내려받고 설치" }).click();
  await expect(dlg.getByRole("alert")).toContainText(
    "설치하지 못했습니다 — 받은 설치 파일이 SHA256SUMS와 다릅니다",
  );
  await expect(dlg.getByRole("button", { name: "다시 시도" })).toBeVisible();
  expect(await calls(page)).toEqual(["check", "download"]);
  expect((await files(page)).some((f) => f.endsWith("_pre-update.db"))).toBe(false);
  await page.keyboard.press("Escape");
  await expect(dlg).toHaveCount(0);
});
