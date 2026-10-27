// 메모 보드 스냅샷 E2E(improve-1027v3-spec 1절): [스냅샷] → PNG 저장(기본 이름·exports, 2배 해상도) · 그림으로 복사 ·
// 빈 주는 흐림 · 엑셀 [메모 보드 스냅샷] → "메모 보드" 시트(주마다 그림 + 메모 없는 주 줄) · 선택 기억.
// 브라우저 모드, 가상 샘플만. 오늘 = 2026-10-22(목, W43).
import { createRequire } from "node:module";
import { copyFile, readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import type ExcelJSType from "exceljs";

const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs") as typeof ExcelJSType;

const TODAY = "2026-10-22";
const FIRST = "테스트 데이터 이관 스크립트 작성 착수";

const lastExport = (page: Page) =>
  page.evaluate(() =>
    (
      globalThis as unknown as { __wjb: { lastExport(): { path: string; size: number } | null } }
    ).__wjb.lastExport(),
  );

/** PNG 머리(IHDR)의 가로·세로 */
const pngSize = (buf: Buffer) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?today=${TODAY}`);
  await expect(page.locator(":focus")).toHaveValue(FIRST);
  await expect(page.getByTestId("note-box").first()).toBeVisible();
});

test("[스냅샷] → PNG 그림으로 저장…: 기본 이름 메모보드_2026-W43.png(exports) · 2배 해상도 PNG · 알림", async ({
  page,
}, info) => {
  await page.getByTestId("snapshot-button").click();
  const menu = page.getByRole("menu", { name: "메모 보드 스냅샷" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "PNG 그림으로 저장…" })).toBeFocused();
  let suggested = "";
  page.once("dialog", (d) => {
    suggested = d.defaultValue();
    void d.accept(suggested);
  });
  const download = page.waitForEvent("download");
  await menu.getByRole("menuitem", { name: "PNG 그림으로 저장…" }).click();
  const file = await (await download).path();
  expect(suggested).toMatch(/[\\/]exports[\\/]메모보드_2026-W43\.png$/);
  await expect(page.getByText(/메모 보드 그림을 저장했습니다: 메모보드_2026-W43\.png/)).toBeVisible();
  await expect(menu).toHaveCount(0);
  const buf = await readFile(file);
  expect(buf.subarray(1, 4).toString()).toBe("PNG");
  const { w, h } = pngSize(buf);
  expect(w).toBeGreaterThanOrEqual(720); // 최소 폭 360 × 2
  expect(w % 2).toBe(0);
  expect(h).toBeGreaterThan(200);
  expect((await lastExport(page))?.size).toBe(buf.length);
  await copyFile(file, info.outputPath("snapshot.png"));
});

test("[그림으로 복사] → 클립보드에 PNG · 알림 / Esc로 메뉴 닫기", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "클립보드 권한은 Chromium에서만 줄 수 있다");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByTestId("snapshot-button").click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "메모 보드 스냅샷" })).toHaveCount(0);
  await expect(page.getByTestId("snapshot-button")).toBeFocused();
  await page.getByTestId("snapshot-button").click();
  await page.getByRole("menuitem", { name: "그림으로 복사" }).click();
  await expect(page.getByText("메모 보드 그림을 복사했습니다")).toBeVisible();
  const types = await page.evaluate(async () =>
    (await navigator.clipboard.read()).flatMap((i) => [...i.types]),
  );
  expect(types).toContain("image/png");
});

test("메모가 빈 주: [스냅샷] 흐림 · 누르면 안내만", async ({ page }) => {
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("week-title")).toContainText("2026-W44");
  await expect(page.getByTestId("note-empty")).toBeVisible();
  const btn = page.getByTestId("snapshot-button");
  await expect(btn).toHaveAttribute("aria-disabled", "true");
  await btn.click({ force: true }); // aria-disabled여도 눌러서 안내를 본다
  await expect(page.getByText("메모가 비어 있습니다")).toBeVisible();
  await expect(page.getByRole("menu", { name: "메모 보드 스냅샷" })).toHaveCount(0);
});

test("엑셀 [메모 보드 스냅샷] → '메모 보드' 시트: 주마다 제목 + 그림, 메모 없는 주 줄 · 다음에 열면 체크 기억", async ({
  page,
}) => {
  await page.keyboard.press("Alt+KeyE");
  const dialog = page.getByTestId("export-dialog");
  await dialog.getByRole("radio", { name: "최근 4주" }).check();
  const box = dialog.getByTestId("export-snapshots");
  await expect(box).not.toBeChecked(); // 기본 꺼짐
  await box.check();
  await expect(dialog).toContainText(/메모 있는 주 \d+개 · 시트 1개 추가/);
  await expect(dialog.getByTestId("export-snapshots-note")).toContainText("파일이 커질 수 있습니다");
  page.once("dialog", (d) => void d.accept(d.defaultValue()));
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "저장 위치 선택…" }).click();
  const file = await (await download).path();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await readFile(file)) as unknown as ArrayBuffer);
  expect(wb.worksheets.map((s) => s.name)).toEqual(["주간보고", "원장", "메모 보드"]);
  const ws = wb.getWorksheet("메모 보드")!;
  const images = ws.getImages();
  expect(images.length).toBeGreaterThanOrEqual(1);
  expect(String(ws.getCell(1, 2).value)).toMatch(/^2026-W43 \(10\/19~10\/25\) 메모 보드$/);
  const texts: string[] = [];
  ws.eachRow((r) => texts.push(String(r.getCell(2).value ?? "")));
  expect(texts.some((t) => t.startsWith("메모가 없는 주: "))).toBe(true);
  expect(wb.model.media?.[0]?.extension).toBe("png");

  // 다음에 열면 체크가 기억돼 있다
  await page.keyboard.press("Alt+KeyE");
  await expect(page.getByTestId("export-snapshots")).toBeChecked();
});
