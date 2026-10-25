// 가져올 파일 읽기(i-m3-plan 3-5 ②): 엑셀(.xlsx — ExcelJS 지연 로딩) · CSV/붙여넣은 글(UTF-8, 아니면 CP949).
// 파일은 읽기만 한다(웹 표준 파일 선택 — 사용자 폴더에 쓰지 않음, CLAUDE.md 4-3).
import type ExcelJSType from "exceljs";
import { detectTable, parseDelimited, type Cell, type DetectedTable } from "../domain/importer";
import { STR } from "../shared/strings";

export interface SourceTable {
  name: string;
  rows: Cell[][];
  detected: DetectedTable | null;
}

export interface SourceFile {
  fileName: string;
  tables: SourceTable[];
  /** 처음 보여 줄 표(양식이면 '기록' 시트) */
  pick: number;
}

export class ImportReadError extends Error {}

/** ExcelJS 칸 값 → 글·숫자·날짜 */
function cellValue(v: ExcelJSType.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("result" in v) return cellValue(v.result as ExcelJSType.CellValue);
    if ("text" in v) return String(v.text);
    if ("error" in v) return null;
  }
  return String(v);
}

function tablesOfWorkbook(wb: ExcelJSType.Workbook): SourceTable[] {
  return wb.worksheets.map((ws) => {
    const rows: Cell[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, r) => {
      const values: Cell[] = [];
      row.eachCell({ includeEmpty: true }, (cell, c) => (values[c - 1] = cellValue(cell.value)));
      rows[r - 1] = Array.from(values, (x) => x ?? null);
    });
    const dense = Array.from(rows, (r) => r ?? []);
    return { name: ws.name, rows: dense, detected: detectTable(dense) };
  });
}

/** 바이트 → 글: UTF-8로 읽어 깨지면 윈도우 엑셀 기본 CSV 인코딩(CP949)으로 */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("euc-kr").decode(bytes);
  }
}

export function tableOfText(name: string, text: string): SourceTable {
  const rows = parseDelimited(text);
  return { name, rows, detected: detectTable(rows) };
}

const pickOf = (tables: SourceTable[]) => {
  const records = tables.findIndex((t) => t.name === STR.importer.sheetRecords && t.detected);
  if (records >= 0) return records;
  const any = tables.findIndex((t) => t.detected);
  return any >= 0 ? any : 0;
};

export async function readSourceFile(file: File): Promise<SourceFile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let tables: SourceTable[];
  if (/\.xlsx$/i.test(file.name)) {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      );
    } catch {
      throw new ImportReadError(STR.importer.readFailed);
    }
    tables = tablesOfWorkbook(wb);
  } else {
    tables = [tableOfText(file.name, decodeText(bytes))];
  }
  if (!tables.length || tables.every((t) => !t.rows.length)) throw new ImportReadError(STR.importer.notTable);
  return { fileName: file.name, tables, pick: pickOf(tables) };
}

export function readPastedText(text: string): SourceFile {
  const t = tableOfText(STR.importer.pasteName, text);
  if (!t.rows.length) throw new ImportReadError(STR.importer.notTable);
  return { fileName: STR.importer.pasteName, tables: [t], pick: 0 };
}
