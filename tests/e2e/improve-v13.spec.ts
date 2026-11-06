import { CURRENT_SCHEMA as LATEST_SCHEMA_VERSION } from "./schema-helper";
import { expect, test, type Page } from "@playwright/test";
import { openSettings } from "./settings-helper";
const files = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as { __wjb: { files(): string[] } }).__wjb.files());
async function copy(page: Page, source: string, target: string) {
  await page.evaluate(
    async ({ source, target }) => {
      await (
        globalThis as unknown as { __wjb: { copyFile(a: string, b: string): Promise<void> } }
      ).__wjb.copyFile(source, target);
    },
    { source, target },
  );
}
async function schema(page: Page, path: string, n: number) {
  await page.evaluate(
    async ({ path, n }) => {
      await (
        globalThis as unknown as { __wjb: { backupSchema(p: string, n: number): Promise<void> } }
      ).__wjb.backupSchema(path, n);
    },
    { path, n },
  );
}
async function start(page: Page) {
  await page.goto("/?today=2026-11-05");
  await expect(page.getByTestId("week-title")).toBeVisible();
  await openSettings(page, "data");
  await page.getByRole("button", { name: "지금 백업", exact: true }).click();
  await expect(page.getByTestId("last-backup")).toContainText(`DB 구조 v${LATEST_SCHEMA_VERSION}`);
  const source = (await files(page)).find((p) => p.includes("_manual_app-v"))!;
  return source;
}
test("v13 이력의 생성/실제 버전, 구형·새 구조·불일치 판정과 키보드 모달", async ({ page }) => {
  const source = await start(page),
    dir = source.slice(0, source.lastIndexOf("/"));
  const old = dir + "/work-journey_2026-10-01.db";
  await copy(page, source, old);
  const future =
    dir + `/work-journey_2026-11-04_090000000_manual_app-v1.18.0_db-v${LATEST_SCHEMA_VERSION + 1}.db`;
  await copy(page, source, future);
  await schema(page, future, LATEST_SCHEMA_VERSION + 1);
  const mismatch = dir + "/work-journey_2026-11-03_090000000_manual_app-v1.17.0_db-v13.db";
  await copy(page, source, mismatch);
  await page.getByTestId("restore-open").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAccessibleName("백업 이력·복원");
  await page.getByTestId("restore-item").filter({ hasText: "기록 없음" }).click();
  await expect(page.getByTestId("restore-detail")).toContainText("백업 실제 구조");
  await expect(page.getByTestId("restore-detail")).toContainText(`v${LATEST_SCHEMA_VERSION}`);
  await expect(page.getByRole("button", { name: "이 사본으로 복원" })).toBeEnabled();
  // 생성 앱 버전은 현재 앱과 같을 수 있다. 검사할 DB 구조로 고르고 실제 선택 파일도 확인한다.
  const futureRow = page
    .getByTestId("restore-item")
    .filter({ has: page.getByText(`v${LATEST_SCHEMA_VERSION + 1}`, { exact: true }) });
  await expect(futureRow).toHaveCount(1);
  await futureRow.click();
  await expect(page.getByTestId("restore-detail")).toContainText(future.slice(future.lastIndexOf("/") + 1));
  await expect(page.getByTestId("restore-detail")).toContainText("앱을 업데이트");
  await expect(page.getByRole("button", { name: "이 사본으로 복원" })).toBeDisabled();
  await page
    .getByTestId("restore-item")
    .filter({ has: page.getByText("v13", { exact: true }) })
    .click();
  await expect(page.getByTestId("restore-detail")).toContainText(
    mismatch.slice(mismatch.lastIndexOf("/") + 1),
  );
  await expect(page.getByTestId("restore-detail")).toContainText("파일 정보 불일치");
  await expect(page.getByRole("button", { name: "이 사본으로 복원" })).toBeDisabled();
  await dialog.getByLabel("종류", { exact: true }).selectOption("protected");
  await expect(page.getByTestId("restore-item")).toHaveCount(3);
  await expect(dialog.getByRole("button", { name: "닫기", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("restore-open")).toBeFocused();
});
test("v13 기간/용량 미리보기, 변경 재확인과 실제 정리·보호 유지", async ({ page }) => {
  const source = await start(page),
    dir = source.slice(0, source.lastIndexOf("/"));
  const stale = [1, 2, 3].map(
    (d) => dir + `/work-journey_2026-10-0${d}_090000000_daily_app-v1.16.0_db-v${LATEST_SCHEMA_VERSION}.db`,
  );
  for (const path of stale) await copy(page, source, path);
  await page.getByTestId("backup-policy-open").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("일일 보관 기준", { exact: true }).first().selectOption("days");
  await dialog.getByRole("spinbutton", { name: "일일 보관 기준" }).fill("2");
  await dialog.getByRole("button", { name: "정리 미리보기", exact: true }).click();
  await expect(page.getByTestId("backup-cleanup-preview")).toContainText("정리 후보 3개");
  const extra = dir + `/work-journey_2026-10-04_090000000_daily_app-v1.16.0_db-v${LATEST_SCHEMA_VERSION}.db`;
  await copy(page, source, extra);
  await page.getByTestId("backup-policy-apply").click();
  await expect(dialog).toContainText("파일 목록이 변경");
  await expect(dialog).toContainText("정리 후보 4개");
  for (const path of stale) expect(await files(page)).toContain(path);
  await page.getByTestId("backup-policy-apply").click();
  await expect(dialog).toContainText("자동 백업 4개 정리");
  for (const path of [...stale, extra]) expect(await files(page)).not.toContain(path);
  expect(await files(page)).toContain(source);
  await expect(dialog.getByRole("button", { name: "닫기", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings-cat-data")).toContainText("일일 최근 2일");
  await page.getByTestId("backup-policy-open").click();
  await page.getByRole("button", { name: "추천값", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "용량 기준으로 추가 정리" })).not.toBeChecked();
  await page.getByRole("checkbox", { name: "용량 기준으로 추가 정리" }).check();
  await expect(page.getByRole("spinbutton", { name: "폴더 용량 목표" })).toHaveValue("2");
  await expect(dialog.getByRole("button", { name: "닫기", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");
});
test("v13 복원 후 현재 보관 정책 유지", async ({ page }) => {
  const source = await start(page);
  await page.getByTestId("backup-policy-open").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("spinbutton", { name: "일일 보관 기준" }).fill("7");
  await dialog.getByRole("button", { name: "정리 미리보기", exact: true }).click();
  await page.getByTestId("backup-policy-apply").click();
  await expect(dialog).toContainText("보관 정책 적용");
  await expect(dialog.getByRole("button", { name: "닫기", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");
  await page.getByTestId("restore-open").click();
  await page.getByTestId("restore-item").filter({ hasText: "수동" }).first().click();
  await page.getByRole("button", { name: "이 사본으로 복원", exact: true }).click();
  await expect(page.getByTestId("settings-view")).toHaveCount(0);
  await openSettings(page, "data");
  await expect(page.getByTestId("settings-cat-data")).toContainText("일일 최근 7일");
  expect(await files(page)).toContain(source);
});
