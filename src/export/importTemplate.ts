// 기존 일지 가져오기 양식 엑셀(i-m3-plan 3-3): 안내 · 업무(이번 주 진행 중 업무 미리 채움) · 기록(머리줄만).
// 사내 AI가 OneNote 캡처를 읽어 '기록' 시트를 채우고, 앱이 그 파일을 가져온다. ExcelJS는 부르는 쪽이 넘긴다(지연 로딩).
import type ExcelJSType from "exceljs";
import { MEMO_CATEGORY, TEMPLATE_HEADERS } from "../domain/importer";
import { DAY_LABELS } from "../domain/week";
import { STR } from "../shared/strings";

const FONT = { name: "맑은 고딕", size: 10 };
const HEAD_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF4F4F1" } };
/** 드롭다운을 걸어 둘 행 수 */
const ROWS = 2000;

export interface ImportTemplateOptions {
  /** 이번 주 진행 중 업무(보드 순서) */
  categories: string[];
  createdAt: Date;
  appVersion: string;
}

export async function buildImportTemplate(
  ExcelJS: typeof ExcelJSType,
  opt: ImportTemplateOptions,
): Promise<Uint8Array> {
  const T = STR.importer;
  const wb = new ExcelJS.Workbook();
  wb.creator = `Work Journey Board ${opt.appVersion}`;
  wb.title = T.title;
  wb.created = opt.createdAt;

  // ① 안내 — 절차·열 규칙·지시문 전문(AI가 파일 안에서도 읽게)
  const guide = wb.addWorksheet(T.sheetGuide);
  guide.columns = [{ width: 120 }];
  const lines: { text: string; bold?: boolean }[] = [
    { text: `Work Journey Board — ${T.title} 양식 (${T.templateVersion})`, bold: true },
    { text: `만든 날짜: ${opt.createdAt.toISOString().slice(0, 10)}` },
    { text: "" },
    { text: "절차", bold: true },
    ...T.procedure.map((p, i) => ({ text: `${i + 1}. ${p}` })),
    { text: "" },
    { text: `'${T.sheetRecords}' 시트 열 (한 행 = 항목 하나)`, bold: true },
    { text: "주 시작일: 그 주 월요일(YYYY-MM-DD) · 날짜: 그날 날짜(모르면 비움) · 요일: 월~일 한 글자" },
    {
      text: `업무: '${T.sheetCategories}' 시트의 이름 그대로(없으면 그 시트에 신규로 추가) · 업무가 아닌 그날의 일은 '${MEMO_CATEGORY}'`,
    },
    { text: "세부: 들여쓴 하위 줄이면 '세부', 아니면 비움 · 내용: 캡처의 한 줄을 글자 그대로" },
    { text: "예시) 2025-03-03 |  | 화 | 차세대 정산 시스템 구축 |  | 현행 분석 자료 정리" },
    { text: "예시) 2025-03-03 |  | 화 | 차세대 정산 시스템 구축 | 세부 | 배치 목록 30개 확인" },
    { text: `예시) 2025-03-03 | 2025-03-06 | 목 | ${MEMO_CATEGORY} |  | 부서 회의 참석` },
    { text: "" },
    { text: "사내 AI 지시문", bold: true },
    ...T.prompt.split("\n").map((text) => ({ text })),
  ];
  lines.forEach((l, i) => {
    const c = guide.getCell(i + 1, 1);
    c.value = l.text;
    c.font = { ...FONT, bold: l.bold === true };
    c.alignment = { wrapText: true, vertical: "top" };
  });

  // ② 업무 — 이번 주 진행 중 업무 + 예약 '메모'
  const cats = wb.addWorksheet(T.sheetCategories);
  cats.columns = [{ width: 40 }, { width: 10 }, { width: 50 }];
  const catRows: [string, string, string][] = [
    ...opt.categories.map((name): [string, string, string] => [name, T.kindExisting, ""]),
    [MEMO_CATEGORY, T.kindReserved, T.memoDesc],
  ];
  cats.addRow([...T.categoryHeaders]);
  for (const r of catRows) cats.addRow(r);
  styleHeader(cats.getRow(1));
  cats.views = [{ state: "frozen", ySplit: 1 }];
  cats.eachRow((row) =>
    row.eachCell((c) => (c.font = { ...FONT, ...(row.number === 1 ? { bold: true } : {}) })),
  );

  // ③ 기록 — 머리줄만(예시 행은 안내 시트에만: 가져오기에 섞이지 않게)
  const rec = wb.addWorksheet(T.sheetRecords);
  rec.columns = [{ width: 13 }, { width: 13 }, { width: 6 }, { width: 32 }, { width: 7 }, { width: 80 }];
  rec.addRow([...TEMPLATE_HEADERS]);
  styleHeader(rec.getRow(1));
  rec.views = [{ state: "frozen", ySplit: 1 }];
  for (let r = 2; r <= ROWS; r++) {
    rec.getCell(r, 1).numFmt = "yyyy-mm-dd";
    rec.getCell(r, 2).numFmt = "yyyy-mm-dd";
    rec.getCell(r, 3).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`"${DAY_LABELS.join(",")}"`],
    };
    // 목록 밖 이름도 허용(AI가 '업무' 시트에 새로 추가한 이름) — 경고 없이
    rec.getCell(r, 4).dataValidation = {
      type: "list",
      allowBlank: true,
      showErrorMessage: false,
      formulae: [`'${T.sheetCategories}'!$A$2:$A$500`],
    };
    rec.getCell(r, 5).dataValidation = { type: "list", allowBlank: true, formulae: ['"세부"'] };
    rec.getCell(r, 6).alignment = { wrapText: true, vertical: "top" };
  }
  wb.views = [
    { x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: 0, visibility: "visible" },
  ];
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

function styleHeader(row: ExcelJSType.Row) {
  row.eachCell((c) => {
    c.font = { ...FONT, bold: true };
    c.fill = HEAD_FILL;
    c.alignment = { vertical: "middle", horizontal: "center" };
  });
}
