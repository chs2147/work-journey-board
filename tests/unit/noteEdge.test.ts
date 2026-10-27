// @vitest-environment node
// 메모 관계선(note-relation-spec): 문서 정리(edges)·상자 삭제와 함께·이름·둥근 꺾은선 경로·후보 순서.
import { describe, expect, it } from "vitest";
import {
  boxEdges,
  boxName,
  findEdge,
  parseNoteDoc,
  withEdges,
  withoutBoxes,
  type NoteBox,
  type NoteDoc,
  type TextBox,
} from "../../src/domain/note";
import { midPoint, nearestBoxes, rectOf, roundedPath, routeEdge } from "../../src/domain/noteEdge";

const text = (id: string, x: number, y: number, words = id, w = 160, h = 60): TextBox => ({
  id,
  kind: "text",
  x,
  y,
  w,
  z: 1,
  h,
  bg: null,
  content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: words }] }] },
});
const edge = (id: string, from: string, to: string, extra: Record<string, unknown> = {}) => ({
  id,
  from,
  to,
  dir: "one",
  dash: false,
  label: "",
  ...extra,
});
const json = (boxes: NoteBox[], edges: unknown) => JSON.stringify({ v: 1, boxes, edges });

describe("문서의 관계선 정리(5-1)", () => {
  const boxes = [text("a", 0, 0), text("b", 400, 0), text("c", 0, 300)];

  it("edges가 없는 문서는 그대로(필드 없음)", () => {
    const d = parseNoteDoc(JSON.stringify({ v: 1, boxes }));
    expect(d.edges).toBeUndefined();
    expect(parseNoteDoc(json(boxes, [])).edges).toBeUndefined();
  });

  it("없는 상자·자기 자신·같은 쌍(반대 방향 포함)은 버리고 모르는 값은 기본값, 이름표는 20자", () => {
    const d = parseNoteDoc(
      json(boxes, [
        edge("e1", "a", "b", { dir: "both", dash: true, label: "  서로   영향  " }),
        edge("e2", "b", "a"),
        edge("e3", "a", "zz"),
        edge("e4", "c", "c"),
        edge("e5", "a", "c", { dir: "weird", dash: "yes", label: "가".repeat(30) }),
        { id: 5, from: "b", to: "c" },
        "nope",
      ]),
    );
    expect(d.edges).toEqual([
      { id: "e1", from: "a", to: "b", dir: "both", dash: true, label: "서로 영향" },
      { id: "e5", from: "a", to: "c", dir: "one", dash: false, label: "가".repeat(20) },
    ]);
  });

  it("빈 글 상자가 정리되면 그 상자의 선도 사라진다", () => {
    const empty: TextBox = {
      ...text("b", 400, 0),
      content: { type: "doc", content: [{ type: "paragraph" }] },
    };
    const d = parseNoteDoc(json([boxes[0]!, empty, boxes[2]!], [edge("e1", "a", "b"), edge("e2", "a", "c")]));
    expect(d.edges?.map((e) => e.id)).toEqual(["e2"]);
  });

  it("상자를 빼면 닿은 선도 함께, 0개면 필드를 뺀다 · 같은 쌍 찾기 · 상자의 선", () => {
    const doc: NoteDoc = {
      v: 1,
      boxes,
      edges: [edge("e1", "a", "b"), edge("e2", "c", "a")] as NoteDoc["edges"],
    };
    expect(findEdge(doc, "b", "a")?.id).toBe("e1");
    expect(boxEdges(doc, "a").map((e) => e.id)).toEqual(["e1", "e2"]);
    const noB = withoutBoxes(doc, new Set(["b"]));
    expect(noB.boxes.map((b) => b.id)).toEqual(["a", "c"]);
    expect(noB.edges?.map((e) => e.id)).toEqual(["e2"]);
    expect("edges" in withoutBoxes(doc, new Set(["a"]))).toBe(false);
    expect("edges" in withEdges(doc, [])).toBe(false);
  });

  it("목록 이름: 글 첫 줄(목록 기호 없이) · 이미지 설명 · 링크 제목, 30자", () => {
    const list: TextBox = {
      ...text("l", 0, 0),
      content: {
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [{ type: "paragraph", content: [{ type: "text", text: "첫 항목" }] }],
              },
            ],
          },
        ],
      },
    };
    expect(boxName(list)).toBe("첫 항목");
    expect(boxName(text("t", 0, 0, "가".repeat(40)))).toBe(`${"가".repeat(30)}…`);
    expect(boxName({ id: "i", kind: "image", x: 0, y: 0, w: 100, z: 1, asset: "x", caption: "" })).toBe(
      "(이미지)",
    );
    expect(boxName({ id: "i", kind: "image", x: 0, y: 0, w: 100, z: 1, asset: "x", caption: "그래프" })).toBe(
      "그래프",
    );
    expect(
      boxName({
        id: "k",
        kind: "link",
        x: 0,
        y: 0,
        w: 300,
        z: 1,
        url: "https://a.example",
        title: "배포",
        note: "",
      }),
    ).toBe("배포");
  });
});

describe("둥근 모서리 꺾은선(1-1)", () => {
  const A = { x: 0, y: 0, w: 100, h: 60 };

  it("옆으로 떨어지고 높이가 겹치면 곧은 가로선(테두리에서 4px 띄움)", () => {
    const r = routeEdge(A, { x: 300, y: 20, w: 100, h: 60 })!;
    expect(r.points).toEqual([
      { x: 104, y: 40 },
      { x: 296, y: 40 },
    ]);
    expect(r.d).toBe("M104 40 L296 40");
    expect(r.mid).toEqual({ x: 200, y: 40 });
  });

  it("옆으로 더 떨어지고 높이가 어긋나면 가로-세로-가로(가운데에서 꺾음), 모서리는 Q로 둥글게", () => {
    const r = routeEdge(A, { x: 300, y: 200, w: 100, h: 60 })!;
    expect(r.points).toEqual([
      { x: 104, y: 30 },
      { x: 200, y: 30 },
      { x: 200, y: 230 },
      { x: 296, y: 230 },
    ]);
    expect(r.d).toBe("M104 30 L190 30 Q200 30 200 40 L200 220 Q200 230 210 230 L296 230");
    expect(r.mid).toEqual({ x: 200, y: 130 });
  });

  it("왼쪽에 있는 상자로도", () => {
    const r = routeEdge({ x: 500, y: 0, w: 100, h: 60 }, { x: 100, y: 200, w: 100, h: 60 })!;
    expect(r.points[0]).toEqual({ x: 496, y: 30 });
    expect(r.points.at(-1)).toEqual({ x: 204, y: 230 });
  });

  it("아래로 더 떨어지면 세로-가로-세로, 너비가 겹치면 곧은 세로선", () => {
    const r = routeEdge(A, { x: 140, y: 300, w: 100, h: 60 })!;
    expect(r.points).toEqual([
      { x: 50, y: 64 },
      { x: 50, y: 180 },
      { x: 190, y: 180 },
      { x: 190, y: 296 },
    ]);
    const s = routeEdge(A, { x: 40, y: 300, w: 100, h: 60 })!;
    expect(s.points).toEqual([
      { x: 70, y: 64 },
      { x: 70, y: 296 },
    ]);
    const up = routeEdge({ x: 40, y: 300, w: 100, h: 60 }, A)!;
    expect(up.points).toEqual([
      { x: 70, y: 296 },
      { x: 70, y: 64 },
    ]);
  });

  it("겹친 상자는 null, 좁은 틈은 띄우기를 줄인다, 반지름은 짧은 선분 절반까지", () => {
    expect(routeEdge(A, { x: 50, y: 30, w: 100, h: 60 })).toBeNull();
    const narrow = routeEdge(A, { x: 106, y: 0, w: 100, h: 60 })!;
    expect(narrow.points[0]!.x).toBe(102);
    expect(narrow.points[1]!.x).toBe(104);
    expect(
      roundedPath([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 4 },
        { x: 30, y: 4 },
      ]),
    ).toBe("M0 0 L8 0 Q10 0 10 2 L10 2 Q10 4 12 4 L30 4");
  });

  it("커서까지(크기 0인 점): 상자 옆 높이 안이면 곧게, 아니면 꺾어서 그 점에 닿음", () => {
    const r = routeEdge(A, { x: 250, y: 40, w: 0, h: 0 })!;
    expect(r.points).toEqual([
      { x: 104, y: 40 },
      { x: 250, y: 40 },
    ]);
    const r2 = routeEdge(A, { x: 260, y: 200, w: 0, h: 0 })!;
    expect(r2.points.at(-1)).toEqual({ x: 260, y: 200 });
    expect(routeEdge(A, { x: 50, y: 30, w: 0, h: 0 })).toBeNull();
  });

  it("가운데 점은 길이 기준, 키보드 후보는 가까운 순", () => {
    expect(
      midPoint([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ]),
    ).toEqual({ x: 100, y: 0 });
    const from = text("a", 0, 0);
    const near = nearestBoxes(from, [from, text("far", 900, 900), text("near", 200, 0), text("mid", 0, 400)]);
    expect(near.map((b) => b.id)).toEqual(["near", "mid", "far"]);
    expect(rectOf({ ...from, h: undefined })).toEqual({ x: 0, y: 0, w: 160, h: 48 });
  });
});
