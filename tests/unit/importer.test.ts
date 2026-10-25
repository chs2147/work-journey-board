// @vitest-environment node
// 기존 일지 가져오기(i-m3-plan 3절): 표 인식·행 해석·주별 처리 계획·저장소 쓰기/되돌리기·양식 왕복·원장 왕복.
// 모든 기록은 가상 업무(CLAUDE.md 4-2).
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import sample from "../../fixtures/sample-weeks.json";
import { seedSample } from "../../src/data/seed";
import {
  cleanText,
  detectTable,
  parseDateCell,
  parseDayCell,
  parseDelimited,
  parseRows,
  planImport,
  TEMPLATE_HEADERS,
  type Cell,
  type ImportRow,
} from "../../src/domain/importer";
import { noteToText } from "../../src/domain/note";
import { buildWorkbook } from "../../src/export/excel";
import { buildImportTemplate } from "../../src/export/importTemplate";
import { decodeText } from "../../src/import/readTable";
import { freshRepo } from "./helpers";

const H = [...TEMPLATE_HEADERS] as Cell[];
const TODAY = "2026-10-23";
const parse = (rows: Cell[][], today = TODAY) => {
  const d = detectTable(rows)!;
  return parseRows(rows, d.headerRow, d.mapping, d.kind, { today });
};

describe("표 인식·칸 해석", () => {
  it("양식(열 순서가 바뀌어도)·원장·일반 표를 알아보고, 필수 열이 없으면 null", () => {
    expect(detectTable([H])).toMatchObject({ kind: "template", headerRow: 0 });
    const shuffled = [["내용", "업무", "요일", "주 시작일", "세부", "날짜"]];
    expect(detectTable(shuffled)?.mapping).toEqual({
      weekStart: 3,
      date: 5,
      day: 2,
      category: 1,
      depth: 4,
      text: 0,
    });
    expect(detectTable([["날짜", "주차", "요일", "업무", "순번", "세부", "내용", "중요"]])?.kind).toBe(
      "ledger",
    );
    expect(detectTable([["제목 행"], [], ["일자", "프로젝트", "업무 내용"]])).toMatchObject({
      kind: "generic",
      headerRow: 2,
    });
    expect(detectTable([["업무", "내용"]])).toBeNull();
  });

  it("날짜·요일·글머리 기호", () => {
    for (const s of ["2025-03-04", "2025.03.04", "2025/3/4", "25.03.04", "2025년 3월 4일", "2025-03-04(화)"])
      expect(parseDateCell(s)).toBe("2025-03-04");
    expect(parseDateCell(new Date(Date.UTC(2025, 2, 4)))).toBe("2025-03-04");
    expect(parseDateCell(45720)).toBe("2025-03-04"); // 엑셀 일련번호
    expect(parseDateCell("2025-02-30")).toBeNull();
    expect(parseDateCell("3/4")).toBeNull();
    expect([
      parseDayCell("화"),
      parseDayCell("(목)"),
      parseDayCell("금요일"),
      parseDayCell("Sat"),
      parseDayCell("x"),
    ]).toEqual([1, 3, 4, 5, null]);
    expect(cleanText("  • 현행 분석  ")).toBe("현행 분석");
    expect(cleanText("1) 첫째\n  둘째 줄  ")).toBe("첫째\n  둘째 줄");
    expect(cleanText("-5% 개선")).toBe("-5% 개선"); // 기호 뒤 공백이 없으면 내용
  });

  it("탭·쉼표 표, 따옴표 칸(쉼표·줄바꿈), UTF-8 BOM, CP949", () => {
    expect(parseDelimited("﻿날짜\t업무\t내용\n2025-03-04\t가\t한 일\n")).toEqual([
      ["날짜", "업무", "내용"],
      ["2025-03-04", "가", "한 일"],
    ]);
    expect(parseDelimited('날짜,업무,내용\n2025-03-04,가,"쉼표, 있음\n둘째 줄"')[1]).toEqual([
      "2025-03-04",
      "가",
      "쉼표, 있음\n둘째 줄",
    ]);
    const cp949 = Uint8Array.from([0xb3, 0xaf, 0xc2, 0xa5]); // "날짜"
    expect(decodeText(cp949)).toBe("날짜");
    expect(decodeText(new TextEncoder().encode("날짜"))).toBe("날짜");
  });
});

describe("행 해석(3-6절)", () => {
  it("양식: 날짜 = 날짜 칸 → 주 시작일+요일. 요일·날짜가 둘 다 없는 행(요약 칸)은 건너뜀", () => {
    const p = parse([
      H,
      ["2025-03-03", null, "화", "가 업무", null, "화요일 일"],
      ["2025-03-03", null, "화", "가 업무", "세부", "세부 항목"],
      ["2025-03-03", "2025-03-06", "목", "나 업무", null, "날짜 칸 우선"],
      [null, null, null, null, null, null],
      ["2025-03-03", null, null, "가 업무", null, "주간 요약(요일·날짜 없음)"],
    ]);
    expect(p.rows.map((r) => [r.line, r.date, r.category, r.depth, r.text])).toEqual([
      [2, "2025-03-04", "가 업무", 0, "화요일 일"],
      [3, "2025-03-04", "가 업무", 1, "세부 항목"],
      [4, "2025-03-06", "나 업무", 0, "날짜 칸 우선"],
    ]);
    expect(p.skipped).toEqual([
      { line: 6, reason: "no-date", sample: "가 업무 · 주간 요약(요일·날짜 없음)" },
    ]);
  });

  it("일반 표: 날짜·업무를 묶음 첫 행에만 적었으면 위 행을 이어 씀", () => {
    const p = parse([
      ["일자", "프로젝트", "내용"],
      ["2025-03-04", "가 업무", "첫째"],
      [null, null, "같은 날·같은 업무"],
      [null, "나 업무", "같은 날·다른 업무"],
    ]);
    expect(p.kind).toBe("generic");
    expect(p.rows.map((r) => [r.date, r.category, r.text])).toEqual([
      ["2025-03-04", "가 업무", "첫째"],
      ["2025-03-04", "가 업무", "같은 날·같은 업무"],
      ["2025-03-04", "나 업무", "같은 날·다른 업무"],
    ]);
  });

  it("확인 필요: 월요일이 아닌 주 시작일은 고치고, 요일 불일치·주 밖 날짜는 표시. 미래·긴 내용·빈 내용은 건너뜀", () => {
    const p = parse([
      H,
      ["2025-03-05", null, "월", "가", null, "수요일을 주 시작일로 적음"],
      ["2025-03-03", "2025-03-05", "목", "가", null, "요일이 틀림"],
      ["2025-03-03", "2025-03-12", "수", "가", null, "다음 주 날짜"],
      ["2026-10-26", null, "월", "가", null, "미래"],
      ["2025-03-03", null, "화", "가", null, "x".repeat(2001)],
      ["2025-03-03", null, "화", "가", null, "[?] [?]"],
    ]);
    expect(p.rows.map((r) => r.date)).toEqual(["2025-03-03", "2025-03-05", "2025-03-12"]);
    expect(p.warnings.map((w) => [w.line, w.reason])).toEqual([
      [2, "week-start-fixed"],
      [3, "day-mismatch"],
      [4, "outside-week"],
    ]);
    expect(p.skipped.map((s) => s.reason)).toEqual(["future", "long-text", "no-text"]);
    expect(p.future).toBe(1);
    const withFuture = parseRows(
      [H, ["2026-10-26", null, "월", "가", null, "미래"]],
      0,
      detectTable([H])!.mapping,
      "template",
      { today: TODAY, includeFuture: true },
    );
    expect(withFuture.rows).toHaveLength(1);
  });

  it("업무: 공백 정리, 40자 초과는 건너뜀, 메모(예약)·원장의 (주간 메모)는 메모 행", () => {
    const p = parse([
      H,
      ["2025-03-03", null, "월", "  가   업무 ", null, "a"],
      ["2025-03-03", null, "월", "가".repeat(41), null, "b"],
      ["2025-03-03", null, "화", "메모", null, "부서 회의"],
      ["2025-03-03", null, "화", "(주간 메모)", null, "주 전체 글"],
    ]);
    expect(p.rows.map((r) => [r.category, r.memo])).toEqual([
      ["가 업무", null],
      ["메모", "day"],
      ["메모", "week"],
    ]);
    expect(p.skipped.map((s) => s.reason)).toEqual(["long-category"]);
  });
});

const row = (
  date: string,
  category: string,
  text: string,
  depth: 0 | 1 = 0,
  memo: ImportRow["memo"] = null,
): ImportRow => ({
  line: 0,
  date,
  category,
  memo,
  depth,
  text,
});
const ctx = (over: Partial<Parameters<typeof planImport>[1]> = {}): Parameters<typeof planImport>[1] => ({
  today: TODAY,
  categories: [
    { id: "a", name: "가 업무", sortOrder: 1 },
    { id: "z", name: "끝난 업무", sortOrder: 2 },
  ],
  periods: [
    { id: "pa", categoryId: "a", startDate: "2026-10-05", endDate: null },
    { id: "pz", categoryId: "z", startDate: "2026-01-05", endDate: "2026-03-01" },
  ],
  items: [],
  notes: {},
  ...over,
});

describe("주별 처리 계획(3-5·3-7절)", () => {
  it("빈 주는 가져오기, 새 업무는 첫 기록 주 월요일부터 열린 구간, 기존 업무 시작을 앞당김, 이름은 대소문자·공백 무시", () => {
    const plan = planImport(
      [
        row("2026-09-16", "가  업무", "기존 업무에"),
        row("2026-09-17", "새 업무", "새로", 1),
        row("2026-09-24", "새 업무", "둘째 주"),
      ],
      ctx(),
    );
    expect(plan.weeks.map((w) => [w.weekId, w.action, w.add])).toEqual([
      ["2026-W38", "import", 2],
      ["2026-W39", "import", 1],
    ]);
    expect(plan.newCategories).toEqual([
      { key: "새 업무", name: "새 업무", startDate: "2026-09-14", sortOrder: 3 },
    ]);
    expect(plan.periodMoves).toEqual([{ periodId: "pa", from: "2026-10-05", to: "2026-09-14" }]);
    expect(plan.inserts.map((i) => [i.date, i.cat, i.seq, i.depth])).toEqual([
      ["2026-09-16", { id: "a" }, 1, 0],
      ["2026-09-17", { newKey: "새 업무" }, 1, 0], // 칸의 첫 항목은 본 항목으로
      ["2026-09-24", { newKey: "새 업무" }, 1, 0],
    ]);
  });

  it("기록이 있는 주: 기본 병합(칸 끝에, 같은 기록 건너뜀) · 덮어쓰기(그 주 전체 지움) · 건너뛰기", () => {
    const existing = [
      { id: "e1", date: "2026-10-19", categoryId: "a", seq: 1, depth: 0 as const, text: "이미 있음" },
      { id: "e2", date: "2026-10-20", categoryId: "z", seq: 1, depth: 0 as const, text: "다른 업무" },
    ];
    const rows = [row("2026-10-19", "가 업무", "  이미   있음 "), row("2026-10-19", "가 업무", "새 항목", 1)];
    const merge = planImport(rows, ctx({ items: existing }));
    expect(merge.weeks[0]).toMatchObject({
      action: "merge",
      add: 1,
      duplicates: 1,
      remove: 0,
      existingItems: 2,
    });
    expect(merge.inserts.map((i) => [i.seq, i.depth, i.text])).toEqual([[2, 1, "새 항목"]]);
    const over = planImport(rows, ctx({ items: existing }), { weekActions: { "2026-W43": "overwrite" } });
    expect(over.weeks[0]).toMatchObject({ action: "overwrite", add: 2, remove: 2 });
    expect(over.deleteItemIds).toEqual(["e1", "e2"]);
    expect(over.inserts.map((i) => i.seq)).toEqual([1, 2]);
    const skip = planImport(rows, ctx({ items: existing }), { weekActions: { "2026-W43": "skip" } });
    expect([skip.inserts.length, skip.totals.weeks]).toEqual([0, 0]);
    // 메모만 있는 주도 "기록이 있는 주"
    const memoOnly = planImport(rows, ctx({ notes: { "2026-W43": { boxes: 1, empty: false } } }));
    expect(memoOnly.weeks[0]!.action).toBe("merge");
  });

  it("메모 행: 병합 = 상자 추가, 덮어쓰기 = 바꿈(메모 줄이 없어도 기존 메모가 있으면 비움)", () => {
    const rows = [row("2026-10-21", "메모", "부서 회의", 0, "day")];
    expect(planImport(rows, ctx({ notes: { "2026-W43": { boxes: 2, empty: false } } })).memos).toEqual([
      { weekId: "2026-W43", mode: "add", lines: [{ date: "2026-10-21", text: "부서 회의", day: true }] },
    ]);
    const over = planImport(
      [row("2026-10-21", "가 업무", "x")],
      ctx({ notes: { "2026-W43": { boxes: 2, empty: false } } }),
      {
        weekActions: { "2026-W43": "overwrite" },
      },
    );
    expect(over.memos).toEqual([{ weekId: "2026-W43", mode: "replace", lines: [] }]);
    expect(over.weeks[0]!.existingMemoBoxes).toBe(2);
  });

  it("종료된 업무 이름은 기록만 연결(다시 시작은 선택), 건너뛴 주에만 나온 새 업무는 만들지 않음", () => {
    const rows = [row("2026-02-03", "끝난 업무", "옛 기록"), row("2026-10-20", "다음에만", "x")];
    const plan = planImport(
      rows,
      ctx({ items: [{ id: "e", date: "2026-10-19", categoryId: "a", seq: 1, depth: 0, text: "y" }] }),
      {
        weekActions: { "2026-W43": "skip" },
        reopen: ["z", "a"],
      },
    );
    expect(plan.matched).toEqual([{ id: "z", name: "끝난 업무", ended: true }]);
    expect(plan.reopen).toEqual(["z"]); // 진행 중인 업무는 다시 시작 대상이 아님
    expect(plan.newCategories).toEqual([]);
    expect(plan.periodMoves).toEqual([]); // 첫 구간(1/5)보다 뒤
  });
});

describe("저장소: 가져오기 쓰기·되돌리기(3-9절)", () => {
  it("가져오기 → 보드·요약에 보임, 되돌리기 → 가져온 행 빠지고 덮어쓴 행·메모 되살아남, 만든 업무 삭제", async () => {
    const { db, repo, clock } = await freshRepo(); // 오늘 2026-10-23(W43)
    await seedSample(db, sample);
    const before = (await repo.getWeek("2026-W43")).categories.length;
    const p1 = parse([
      H,
      ["2026-09-14", null, "월", "차세대 정산 시스템 구축", null, "가상 착수 회의"],
      ["2026-09-14", null, "화", "레거시 이관(가상)", null, "가상 이관 범위 정리"],
      ["2026-09-14", null, "화", "메모", null, "가상 교육 참석"],
    ]);
    const weeks = [...new Set(p1.rows.map((r) => r.date))].map((d) => d.slice(0, 10));
    const plan1 = planImport(p1.rows, await repo.importContext(["2026-W38"]));
    expect(weeks.length).toBe(2);
    const r1 = await repo.applyImport(plan1, "가상.xlsx");
    expect(r1).toMatchObject({ items: 2, weeks: 1, newCategories: 1 });
    // 새 업무는 이번 주(W43)까지 이어 보인다
    const w43 = await repo.getWeek("2026-W43");
    expect(w43.categories.map((v) => v.category.name)).toContain("레거시 이관(가상)");
    expect(w43.categories).toHaveLength(before + 1);
    expect(noteToText((await repo.getWeek("2026-W38")).note)).toBe("- (화) 가상 교육 참석");
    // 정산 업무의 시작(9/14)은 그대로(이미 그 주부터)
    expect((await repo.listImports()).map((b) => [b.fileName, b.items, b.undoneAt])).toEqual([
      ["가상.xlsx", 2, null],
    ]);

    // 덮어쓰기: 샘플 W43(기록 있음) 전체를 파일 한 줄로
    const p2 = parse([H, ["2026-10-19", null, "월", "차세대 정산 시스템 구축", null, "덮어쓴 한 줄"]]);
    const ctx2 = await repo.importContext(["2026-W43"]);
    const existingW43 = ctx2.items.length;
    expect(existingW43).toBeGreaterThan(5);
    const plan2 = planImport(p2.rows, ctx2, { weekActions: { "2026-W43": "overwrite" } });
    await repo.applyImport(plan2, "(붙여넣기)");
    let items43 = (await repo.getWeek("2026-W43")).items;
    expect(
      Object.values(items43)
        .flat()
        .map((i) => i.text),
    ).toEqual(["덮어쓴 한 줄"]);
    expect(noteToText((await repo.getWeek("2026-W43")).note)).toBe(""); // 그 주 메모도 바뀜(빈 메모)

    const [last] = await repo.listImports();
    expect(await repo.undoImport(last!.id, false)).toEqual({ removed: 1, restored: existingW43 });
    items43 = (await repo.getWeek("2026-W43")).items;
    expect(Object.values(items43).flat()).toHaveLength(existingW43);
    expect(noteToText((await repo.getWeek("2026-W43")).note)).toContain("부서 월례 회의"); // 예전 요일 메모가 다시
    expect((await repo.listImports())[0]!.undoneAt).not.toBeNull();
    expect(await repo.undoImport(last!.id, false)).toEqual({ removed: 0, restored: 0 }); // 두 번은 안 함

    // 첫 가져오기 되돌리기: 고친 항목은 남김 → 새 업무는 기록이 남아 지우지 않음
    const first = (await repo.listImports()).find((b) => b.fileName === "가상.xlsx")!;
    const legacyId = (await repo.listCategories()).categories.find((c) => c.name === "레거시 이관(가상)")!.id;
    const [it] = (await repo.getWeek("2026-W38")).items[`2026-09-15|${legacyId}`]!;
    clock.set(2026, 10, 23, 11); // 고친 시각은 가져온 시각과 다르다
    await repo.saveCell("2026-09-15", legacyId, [
      { id: it!.id, depth: 0, text: "가상 이관 범위 정리(고침)" },
    ]);
    expect(await repo.countEditedImported(first.id)).toBe(1);
    expect(await repo.undoImport(first.id, true)).toEqual({ removed: 1, restored: 0 });
    expect((await repo.listCategories()).categories.some((c) => c.id === legacyId)).toBe(true);
    expect(noteToText((await repo.getWeek("2026-W38")).note)).toBe("");
  });

  it("다시 시작 선택 · 원장(엑셀 내보내기)을 그대로 다시 가져오면 0건 추가", async () => {
    const { db, repo } = await freshRepo();
    await seedSample(db, sample);
    const weeks = await repo.exportWeeks("2026-W42", "2026-W43");
    const bytes = await buildWorkbook(ExcelJS, weeks, {
      from: "2026-W42",
      to: "2026-W43",
      weekly: false,
      ledger: true,
      appVersion: "t",
      exportedAt: new Date(2026, 9, 23),
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    const rows: Cell[][] = [];
    wb.getWorksheet("원장")!.eachRow(
      (r, i) => (rows[i - 1] = (r.values as Cell[]).slice(1).map((v) => v ?? null)),
    );
    const d = detectTable(rows)!;
    expect(d.kind).toBe("ledger");
    const p = parseRows(rows, d.headerRow, d.mapping, d.kind, { today: TODAY });
    const plan = planImport(p.rows, await repo.importContext(["2026-W42", "2026-W43"]));
    expect(plan.totals.items).toBe(0);
    expect(plan.totals.duplicates).toBe(p.rows.filter((r) => !r.memo).length);
    expect(plan.newCategories).toEqual([]);
  });
});

describe("가져오기 양식 엑셀(3-3절)", () => {
  it("안내·업무·기록 시트, 업무 = 이번 주 진행 중 업무 + 메모(예약), 기록은 머리줄만 — 채워 넣으면 그대로 가져와진다", async () => {
    const { db, repo } = await freshRepo();
    await seedSample(db, sample);
    const cats = await repo.importTemplateCategories();
    expect(cats).toEqual([
      "차세대 정산 시스템 구축",
      "협력사 보안 점검",
      "사내 데이터 대시보드",
      "신규 입사자 온보딩",
    ]);
    const bytes = await buildImportTemplate(ExcelJS, {
      categories: cats,
      createdAt: new Date(2026, 9, 23),
      appVersion: "t",
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["안내", "업무", "기록"]);
    const catSheet = wb.getWorksheet("업무")!;
    expect(catSheet.getColumn(1).values.slice(1)).toEqual(["업무", ...cats, "메모"]);
    const rec = wb.getWorksheet("기록")!;
    expect(rec.getRow(1).values).toEqual([undefined, ...TEMPLATE_HEADERS]);
    expect(rec.actualRowCount).toBe(1);
    expect(rec.getCell("D5").dataValidation).toMatchObject({
      type: "list",
      formulae: ["'업무'!$A$2:$A$500"],
    });
    expect(String(wb.getWorksheet("안내")!.getColumn(1).values.join("\n"))).toContain(
      "[이 캡처의 주 시작일(월요일)]",
    );

    // AI가 채운 것처럼: 기존 업무 + 신규 업무 + 메모
    rec.addRow(["2026-03-02", null, "화", "협력사 보안 점검", null, "가상 점검 계획"]);
    rec.addRow([new Date(Date.UTC(2026, 2, 2)), null, "화", "협력사 보안 점검", "세부", "가상 대상 3곳"]);
    rec.addRow(["2026-03-02", null, "수", "가상 신규 업무", null, "가상 착수"]);
    catSheet.addRow(["가상 신규 업무", "신규", ""]);
    const filled = new ExcelJS.Workbook();
    await filled.xlsx.load((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const rows: Cell[][] = [];
    filled.getWorksheet("기록")!.eachRow({ includeEmpty: true }, (r, i) => {
      rows[i - 1] = Array.from({ length: 6 }, (_, c) => {
        const v = r.getCell(c + 1).value;
        return v === undefined ? null : (v as Cell);
      });
    });
    const p = parse(Array.from(rows, (r) => r ?? []));
    expect(p.rows.map((r) => [r.date, r.category, r.depth])).toEqual([
      ["2026-03-03", "협력사 보안 점검", 0],
      ["2026-03-03", "협력사 보안 점검", 1],
      ["2026-03-04", "가상 신규 업무", 0],
    ]);
    const plan = planImport(p.rows, await repo.importContext(["2026-W10"]));
    expect(plan.newCategories.map((c) => c.name)).toEqual(["가상 신규 업무"]);
    expect(plan.periodMoves.map((m) => m.to)).toEqual(["2026-03-02"]);
  });
});
