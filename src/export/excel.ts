// 엑셀 내보내기(output-spec 3절): ① 주간보고(사람이 읽는 용) ② 원장(분석용). 앱 안에서 만들고 외부로 보내지 않는다.
// ExcelJS는 내보내기를 처음 열 때만 불러온다(앱 시작 속도에 영향 없게) — 호출하는 쪽이 모듈을 넘긴다.
import { splitCategories, finalVersion, type SummaryInput, type SummaryItem } from "../domain/aggregate";
import { localDate } from "../domain/localTime";
import { DAY_MARK_LABEL } from "../domain/dayMark";
import { DAY_LABELS, dayIndex, weekDays, weekTitle, type DateStr, type WeekId } from "../domain/week";
import { CATEGORY_COLORS, type CategoryColorKey } from "../shared/palette";
import { exportTitle } from "./filename";
import { MIN_ROW_HEIGHT, rowHeight } from "./textWidth";

type ExcelJSModule = typeof import("exceljs");
type Worksheet = import("exceljs").Worksheet;
type Cell = import("exceljs").Cell;

export interface ExportWeek {
  input: SummaryInput;
  /** 업무 id → 팔레트 키(주간보고 업무 행의 왼쪽 굵은 테두리) */
  colors: Record<string, CategoryColorKey>;
  /** 저장된 본(최종본 = 수정본 > AI본, 없으면 `—`) */
  summary: { editedText: string | null; aiText: string | null };
}

/** 메모 보드 스냅샷 한 장(improve-1027v3-spec 1-5) — 그림은 내보내기 전에 만들어 넘긴다(이 모듈은 캔버스를 모른다) */
export interface ExportSnapshot {
  weekId: WeekId;
  /** PNG base64(머리 없이) */
  base64: string;
  /** 그림의 화면 크기(px, 해상도 배율 전) */
  width: number;
  height: number;
}

export interface ExportOptions {
  from: WeekId;
  to: WeekId;
  weekly: boolean;
  ledger: boolean;
  /** 메모 보드 시트(최신 주가 위) + 메모가 없는 주. 없으면 시트를 만들지 않는다 */
  snapshots?: { images: ExportSnapshot[]; noMemo: WeekId[] };
  appVersion: string;
  exportedAt: Date;
}

export const FONT = "맑은 고딕";
const FONT_SIZE = 10;
const BORDER = "FFBFBFBF";
const FILL_TITLE = "FFE8E8E4";
const FILL_HEAD = "FFF4F4F1";
const FILL_SUMMARY = "FFFAFAF7";
const MEMO_COLOR = "FF5F5E5A";

/** 열 너비(문자) — 업무 22, 월~금 34, 토·일 26 */
export const WIDTH = { category: 22, weekday: 34, weekend: 26 } as const;

const argb = (hex: string) => `FF${hex.replace("#", "").toUpperCase()}`;
const thin = { style: "thin" as const, color: { argb: BORDER } };
const fill = (c: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: c } });

/** 셀 안 개조식: 본 항목 `- 내용`, 세부 항목 `   · 내용`, 항목 안 줄바꿈은 들여 이어 쓰기 */
export function cellText(items: SummaryItem[]): string {
  return items
    .flatMap((it) => {
      const [head, cont] = it.depth === 0 ? ["- ", "  "] : ["   · ", "     "];
      return it.text.split("\n").map((l, i) => (i === 0 ? head : cont) + l);
    })
    .join("\n");
}

const hasText = (s: string | undefined) => (s ?? "").trim() !== "";

/** 그 주 그 요일에 업무 항목이 있는가(주간 메모는 요일이 없어 토·일 열을 만들지 않는다) */
function dayHasRecord(input: SummaryInput, date: DateStr): boolean {
  const visible = new Set(input.categories.map((c) => c.id));
  return input.items.some((it) => it.date === date && visible.has(it.categoryId) && hasText(it.text));
}

/** 주간보고 시트의 요일 열: 월~금 + (범위 안 어느 주라도 기록이 있으면) 토·일 */
export function sheetDays(weeks: ExportWeek[]): number[] {
  const days = [0, 1, 2, 3, 4];
  for (const d of [5, 6]) {
    if (weeks.some((w) => dayHasRecord(w.input, weekDays(w.input.weekId)[d]!))) days.push(d);
  }
  return days;
}

/** 요약 행 글: `[수정본]`/`[AI본]` + 본문, 없으면 `—` */
export function summaryCellText(summary: ExportWeek["summary"]): string {
  const v = finalVersion(summary);
  if (v === "edited") return `[수정본]\n${summary.editedText!}`;
  if (v === "ai") return `[AI본]\n${summary.aiText!}`;
  return "—";
}

function setFont(cell: Cell, extra: Partial<import("exceljs").Font> = {}) {
  cell.font = { name: FONT, size: FONT_SIZE, ...extra };
}

function writeWeeklySheet(ws: Worksheet, weeks: ExportWeek[]) {
  const days = sheetDays(weeks);
  const colOfDay = new Map(days.map((d, i) => [d, i + 2]));
  const widths = [WIDTH.category, ...days.map((d) => (d < 5 ? WIDTH.weekday : WIDTH.weekend))];
  ws.columns = widths.map((width) => ({ width }));
  const widthOf = (col: number) => widths[col - 1]!;
  const sumWidth = (a: number, b: number) => widths.slice(a - 1, b).reduce((x, y) => x + y, 0);

  let r = 1;
  for (const w of weeks) {
    const dates = weekDays(w.input.weekId);
    // 블록의 요일 열: 월~금 + 그 주에 기록이 있는 토·일만(머리·칸·테두리)
    const blockDays = days.filter((d) => d < 5 || dayHasRecord(w.input, dates[d]!));
    const blockCols = blockDays.map((d) => colOfDay.get(d)!);
    const last = blockCols.at(-1)!;
    const border = (cell: Cell) => (cell.border = { top: thin, left: thin, bottom: thin, right: thin });
    const blockRow = (row: number) => [1, ...blockCols].map((c) => ws.getCell(row, c));

    // 제목행
    ws.mergeCells(r, 1, r, last);
    const title = ws.getCell(r, 1);
    title.value = weekTitle(w.input.weekId);
    setFont(title, { size: 12, bold: true });
    title.fill = fill(FILL_TITLE);
    title.alignment = { vertical: "middle" };
    border(title);
    ws.getRow(r).height = 22;
    r++;

    // 머리행
    ws.getCell(r, 1).value = "업무";
    // 연차·반차 날은 머리 끝에 `(연차)`(improve-1026-spec 1-3). 원장 시트에는 넣지 않는다
    const markOf = new Map((w.input.dayMarks ?? []).map((m) => [m.date, DAY_MARK_LABEL[m.kind]]));
    for (const d of blockDays) {
      const mark = markOf.get(dates[d]!);
      ws.getCell(r, colOfDay.get(d)!).value =
        `${DAY_LABELS[d]} ${dates[d]!.slice(5).replace("-", "/")}${mark ? ` (${mark})` : ""}`;
    }
    for (const cell of blockRow(r)) {
      setFont(cell, { bold: true });
      cell.fill = fill(FILL_HEAD);
      cell.alignment = { horizontal: "center", vertical: "middle" };
      border(cell);
    }
    r++;

    // 업무 행: 항목이 있는 업무만(자동 집계와 같은 규칙), 보드 순서
    const { byCat, withItems } = splitCategories(w.input);
    for (const c of withItems) {
      const items = byCat.get(c.id)!;
      const name = ws.getCell(r, 1);
      name.value = c.name;
      const texts: { text: string; width: number }[] = [{ text: c.name, width: widthOf(1) }];
      for (const d of blockDays) {
        const col = colOfDay.get(d)!;
        const text = cellText(items.filter((it) => it.date === dates[d]));
        if (text) ws.getCell(r, col).value = text;
        texts.push({ text, width: widthOf(col) });
      }
      for (const cell of blockRow(r)) {
        setFont(cell);
        cell.alignment = { wrapText: true, vertical: "top", horizontal: "left" };
        border(cell);
      }
      setFont(name, { bold: true });
      const color = CATEGORY_COLORS[w.colors[c.id] ?? "c1"].light;
      name.border = { ...name.border, left: { style: "thick", color: { argb: argb(color) } } };
      ws.getRow(r).height = rowHeight(texts);
      r++;
    }

    // 메모 행(메모가 있는 주만): A=`메모`, B~마지막 열 병합 한 칸에 주간 메모의 글(weekly-note-spec 6절)
    if (hasText(w.input.memo)) {
      ws.getCell(r, 1).value = "메모";
      ws.mergeCells(r, 2, r, last);
      const memo = w.input.memo.trim();
      ws.getCell(r, 2).value = memo;
      for (const cell of blockRow(r)) {
        setFont(cell, { color: { argb: MEMO_COLOR } });
        cell.alignment = { wrapText: true, vertical: "top", horizontal: "left" };
        border(cell);
      }
      ws.getRow(r).height = rowHeight([{ text: memo, width: sumWidth(2, last) }]);
      r++;
    }

    // 주간 요약 행(블록 맨 아래, B~마지막 열 병합)
    const label = ws.getCell(r, 1);
    label.value = "주간 요약";
    ws.mergeCells(r, 2, r, last);
    const body = ws.getCell(r, 2);
    const text = summaryCellText(w.summary);
    body.value = text;
    for (const cell of blockRow(r)) {
      setFont(cell);
      cell.fill = fill(FILL_SUMMARY);
      cell.alignment = { wrapText: true, vertical: "top", horizontal: "left" };
      border(cell);
    }
    setFont(label, { bold: true });
    ws.getRow(r).height = rowHeight([{ text, width: sumWidth(2, last) }]);
    r += 2; // 빈 행 1개
  }
}

/** 원장 한 줄 */
export interface LedgerRow {
  date: DateStr;
  weekId: WeekId;
  day: string;
  category: string;
  no: number | null;
  sub: number | null;
  text: string;
  flagged: boolean;
}

/** 원장 행: 날짜 → 업무 보드 순서 → seq, 주간 메모는 그 주 맨 끝 1행. 보이는 업무의 모든 항목(종료된 업무의 과거 항목 포함) */
export function ledgerRows(weeks: ExportWeek[]): LedgerRow[] {
  const out: LedgerRow[] = [];
  for (const w of weeks) {
    const { byCat } = splitCategories(w.input);
    for (const date of weekDays(w.input.weekId)) {
      const day = DAY_LABELS[dayIndex(date)]!;
      for (const c of w.input.categories) {
        let no = 0;
        let sub = 0;
        for (const it of byCat.get(c.id)!.filter((x) => x.date === date)) {
          if (it.depth === 0) {
            no++;
            sub = 0;
          } else sub++;
          out.push({
            date,
            weekId: w.input.weekId,
            day,
            category: c.name,
            no: Math.max(no, 1),
            sub: it.depth === 1 ? sub : null,
            text: it.text,
            flagged: it.flagged === true,
          });
        }
      }
    }
    // 주간 메모: 주마다 1행, 그 주 행들 맨 끝. 날짜 = 그 주 월요일, 요일은 빈칸(weekly-note-spec 6절)
    const memo = w.input.memo.trim();
    if (memo) {
      out.push({
        date: weekDays(w.input.weekId)[0]!,
        weekId: w.input.weekId,
        day: "",
        category: "(주간 메모)",
        no: null,
        sub: null,
        text: memo,
        flagged: false,
      });
    }
  }
  return out;
}

const LEDGER_COLUMNS = [
  { header: "날짜", width: 12 },
  { header: "주차", width: 10 },
  { header: "요일", width: 6 },
  { header: "업무", width: 24 },
  { header: "순번", width: 6 },
  { header: "세부", width: 6 },
  { header: "내용", width: 80 },
  { header: "중요", width: 6 },
];

function writeLedgerSheet(ws: Worksheet, weeks: ExportWeek[]) {
  ws.columns = LEDGER_COLUMNS.map((c) => ({ header: c.header, width: c.width }));
  const head = ws.getRow(1);
  head.eachCell((cell) => {
    setFont(cell, { bold: true });
    cell.fill = fill(FILL_HEAD);
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  const rows = ledgerRows(weeks);
  rows.forEach((row, i) => {
    const [y, m, d] = row.date.split("-").map(Number);
    const r = ws.getRow(i + 2);
    // 날짜는 시간대와 무관한 엑셀 날짜 값(UTC 자정)
    r.values = [
      new Date(Date.UTC(y!, m! - 1, d!)),
      row.weekId,
      row.day,
      row.category,
      row.no ?? null,
      row.sub ?? null,
      row.text,
      row.flagged ? "★" : null,
    ];
    r.eachCell({ includeEmpty: true }, (cell, col) => {
      setFont(cell);
      cell.alignment = {
        vertical: "top",
        wrapText: col === 7,
        horizontal: col === 3 || col === 8 ? "center" : undefined,
      };
    });
    r.getCell(1).numFmt = "yyyy-mm-dd";
    // 한 줄이면 엑셀 기본 높이 그대로, 여러 줄일 때만 계산값
    const h = rowHeight([{ text: row.text, width: 80 }]);
    if (h > MIN_ROW_HEIGHT + 3) r.height = h;
  });
  ws.views = [{ state: "frozen", xSplit: 0, ySplit: 1, topLeftCell: "A2", activeCell: "A2" }];
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, rows.length + 1), column: LEDGER_COLUMNS.length },
  };
}

export const SNAPSHOT_SHEET = "메모 보드";
/** 시트에서 그림 폭(px) — 이보다 작은 그림은 제 크기 */
export const SNAPSHOT_W = 1000;
/** 기본 행 높이(15pt ≈ 20px) */
const ROW_PX = 20;

/** 메모 보드 시트: 주마다 제목 행 + 셀 위에 뜬 그림(아래 행은 그림 높이만큼 비움) + 빈 행 2개, 맨 끝에 메모가 없는 주 */
export function writeSnapshotSheet(
  wb: import("exceljs").Workbook,
  ws: Worksheet,
  images: ExportSnapshot[],
  noMemo: WeekId[],
) {
  ws.getColumn(1).width = 2;
  ws.getColumn(2).width = 140;
  let row = 1;
  for (const s of images) {
    const title = ws.getCell(row, 2);
    title.value = `${weekTitle(s.weekId)} 메모 보드`;
    title.font = { name: FONT, size: 11, bold: true };
    const w = Math.min(SNAPSHOT_W, s.width);
    const h = Math.round((w * s.height) / Math.max(1, s.width));
    const id = wb.addImage({ base64: `data:image/png;base64,${s.base64}`, extension: "png" });
    ws.addImage(id, { tl: { col: 1, row }, ext: { width: w, height: h }, editAs: "oneCell" });
    row += 1 + Math.ceil(h / ROW_PX) + 2;
  }
  if (noMemo.length) {
    const c = ws.getCell(row, 2);
    c.value = `메모가 없는 주: ${noMemo.join(", ")}`;
    c.font = { name: FONT, size: FONT_SIZE, color: { argb: MEMO_COLOR } };
  }
}

/** 내보내기 엑셀 파일 바이트 */
export async function buildWorkbook(
  ExcelJS: ExcelJSModule,
  weeks: ExportWeek[],
  opt: ExportOptions,
): Promise<Uint8Array> {
  if (!opt.weekly && !opt.ledger && !opt.snapshots) throw new Error("내보낼 시트를 하나 이상 고르세요");
  const wb = new ExcelJS.Workbook();
  wb.title = exportTitle(opt.from, opt.to);
  wb.creator = `Work Journey Board ${opt.appVersion}`;
  wb.lastModifiedBy = wb.creator;
  wb.created = opt.exportedAt;
  wb.modified = opt.exportedAt;

  const footer = `&CWork Journey Board · 내보낸 날짜 ${localDate(opt.exportedAt)} · &P/&N`;
  const page = {
    paperSize: 9, // A4
    orientation: "landscape" as const,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  };
  if (opt.weekly) {
    const ws = wb.addWorksheet("주간보고", { pageSetup: page, headerFooter: { oddFooter: footer } });
    writeWeeklySheet(ws, weeks);
  }
  if (opt.ledger) {
    const ws = wb.addWorksheet("원장", { pageSetup: page, headerFooter: { oddFooter: footer } });
    writeLedgerSheet(ws, weeks);
  }
  if (opt.snapshots) {
    const ws = wb.addWorksheet(SNAPSHOT_SHEET, {
      pageSetup: { ...page, orientation: "portrait" },
      headerFooter: { oddFooter: footer },
    });
    writeSnapshotSheet(wb, ws, opt.snapshots.images, opt.snapshots.noMemo);
  }
  wb.views = [
    { x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: 0, visibility: "visible" },
  ];
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}
