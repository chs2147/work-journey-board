// 메모 보드 스냅샷 배치(improve-1027v3-spec 1-3·1-4): 글 줄바꿈(낱말 단위·긴 덩어리 자르기)·목록·체크·띠 접기·지워진 항목 순서·
// 그림 크기·배율 한계. 글자 폭은 가짜 재기(글자 하나 = 글자 크기 × 0.5)로 — 캔버스 없이 순수 계산만.
import { describe, expect, it } from "vitest";
import type { NoteDoc, PMNode, TextBox } from "../../src/domain/note";
import {
  ellipsize,
  layoutInline,
  layoutProse,
  layoutSnapshot,
  snapLines,
  snapshotScale,
  type Measure,
  type SnapshotInput,
  type TextOp,
} from "../../src/export/noteSnapshot";

const measure: Measure = (text, font) => [...text].length * Number(/(\d+)px/.exec(font)![1]) * 0.5;
const base = {
  size: 14,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  highlight: false,
  color: "#000",
};
const t = (text: string, marks?: PMNode["marks"]): PMNode => ({
  type: "text",
  text,
  ...(marks ? { marks } : {}),
});
const texts = (ops: { kind: string }[]) => ops.filter((o): o is TextOp => o.kind === "text");

describe("layoutInline", () => {
  it("낱말 단위로 줄바꿈, 줄 끝 빈칸은 버림, 줄 높이 = 글자 크기 × 1.65", () => {
    // 글자 하나 7px, 폭 70px = 10글자
    const r = layoutInline([t("가나다라 마바사아 자차카")], base, 0, 0, 70, measure);
    const lines = [...new Set(r.ops.map((o) => o.y))];
    expect(lines).toHaveLength(2);
    expect(r.height).toBeCloseTo(14 * 1.65 * 2);
    expect(
      r.ops
        .filter((o) => o.y === lines[0])
        .map((o) => o.text)
        .join(""),
    ).toBe("가나다라 마바사아");
  });
  it("줄보다 긴 덩어리는 글자 단위로 자르고, 줄바꿈 노드는 새 줄", () => {
    const r = layoutInline([t("가".repeat(25)), { type: "hardBreak" }, t("끝")], base, 0, 0, 70, measure);
    expect(r.ops.map((o) => o.text)).toEqual(["가".repeat(10), "가".repeat(10), "가".repeat(5), "끝"]);
  });
  it("서식: 굵게·크기·글자색·형광펜 → 글꼴·색·꾸밈, 큰 글자가 있으면 줄이 높아짐", () => {
    const r = layoutInline(
      [
        t("큰", [{ type: "fontSize", attrs: { size: "xl" } }, { type: "bold" }]),
        t("파랑", [{ type: "textColor", attrs: { color: "blue" } }, { type: "highlight" }]),
      ],
      base,
      0,
      0,
      500,
      measure,
    );
    expect(r.ops[0]!.font).toContain("700 21px");
    expect(r.ops[1]!.color).toBe("#1f5fa8");
    expect(r.ops[1]!.highlight).toBe(true);
    expect(r.height).toBeCloseTo(21 * 1.65);
  });
  it("빈 문단도 한 줄 높이", () => {
    expect(layoutInline([], base, 0, 0, 100, measure).height).toBeCloseTo(14 * 1.65);
  });
});

describe("layoutProse", () => {
  it("제목·목록 표시(•, 1.)·체크(끝난 일은 회색 취소선)·구분선, 블록 사이 4px", () => {
    const doc: PMNode = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [t("제목")] },
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [{ type: "paragraph", content: [t("가")] }] }],
        },
        {
          type: "orderedList",
          content: [{ type: "listItem", content: [{ type: "paragraph", content: [t("나")] }] }],
        },
        { type: "horizontalRule" },
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: true },
              content: [{ type: "paragraph", content: [t("끝")] }],
            },
          ],
        },
      ],
    };
    const r = layoutProse(doc, 300, measure);
    const tx = texts(r.ops);
    expect(tx.find((o) => o.text === "제목")!.font).toContain("700 20px");
    expect(tx.map((o) => o.text)).toEqual(expect.arrayContaining(["•", "1.", "가", "나", "끝"]));
    expect(tx.find((o) => o.text === "끝")).toMatchObject({ strike: true, color: "#8a8983" });
    expect(r.ops.some((o) => o.kind === "rule")).toBe(true);
    expect(r.ops.find((o) => o.kind === "check")).toMatchObject({ checked: true });
    expect(r.height).toBeCloseTo(20 * 1.65 + 3 * 14 * 1.65 + 17 + 4 * 4);
  });
});

const box = (id: string, x: number, y: number, refs?: string[]): TextBox => ({
  id,
  kind: "text",
  x,
  y,
  w: 300,
  z: 1,
  bg: null,
  content: { type: "doc", content: [{ type: "paragraph", content: [t("가상")] }] },
  ...(refs ? { refs: refs.map((item) => ({ item })) } : {}),
});
const input = (doc: NoteDoc, lines: SnapshotInput["lines"] = {}): SnapshotInput => ({
  doc,
  images: {},
  lines,
  title: "메모 보드 · 2026-W43",
  subtitle: "가상",
  goneText: "연결된 항목이 삭제됨",
  moreText: (n) => `연결 ${n}개 더 보기`,
});
const line = (order: string) => ({
  catName: "가상",
  color: "#000",
  dateLabel: "10/22 (목)",
  text: order,
  order,
});

describe("layoutSnapshot", () => {
  it("그림 크기 = 상자 범위 + 여백 24 + 제목 띠 44, 문서 좌표를 옮겨 왼쪽 위 여백에 맞춤", () => {
    const L = layoutSnapshot(input({ v: 1, boxes: [box("a", 100, 200), box("b", 500, 260)] }), measure);
    expect(L.width).toBe(500 + 300 - 100 + 48);
    expect(L.dx).toBe(24 - 100);
    expect(L.dy).toBe(24 + 44 - 200);
    expect(L.boxes.map((b) => b.rect.h)).toEqual([Math.ceil(1 + 8 + 14 * 1.65 + 8 + 1), expect.any(Number)]);
  });
  it("관계선은 배치한 높이로 길을 잡고, 겹친 상자 사이는 그리지 않음", () => {
    const doc: NoteDoc = {
      v: 1,
      boxes: [box("a", 0, 0), box("b", 400, 0), box("c", 10, 10)],
      edges: [
        { id: "e1", from: "a", to: "b", dir: "one", dash: false, label: "" },
        { id: "e2", from: "a", to: "c", dir: "one", dash: false, label: "" },
      ],
    };
    expect(layoutSnapshot(input(doc), measure).edges).toHaveLength(1);
  });
  it("띠: 보드 순서, 지워진 항목은 맨 아래 · 5개 이상이면 4줄 + 더 보기", () => {
    const L = layoutSnapshot(
      input({ v: 1, boxes: [box("a", 0, 0, ["gone", "y", "x"])] }, { x: line("0001"), y: line("0002") }),
      measure,
    );
    const tx = texts(L.boxes[0]!.ops).map((o) => o.text);
    expect(tx.slice(0, 3)).toEqual([
      expect.stringContaining("0001"),
      expect.stringContaining("0002"),
      "연결된 항목이 삭제됨",
    ]);
    const many = layoutSnapshot(
      input(
        { v: 1, boxes: [box("a", 0, 0, ["1", "2", "3", "4", "5", "6"])] },
        Object.fromEntries(["1", "2", "3", "4", "5", "6"].map((k) => [k, line(k)])),
      ),
      measure,
    );
    expect(many.boxes[0]!.stripH).toBe(5 * 24 + 1);
    expect(texts(many.boxes[0]!.ops).some((o) => o.text === "연결 2개 더 보기")).toBe(true);
  });
});

describe("도우미", () => {
  it("ellipsize: 폭에 맞춰 …", () => {
    expect(ellipsize("가나다라마", 100, "400 14px x", measure)).toBe("가나다라마");
    expect(ellipsize("가나다라마", 30, "400 14px x", measure)).toBe("가나다…"); // 4글자 × 7px = 28 ≤ 30
  });
  it("snapshotScale: 긴 변이 8192px를 넘지 않게", () => {
    expect(snapshotScale({ width: 1000, height: 500 }, 2)).toBe(2);
    expect(snapshotScale({ width: 6000, height: 500 }, 2)).toBeCloseTo(8192 / 6000);
  });
  it("snapLines: 칸 열쇠(날짜|업무)에서 업무명·색·날짜·보드 순서, 빈 항목은 뺀다", () => {
    const out = snapLines(
      [
        { id: "c1", name: "가상 정산", color: "c2" },
        { id: "c2", name: "가상 보안", color: "c1" },
      ],
      {
        "2026-10-22|c2": [{ id: "i1", text: "점검" }],
        "2026-10-21|c1": [
          { id: "i2", text: "설계" },
          { id: "i3", text: " " },
        ],
      },
      (k) => `#${k}`,
      (d) => d.slice(5),
    );
    expect(Object.keys(out).sort()).toEqual(["i1", "i2"]);
    expect(out.i2).toMatchObject({ catName: "가상 정산", color: "#c2", dateLabel: "10-21" });
    expect(out.i2!.order < out.i1!.order).toBe(true);
  });
});
