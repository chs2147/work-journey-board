// 기존 일지 가져오기 E2E(i-m3-plan M3-S0): 준비(절차·AI 지시문·양식 엑셀) → 작성된 양식/표 붙여넣기/일반 CSV
// → 미리보기(주별 병합·덮어쓰기·건너뛰기) → 가져오기 → 보드·메모 → 설정의 가져오기 기록에서 되돌리기.
// 오늘 = 2026-10-22(W43), 가상 샘플(W42~W43 기록). 가져오는 기록도 모두 가상.
import type ExcelJSType from "exceljs";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";

const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs") as typeof ExcelJSType; // (export.spec과 같은 방식 — ESM 가져오기는 Playwright에서 안 됨)
const SEC = "협력사 보안 점검";
const clipboard = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as { __wjb: { clipboard(): string | null } }).__wjb.clipboard());
const wizard = (page: Page) => page.getByTestId("import-wizard");

async function openWizard(page: Page) {
  await page.getByRole("button", { name: "설정" }).click();
  await page.getByRole("button", { name: "기존 일지 가져오기…" }).click();
  await expect(wizard(page)).toBeVisible();
}

/** 양식 엑셀(앱에서 받은 것)에 AI가 채운 것처럼 행을 넣은 xlsx 바이트 */
async function fillTemplate(
  template: Buffer,
  rows: (string | null)[][],
  newCats: string[] = [],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(template as unknown as ArrayBuffer);
  const rec = wb.getWorksheet("기록")!;
  rows.forEach((r, i) => (rec.getRow(i + 2).values = r));
  for (const c of newCats) wb.getWorksheet("업무")!.addRow([c, "신규", ""]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?today=2026-10-22");
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
});

test("준비 → 양식 엑셀(이번 주 진행 중 업무 미리 채움) → AI가 채운 양식 가져오기 → 새 업무는 이번 주까지, 메모는 주간 메모로 → 되돌리기", async ({
  page,
}) => {
  await openWizard(page);
  await expect(page.getByTestId("import-procedure").locator("li")).toHaveCount(8);
  await wizard(page).getByRole("button", { name: "AI 지시문 복사" }).click();
  expect(await clipboard(page)).toContain("[이 캡처의 주 시작일(월요일)]");
  expect(await clipboard(page)).toContain("요일이나 날짜에 속하지 않는 칸");

  // 양식 받기(브라우저 모드: 저장 대화상자 대신 경로 입력 → 내려받기)
  page.once("dialog", (d) => void d.accept(d.defaultValue()));
  const dl = page.waitForEvent("download");
  await wizard(page).getByRole("button", { name: "양식 엑셀 받기" }).click();
  const template = readFileSync((await (await dl).path())!);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(template as unknown as ArrayBuffer);
  expect(wb.worksheets.map((w) => w.name)).toEqual(["안내", "업무", "기록"]);
  expect(wb.getWorksheet("업무")!.getColumn(1).values.slice(1)).toEqual([
    "업무",
    "차세대 정산 시스템 구축",
    SEC,
    "사내 데이터 대시보드",
    "신규 입사자 온보딩",
    "메모",
  ]);

  // 사내 AI가 OneNote 캡처를 옮겨 적은 것처럼(가상): 9월 둘째 주 + 이미 기록이 있는 W43
  const filled = await fillTemplate(
    template,
    [
      ["2026-09-07", null, "월", SEC, null, "가상 점검 범위 협의"],
      ["2026-09-07", null, "월", SEC, "세부", "가상 대상 업체 목록"],
      ["2026-09-07", null, "화", "가상 레거시 이관", null, "가상 이관 대상 정리"],
      ["2026-09-07", null, "수", "메모", null, "가상 부서 교육"],
      ["2026-09-07", null, null, null, null, "주간 요약(요일·날짜 없음 — 가져오지 않음)"],
      ["2026-10-19", null, "목", SEC, null, "점검 결과 보고서 초안 작성"],
      ["2026-10-19", null, "목", SEC, null, "가상 W43 추가 항목"],
    ],
    ["가상 레거시 이관"],
  );
  await wizard(page).getByRole("button", { name: "다음" }).click();
  await page
    .getByTestId("import-file-input")
    .setInputFiles({ name: "가상_작성본.xlsx", mimeType: "application/octet-stream", buffer: filled });

  // 미리보기: 양식 인식, 주 2개(빈 주 = 가져오기, W43 = 기본 병합), 새 업무 1, 같은 기록 1개 건너뜀
  await expect(page.getByTestId("import-summary")).toContainText("가져오기 양식");
  await expect(page.getByTestId("import-summary")).toContainText("2주");
  const rows = page.getByTestId("import-weeks").locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("2026-W37");
  await expect(rows.nth(0)).toContainText("가져오기");
  await expect(rows.nth(1).getByRole("combobox")).toHaveValue("merge");
  await expect(rows.nth(1)).toContainText("같은 기록 1개 건너뜀");
  await expect(page.getByTestId("import-categories")).toHaveText("업무: 기존 1개 · 새로 만듦 1개");
  await page.getByTestId("import-skipped").locator("summary").click();
  await expect(page.getByTestId("import-skipped")).toContainText("6행 날짜 없음(요약 칸 등)");
  await wizard(page).getByRole("button", { name: "가져오기" }).click();

  // 결과 → 가져온 첫 주로
  await expect(page.getByTestId("import-result")).toContainText("기록 4개(2주)를 가져왔습니다");
  await expect(page.getByTestId("import-result")).toContainText("새 업무 1개");
  await page.getByRole("button", { name: "가져온 첫 주로" }).click();
  await expect(page.getByTestId("week-title")).toContainText("2026-W37");
  await expect(page.getByTestId(`cell-${SEC}-2026-09-07`).locator("textarea")).toHaveCount(2);
  await expect(page.getByTestId("cell-가상 레거시 이관-2026-09-08").locator("textarea")).toHaveValue(
    "가상 이관 대상 정리",
  );
  await expect(page.locator(".note-prose")).toContainText("(수) 가상 부서 교육");
  // 새 업무는 이번 주(W43)까지 보드에 이어진다
  await page.keyboard.press("Alt+KeyT");
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
  await expect(page.getByTestId("category-header").filter({ hasText: "가상 레거시 이관" })).toHaveCount(1);
  await expect(page.getByTestId(`cell-${SEC}-2026-10-22`).locator("textarea")).toHaveCount(2); // 병합: 기존 1 + 새 1

  // 설정 > 가져오기 기록 → 되돌리기(확인 2번: 되돌림, 고친 항목 없음)
  await page.getByRole("button", { name: "설정" }).click();
  const history = page.getByTestId("import-history");
  await expect(history).toContainText("가상_작성본.xlsx · 2주 · 항목 4개");
  page.once("dialog", (d) => void d.accept());
  await history.getByRole("button", { name: "되돌리기" }).click();
  await expect(history).toContainText("되돌림");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("category-header").filter({ hasText: "가상 레거시 이관" })).toHaveCount(0);
  await expect(page.getByTestId(`cell-${SEC}-2026-10-22`).locator("textarea")).toHaveCount(1);
});

test("표 붙여넣기(사내 AI가 파일을 못 줄 때) · 기록 있는 주 덮어쓰기(재확인) · 건너뜀·확인 필요 목록", async ({
  page,
}) => {
  await openWizard(page);
  await wizard(page).getByRole("button", { name: "다음" }).click();
  const tsv = [
    "주 시작일\t날짜\t요일\t업무\t세부\t내용",
    "2026-10-19\t\t월\t사내 데이터 대시보드\t\t덮어쓴 가상 항목",
    "2026-10-21\t\t화\t사내 데이터 대시보드\t\t수요일을 주 시작일로 적음",
    "\t\t\t사내 데이터 대시보드\t\t날짜 없는 요약 칸",
  ].join("\n");
  await wizard(page).getByRole("textbox", { name: "표 붙여넣기" }).fill(tsv);
  await wizard(page).getByRole("button", { name: "붙여 넣은 표 읽기" }).click();
  await expect(page.getByTestId("import-summary")).toContainText("(붙여넣기)");
  // 셋째 행(요일·날짜 없음)은 건너뜀, 둘째 행은 확인 필요(주 시작일을 월요일로 고침)
  await page.getByTestId("import-skipped").locator("summary").click();
  await expect(page.getByTestId("import-skipped")).toContainText("4행 날짜 없음");
  await page.getByTestId("import-warnings").locator("summary").click();
  await expect(page.getByTestId("import-warnings")).toContainText("3행 주 시작일이 월요일이 아님");
  const w43 = page.getByTestId("import-weeks").locator('tbody tr[data-week="2026-W43"]');
  await w43.getByRole("combobox").selectOption("overwrite");
  await expect(w43).toContainText(/기존 \d+개 지움/);
  page.once("dialog", (d) => {
    expect(d.message()).toContain("지우고 파일 내용으로 바꿉니다");
    void d.accept();
  });
  await wizard(page).getByRole("button", { name: "가져오기" }).click();
  await expect(page.getByTestId("import-result")).toContainText("기록 2개(1주)를 가져왔습니다");
  await wizard(page).getByRole("button", { name: "닫기" }).click();
  // 덮어쓰기: W43의 다른 업무 기록도 사라지고 파일 내용만
  const texts = () =>
    page
      .locator('[data-testid^="cell-"] textarea')
      .evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value).filter((v) => v.trim()));
  await expect.poll(texts).toEqual(["덮어쓴 가상 항목", "수요일을 주 시작일로 적음"]);
  await expect(page.locator(".note-prose")).toHaveCount(0); // 그 주 메모도 바뀜(빈 메모)
});

test("일반 CSV(머리줄이 달라 열 맞추기) · 오늘 이후 날짜는 건너뜀(선택으로 포함)", async ({ page }) => {
  await openWizard(page);
  await wizard(page).getByRole("button", { name: "다음" }).click();
  const csv = '일시,구분,적은 것\n2026-08-03,가상 연구,"쉼표, 있는 내용"\n2026-12-01,가상 연구,미래 일정\n';
  await page
    .getByTestId("import-file-input")
    .setInputFiles({ name: "옛일지.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  const mapping = page.getByTestId("import-mapping");
  await expect(mapping).toBeVisible();
  await mapping.getByLabel("날짜").selectOption({ label: "일시" });
  await mapping.getByLabel("업무").selectOption({ label: "구분" });
  await mapping.getByLabel("내용").selectOption({ label: "적은 것" });
  await mapping.getByRole("button", { name: "다음" }).click();
  await expect(page.getByTestId("import-summary")).toContainText("일반 표");
  await expect(page.getByTestId("import-summary")).toContainText("1주 · 항목 1개");
  await page.getByLabel(/오늘 이후 날짜도 가져오기/).check();
  await expect(page.getByTestId("import-summary")).toContainText("2주 · 항목 2개");
  await page.getByLabel(/오늘 이후 날짜도 가져오기/).uncheck();
  await wizard(page).getByRole("button", { name: "가져오기" }).click();
  await expect(page.getByTestId("import-result")).toContainText("기록 1개(1주)");
  await page.getByRole("button", { name: "가져온 첫 주로" }).click();
  await expect(page.getByTestId("week-title")).toContainText("2026-W32");
  await expect(page.getByTestId("cell-가상 연구-2026-08-03").locator("textarea")).toHaveValue(
    "쉼표, 있는 내용",
  );
});

test("가져올 표가 아니면 안내, Esc로 닫으면 보드로", async ({ page }) => {
  await openWizard(page);
  await wizard(page).getByRole("button", { name: "다음" }).click();
  await page
    .getByTestId("import-file-input")
    .setInputFiles({ name: "x.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("not xlsx") });
  await expect(wizard(page).getByRole("alert")).toContainText("파일을 읽지 못했습니다");
  await page.keyboard.press("Escape");
  await expect(wizard(page)).toHaveCount(0);
});
