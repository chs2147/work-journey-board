// I-M2 통합 흐름(i-m2-plan M2-S3): 6주 + 연도 경계 가상 샘플(?sample=long)로
// 보드 기록 → 주간 요약 패널(저장된 수정본·AI본, 새 수정본) → 엑셀 내보내기 → 파일을 다시 읽어 확인.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import type ExcelJSType from "exceljs";

const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs") as typeof ExcelJSType;

const panel = (page: Page) => page.getByTestId("summary-panel");
const final = (page: Page) => page.getByTestId("summary-final");
const dialog = (page: Page) => page.getByTestId("export-dialog");
const saved = (page: Page) => expect(page.getByTestId("save-state")).toHaveText("저장됨 ✓");
const lastPath = (page: Page) =>
  page.evaluate(
    () =>
      (globalThis as unknown as { __wjb: { lastExport(): { path: string } | null } }).__wjb.lastExport()
        ?.path ?? null,
  );
const clipboard = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as { __wjb: { clipboard(): string | null } }).__wjb.clipboard());

async function exportNow(page: Page) {
  page.once("dialog", (d) => void d.accept(d.defaultValue()));
  const download = page.waitForEvent("download");
  await dialog(page).getByRole("button", { name: "저장 위치 선택…" }).click();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await readFile(await (await download).path())) as unknown as ArrayBuffer);
  return { wb, path: await lastPath(page) };
}

/** 주간보고 블록 제목 → 그 블록의 요약 행 글 */
function summaries(wb: ExcelJSType.Workbook): Record<string, string> {
  const ws = wb.getWorksheet("주간보고")!;
  const out: Record<string, string> = {};
  let current = "";
  ws.eachRow((row) => {
    const a = String(row.getCell(1).value ?? "");
    if (/^\d{4}-W\d{2} \(/.test(a)) current = a.slice(0, 8);
    if (a === "주간 요약") out[current] = String(row.getCell(2).value);
  });
  return out;
}

test("6주 사용 흐름: 저장된 본 확인 → 이번 주 수정본 → 최근 4주·전체 내보내기", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/?today=2026-10-22&sample=long");
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");

  // 저장된 본: W42 = AI본, W41 = 수정본
  await page.keyboard.press("Alt+KeyS");
  await expect(final(page)).toHaveText("최종본: 자동 집계");
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(panel(page)).toContainText("2026-W42");
  await expect(final(page)).toHaveText("최종본: AI본");
  await panel(page).getByRole("button", { name: "최종본 복사" }).click();
  expect(await clipboard(page)).toContain("응답 시간 절반으로 단축");
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(final(page)).toHaveText("최종본: 수정본");

  // 이번 주: 기록 한 줄 더하고 수정본 만들기 → 고치기
  await page.keyboard.press("Alt+KeyT");
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
  await page.locator('[data-testid="cell-운영 지표 개선-2026-10-22"]').click({ position: { x: 40, y: 20 } });
  await page.keyboard.type("자동화 결과 공유");
  await saved(page);
  await expect(page.getByTestId("summary-auto")).toContainText("- (목) 자동화 결과 공유");
  await panel(page).getByRole("button", { name: "수정본 만들기" }).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n(다음 주) 교육 진행");
  await saved(page);

  // 최근 4주 내보내기: W40 —, W41 수정본, W42 AI본, W43 방금 만든 수정본
  await page.keyboard.press("Alt+KeyE");
  await dialog(page).getByRole("radio", { name: "최근 4주" }).check();
  await expect(page.getByTestId("export-stats")).toContainText("4주");
  let r = await exportNow(page);
  expect(r.path).toBe("/demo/WorkJourney/exports/업무일지_2026-W40~W43.xlsx");
  const s = summaries(r.wb);
  expect(Object.keys(s)).toEqual(["2026-W40", "2026-W41", "2026-W42", "2026-W43"]);
  expect(s["2026-W40"]).toBe("—");
  expect(s["2026-W41"]!.startsWith("[수정본]\n")).toBe(true);
  expect(s["2026-W42"]!.startsWith("[AI본]\n")).toBe(true);
  expect(s["2026-W43"]).toContain("(다음 주) 교육 진행");
  expect(s["2026-W43"]).toContain("자동화 결과 공유");

  // 전체 = 첫 기록 주(W38) ~ 이번 주. 원장에 종료 업무의 과거 항목과 오늘 입력이 들어 있다
  await page.keyboard.press("Alt+KeyE");
  await dialog(page).getByRole("radio", { name: "전체" }).check();
  await expect(dialog(page)).toContainText("2026-W38 ~ 2026-W43");
  r = await exportNow(page);
  expect(r.path).toBe("/demo/WorkJourney/exports/업무일지_전체_2026-W38~W43.xlsx");
  expect(Object.keys(summaries(r.wb))).toHaveLength(6);
  const ledger: string[] = [];
  r.wb
    .getWorksheet("원장")!
    .eachRow(
      (row, i) => i > 1 && ledger.push(`${String(row.getCell(4).value)}|${String(row.getCell(7).value)}`),
    );
  expect(ledger.filter((l) => l.startsWith("분기 결산 지원|"))).toHaveLength(3);
  expect(ledger).toContain("운영 지표 개선|자동화 결과 공유");
});

test("연도 경계: 기간 지정으로 2026-W52 ~ 2027-W01 내보내기", async ({ page }) => {
  await page.goto("/?today=2027-01-06&sample=long");
  await expect(page.getByTestId("week-title")).toContainText("2027-W01");
  await page.keyboard.press("Alt+KeyE");
  await dialog(page).getByRole("radio", { name: "기간 지정" }).check();
  await dialog(page).getByLabel("시작 주").selectOption("2026-W52");
  await dialog(page).getByLabel("끝 주").selectOption("2027-W01");
  await expect(page.getByTestId("export-stats")).toContainText("미리 계산: 3주");
  const r = await exportNow(page);
  expect(r.path).toBe("/demo/WorkJourney/exports/업무일지_2026-W52~2027-W01.xlsx");
  expect(Object.keys(summaries(r.wb))).toEqual(["2026-W52", "2026-W53", "2027-W01"]);
  expect(r.wb.getWorksheet("주간보고")!.getCell("A1").value).toBe("2026-W52 (12/21~12/27)");
});
