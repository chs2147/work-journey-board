// 워크스페이스 전환 무결성(v1.8.1 긴급 수정): 공간을 바꿔도 각 공간의 기록·메모·이미지·요약이 그 공간 일지에 그대로 남는다.
// 1.8.0 결함 = 전환 직후 메모 정리가 "이전 공간의 메모"를 기준으로 "새 공간의 이미지"를 지움(그림을 찾을 수 없습니다).
// 그림은 테스트가 그 자리에서 그린 단색 도형(가상 이미지)만 쓴다.
import { expect, test, type Page } from "@playwright/test";

const TODAY = "2026-10-22";
const images = (page: Page) => page.getByTestId("note-image");
const missing = (page: Page) => page.getByText("그림을 찾을 수 없습니다");
const saved = (page: Page) =>
  expect(page.locator('[data-testid="save-state"][data-idle="true"]')).toHaveText("저장됨");

async function makePng(page: Page, color: string): Promise<Buffer> {
  const b64 = await page.evaluate((c) => {
    const cv = document.createElement("canvas");
    cv.width = 240;
    cv.height = 160;
    const ctx = cv.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 240, 160);
    ctx.fillStyle = c;
    ctx.fillRect(24, 16, 120, 96);
    return cv.toDataURL("image/png").split(",")[1]!;
  }, color);
  return Buffer.from(b64, "base64");
}

async function addImage(page: Page, color: string, name: string) {
  const before = await images(page).count();
  await page
    .getByTestId("note-image-input")
    .setInputFiles({ name: `${name}.png`, mimeType: "image/png", buffer: await makePng(page, color) });
  await expect(images(page)).toHaveCount(before + 1);
  await saved(page);
}

async function switchTo(page: Page, n: 1 | 2, name: string) {
  await page.keyboard.press(`Control+Alt+Digit${n}`);
  await expect(page).toHaveTitle(`Work Journey Board — ${name}`);
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
}

/** 지금 연 공간 일지에 저장된 이미지 수(저장소에서 직접 — 화면 표시와 따로 확인) */
const storedAssets = (page: Page) =>
  page.evaluate(async () => {
    const w = globalThis as unknown as { __wjbApp: { assetCount(): Promise<number> } };
    return w.__wjbApp.assetCount();
  });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?today=${TODAY}&ws=2`);
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
});

test("이미지를 붙이고 공간을 오가도 두 공간의 이미지가 모두 남는다(1.8.0 유실 결함)", async ({ page }) => {
  const base1 = await images(page).count();
  await addImage(page, "#2a78d6", "회사-그림");
  const stored1 = await storedAssets(page);

  await switchTo(page, 2, "개인");
  const base2 = await images(page).count();
  await expect(missing(page)).toHaveCount(0);
  await addImage(page, "#e55", "개인-그림");
  const stored2 = await storedAssets(page);

  for (let round = 0; round < 3; round++) {
    await switchTo(page, 1, "회사");
    await expect(images(page)).toHaveCount(base1 + 1);
    await expect(missing(page)).toHaveCount(0);
    expect(await storedAssets(page)).toBe(stored1);

    await switchTo(page, 2, "개인");
    await expect(images(page)).toHaveCount(base2 + 1);
    await expect(missing(page)).toHaveCount(0);
    expect(await storedAssets(page)).toBe(stored2);
  }
});

test("이미지를 지운 뒤 바로 공간을 바꿔도: 지운 공간만 정리되고, 다른 공간 이미지는 그대로", async ({
  page,
}) => {
  await addImage(page, "#2a78d6", "회사-그림");
  await switchTo(page, 2, "개인");
  await addImage(page, "#e55", "개인-그림");
  const keep2 = await storedAssets(page);
  await switchTo(page, 1, "회사");
  const n1 = await images(page).count();
  // 회사 이미지 하나를 지우고(메모 판에서 Delete) 곧바로 전환
  await images(page)
    .last()
    .click({ position: { x: 8, y: 30 } });
  await page.keyboard.press("Delete");
  await expect(images(page)).toHaveCount(n1 - 1);
  await switchTo(page, 2, "개인");
  await expect(missing(page)).toHaveCount(0);
  expect(await storedAssets(page)).toBe(keep2);
  await switchTo(page, 1, "회사");
  await expect(images(page)).toHaveCount(n1 - 1);
  await expect(missing(page)).toHaveCount(0);
});

test("기록·메모 글·요약 수정본도 공간마다 따로: 입력 직후 전환해도 그 공간 일지에 저장되고 섞이지 않는다", async ({
  page,
}) => {
  // 회사: 오늘 칸 첫 항목에 글을 붙이고 저장 대기 중에 바로 전환
  const cell = page.locator(":focus");
  await expect(cell).toBeVisible();
  await page.keyboard.press("End");
  await page.keyboard.type(" (회사 확인)");
  await switchTo(page, 2, "개인");
  await expect(page.getByText(/\(회사 확인\)/)).toHaveCount(0);
  // 개인: 메모 글 상자
  const c = (await page.getByTestId("note-canvas").boundingBox())!;
  await page.mouse.click(c.x + 300, c.y + 60);
  await expect(page.locator(":focus")).toHaveClass(/note-prose/);
  await page.keyboard.type("개인 메모 가상");
  await switchTo(page, 1, "회사");
  await expect(page.getByText("개인 메모 가상")).toHaveCount(0);
  await expect(page.locator("textarea").filter({ hasText: /\(회사 확인\)/ })).toHaveCount(1);
  await switchTo(page, 2, "개인");
  await expect(page.getByTestId("note-box").filter({ hasText: "개인 메모 가상" })).toHaveCount(1);
  await expect(page.getByText(/\(회사 확인\)/)).toHaveCount(0);
});

test("Universe: 다른 공간을 읽기 전용으로 켜고 [그 공간에서 열기]로 오가도 두 공간의 이미지·기록이 그대로(CLAUDE.md 4-7)", async ({
  page,
}) => {
  const base1 = await images(page).count();
  await addImage(page, "#2a78d6", "회사-그림");
  const stored1 = await storedAssets(page);
  for (let round = 0; round < 3; round++) {
    // 회사에서 Universe → 개인 공간 켜기(읽기 전용) → 개인 항목 [그 공간에서 열기]
    await page.keyboard.press("Alt+Digit5");
    await page.getByTestId("u-view-list").click();
    const toggle = page.getByTestId("u-ws-toggle").nth(1);
    if (!(await toggle.isChecked())) await toggle.check();
    await page
      .getByTestId("universe-list")
      .getByTestId("u-row")
      .filter({ hasText: "아침 달리기 5km" })
      .click();
    await page.getByTestId("u-open").click();
    await expect(page).toHaveTitle("Work Journey Board — 개인");
    await expect(missing(page)).toHaveCount(0);
    if (round === 0) await addImage(page, "#e55", "개인-그림");
    await expect(images(page)).not.toHaveCount(0);
    await expect(missing(page)).toHaveCount(0);
    const stored2 = await storedAssets(page);
    expect(stored2).toBeGreaterThan(0);
    // 다시 회사로: 그림·저장소 개수 그대로
    await switchTo(page, 1, "회사");
    await expect(images(page)).toHaveCount(base1 + 1);
    await expect(missing(page)).toHaveCount(0);
    expect(await storedAssets(page)).toBe(stored1);
  }
});

test("Universe 직접 연결은 만든 공간 일지에만: 공간을 오가도 그 공간에 그대로, 다른 공간에는 없음(CLAUDE.md 4-7)", async ({
  page,
}) => {
  const count = () =>
    page.evaluate(() =>
      (globalThis as unknown as { __wjbApp: { relationCount(): Promise<number> } }).__wjbApp.relationCount(),
    );
  await page.keyboard.press("Alt+Digit5");
  await page.getByTestId("u-view-list").click();
  await page
    .getByTestId("universe-list")
    .getByTestId("u-row")
    .filter({ has: page.locator("td", { hasText: /^\s*업무 항목$/ }) })
    .first()
    .click();
  await page.getByTestId("u-connect").click();
  await page.getByTestId("u-link-candidate").first().click();
  await page.getByTestId("u-link-save").click();
  await expect(page.getByTestId("u-rel-row")).toHaveCount(1);
  expect(await count()).toBe(1);
  for (let round = 0; round < 3; round++) {
    await switchTo(page, 2, "개인");
    expect(await count()).toBe(0);
    await switchTo(page, 1, "회사");
    expect(await count()).toBe(1);
  }
  await page.keyboard.press("Alt+Digit5");
  await page.getByTestId("u-view-map").click();
  await expect(page.getByTestId("u-rel-line")).toHaveCount(1);
});

test("지식 카드·근거 묶음도 공간마다 따로: 카드는 만든 공간 일지에만, 공간을 바꾸면 근거 묶음·보드 ◆가 비워진다(CLAUDE.md 4-7)", async ({
  page,
}) => {
  const count = () =>
    page.evaluate(() =>
      (globalThis as unknown as { __wjbApp: { cardCount(): Promise<number> } }).__wjbApp.cardCount(),
    );
  await page.keyboard.press("Alt+Digit5");
  await page.getByTestId("u-view-list").click();
  await page
    .getByTestId("universe-list")
    .getByTestId("u-row")
    .filter({ has: page.locator("td", { hasText: /^\s*업무 항목$/ }) })
    .first()
    .click();
  await page.getByTestId("u-pack-add").click();
  await expect(page.getByTestId("pack-badge")).toHaveText("1");
  await page.getByTestId("u-make-card").click();
  await page.getByTestId("u-card-title").fill("가상: 회사 카드");
  await page.getByTestId("u-card-save").click();
  await expect(page.getByTestId("u-detail-title")).toHaveText("가상: 회사 카드");
  expect(await count()).toBe(1);
  for (let round = 0; round < 3; round++) {
    await switchTo(page, 2, "개인");
    expect(await count()).toBe(0);
    await expect(page.getByTestId("pack-badge")).toHaveCount(0); // 이전 공간 원문은 묶음에 남지 않는다
    await expect(page.getByTestId("card-badge")).toHaveCount(0);
    await switchTo(page, 1, "회사");
    expect(await count()).toBe(1);
  }
});
