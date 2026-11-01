// 메모 보드 → 마크다운(features-1102-spec F4) 골든 테스트: 서식·목록·체크·제목·줄바꿈·이미지 파일·링크 카드·연결·관계선·빈 주.
import { describe, expect, it } from "vitest";
import showcase from "../../fixtures/sample-showcase.json";
import type { SampleData } from "../../src/data/seed";
import type { NoteDoc, PMNode } from "../../src/domain/note";
import { notesToMarkdown, type MarkdownOptions } from "../../src/export/noteMarkdown";

const OPTS: MarkdownOptions = {
  links: true,
  edges: true,
  emptyWeeks: false,
  images: "files",
  imageDir: "메모보드_2026-W43_images",
};
const t = (text: string, marks: string[] = [], href?: string): PMNode => ({
  type: "text",
  text,
  marks: [...marks.map((type) => ({ type })), ...(href ? [{ type: "link", attrs: { href } }] : [])],
});
const p = (...c: PMNode[]): PMNode => ({ type: "paragraph", content: c });
const li = (...c: PMNode[]): PMNode => ({ type: "listItem", content: c });

describe("notesToMarkdown", () => {
  it("서식·목록·체크·번호·중첩·제목·줄바꿈 + 첫 문단을 상자 제목으로", () => {
    const doc: NoteDoc = {
      v: 1,
      boxes: [
        {
          id: "b1",
          kind: "text",
          x: 0,
          y: 0,
          w: 300,
          z: 1,
          bg: null,
          content: {
            type: "doc",
            content: [
              p(t("가상 회의 정리")),
              p(
                t("굵게", ["bold"]),
                t(" · "),
                t("기울임", ["italic"]),
                t(" · "),
                t("취소", ["strike"]),
                t(" · "),
                t("링크", [], "https://wiki.example.com/a"),
              ),
              { type: "heading", attrs: { level: 2 }, content: [t("결정")] },
              {
                type: "bulletList",
                content: [
                  li(p(t("첫째")), { type: "bulletList", content: [li(p(t("세부")))] }),
                  li(p(t("둘째"))),
                ],
              },
              { type: "orderedList", attrs: { start: 3 }, content: [li(p(t("셋"))), li(p(t("넷")))] },
              {
                type: "taskList",
                content: [
                  { type: "taskItem", attrs: { checked: true }, content: [p(t("끝남"))] },
                  { type: "taskItem", attrs: { checked: false }, content: [p(t("남음 *별표*"))] },
                ],
              },
              p(t("한 줄"), { type: "hardBreak" }, t("다음 줄")),
            ],
          },
        },
      ],
    };
    const { markdown, images } = notesToMarkdown([{ weekId: "2026-W43", doc, itemLabel: () => null }], OPTS);
    expect(images).toEqual([]);
    expect(markdown).toBe(
      [
        "# 2026-W43 이번 주 메모 (10/19~10/25)",
        "",
        "## 가상 회의 정리",
        "",
        "**굵게** · *기울임* · ~~취소~~ · [링크](https://wiki.example.com/a)",
        "",
        "#### 결정",
        "",
        "- 첫째",
        "  - 세부",
        "- 둘째",
        "",
        "3. 셋",
        "4. 넷",
        "",
        "- [x] 끝남",
        "- [ ] 남음 \\*별표\\*",
        "",
        "한 줄  ",
        "다음 줄",
        "",
      ].join("\n"),
    );
  });

  it("가상 샘플(W43): 연결 항목·이미지 파일·링크 카드·관계선(점선) — 읽는 순서", () => {
    const doc = (showcase as unknown as SampleData).weekNotes![0]!.doc as NoteDoc;
    const labels: Record<string, string> = {
      "it-sched": "차세대 정산 시스템 구축 · 10/20(화) · 배치 스케줄러 설계안 작성",
    };
    const { markdown, images } = notesToMarkdown(
      [{ weekId: "2026-W43", doc, itemLabel: (id) => labels[id] ?? null, assetMime: () => "image/png" }],
      OPTS,
    );
    expect(images).toEqual([{ assetId: "a-showcase-flow", file: "box-flow.png" }]);
    expect(markdown.split("\n").slice(0, 10)).toEqual([
      "# 2026-W43 이번 주 메모 (10/19~10/25)",
      "",
      "## 야간 배치 02~04시 확정",
      "> 연결: 차세대 정산 시스템 구축 · 10/20(화) · 배치 스케줄러 설계안 작성",
      "",
      "- 운영팀 공유 완료",
      "- 재처리 조건은 수요일 리뷰에서",
      "",
      "회의록: [10/20 배치 협의](https://wiki.example.com/settlement/meeting-1020)",
      "",
    ]);
    expect(markdown).toContain("![정산 배치 흐름 v2(리뷰 반영)](메모보드_2026-W43_images/box-flow.png)");
    expect(markdown).toContain(
      "## 링크 — 정산 배치 설계서 v2(사내 위키)\n\n<https://wiki.example.com/settlement/batch-design>\n\n리뷰 의견 5건 반영본",
    );
    expect(markdown).toContain(
      "### 관계선\n- 야간 배치 02~04시 확정 → 이미지 — 정산 배치 흐름 v2(리뷰 반영) : 설계 반영",
    );
    expect(markdown).toContain("- 계정 관리 미흡 2건 ⇢ 다음 주 할 일 : 후속 (점선)");
    // 지워진 항목(라벨 없음)은 연결 줄을 쓰지 않음 · 연결·관계선·이미지 끄기
    const bare = notesToMarkdown([{ weekId: "2026-W43", doc, itemLabel: () => null }], {
      ...OPTS,
      links: false,
      edges: false,
      images: "none",
    });
    expect(bare.markdown).not.toContain("> 연결");
    expect(bare.markdown).not.toContain("관계선");
    expect(bare.markdown).not.toContain("![");
    expect(bare.images).toEqual([]);
  });

  it("여러 주 · 빈 주는 기본 생략(옵션이면 제목만) · 아무것도 없으면 빈 문서", () => {
    const empty: NoteDoc = { v: 1, boxes: [] };
    expect(notesToMarkdown([{ weekId: "2026-W42", doc: empty, itemLabel: () => null }], OPTS).markdown).toBe(
      "",
    );
    expect(
      notesToMarkdown([{ weekId: "2026-W42", doc: empty, itemLabel: () => null }], {
        ...OPTS,
        emptyWeeks: true,
      }).markdown,
    ).toBe("# 2026-W42 이번 주 메모 (10/12~10/18)\n");
  });
});
