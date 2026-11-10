import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { startSettingsReview } from "../../../../poc/v2-runtime/settings-review-server.mjs";
const review = await startSettingsReview({ port: 0 });
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } }),
    errors = [],
    external = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (!r.url().startsWith(review.url + "/")) external.push(r.url());
  });
  await page.goto(review.url);
  await page.locator(".workspace").first().waitFor();
  assert.equal(await page.locator(".workspace").count(), 3);
  assert.equal(await page.locator(".workspace[data-kind=offline_only]").count(), 2);
  assert.equal(await page.locator(".workspace[data-kind=online] .chip").textContent(), "온라인");
  const source = page.getByRole("button", { name: "회사 업무 열기", exact: true });
  await source.click();
  await page.getByRole("button", { name: "회사 업무 사용 중", exact: true }).waitFor();
  assert((await page.locator("#current").textContent()).includes("오프라인 전용"));
  await page.locator("summary").click();
  const scenario = page.waitForResponse((r) => r.url().endsWith("/api/scenario"));
  await page.selectOption("#scenario", "save-failure");
  await scenario;
  await page.getByRole("button", { name: "회사 업무 · 온라인 열기", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "저장하지 못했습니다" }).waitFor();
  assert((await page.locator("#current").textContent()).includes("회사 업무"));
  assert.equal(await page.locator(".workspace.active").count(), 1);
  await page.screenshot({ path: new URL("a-save-failure.png", import.meta.url).pathname, fullPage: true });
  const reset = page.waitForResponse((r) => r.url().endsWith("/api/scenario"));
  await page.selectOption("#scenario", "normal");
  await reset;
  await page.getByRole("button", { name: "회사 업무 · 온라인 열기", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "제품용" }).waitFor();
  assert.equal(await page.locator(".workspace.active").count(), 0);
  assert.equal(await page.locator(".workspace[data-kind=online] .chip").textContent(), "온라인");
  await page.screenshot({ path: new URL("a-online-gated.png", import.meta.url).pathname, fullPage: true });
  for (const mode of ["expired", "pending", "disconnected"]) {
    await page.selectOption("#connection", mode);
    assert.equal(await page.locator(".workspace[data-kind=online] .chip").textContent(), "온라인");
    const label = await page.locator(".workspace[data-kind=online] .sub").textContent();
    assert(label.includes(mode === "expired" ? "로그인" : mode === "pending" ? "3건" : "연결 끊김"));
  }
  await page.getByRole("button", { name: "개인 기록 열기", exact: true }).click();
  await page.getByRole("button", { name: "개인 기록 사용 중", exact: true }).waitFor();
  await page.getByRole("button", { name: "회사 업무 열기", exact: true }).click();
  await page.getByRole("button", { name: "회사 업무 사용 중", exact: true }).waitFor();
  for (let n = 0; n < 3; n++) {
    await page.getByRole("button", { name: "개인 기록 열기", exact: true }).click();
    await page.getByRole("button", { name: "개인 기록 사용 중", exact: true }).waitFor();
    await page.getByRole("button", { name: "회사 업무 열기", exact: true }).click();
    await page.getByRole("button", { name: "회사 업무 사용 중", exact: true }).waitFor();
  }
  // Lose the selection ACK after the server has already switched its handle.
  await page.route("**/api/workspace", async (route) => {
    if (route.request().postDataJSON().command === "select") {
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await page.getByRole("button", { name: "개인 기록 열기", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "목록을 새로고침" }).waitFor();
  assert.equal(await page.locator("#current").textContent(), "워크스페이스 선택 전");
  assert.equal(await page.locator(".workspace.active").count(), 0);
  await page.unroute("**/api/workspace");
  await page.getByRole("button", { name: "목록 새로고침", exact: true }).click();
  await page.getByRole("button", { name: "개인 기록 사용 중", exact: true }).waitFor();
  await page.getByRole("button", { name: "회사 업무 열기", exact: true }).click();
  await page.getByRole("button", { name: "회사 업무 사용 중", exact: true }).waitFor();
  await page.locator("summary").click();
  let layouts = 0;
  for (const theme of ["signature", "light", "dark"])
    for (const width of [1440, 900, 390]) {
      await page.setViewportSize({ width, height: 1080 });
      await page.selectOption("#theme", theme);
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `overflow ${theme}/${width}`,
      );
      assert(await page.getByRole("heading", { name: "워크스페이스", exact: true }).isVisible());
      layouts++;
      if (theme === "signature" && width === 1440)
        await page.screenshot({ path: new URL("a-settings.png", import.meta.url).pathname, fullPage: true });
      if (theme === "dark" && width === 1440)
        await page.screenshot({
          path: new URL("a-settings-dark.png", import.meta.url).pathname,
          fullPage: true,
        });
      if (theme === "signature" && width === 390)
        await page.screenshot({
          path: new URL("a-settings-narrow.png", import.meta.url).pathname,
          fullPage: true,
        });
    }
  const forbidden = await fetch(review.url + "/api/workspace", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://other.invalid" },
    body: '{"command":"list"}',
  });
  assert.equal(forbidden.status, 403);
  const unknown = await fetch(review.url + "/api/workspace", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: review.url },
    body: JSON.stringify({ command: "select", payload: { entryId: "forged", token: "fake" } }),
  });
  const safe = await unknown.json();
  assert.equal(safe.code, "WORKSPACE_COMMAND_INVALID");
  assert(!JSON.stringify(safe).includes("canonical_dir"));
  assert(!JSON.stringify(safe).includes("owner_id"));
  const traversal = await fetch(review.url + "/.env");
  assert.equal(traversal.status, 404);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  await browser.close();
  browser = null;
  const preservation = await review.close();
  const evidence = {
    checkedAt: new Date().toISOString(),
    scope:
      "A-layout browser controller -> loopback synthetic bridge -> real SQLite registry/read-only DB19 fixtures",
    layouts,
    tests: [
      "three entries, two fixed offline types and one online type",
      "offline open with header badge",
      "save failure retains previous active workspace",
      "PoC online activation gated without fallback",
      "online badge retained in three connection states",
      "three round trips between offline workspaces",
      "three themes x three viewport widths without horizontal overflow",
      "foreign origin POST denied",
      "extra UI credential field denied",
      "unlisted static resource denied",
      "public response omits native paths and owner",
      "lost switch acknowledgement clears identity and reload reconciles active handle",
      "no external network or browser errors",
      "original synthetic DB hashes unchanged at cleanup",
    ],
    browserErrors: errors,
    externalRequests: external,
    ...preservation,
    productWiringImplemented: false,
    cloudWrites: false,
  };
  writeFileSync(
    new URL("../../evidence/workspace-settings-ui-pass.json", import.meta.url),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify(evidence, null, 2));
} catch (e) {
  if (browser) await browser.close();
  await review.close();
  throw e;
}
