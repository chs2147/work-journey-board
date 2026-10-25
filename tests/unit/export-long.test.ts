// @vitest-environment node
// I-M2 통합 검증(i-m2-plan M2-S3): 6주(2026-W38~W43) + 연도 경계(2026-W52~2027-W01) 가상 샘플로
// 저장소 → 자동 집계 → 엑셀(주간보고·원장)까지 한 흐름을 확인한다.
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import sampleLong from "../../fixtures/sample-long.json";
import { seedSample } from "../../src/data/seed";
import { buildWeeklySummary } from "../../src/domain/aggregate";
import { buildWorkbook } from "../../src/export/excel";
import { exportFileName } from "../../src/export/filename";
import { freshRepo } from "./helpers";

async function repoWithLong() {
  const { db, repo } = await freshRepo();
  await seedSample(db, sampleLong);
  return repo;
}

async function exportBack(from: string, to: string, sheets = { weekly: true, ledger: true }) {
  const repo = await repoWithLong();
  const weeks = await repo.exportWeeks(from, to);
  const bytes = await buildWorkbook(ExcelJS, weeks, {
    from,
    to,
    ...sheets,
    appVersion: "0.2.0",
    exportedAt: new Date(2026, 9, 25, 9, 0),
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  return { wb, weeks, bytes };
}

/** 주간보고 시트의 블록: 제목행 번호 → 제목·업무 이름·요약 글·머리행 */
function blocks(ws: ExcelJS.Worksheet) {
  const out: { title: string; header: string[]; categories: string[]; memo: boolean; summary: string }[] = [];
  ws.eachRow((row, r) => {
    const v = String(row.getCell(1).value ?? "");
    if (!/^\d{4}-W\d{2} \(/.test(v)) return;
    const header: string[] = [];
    ws.getRow(r + 1).eachCell((c) => header.push(String(c.value)));
    const categories: string[] = [];
    let memo = false;
    let k = r + 2;
    for (; ; k++) {
      const a = String(ws.getRow(k).getCell(1).value ?? "");
      if (a === "주간 요약") break;
      if (a === "메모") memo = true;
      else categories.push(a);
    }
    out.push({ title: v, header, categories, memo, summary: String(ws.getRow(k).getCell(2).value) });
  });
  return out;
}

describe("6주 가상 샘플 — 엑셀 통합", () => {
  it("주간보고: 6개 블록, 블록별 토·일 머리, 종료 업무는 끝난 주까지만, 요약 행 우선순위", async () => {
    const { wb } = await exportBack("2026-W38", "2026-W43");
    const ws = wb.getWorksheet("주간보고")!;
    // 범위 안 토요일(W39·W43)·일요일(W41 메모) 기록 → 시트 열은 업무 + 월~일 = 8열
    expect(ws.columns.map((c) => c.width)).toEqual([22, 34, 34, 34, 34, 34, 26, 26]);
    const b = blocks(ws);
    expect(b.map((x) => x.title.slice(0, 8))).toEqual([
      "2026-W38",
      "2026-W39",
      "2026-W40",
      "2026-W41",
      "2026-W42",
      "2026-W43",
    ]);
    // 토·일 머리는 그 주에 기록이 있을 때만
    expect(b.map((x) => x.header.length)).toEqual([6, 7, 6, 7, 6, 7]);
    expect(b[1]!.header.at(-1)).toBe("토 09/26");
    expect(b[3]!.header.at(-1)).toBe("일 10/11");
    // 분기 결산 지원: W40(10/2 종료)까지만, 항목 없는 주의 업무는 블록에 없음
    expect(b.map((x) => x.categories.includes("분기 결산 지원"))).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(b[1]!.categories).not.toContain("사내 교육 준비"); // W39 교육 기록 없음
    expect(b.map((x) => x.memo)).toEqual([true, false, false, true, true, false]);
    // 요약 행: W41 수정본, W42 AI본, 나머지 —
    expect(b.map((x) => x.summary.split("\n")[0])).toEqual(["—", "—", "—", "[수정본]", "[AI본]", "—"]);
  });

  it("원장: 항목 + 메모가 빠짐없이(종료 업무의 과거 항목 포함), 중요 ★, 여러 줄 항목은 줄바꿈 유지", async () => {
    const { wb, weeks } = await exportBack("2026-W38", "2026-W43");
    const ws = wb.getWorksheet("원장")!;
    const rows: (string | number | null)[][] = [];
    ws.eachRow((row, r) => {
      if (r > 1)
        rows.push(
          [1, 2, 3, 4, 5, 6, 7, 8].map((c) => (row.getCell(c).value as string | number | null) ?? null),
        );
    });
    const inRange = sampleLong.items.filter((i) => i.date >= "2026-09-14" && i.date <= "2026-10-25");
    const memosInRange = sampleLong.memos.filter((m) => m.date >= "2026-09-14" && m.date <= "2026-10-25");
    expect(rows).toHaveLength(inRange.length + memosInRange.length);
    expect(rows.filter((r) => r[3] === "분기 결산 지원")).toHaveLength(3);
    expect(rows.filter((r) => r[7] === "★").map((r) => r[6])).toEqual([
      "교육 자료 초안 작성",
      "개발 착수 회의 준비",
    ]);
    expect(rows.find((r) => String(r[6]).startsWith("회의 결과 정리"))![6]).toBe(
      "회의 결과 정리\n다음 회의: 화면 흐름 확정",
    );
    expect(ws.autoFilter).toBe(`A1:H${rows.length + 1}`);
    // 자동 집계(패널)와 엑셀이 같은 업무 고르기 규칙: 주간보고 블록 업무 = 자동 집계 본문 업무
    const w38 = buildWeeklySummary(weeks[0]!.input, { includeMemo: true });
    expect(w38.match(/^■ (.+)$/gm)!.map((l) => l.slice(2))).toEqual(
      blocks(wb.getWorksheet("주간보고")!)[0]!.categories,
    );
  });

  it("여러 줄 항목은 행 높이가 늘어난다(2줄 = 30pt, 1줄 = 16.5pt)", async () => {
    const heightOf = async (week: string) => {
      const { wb } = await exportBack(week, week, { weekly: true, ledger: false });
      let h = 0;
      wb.getWorksheet("주간보고")!.eachRow((row) => {
        if (row.getCell(1).value === "신규 서비스 기획") h = row.height;
      });
      return h;
    };
    expect(await heightOf("2026-W40")).toBe(30); // 금요일 칸 "회의 결과 정리\n다음 회의: …"
    expect(await heightOf("2026-W38")).toBe(16.5);
  });
});

describe("연도 경계(2026-W52 → W53 → 2027-W01)", () => {
  it("블록 제목·파일명·원장 주차", async () => {
    expect(exportFileName("2026-W52", "2027-W01")).toBe("업무일지_2026-W52~2027-W01.xlsx");
    const { wb } = await exportBack("2026-W52", "2027-W01");
    expect(wb.title).toBe("업무일지 2026-W52~2027-W01");
    expect(blocks(wb.getWorksheet("주간보고")!).map((b) => b.title)).toEqual([
      "2026-W52 (12/21~12/27)",
      "2026-W53 (2026/12/28~2027/01/03)",
      "2027-W01 (01/04~01/10)",
    ]);
    const weeks: string[] = [];
    wb.getWorksheet("원장")!.eachRow(
      (row, r) => r > 1 && weeks.push(`${String(row.getCell(2).value)} ${String(row.getCell(3).value)}`),
    );
    expect(weeks).toEqual(["2026-W52 화", "2026-W53 화", "2026-W53 금", "2027-W01 화"]);
  });
});
