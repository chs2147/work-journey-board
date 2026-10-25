// ExcelJS가 실앱 CSP(`'unsafe-eval'` 없음) 아래에서 동작하는가(i-m2-plan M2-S2 리스크 1번).
// CSP는 src-tauri/tauri.conf.json에서 그대로 읽고, 화면 번들이 쓰는 파일(package.json "browser" → dist/exceljs.min.js)을 싣는다.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";

const require = createRequire(import.meta.url);
const conf = JSON.parse(
  readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
) as {
  app: { security: { csp: string } };
};
const CSP = conf.app.security.csp;
const lib = readFileSync(require.resolve("exceljs/dist/exceljs.min.js"), "utf8");

const app = `
window.violations = [];
document.addEventListener("securitypolicyviolation", (e) => window.violations.push(e.violatedDirective));
window.run = async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("주간보고");
  ws.columns = [{ width: 22 }, { width: 34 }];
  ws.mergeCells("A1:B1");
  ws.getCell("A1").value = "2026-W43 (10/19~10/25)";
  ws.getCell("A2").value = "- 항목\\n   · 세부";
  ws.getCell("A2").alignment = { wrapText: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = "A1:B1";
  const buf = await wb.xlsx.writeBuffer();
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(buf);
  return back.getWorksheet("주간보고").getCell("A1").value;
};`;

test("실앱 CSP 아래에서 엑셀 쓰기·읽기 — CSP 위반·외부 요청 없음", async ({ page }) => {
  expect(CSP).toContain("default-src 'self'");
  expect(CSP).not.toContain("unsafe-eval");
  await page.route("http://csp.test/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/")
      return route.fulfill({
        contentType: "text/html",
        headers: { "Content-Security-Policy": CSP },
        body: '<!doctype html><meta charset="utf-8"><script src="/app.js"></script><script src="/exceljs.min.js"></script>',
      });
    if (path === "/app.js") return route.fulfill({ contentType: "text/javascript", body: app });
    if (path === "/exceljs.min.js") return route.fulfill({ contentType: "text/javascript", body: lib });
    return route.abort();
  });
  const external: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("http://csp.test/")) external.push(r.url());
  });
  await page.goto("http://csp.test/");
  expect(await page.evaluate(() => (window as unknown as { run(): Promise<unknown> }).run())).toBe(
    "2026-W43 (10/19~10/25)",
  );
  expect(await page.evaluate(() => (window as unknown as { violations: string[] }).violations)).toEqual([]);
  expect(external).toEqual([]);
});
