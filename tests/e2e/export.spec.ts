// 엑셀 내보내기(i-m2-plan M2-S2, output-spec 4절). 브라우저 모드, 오늘 = 2026-10-22(목, W43), 가상 샘플.
// 저장 대화상자는 브라우저 모드에서 경로 입력(prompt)으로 대신하고, 파일은 내려받기로 받아 ExcelJS로 다시 읽어 검사한다.
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import type ExcelJSType from "exceljs";

const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs") as typeof ExcelJSType;

const TODAY = "2026-10-22";
const FIRST = "테스트 데이터 이관 스크립트 작성 착수";
const dialog = (page: Page) => page.getByTestId("export-dialog");

async function readXlsx(path: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await readFile(path)) as unknown as ArrayBuffer);
  return wb;
}

/** 브라우저 모드가 마지막으로 "저장"한 경로(내려받기 파일 이름은 엔진·로캘에 따라 한글이 빠질 수 있어 경로로 본다) */
const lastPath = (page: Page) =>
  page.evaluate(
    () =>
      (globalThis as unknown as { __wjb: { lastExport(): { path: string } | null } }).__wjb.lastExport()
        ?.path ?? null,
  );

/** [저장 위치 선택…] → 경로 입력(저장 대화상자 대신) → 내려받은 파일 바이트 경로 */
async function saveAs(page: Page, answer: (suggested: string) => string) {
  let suggested = "";
  page.once("dialog", (d) => {
    suggested = d.defaultValue();
    void d.accept(answer(suggested));
  });
  const download = page.waitForEvent("download");
  await dialog(page).getByRole("button", { name: "저장 위치 선택…" }).click();
  const file = await (await download).path();
  return { file, suggested, path: await lastPath(page) };
}

/** 저장되지 않는 경우: 경로 입력에 답만 하고, 내려받기를 기다리지 않는다 */
async function answerOnly(page: Page, answer: string | null) {
  page.once("dialog", (d) => void (answer === null ? d.dismiss() : d.accept(answer)));
  await dialog(page).getByRole("button", { name: "저장 위치 선택…" }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto(`/?today=${TODAY}`);
  await expect(page.locator(":focus")).toHaveValue(FIRST);
});

test("Alt+E → 이번 주 · 기본 파일명·위치 → 저장되면 토스트 [폴더 열기] [파일 열기], 파일을 다시 읽으면 두 시트", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (!["localhost", "127.0.0.1"].includes(u.hostname) && !["blob:", "data:"].includes(u.protocol))
      external.push(r.url());
  });
  await page.keyboard.press("Alt+KeyE");
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole("radio", { name: "이번 주" })).toBeFocused();
  await expect(page.getByTestId("export-stats")).toHaveText("미리 계산: 1주 · 업무 3개 · 항목 15개");

  const r = await saveAs(page, (s) => s);
  expect(r.suggested).toBe("/demo/WorkJourney/exports/업무일지_2026-W43.xlsx");
  expect(r.path).toBe(r.suggested);
  await expect(page.getByText("업무일지_2026-W43.xlsx 저장됨")).toBeVisible();
  await expect(page.getByRole("button", { name: "폴더 열기" })).toBeVisible();
  await expect(page.getByRole("button", { name: "파일 열기" })).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator(":focus")).toHaveValue(FIRST); // 보드로 돌아옴

  const wb = await readXlsx(r.file);
  expect(wb.worksheets.map((w) => w.name)).toEqual(["주간보고", "원장"]);
  expect(wb.getWorksheet("주간보고")!.getCell("A1").value).toBe("2026-W43 (10/19~10/25)");
  expect(wb.title).toBe("업무일지 2026-W43");
  expect(external).toEqual([]); // 내보내는 동안 외부 요청 0건(ExcelJS 지연 로딩 포함)
});

test("범위: 최근 4주 · 기간 지정 · 전체 — 파일명 규칙과 블록 수, 시트 하나만", async ({ page }) => {
  await page.getByTestId("export-open").click();
  await dialog(page).getByRole("radio", { name: "최근 4주" }).check();
  await expect(dialog(page)).toContainText("2026-W40 ~ 2026-W43");
  await expect(page.getByTestId("export-stats")).toContainText("4주");
  let r = await saveAs(page, (s) => s);
  expect(r.path).toBe("/demo/WorkJourney/exports/업무일지_2026-W40~W43.xlsx");
  const titles = (wb: ExcelJSType.Workbook) => {
    const out: string[] = [];
    wb.getWorksheet("주간보고")!.eachRow((row) => {
      const v = String(row.getCell(1).value ?? "");
      if (/^\d{4}-W\d{2} \(/.test(v)) out.push(v.slice(0, 8));
    });
    return out;
  };
  expect(titles(await readXlsx(r.file))).toEqual(["2026-W40", "2026-W41", "2026-W42", "2026-W43"]);

  // 기간 지정 + 원장만. 마지막 내보내기 폴더를 기억한다
  await page.keyboard.press("Alt+KeyE");
  await dialog(page).getByRole("radio", { name: "기간 지정" }).check();
  await dialog(page).getByLabel("시작 주").selectOption("2026-W42");
  await dialog(page).getByLabel("끝 주").selectOption("2026-W42");
  await dialog(page).getByLabel("주간보고 시트").uncheck();
  r = await saveAs(page, (s) => s.replace("/exports/", "/보고/"));
  await expect(page.getByText("업무일지_2026-W42.xlsx 저장됨")).toBeVisible();
  let wb = await readXlsx(r.file);
  expect(wb.worksheets.map((w) => w.name)).toEqual(["원장"]);

  await page.keyboard.press("Alt+KeyE");
  await dialog(page).getByRole("radio", { name: "전체" }).check();
  await expect(dialog(page)).toContainText("2026-W42 ~ 2026-W43"); // 첫 기록 주 ~ 이번 주
  r = await saveAs(page, (s) => s);
  expect(r.suggested).toBe("/demo/WorkJourney/보고/업무일지_전체_2026-W42~W43.xlsx");
  wb = await readXlsx(r.file);
  expect(titles(wb)).toEqual(["2026-W42", "2026-W43"]);
});

test("시트를 모두 끄면 저장 단추가 막히고, Esc로 닫으면 보드로", async ({ page }) => {
  await page.keyboard.press("Alt+KeyE");
  await dialog(page).getByLabel("주간보고 시트").uncheck();
  await dialog(page).getByLabel("원장 시트").uncheck();
  const save = dialog(page).getByRole("button", { name: "저장 위치 선택…" });
  await expect(save).toBeDisabled();
  await expect(save).toHaveAttribute("title", "시트를 하나 이상 고르세요");
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator(":focus")).toHaveValue(FIRST);
});

test("저장 대화상자 취소 → 아무것도 저장하지 않고 대화상자는 그대로", async ({ page }) => {
  await page.keyboard.press("Alt+KeyE");
  await answerOnly(page, null);
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole("button", { name: "저장 위치 선택…" })).toBeEnabled();
  expect(await lastPath(page)).toBeNull();
});

test("OneDrive 폴더면 경고 — 취소하면 저장 안 함, 확인하면 저장", async ({ page }) => {
  await page.keyboard.press("Alt+KeyE");
  const target = "/demo/OneDrive - Company/문서/업무일지_2026-W43.xlsx";
  // 첫 번째 대화상자(경로) 다음에 OneDrive 확인 창이 뜬다
  page.once("dialog", (d) => {
    page.once("dialog", (c) => {
      expect(c.message()).toContain("OneDrive 동기화 폴더");
      void c.dismiss();
    });
    void d.accept(target);
  });
  await dialog(page).getByRole("button", { name: "저장 위치 선택…" }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole("button", { name: "저장 위치 선택…" })).toBeEnabled();
  expect(await lastPath(page)).toBeNull();

  page.once("dialog", (d) => {
    page.once("dialog", (c) => void c.accept());
    void d.accept(target);
  });
  const download = page.waitForEvent("download");
  await dialog(page).getByRole("button", { name: "저장 위치 선택…" }).click();
  await download;
  expect(await lastPath(page)).toBe(target);
});

test("엑셀 파일이 아니거나 백업 폴더면 저장하지 않는다", async ({ page }) => {
  await page.keyboard.press("Alt+KeyE");
  await answerOnly(page, "/demo/WorkJourney/exports/업무일지.csv");
  await expect(page.getByText("엑셀 파일(.xlsx)로만 저장할 수 있습니다")).toBeVisible();
  await answerOnly(page, "/demo/WorkJourney/backups/업무일지.xlsx");
  await expect(page.getByText("백업 폴더에는 내보낼 수 없습니다")).toBeVisible();
  expect(await lastPath(page)).toBeNull();
});

test("입력 중인 기록도 저장한 뒤 내보낸다(자동 저장 0.5초를 기다리지 않음)", async ({ page }) => {
  await page.keyboard.press("End");
  await page.keyboard.type(" 완료");
  await page.keyboard.press("Alt+KeyE");
  const r = await saveAs(page, (s) => s);
  const wb = await readXlsx(r.file);
  const texts: string[] = [];
  wb.getWorksheet("원장")!.eachRow((row) => texts.push(String(row.getCell(7).value)));
  expect(texts).toContain(`${FIRST} 완료`);
});
