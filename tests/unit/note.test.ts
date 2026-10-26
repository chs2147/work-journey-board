// @vitest-environment node
// 주간 메모 문서(weekly-note-spec 4·5·6절): 검증·글 추출·예전 요일 메모 변환·배치.
import { describe, expect, it } from "vitest";
import {
  clampImageWidth,
  clampWidth,
  docFromDayMemos,
  fitWithin,
  isNoteEmpty,
  noteAssetIds,
  noteToText,
  parseNoteDoc,
  positionBelow,
  readingOrder,
  sanitizeContent,
  snap,
  type ImageBox,
  type NoteDoc,
  type PMNode,
  type TextBox,
} from "../../src/domain/note";

const p = (...inline: PMNode[]): PMNode => ({ type: "paragraph", content: inline });
const t = (text: string, marks?: PMNode["marks"]): PMNode => ({
  type: "text",
  text,
  ...(marks ? { marks } : {}),
});
const box = (id: string, x: number, y: number, content: PMNode[]): TextBox => ({
  id,
  kind: "text",
  x,
  y,
  w: 320,
  z: 1,
  bg: null,
  content: { type: "doc", content },
});
const doc = (...boxes: TextBox[]): NoteDoc => ({ v: 1, boxes });

describe("글 추출(자동 집계·엑셀용, 스펙 6절)", () => {
  it("제목·문단·글머리·번호·체크(완료)·중첩·줄바꿈", () => {
    const d = doc(
      box("a", 24, 24, [
        { type: "heading", attrs: { level: 2 }, content: [t("고객 미팅 정리")] },
        p(t("우선순위 "), t("정산 화면", [{ type: "bold" }])),
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                p(t("첫째")),
                { type: "bulletList", content: [{ type: "listItem", content: [p(t("안쪽"))] }] },
              ],
            },
            { type: "listItem", content: [p(t("줄"), { type: "hardBreak" }, t("바꿈"))] },
          ],
        },
        {
          type: "orderedList",
          content: [
            { type: "listItem", content: [p(t("하나"))] },
            { type: "listItem", content: [p(t("둘"))] },
          ],
        },
        {
          type: "taskList",
          content: [
            { type: "taskItem", attrs: { checked: true }, content: [p(t("끝난 일"))] },
            { type: "taskItem", attrs: { checked: false }, content: [p(t("남은 일"))] },
          ],
        },
        { type: "horizontalRule" },
      ]),
    );
    expect(noteToText(d)).toBe(
      [
        "고객 미팅 정리",
        "우선순위 정산 화면",
        "- 첫째",
        "  - 안쪽",
        "- 줄",
        "  바꿈",
        "1. 하나",
        "2. 둘",
        "- (완료) 끝난 일",
        "- 남은 일",
      ].join("\n"),
    );
  });

  it("상자는 위→아래, 같은 줄이면 왼쪽→오른쪽, 상자 사이 빈 줄, 빈 상자는 건너뜀", () => {
    const d = doc(
      box("right", 400, 30, [p(t("오른쪽"))]),
      box("below", 24, 300, [p(t("아래"))]),
      box("left", 24, 24, [p(t("왼쪽"))]),
      box("empty", 24, 200, [p()]),
    );
    expect(readingOrder(d.boxes).map((b) => b.id)).toEqual(["left", "right", "empty", "below"]);
    expect(noteToText(d)).toBe("왼쪽\n\n오른쪽\n\n아래");
    expect(isNoteEmpty(doc(box("e", 0, 0, [p()])))).toBe(true);
    expect(isNoteEmpty(d)).toBe(false);
  });
});

describe("예전 요일 메모 → 상자 1개(스펙 5-1)", () => {
  it("`(요일) 내용` 글머리 목록 — 글 추출하면 지금 자동 집계 메모 줄과 같은 모양", () => {
    let n = 0;
    const d = docFromDayMemos(
      "2026-W43",
      {
        "2026-10-22": "부서 월례 회의 참석",
        "2026-10-23": "교육 신청 마감 확인\n둘째 줄",
        "2026-10-24": "  ",
      },
      () => `id${++n}`,
    );
    expect(d.boxes).toHaveLength(1);
    expect(noteToText(d)).toBe("- (목) 부서 월례 회의 참석\n- (금) 교육 신청 마감 확인\n  둘째 줄");
    expect(docFromDayMemos("2026-W43", {}, () => "x")).toEqual({ v: 1, boxes: [] });
  });
});

describe("문서 검증", () => {
  it("허용 밖 노드는 벗기고 글은 살림, 허용 밖 서식·빈 글은 버림, 문서가 아니면 null", () => {
    const s = sanitizeContent({
      type: "doc",
      content: [
        { type: "blockquote", content: [p(t("인용 안 글"))] },
        p(t("링크", [{ type: "link", attrs: { href: "https://example.com" } }, { type: "bold" }]), {
          type: "text",
          text: "",
        }),
        { type: "image", attrs: { src: "https://example.com/a.png" } },
      ],
    });
    expect(s).toEqual({
      type: "doc",
      content: [p(t("인용 안 글")), p(t("링크", [{ type: "bold" }]))],
    });
    expect(sanitizeContent({ type: "paragraph" })).toBeNull();
    expect(sanitizeContent({ type: "doc", content: [] })).toEqual({
      type: "doc",
      content: [p()].map((x) => ({ type: x.type })),
    });
  });

  it("저장된 JSON: 깨졌으면 빈 문서, 위치는 8px 눈금·폭은 160~960, 모르는 상자 종류는 버림", () => {
    expect(parseNoteDoc("{not json")).toEqual({ v: 1, boxes: [] });
    expect(parseNoteDoc(null)).toEqual({ v: 1, boxes: [] });
    const d = parseNoteDoc(
      JSON.stringify({
        v: 1,
        boxes: [
          {
            id: "a",
            kind: "text",
            x: 13,
            y: 21,
            w: 5000,
            z: 2,
            bg: "purple",
            content: { type: "doc", content: [p(t("가"))] },
          },
          { id: "b", kind: "video", x: 0, y: 0, w: 100, z: 1, content: {} },
          { id: "c", kind: "text", x: 0, y: 0, w: 100, z: 1, content: "nope" },
        ],
      }),
    );
    expect(d.boxes).toHaveLength(1);
    expect(d.boxes[0]).toMatchObject({ id: "a", x: 16, y: 24, w: 960, bg: null });
  });

  it("글이 없는 텍스트 상자는 읽을 때·저장할 때 버린다(improve-1026-spec 2-2)", () => {
    const d = parseNoteDoc(
      JSON.stringify({
        v: 1,
        boxes: [
          {
            id: "a",
            kind: "text",
            x: 0,
            y: 0,
            w: 320,
            z: 1,
            content: { type: "doc", content: [p(t("가"))] },
          },
          { id: "e", kind: "text", x: 0, y: 80, w: 320, z: 2, content: { type: "doc", content: [p()] } },
          {
            id: "s",
            kind: "text",
            x: 0,
            y: 160,
            w: 320,
            z: 3,
            content: { type: "doc", content: [p(t("   "))] },
          },
        ],
      }),
    );
    expect(d.boxes.map((b) => b.id)).toEqual(["a"]);
  });

  it("눈금·폭 제한·아래에 붙이기", () => {
    expect([snap(3), snap(4), snap(-20)]).toEqual([0, 8, 0]);
    expect([clampWidth(10), clampWidth(333), clampWidth(2000)]).toEqual([160, 336, 960]);
    expect(positionBelow(doc())).toEqual({ x: 24, y: 24 });
    const d = doc(
      { ...box("a", 40, 24, [p(t("가"))]), h: 100 },
      { ...box("b", 400, 60, [p(t("나"))]), h: 40 },
    );
    expect(positionBelow(d)).toEqual({ x: 40, y: 144 });
  });
});

describe("이미지 상자(스펙 4-4·6절)", () => {
  const img = (id: string, y: number, caption: string, asset = `as-${id}`): ImageBox => ({
    id,
    kind: "image",
    x: 24,
    y,
    w: 330,
    z: 1,
    asset,
    caption,
  });

  it("글 추출: 설명이 있으면 `- (이미지) 설명`, 없으면 빠짐 — 읽는 순서에 끼어 든다", () => {
    const doc: NoteDoc = {
      v: 1,
      boxes: [
        img("i1", 200, "  응답 시간 전후 비교 "),
        box("a", 24, 24, [p(t("가상 회의"))]),
        img("i2", 400, ""),
      ],
    };
    expect(noteToText(doc)).toBe("가상 회의\n\n- (이미지) 응답 시간 전후 비교");
  });

  it("이미지만 있어도 비어 있지 않은 메모, 이미지 id는 중복 없이", () => {
    expect(isNoteEmpty({ v: 1, boxes: [img("i1", 0, "")] })).toBe(false);
    expect(
      noteAssetIds({ v: 1, boxes: [img("i1", 0, "", "x"), img("i2", 0, "", "x"), img("i3", 0, "", "y")] }),
    ).toEqual(["x", "y"]);
  });

  it("저장된 JSON: 폭 80~1600(1px 단위), 설명은 한 줄·200자, asset 없으면 버림", () => {
    const d = parseNoteDoc(
      JSON.stringify({
        v: 1,
        boxes: [
          { id: "a", kind: "image", x: 3, y: 9, w: 9999, z: 1, asset: "as1", caption: "첫 줄\n둘째 줄" },
          { id: "b", kind: "image", x: 0, y: 0, w: 10, z: 1, asset: "as2", caption: "가".repeat(300) },
          { id: "c", kind: "image", x: 0, y: 0, w: 100, z: 1 },
        ],
      }),
    );
    expect(d.boxes).toHaveLength(2);
    expect(d.boxes[0]).toMatchObject({ x: 0, y: 8, w: 1600, asset: "as1", caption: "첫 줄 둘째 줄" });
    expect(d.boxes[1]).toMatchObject({ w: 80 });
    expect((d.boxes[1] as ImageBox).caption).toHaveLength(200);
    expect(clampImageWidth(333.4)).toBe(333);
  });

  it("긴 변 1600px을 넘으면 비율대로 줄인다", () => {
    expect(fitWithin(3200, 1800)).toEqual({ width: 1600, height: 900 });
    expect(fitWithin(900, 2400)).toEqual({ width: 600, height: 1600 });
    expect(fitWithin(1600, 1000)).toEqual({ width: 1600, height: 1000 });
  });
});
