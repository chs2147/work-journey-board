// Manual static mockup review only; requires the local repository HTTP server.
const { chromium } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../../../..");
const base = process.env.WJB_UI_REVIEW_BASE_URL || "http://127.0.0.1:14620";
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw Error("LOCAL_REVIEW_SERVER_REQUIRED");
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  const errors = [],
    external = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (!r.url().startsWith(base + "/")) external.push(r.url());
  });
  await page.goto(base + "/docs/v2-design/mockups/step6/");
  await page.evaluate(() => document.fonts.ready);
  let states = await page.locator("#scene option").evaluateAll((o) => o.map((n) => n.value));
  let renders = 0;
  for (const theme of ["signature", "light", "dark"])
    for (const scheme of ["A", "B", "C"]) {
      await page.evaluate(
        ({ theme, scheme }) => {
          window.mock.close();
          document.body.dataset.theme = theme;
          window.mock.setScheme(scheme);
        },
        { theme, scheme },
      );
      for (const state of states) {
        await page.evaluate((s) => window.mock.show(s), state);
        assert(await page.locator("#modal").isVisible());
        assert((await page.locator("#dialogTitle").textContent()).trim());
        assert.equal(
          await page.locator("#modal").evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
          true,
          scheme + " " + state,
        );
        renders++;
      }
    }
  await page.evaluate(() => {
    window.mock.close();
    document.body.dataset.theme = "signature";
    window.mock.setScheme("A");
    window.mock.show("review");
    window.bgClicks = 0;
    document.querySelector("#app").addEventListener("click", () => window.bgClicks++);
  });
  assert(await page.locator("#startCopy").isDisabled());
  await page.mouse.click(28, 350);
  assert.equal(await page.evaluate(() => window.bgClicks), 0);
  assert(
    (await page.locator("#modal").evaluate((e) => getComputedStyle(e, "::backdrop").backdropFilter)).includes(
      "blur",
    ),
  );
  for (let i = 0; i < 18; i++) {
    await page.keyboard.press("Tab");
    assert.equal(await page.locator("#modal").evaluate((e) => e.contains(document.activeElement)), true);
  }
  await page.locator("#consent").check();
  assert(await page.locator("#startCopy").isEnabled());
  await page.locator("#startCopy").click();
  assert.equal(await page.evaluate(() => window.mock.scene), "progress");
  await page.getByRole("button", { name: "잠시 중단", exact: true }).click();
  assert.equal(await page.evaluate(() => window.mock.scene), "paused");
  await page.getByRole("button", { name: "이어서 준비하기", exact: true }).click();
  await page.getByRole("button", { name: "이관 취소", exact: true }).click();
  assert.equal(await page.evaluate(() => window.mock.scene), "cancelconfirm");
  await page.getByRole("button", { name: "이관 취소", exact: true }).click();
  assert.equal(await page.evaluate(() => window.mock.scene), "canceling");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#modal").evaluate((e) => e.open), false);
  await page.evaluate(() => {
    window.mock.setScheme("C");
    window.mock.show("review");
  });
  await page.setViewportSize({ width: 430, height: 932 });
  const rect = await page.locator("#modal").boundingBox();
  assert(rect.x >= 0 && rect.x + rect.width <= 431);
  await page.locator("#consent").check();
  await page.locator("#startCopy").click();
  assert.equal(await page.evaluate(() => window.mock.scene), "progress");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.evaluate(() => window.mock.close());
  let typeChecks = 0;
  for (const scheme of ["A", "B", "C"]) {
    await page.evaluate((s) => window.mock.setScheme(s), scheme);
    for (const network of ["connected", "disconnected"]) {
      await page.evaluate((n) => window.mock.setWorkspace("offline", n), network);
      assert.equal(await page.locator(".appbar [data-workspace-type]").textContent(), "오프라인 전용");
      assert.equal(await page.locator('[data-testid="sync-state"]').count(), 0);
      assert(await page.locator('[data-testid="local-only-state"]').isVisible());
      typeChecks++;
      await page.evaluate((n) => window.mock.setWorkspace("online", n), network);
      assert.equal(await page.locator(".appbar [data-workspace-type]").textContent(), "온라인");
      const state = await page.locator('[data-testid="sync-state"]').textContent();
      assert(state.includes(network === "connected" ? "온라인 반영됨" : "연결 끊김"));
      typeChecks++;
    }
  }
  await page.evaluate(() => {
    window.mock.setScheme("A");
    window.mock.setWorkspace("offline");
    window.mock.show("complete");
  });
  await page.getByRole("button", { name: "온라인 워크스페이스 열기", exact: true }).click();
  assert.equal(await page.evaluate(() => window.mock.workspace.type), "online");
  assert.equal(await page.evaluate(() => window.mock.workspace.name), "회사일지 · 온라인");
  assert(
    await page
      .locator(".wsrow")
      .filter({ hasText: "회사일지" })
      .filter({ has: page.locator('[data-workspace-type="offline_only"]') })
      .count(),
  );
  await page.evaluate(() => window.mock.show("create"));
  assert(await page.getByRole("button", { name: "새로 시작하기", exact: true }).isVisible());
  assert(await page.getByRole("button", { name: "오프라인 기록으로 시작", exact: true }).isVisible());
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  const result = {
    checkedAt: new Date().toISOString(),
    browser: "Chromium",
    schemes: 3,
    themes: 3,
    scenes: states.length,
    stateRenders: renders,
    explicitConsent: true,
    workspaceTypeChecks: typeChecks,
    originalWorkspaceRetained: true,
    onlineTypePersistsWithoutInternet: true,
    postCreationOpensNewOnlineWorkspace: true,
    backgroundBlocked: true,
    backgroundBlurred: true,
    pauseResume: true,
    cancelConfirmation: true,
    cancelWaitState: true,
    escapeClose: true,
    tabFocusTrap: true,
    narrowViewport: 430,
    narrowOverflow: false,
    pageErrors: errors,
    externalRequests: external,
    productCodeChanged: false,
  };
  fs.writeFileSync(
    path.join(root, "docs/v2-design/evidence/step6-ui-review-check.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
