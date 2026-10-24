// @vitest-environment node
// 주간 자동 집계(output-spec 2절). 골든 = output-spec.md 2-2절 코드 블록 그 자체(스펙이 정본 — 따로 복사본을 두지 않는다).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import sample from "../../fixtures/sample-weeks.json";
import { seedSample } from "../../src/data/seed";
import { basisText, buildWeeklySummary, finalVersion, type SummaryInput } from "../../src/domain/aggregate";
import { sha256Hex } from "../../src/shared/hash";
import { freshRepo } from "./helpers";

function specSample(): string {
  const doc = readFileSync(new URL("../../docs/output-spec.md", import.meta.url), "utf8");
  const section = doc.slice(doc.indexOf("### 2-2."));
  const m = /```\n([\s\S]*?)\n```/.exec(section);
  if (!m) throw new Error("output-spec 2-2절 샘플 블록을 찾지 못했습니다");
  return m[1]!;
}

const input = (over: Partial<SummaryInput> = {}): SummaryInput => ({
  weekId: "2026-W43",
  categories: [
    { id: "a", name: "가 업무" },
    { id: "b", name: "나 업무" },
  ],
  items: [],
  memos: {},
  ...over,
});

describe("주간 자동 집계 — 골든(output-spec 2-2)", () => {
  it("가상 샘플 W43 → 스펙 샘플과 문자 단위로 같다", async () => {
    const { db, repo } = await freshRepo();
    await seedSample(db, sample);
    const text = buildWeeklySummary(await repo.getSummaryInput("2026-W43"), { includeMemo: true });
    expect(text).toBe(specSample());
  });
});

describe("주간 자동 집계 — 규칙(output-spec 2-1)", () => {
  it("업무는 보드 순서, 항목은 날짜순 → seq순, 세부 항목은 요일 태그 없이 들여쓰기", () => {
    const text = buildWeeklySummary(
      input({
        categories: [
          { id: "b", name: "나 업무" },
          { id: "a", name: "가 업무" },
        ],
        items: [
          { date: "2026-10-21", categoryId: "a", depth: 0, text: "수요일 일" },
          { date: "2026-10-19", categoryId: "a", depth: 0, text: "월요일 일" },
          { date: "2026-10-19", categoryId: "a", depth: 1, text: "월요일 세부" },
          { date: "2026-10-25", categoryId: "b", depth: 0, text: "일요일 일" },
        ],
      }),
      { includeMemo: true },
    );
    expect(text).toBe(
      [
        "[주간 업무 요약] 2026-W43 (10/19~10/25)",
        "",
        "■ 나 업무",
        "- (일) 일요일 일",
        "",
        "■ 가 업무",
        "- (월) 월요일 일",
        "  · 월요일 세부",
        "- (수) 수요일 일",
      ].join("\n"),
    );
  });

  it("항목 안 줄바꿈은 본 항목 2칸·세부 항목 4칸 들여 이어 쓴다", () => {
    const text = buildWeeklySummary(
      input({
        items: [
          { date: "2026-10-20", categoryId: "a", depth: 0, text: "첫 줄\n둘째 줄" },
          { date: "2026-10-20", categoryId: "a", depth: 1, text: "세부 첫 줄\n세부 둘째 줄" },
        ],
        categories: [{ id: "a", name: "가 업무" }],
      }),
      { includeMemo: false },
    );
    expect(text.split("\n").slice(2)).toEqual([
      "■ 가 업무",
      "- (화) 첫 줄",
      "  둘째 줄",
      "  · 세부 첫 줄",
      "    세부 둘째 줄",
    ]);
  });

  it("메모: 켜면 [메모] 블록, 끄면 빠짐. 무기록 업무는 맨 끝 한 줄. 빈 글 항목은 무시", () => {
    const base = input({
      items: [
        { date: "2026-10-22", categoryId: "a", depth: 0, text: "한 일" },
        { date: "2026-10-22", categoryId: "b", depth: 0, text: "   " },
      ],
      memos: { "2026-10-23": "회의 참석", "2026-10-24": "  " },
    });
    expect(buildWeeklySummary(base, { includeMemo: true }).split("\n").slice(-5)).toEqual([
      "",
      "[메모]",
      "- (금) 회의 참석",
      "",
      "※ 이번 주 기록 없음: 나 업무",
    ]);
    expect(buildWeeklySummary(base, { includeMemo: false })).not.toContain("[메모]");
  });

  it("기록이 하나도 없는 주", () => {
    expect(buildWeeklySummary(input(), { includeMemo: true })).toBe(
      "[주간 업무 요약] 2026-W43 (10/19~10/25)\n\n※ 이번 주 기록 없음: 가 업무, 나 업무",
    );
  });

  it("보이지 않는 업무의 항목은 넣지 않고, 해를 넘긴 주 제목도 보드 제목 규칙", () => {
    const text = buildWeeklySummary(
      input({
        weekId: "2026-W53",
        categories: [{ id: "a", name: "가 업무" }],
        items: [
          { date: "2027-01-01", categoryId: "a", depth: 0, text: "새해 첫 일" },
          { date: "2027-01-01", categoryId: "zz", depth: 0, text: "숨은 업무" },
        ],
      }),
      { includeMemo: true },
    );
    expect(text).toBe("[주간 업무 요약] 2026-W53 (2026/12/28~2027/01/03)\n\n■ 가 업무\n- (금) 새해 첫 일");
  });
});

describe("최종본·근거 해시(output-spec 2-3)", () => {
  it("수정본 > AI본 > 자동 집계본", () => {
    expect(finalVersion({ editedText: "x", aiText: "y" })).toBe("edited");
    expect(finalVersion({ editedText: "", aiText: "y" })).toBe("edited"); // 빈 수정본도 사용자가 만든 본
    expect(finalVersion({ editedText: null, aiText: "y" })).toBe("ai");
    expect(finalVersion({})).toBe("auto");
  });

  it("근거는 메모 포함 설정과 무관(메모까지 넣은 본), 기록이 바뀌면 해시가 바뀐다", async () => {
    const a = input({
      items: [{ date: "2026-10-22", categoryId: "a", depth: 0, text: "한 일" }],
      memos: { "2026-10-22": "메모" },
    });
    expect(basisText(a)).toBe(buildWeeklySummary(a, { includeMemo: true }));
    const h1 = await sha256Hex(basisText(a));
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256Hex(basisText(a))).toBe(h1);
    const b = { ...a, memos: { "2026-10-22": "메모 고침" } };
    expect(await sha256Hex(basisText(b))).not.toBe(h1);
  });
});
