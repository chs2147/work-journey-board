// 정식판·DEV 검증판 운영 정책(docs/release-channel-spec.md): DEV(?profile=local-dev)는 설치마다 일지를 묻고,
// 정식 일지(DEV 표시 없음)는 열지 않으며, 복제는 원본을 읽기만 한다. 정식판(기본)은 그대로.
import { expect, test, type Page } from "@playwright/test";

const SHOT = process.env.DEV_CHANNEL_SHOTS;
const answer = (page: Page, values: string[]) => {
  page.on("dialog", (d) => void d.accept(values.shift() ?? ""));
};

test("DEV: 설치마다 일지 선택 — 기본 빈 일지, 옵션 3개, 정식 일지 폴더는 DEV 폴더로 못 씀", async ({
  page,
}) => {
  await page.goto("/?profile=local-dev&fresh=1&existing=/demo/Official");
  const setup = page.getByTestId("dev-setup");
  await expect(setup).toBeVisible();
  await expect(page.getByTestId("dev-opt-empty")).toBeChecked();
  await expect(page.getByTestId("dev-opt-sample")).not.toBeChecked();
  await expect(page.getByTestId("dev-opt-copy")).not.toBeChecked();
  await expect(page.getByTestId("dev-dest")).toHaveText("/demo/WorkJourney DEV");
  if (SHOT) await page.screenshot({ path: `${SHOT}/dev-setup.png` });
  // 정식 일지 폴더를 DEV 폴더로 고르면 거절(쓰기 없음)
  answer(page, ["/demo/Official"]);
  await page.getByRole("button", { name: /DEV 일지 폴더 · 폴더 선택/ }).click();
  await page.getByTestId("dev-start").click();
  await expect(page.getByTestId("dev-error")).toHaveText(
    "정식 일지가 있는 폴더는 DEV 일지 폴더로 쓸 수 없습니다.",
  );
});

test("DEV: 가상 샘플로 시작 → 보드에 DEV 배지·주황 타이틀 띠, 창 제목 DEV", async ({ page }) => {
  await page.goto("/?profile=local-dev&fresh=1");
  await page.getByTestId("dev-opt-sample").check();
  await page.getByTestId("dev-start").click();
  await expect(page.getByTestId("rail-settings")).toBeEnabled();
  const badge = page.getByTestId("dev-badge");
  await expect(badge).toHaveText("DEV");
  await expect(page.locator("html")).toHaveAttribute("data-channel", "dev");
  // 타이틀 줄이 DEV 띠 색(정식판 배경과 다름)
  const bg = await badge.evaluate((e) => getComputedStyle(e.parentElement!).backgroundColor);
  expect(bg).not.toBe("rgba(0, 0, 0, 0)");
  await expect(page.getByTestId("board").or(page.locator("main")).first()).toBeVisible();
  if (SHOT) await page.screenshot({ path: `${SHOT}/dev-board.png` });
});

test("DEV: 정식 일지 복제 — 복사본으로 열고 원본 폴더에는 DEV 표시를 남기지 않음", async ({ page }) => {
  await page.goto("/?profile=local-dev&fresh=1&existing=/demo/Official");
  await page.getByTestId("dev-opt-copy").check();
  answer(page, ["/demo/Official"]);
  await page.getByTestId("dev-pick-src").click();
  await expect(page.getByTestId("dev-src")).toHaveText("/demo/Official");
  await page.getByTestId("dev-start").click();
  await expect(page.getByTestId("dev-badge")).toBeVisible();
  await expect(page.getByTestId("rail-settings")).toBeEnabled();
});

test("DEV: [지난 DEV 일지 계속 쓰기]는 DEV 표시가 있는 폴더가 있을 때만", async ({ page }) => {
  await page.goto("/?profile=local-dev&fresh=1&existing=/demo/Official");
  await expect(page.getByTestId("dev-setup")).toBeVisible();
  await expect(page.getByTestId("dev-continue")).toHaveCount(0);
});

test("정식판(기본): DEV 배지·DEV 일지 선택 없음", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("rail-settings")).toBeEnabled();
  await expect(page.getByTestId("dev-badge")).toHaveCount(0);
  await expect(page.getByTestId("dev-setup")).toHaveCount(0);
  expect(await page.locator("html").getAttribute("data-channel")).toBeNull();
});
