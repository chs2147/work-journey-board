// 개선 v22(improve-v22-spec): 앱과 호환되지 않는 일지 차단 · 칸반 다듬기 · 업무 타임라인 정돈. 가상 샘플만.
import { expect, test } from "@playwright/test";

const TODAY = "2026-10-22";

test.describe("앱과 호환되지 않는 일지(2절)", () => {
  test("시작할 때 새 DB 버전이면 열지 않고 '앱 업데이트가 필요합니다' · 최신 버전 확인 결과가 단추에", async ({
    page,
  }) => {
    await page.goto(`/?today=${TODAY}&newer=1&update=9.9.9`);
    const box = page.getByTestId("update-required");
    await expect(box).toBeVisible();
    await expect(box).toContainText("앱 업데이트가 필요합니다");
    await expect(box).toContainText("지금 설치된 앱 버전과 호환되지 않습니다");
    await expect(page.getByTestId("update-required-version")).toHaveText(
      /^DB v99 \(이 앱은 DB v\d+까지 지원\)$/,
    );
    await expect(page.getByTestId("week-title")).toHaveCount(0);
    await expect(page.getByTestId("update-required-update")).toHaveText("9.9.9 버전으로 업데이트");
  });

  test("호환되지 않는 워크스페이스로 바꾸려 하면 거부 — 지금 공간 그대로(전환 무결성)", async ({ page }) => {
    await page.goto(`/?today=${TODAY}&ws=2&newer=2`);
    await expect(page.getByTestId("week-title")).toContainText("2026-W43");
    const before = await page.evaluate(() =>
      (
        globalThis as unknown as { __wjbApp: { journalCounts(): Promise<Record<string, number>> } }
      ).__wjbApp.journalCounts(),
    );
    await page.keyboard.press("Control+Alt+Digit2");
    await expect(page.getByRole("status").filter({ hasText: "호환되지 않아 열지 않았습니다" })).toBeVisible();
    await expect(page).toHaveTitle("Work Journey Board — 회사");
    await expect(page.getByTestId("week-title")).toContainText("2026-W43");
    const after = await page.evaluate(() =>
      (
        globalThis as unknown as { __wjbApp: { journalCounts(): Promise<Record<string, number>> } }
      ).__wjbApp.journalCounts(),
    );
    expect(after).toEqual(before);
  });

  test("열려 있는 동안 다른 PC의 최신 앱이 올린 경우 — 창이 다시 활성화되면 쓰기를 멈추고 같은 화면", async ({
    page,
  }) => {
    await page.goto(`/?today=${TODAY}`);
    await expect(page.getByTestId("week-title")).toContainText("2026-W43");
    await page.evaluate(() =>
      (globalThis as unknown as { __wjbApp: { bumpSchema(): Promise<void> } }).__wjbApp.bumpSchema(),
    );
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByTestId("update-required")).toBeVisible();
    await expect(page.getByTestId("week-title")).toHaveCount(0);
  });
});
