// @vitest-environment node
// 엑셀 내보내기(output-spec 3·4절, i-m2-plan M2-S2). 만든 파일을 ExcelJS로 다시 읽어 검사하고,
// docs/samples의 양식 샘플(가상 W42~W43)과 셀 값·병합·열 너비·행 높이를 비교한다.
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import sample from "../../fixtures/sample-weeks.json";
import { seedSample } from "../../src/data/seed";
import {
  buildWorkbook,
  cellText,
  ledgerRows,
  sheetDays,
  summaryCellText,
  type ExportWeek,
} from "../../src/export/excel";
import { exportFileName, exportTitle, rangeLabel } from "../../src/export/filename";
import { displayWidth, rowHeight, wrappedLines } from "../../src/export/textWidth";
import { freshRepo } from "./helpers";

const SAMPLE_PATH = new URL("../../docs/samples/sample-export_2026-W42~W43.xlsx", import.meta.url).pathname;
const decodePath = (p: string) => decodeURIComponent(p);

async function readBack(bytes: Uint8Array) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  return wb;
}

const opt = (over: Partial<Parameters<typeof buildWorkbook>[2]> = {}) => ({
  from: "2026-W42",
  to: "2026-W43",
  weekly: true,
  ledger: true,
  appVersion: "0.2.1",
  exportedAt: new Date(2026, 9, 24, 9, 30),
  ...over,
});

/** 시트의 셀 값(병합된 칸은 왼쪽 위 값만) 표 */
function values(ws: ExcelJS.Worksheet): (string | number | null)[][] {
  const out: (string | number | null)[][] = [];
  const masters = new Set<string>();
  ws.eachRow({ includeEmpty: true }, (row, r) => {
    const line: (string | number | null)[] = [];
    for (let c = 1; c <= ws.columnCount; c++) {
      const cell = row.getCell(c);
      if (cell.isMerged && cell.master.address !== cell.address) {
        line.push(null);
        continue;
      }
      masters.add(cell.address);
      const v = cell.value;
      line.push(v instanceof Date ? v.toISOString().slice(0, 10) : ((v as string | number | null) ?? null));
    }
    out[r - 1] = line;
  });
  return out;
}

const merges = (ws: ExcelJS.Worksheet) => [...(ws.model.merges ?? [])].sort();
const heights = (ws: ExcelJS.Worksheet) => {
  const h: (number | undefined)[] = [];
  ws.eachRow({ includeEmpty: true }, (row, r) => (h[r - 1] = row.height));
  return h;
};

async function sampleWeeks(): Promise<ExportWeek[]> {
  const { db, repo } = await freshRepo();
  await seedSample(db, sample);
  // 샘플 W43의 요약 행은 AI본(output-spec 5-3) — 샘플 파일에서 그 글을 그대로 가져와 넣는다
  const ref = new ExcelJS.Workbook();
  await ref.xlsx.readFile(decodePath(SAMPLE_PATH));
  const ai = String(ref.getWorksheet("주간보고")!.getCell("B16").value).replace(/^\[AI본\]\n/, "");
  await db.execute("INSERT INTO weekly_summary (week_id, ai_text) VALUES ('2026-W43', ?)", [ai]);
  return repo.exportWeeks("2026-W42", "2026-W43");
}

describe("표시폭·행 높이(output-spec 3-1)", () => {
  it("한글·전각 2, 그 외 1 / 줄 수 / 높이 = max(15, 줄 수 × 13.5 + 3)", () => {
    expect(displayWidth("가나 ab·")).toBe(2 + 2 + 1 + 2 + 1);
    expect(displayWidth("ＡＢ")).toBe(4);
    expect(wrappedLines("가".repeat(17), 34)).toBe(1);
    expect(wrappedLines("가".repeat(18), 34)).toBe(2);
    expect(wrappedLines("한 줄\n\n셋째 줄", 34)).toBe(3);
    expect(rowHeight([{ text: "", width: 34 }])).toBe(15);
    expect(rowHeight([{ text: "짧음", width: 34 }])).toBe(16.5);
    expect(
      rowHeight([
        { text: "a\nb", width: 34 },
        { text: "a\nb\nc", width: 34 },
      ]),
    ).toBe(43.5);
  });
});

describe("파일명·제목(output-spec 4-2·3-3)", () => {
  it("한 주 / 같은 연도 / 연도 넘김 / 전체", () => {
    expect(exportFileName("2026-W43", "2026-W43")).toBe("업무일지_2026-W43.xlsx");
    expect(exportFileName("2026-W40", "2026-W43")).toBe("업무일지_2026-W40~W43.xlsx");
    expect(exportFileName("2025-W50", "2026-W03")).toBe("업무일지_2025-W50~2026-W03.xlsx");
    expect(exportFileName("2026-W38", "2026-W43", true)).toBe("업무일지_전체_2026-W38~W43.xlsx");
    expect(exportFileName("2026-W52", "2027-W01")).toBe("업무일지_2026-W52~2027-W01.xlsx");
    expect(rangeLabel("2026-W53", "2026-W53")).toBe("2026-W53");
    expect(exportTitle("2026-W42", "2026-W43")).toBe("업무일지 2026-W42~W43");
  });
});

describe("셀 글·요약 행·토일 열", () => {
  it("본 항목 `- `, 세부 `   · `, 항목 안 줄바꿈은 들여 이어 쓰기", () => {
    expect(
      cellText([
        { date: "2026-10-19", categoryId: "a", depth: 0, text: "본\n이어" },
        { date: "2026-10-19", categoryId: "a", depth: 1, text: "세부\n이어" },
      ]),
    ).toBe("- 본\n  이어\n   · 세부\n     이어");
  });

  it("요약 행: 수정본 > AI본 > —", () => {
    expect(summaryCellText({ editedText: "고친 본", aiText: "AI" })).toBe("[수정본]\n고친 본");
    expect(summaryCellText({ editedText: null, aiText: "AI" })).toBe("[AI본]\nAI");
    expect(summaryCellText({ editedText: null, aiText: null })).toBe("—");
  });

  it("토·일 열은 범위 안 어느 주라도 그 요일에 항목이 있을 때만(주간 메모는 요일이 없어 세지 않음)", async () => {
    const weeks = await sampleWeeks();
    expect(sheetDays(weeks)).toEqual([0, 1, 2, 3, 4, 5]); // W43 토요일 기록, 일요일은 없음
    expect(sheetDays(weeks.slice(0, 1))).toEqual([0, 1, 2, 3, 4]);
    const w42 = weeks[0]!;
    expect(sheetDays([{ ...w42, input: { ...w42.input, memo: "일요일에 쓴 메모" } }])).toEqual([
      0, 1, 2, 3, 4,
    ]);
    const sundayItem = {
      date: "2026-10-18",
      categoryId: w42.input.categories[0]!.id,
      depth: 0 as const,
      text: "일",
    };
    expect(sheetDays([{ ...w42, input: { ...w42.input, items: [...w42.input.items, sundayItem] } }])).toEqual(
      [0, 1, 2, 3, 4, 6],
    );
  });
});

describe("양식 샘플과 비교(docs/samples/sample-export_2026-W42~W43.xlsx)", () => {
  it("주간보고: 셀 값 · 병합 · 열 너비 · 행 높이가 샘플과 같다", async () => {
    const wb = await readBack(await buildWorkbook(ExcelJS, await sampleWeeks(), opt()));
    const ref = new ExcelJS.Workbook();
    await ref.xlsx.readFile(decodePath(SAMPLE_PATH));
    const [ours, theirs] = [wb.getWorksheet("주간보고")!, ref.getWorksheet("주간보고")!];
    expect(values(ours)).toEqual(values(theirs));
    expect(merges(ours)).toEqual(merges(theirs));
    expect(ours.columns.map((c) => c.width)).toEqual(theirs.columns.map((c) => c.width));
    expect(heights(ours)).toEqual(heights(theirs));
  });

  it("원장: A~G열은 샘플과 같고, H열 `중요`(★)가 더해진다", async () => {
    const weeks = await sampleWeeks();
    weeks[1]!.input.items.find((i) => i.text === "A협력사 현장 점검")!.flagged = true;
    const wb = await readBack(await buildWorkbook(ExcelJS, weeks, opt()));
    const ref = new ExcelJS.Workbook();
    await ref.xlsx.readFile(decodePath(SAMPLE_PATH));
    const [ours, theirs] = [wb.getWorksheet("원장")!, ref.getWorksheet("원장")!];
    expect(values(ours).map((r) => r.slice(0, 7))).toEqual(values(theirs).map((r) => r.slice(0, 7)));
    expect(ours.getRow(1).getCell(8).value).toBe("중요");
    const flaggedRow = values(ours).find((r) => r[6] === "A협력사 현장 점검")!;
    expect(flaggedRow[7]).toBe("★");
    expect(values(ours).filter((r) => r[7] === "★")).toHaveLength(1);
    expect(ours.columns.map((c) => c.width)).toEqual([12, 10, 6, 24, 6, 6, 80, 6]);
    expect(ours.getCell("A2").numFmt).toBe("yyyy-mm-dd");
    expect(ours.views[0]).toMatchObject({ state: "frozen", ySplit: 1, topLeftCell: "A2" });
    expect(ours.autoFilter).toEqual("A1:H28");
  });
});

describe("파일 속성·서식", () => {
  it("문서 속성 · 시트 순서 · 활성 시트 · 인쇄 설정 · 글꼴", async () => {
    const wb = await readBack(await buildWorkbook(ExcelJS, await sampleWeeks(), opt()));
    expect(wb.title).toBe("업무일지 2026-W42~W43");
    expect(wb.creator).toBe("Work Journey Board 0.2.1");
    expect(wb.worksheets.map((w) => w.name)).toEqual(["주간보고", "원장"]);
    expect(wb.views[0]?.activeTab).toBe(0);
    const ws = wb.getWorksheet("주간보고")!;
    expect(ws.pageSetup).toMatchObject({
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    });
    expect(ws.headerFooter.oddFooter).toBe("&CWork Journey Board · 내보낸 날짜 2026-10-24 · &P/&N");
    expect(ws.getCell("A3").font).toMatchObject({ name: "맑은 고딕", size: 10, bold: true });
    expect(ws.getCell("A1").font).toMatchObject({ size: 12, bold: true });
    // 업무 행 왼쪽 굵은 테두리 = 업무 색(라이트 팔레트)
    expect(ws.getCell("A3").border?.left).toMatchObject({ style: "thick", color: { argb: "FF2A78D6" } });
    expect(ws.getCell("A7").font?.color).toMatchObject({ argb: "FF5F5E5A" }); // 메모 행 회색
  });

  it("시트 하나만 / 둘 다 끄면 오류", async () => {
    const weeks = await sampleWeeks();
    const onlyLedger = await readBack(await buildWorkbook(ExcelJS, weeks, opt({ weekly: false })));
    expect(onlyLedger.worksheets.map((w) => w.name)).toEqual(["원장"]);
    await expect(buildWorkbook(ExcelJS, weeks, opt({ weekly: false, ledger: false }))).rejects.toThrow();
  });

  it("항목 0개 업무는 주간보고 블록에서 빠지고, 원장은 주간 메모를 그 주 맨 끝 1행(날짜 = 월요일)", async () => {
    const weeks = await sampleWeeks();
    const rows = ledgerRows(weeks);
    const w42 = rows.filter((r) => r.weekId === "2026-W42");
    expect(w42.at(-1)).toMatchObject({
      date: "2026-10-12",
      day: "",
      category: "(주간 메모)",
      no: null,
      sub: null,
      text: "- (수) 분기 보안 교육 이수",
    });
    expect(rows.filter((r) => r.category === "(주간 메모)")).toHaveLength(2);
    const noMemo = weeks.map((w) => ({ ...w, input: { ...w.input, memo: " " } }));
    expect(ledgerRows(noMemo).filter((r) => r.category === "(주간 메모)")).toHaveLength(0);
    const wb = await readBack(await buildWorkbook(ExcelJS, weeks, opt({ ledger: false })));
    const ws = wb.getWorksheet("주간보고")!;
    const names = values(ws)
      .slice(10, 15)
      .map((r) => r[0]);
    expect(names).not.toContain("신규 입사자 온보딩"); // W43에는 기록 없음
    // 메모 행 = B~마지막 열 병합 한 칸, 줄 수만큼 높이
    expect(ws.getCell("A15").value).toBe("메모");
    expect(merges(ws)).toContain("B15:G15");
    expect(ws.getCell("B15").value).toBe("- (목) 부서 월례 회의 참석\n- (금) 하반기 교육 신청 마감 확인");
    expect(ws.getRow(15).height).toBe(30);
  });
});

describe("저장소 내보내기 자료", () => {
  it("첫 기록 주 · 미리 계산(주 수·업무 수·항목 수) · 범위를 거꾸로 줘도 오래된 주부터", async () => {
    const { db, repo } = await freshRepo();
    expect(await repo.firstRecordWeek()).toBeNull();
    await seedSample(db, sample);
    expect(await repo.firstRecordWeek()).toBe("2026-W42");
    expect(await repo.exportStats("2026-W40", "2026-W43")).toEqual({ weeks: 4, categories: 4, items: 25 });
    const weeks = await repo.exportWeeks("2026-W43", "2026-W42");
    expect(weeks.map((w) => w.input.weekId)).toEqual(["2026-W42", "2026-W43"]);
  });
});
