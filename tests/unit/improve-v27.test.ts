// @vitest-environment node
// 개선 v27(docs/improve-v27-spec.md): 업무일지 내보내기 — 연도 범위·파일 이름·업무 거르기·마크다운 골든, 텍스트 상자 스냅샷 높이.
import { describe, expect, it } from "vitest";
import sample from "../../fixtures/sample-weeks.json";
import { seedSample } from "../../src/data/seed";
import type { ExportWeek } from "../../src/export/excel";
import { exportFileName, yearLabel, yearRange } from "../../src/export/filename";
import { filterExportWeeks } from "../../src/export/filterWeeks";
import { buildJournalMarkdown } from "../../src/export/journalMarkdown";
import { layoutSnapshot } from "../../src/export/noteSnapshot";
import { freshRepo } from "./helpers";

describe("연도 범위·파일 이름", () => {
  it("그 해 W01~마지막 주를 첫 기록 주·이번 주로 자른다", () => {
    expect(yearRange(2026, "2026-W43", "2026-W38")).toEqual(["2026-W38", "2026-W43"]);
    expect(yearRange(2025, "2026-W43", "2025-W10")).toEqual(["2025-W10", "2025-W52"]);
    expect(yearRange(2026, "2026-W43", null)).toEqual(["2026-W01", "2026-W43"]);
    expect(yearRange(2026, "2026-W43", "2026-W38", "2026-W45")).toEqual(["2026-W38", "2026-W45"]);
    // ISO 53주 해
    expect(yearRange(2026, "2027-W05", "2025-W01")).toEqual(["2026-W01", "2026-W53"]);
  });

  it("그 해 전체면 `2026년`, 일부면 `2026년_W38~W43`, 업무·공간·확장자", () => {
    expect(yearLabel(2025, "2025-W01", "2025-W52")).toBe("2025년");
    expect(yearLabel(2026, "2026-W38", "2026-W43")).toBe("2026년_W38~W43");
    expect(yearLabel(2026, "2026-W43", "2026-W43")).toBe("2026년_W43");
    expect(exportFileName("2025-W01", "2025-W52", false, undefined, { year: 2025, ext: "md" })).toBe(
      "업무일지_2025년.md",
    );
    expect(
      exportFileName("2026-W40", "2026-W43", false, "개인", { categories: "업무 2개", ext: "xlsx" }),
    ).toBe("업무일지_개인_업무 2개_2026-W40~W43.xlsx");
    expect(exportFileName("2026-W40", "2026-W43", false, undefined, { categories: "a/b:c" })).toBe(
      "업무일지_abc_2026-W40~W43.xlsx",
    );
    // 예전 호출은 그대로
    expect(exportFileName("2026-W38", "2026-W43", true)).toBe("업무일지_전체_2026-W38~W43.xlsx");
  });
});

const week = (
  over: Partial<ExportWeek["input"]> = {},
  summary: ExportWeek["summary"] = { editedText: null, aiText: null },
): ExportWeek => ({
  input: {
    weekId: "2026-W43",
    categories: [
      { id: "a", name: "정산 개편" },
      { id: "b", name: "보안 점검" },
    ],
    items: [
      { date: "2026-10-20", categoryId: "a", depth: 0, text: "배치 확정" },
      { date: "2026-10-20", categoryId: "a", depth: 1, text: "운영팀 공유\n메일로" },
      { date: "2026-10-21", categoryId: "a", depth: 0, text: "리뷰", flagDoneAt: "2026-10-21T01:00:00Z" },
      { date: "2026-10-22", categoryId: "b", depth: 0, text: "체크리스트 회신" },
      { date: "2026-10-22", categoryId: "b", depth: 0, text: "   " },
    ],
    memo: "다음 주 일정 확인",
    dayMarks: [{ date: "2026-10-22", kind: "half_pm", label: null }],
    ...over,
  },
  colors: {},
  summary,
});

describe("업무 거르기", () => {
  it("고른 업무의 업무·항목만 남기고 저장된 수정본·AI본은 버린다(메모·연차는 그대로)", () => {
    const [w] = filterExportWeeks([week({}, { editedText: "수정본", aiText: null })], ["b"]);
    expect(w!.input.categories.map((c) => c.id)).toEqual(["b"]);
    expect(w!.input.items.every((it) => it.categoryId === "b")).toBe(true);
    expect(w!.summary).toEqual({ editedText: null, aiText: null });
    expect(w!.input.memo).toBe("다음 주 일정 확인");
    expect(filterExportWeeks([week()], null)[0]).toEqual(week());
  });
});

describe("마크다운 모양(골든)", () => {
  const base = {
    from: "2026-W42",
    to: "2026-W43",
    records: true,
    summary: false,
    memo: true,
    includeMemo: false,
    categoryLabel: "전체",
    exportedOn: "2026-10-22",
  };
  it("주(오래된 주부터) → 업무 → 날짜 → 항목, 세부 들여쓰기·이어 쓰기·완료 ✓·연차, 빈 주는 기록 없음", () => {
    const empty = week({ weekId: "2026-W42", items: [], memo: "", dayMarks: [] });
    const text = buildJournalMarkdown([week(), empty], base);
    expect(text).toBe(
      [
        "# 업무일지 2026-W42~W43",
        "업무: 전체 · 내보낸 날 2026-10-22",
        "",
        "## 2026-W42 (10/12 ~ 10/18)",
        "",
        "기록 없음",
        "",
        "## 2026-W43 (10/19 ~ 10/25)",
        "",
        "### 정산 개편",
        "- 10/20 (화)",
        "  - 배치 확정",
        "    - 운영팀 공유",
        "      메일로",
        "- 10/21 (수)",
        "  - 리뷰 ✓",
        "",
        "### 보안 점검",
        "- 10/22 (목) · 오후 반차",
        "  - 체크리스트 회신",
        "",
        "### 주간 메모",
        "다음 주 일정 확인",
        "",
      ].join("\n"),
    );
  });
  it("주간 요약: 수정본 > AI본 > 자동 집계", () => {
    const o = { ...base, records: false, memo: false, summary: true };
    expect(buildJournalMarkdown([week({}, { editedText: "수정 요약", aiText: "AI" })], o)).toContain(
      "### 주간 요약\n수정 요약\n",
    );
    expect(buildJournalMarkdown([week({}, { editedText: null, aiText: "AI 요약" })], o)).toContain(
      "### 주간 요약\nAI 요약\n",
    );
    const auto = buildJournalMarkdown([week()], o);
    expect(auto).toContain("### 주간 요약\n");
    expect(auto).toContain("배치 확정");
  });
});

describe("저장소 — 업무 목록·고른 업무 미리 계산", () => {
  it("범위 안 업무(보드 순서)와 고른 업무만 센 미리 계산", async () => {
    const { db, repo } = await freshRepo();
    await seedSample(db, sample);
    const cats = await repo.exportCategories("2026-W42", "2026-W43");
    expect(cats.length).toBeGreaterThan(1);
    const all = await repo.exportStats("2026-W42", "2026-W43");
    const one = await repo.exportStats("2026-W42", "2026-W43", [cats[0]!.id]);
    expect(one.categories).toBeLessThanOrEqual(1);
    expect(one.items).toBeLessThan(all.items);
    expect(one.weeks).toBe(all.weeks);
    expect((await repo.exportStats("2026-W42", "2026-W43", [])).items).toBe(0);
  });
});

describe("텍스트 상자 스냅샷 높이(improve-v27 D9)", () => {
  it("예전에 고정된 frameH는 쓰지 않고 글에 맞춘다", () => {
    const content = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "한 줄" }] }],
    };
    const doc = (frameH?: number) => ({
      boxes: [{ id: "t", kind: "text", x: 0, y: 0, w: 240, z: 1, content, ...(frameH ? { frameH } : {}) }],
      edges: [],
    });
    const measure = (t: string) => t.length * 7;
    const input = (frameH?: number) =>
      ({
        doc: doc(frameH),
        images: {},
        lines: {},
        title: "가상",
        subtitle: "",
        goneText: "원본 없음",
        moreText: (n: number) => String(n),
      }) as unknown as Parameters<typeof layoutSnapshot>[0];
    const h0 = layoutSnapshot(input(), measure).boxes[0]!.rect.h;
    const h1 = layoutSnapshot(input(300), measure).boxes[0]!.rect.h;
    expect(h1).toBe(h0);
  });
});
