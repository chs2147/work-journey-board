import { describe, expect, it } from "vitest";
import {
  deleteAt,
  deleteRange,
  moveRows,
  snapGap,
  indentAt,
  moveItem,
  normalizeCell,
  outdentAt,
  parsePastedLines,
} from "../../src/domain/items";
import type { ItemDraft } from "../../src/domain/types";

const d = (id: string, depth: 0 | 1 = 0, text = id): ItemDraft => ({ id, depth, text });
const ids = (xs: ItemDraft[]) => xs.map((x) => `${x.id}${x.depth ? "'" : ""}`).join(" ");

describe("셀 정리 (data-spec 2절)", () => {
  it("빈 항목 제거, 첫 항목은 본 항목", () => {
    expect(ids(normalizeCell([d("a", 0, "  "), d("b", 1), d("c", 1)]))).toBe("b c'");
  });
});

describe("붙여넣기 분해 (overview 10-3)", () => {
  it("한 줄은 그대로(null)", () => {
    expect(parsePastedLines("한 줄 메모")).toBeNull();
    expect(parsePastedLines("한 줄\n\n")).toBeNull();
  });

  it("기호 제거, 들여쓴 줄은 세부 항목", () => {
    const text =
      "- 요구사항 리뷰\n  · 조건 3건 확정\n• 설계안 작성\n\t* 시간대 협의\n1. 배포 일정\n2) 점검 입회\r\n○ 회의";
    expect(parsePastedLines(text)).toEqual([
      { depth: 0, text: "요구사항 리뷰" },
      { depth: 1, text: "조건 3건 확정" },
      { depth: 0, text: "설계안 작성" },
      { depth: 1, text: "시간대 협의" },
      { depth: 0, text: "배포 일정" },
      { depth: 0, text: "점검 입회" },
      { depth: 0, text: "회의" },
    ]);
  });

  it("첫 줄이 들여써져 있어도 본 항목", () => {
    expect(parsePastedLines("  가\n  나")![0]).toEqual({ depth: 0, text: "가" });
  });
});

describe("깊이·순서 (overview 10-3)", () => {
  it("Tab: 첫 항목은 세부로 못 감, Shift+Tab: 본 항목으로", () => {
    const xs = [d("a"), d("b")];
    expect(ids(indentAt(xs, 0))).toBe("a b");
    expect(ids(indentAt(xs, 1))).toBe("a b'");
    expect(ids(outdentAt(indentAt(xs, 1), 1))).toBe("a b");
  });

  it("본 항목은 세부 항목을 데리고 이웃 블록과 자리를 바꾼다", () => {
    const xs = [d("a"), d("a1", 1), d("b"), d("b1", 1), d("b2", 1), d("c")];
    expect(moveItem(xs, 2, -1)).toEqual({
      items: [d("b"), d("b1", 1), d("b2", 1), d("a"), d("a1", 1), d("c")],
      index: 0,
    });
    const down = moveItem(xs, 0, 1);
    expect(ids(down.items)).toBe("b b1' b2' a a1' c");
    expect(down.index).toBe(3);
  });

  it("맨 위·맨 아래에서는 움직이지 않음", () => {
    const xs = [d("a"), d("b")];
    expect(moveItem(xs, 0, -1).items).toBe(xs);
    expect(moveItem(xs, 1, 1).items).toBe(xs);
  });

  it("세부 항목은 한 칸씩, 첫 자리로는 못 감", () => {
    const xs = [d("a"), d("a1", 1), d("b")];
    expect(moveItem(xs, 1, -1).items).toBe(xs);
    expect(ids(moveItem(xs, 1, 1).items)).toBe("a b a1'");
  });
});

describe("행 삭제 범위 (improve-1026v2-spec 1·2절)", () => {
  const xs = [d("a"), d("a1", 1), d("a2", 1), d("b"), d("b1", 1), d("c")];

  it("본 항목 = 딸린 세부 항목까지 묶음째, 세부 항목 = 그 항목만", () => {
    expect(deleteRange(xs, 0)).toEqual([0, 3]);
    expect(deleteRange(xs, 3)).toEqual([3, 5]);
    expect(deleteRange(xs, 5)).toEqual([5, 6]);
    expect(deleteRange(xs, 1)).toEqual([1, 2]);
    expect(deleteRange(xs, 4)).toEqual([4, 5]);
  });

  it("지운 결과·지운 줄·시작 위치", () => {
    const r = deleteAt(xs, 3);
    expect(ids(r.items)).toBe("a a1' a2' c");
    expect(ids(r.removed)).toBe("b b1'");
    expect(r.start).toBe(3);
    expect(ids(deleteAt(xs, 2).items)).toBe("a a1' b b1' c");
    expect(ids(deleteAt(xs, 0).items)).toBe("b b1' c");
    expect(deleteAt([d("a")], 0).items).toEqual([]);
  });

  it("본 항목을 지우면 세부 항목도 함께라 남은 첫 항목은 늘 본 항목", () => {
    expect(deleteAt([d("a"), d("b", 1)], 0).items).toEqual([]);
    expect(ids(deleteAt([d("a"), d("a1", 1), d("b", 1)], 0).items)).toBe("");
  });
});

describe("행 끌어서 옮기기 (improve-1026v2-spec 3절)", () => {
  const xs = [d("a"), d("a1", 1), d("a2", 1), d("b"), d("b1", 1), d("c")];

  it("본 항목 묶음은 세부 항목 사이에 끼지 않고 묶음 끝으로 밀린다", () => {
    expect(snapGap(xs, 4, true)).toBe(5);
    expect(snapGap(xs, 1, true)).toBe(3);
    expect(snapGap(xs, 4, false)).toBe(4);
    expect(snapGap(xs, 99, true)).toBe(6);
  });

  it("같은 칸: 본 항목은 세부 항목과 함께, 제자리면 null", () => {
    const r = moveRows(xs, 0, null, 6)!;
    expect(ids(r.src)).toBe("b b1' c a a1' a2'");
    expect(r.at).toBe(3);
    expect(ids(moveRows(xs, 3, null, 0)!.src)).toBe("b b1' a a1' a2' c");
    expect(moveRows(xs, 0, null, 0)).toBeNull();
    expect(moveRows(xs, 0, null, 2)).toBeNull(); // 자기 세부 항목 사이 = 제자리
    expect(moveRows(xs, 3, null, 5)).toBeNull();
  });

  it("같은 칸: 세부 항목은 혼자, 놓은 자리 위 항목에 딸리고 맨 위면 본 항목", () => {
    expect(ids(moveRows(xs, 1, null, 5)!.src)).toBe("a a2' b b1' a1' c");
    expect(ids(moveRows(xs, 4, null, 0)!.src)).toBe("b1 a a1' a2' b c");
    expect(ids(moveRows(xs, 4, null, 6)!.src)).toBe("a a1' a2' b c b1'");
  });

  it("다른 칸: 원래 칸에서 빠지고 받는 칸 틈에 들어간다", () => {
    const dst = [d("x"), d("x1", 1), d("y")];
    const r = moveRows(xs, 3, dst, 1)!;
    expect(ids(r.src)).toBe("a a1' a2' c");
    expect(ids(r.dst)).toBe("x x1' b b1' y");
    expect(r.at).toBe(2);
    expect(ids(r.moved)).toBe("b b1'");
    const sub = moveRows(xs, 1, dst, 1)!;
    expect(ids(sub.dst)).toBe("x a1' x1' y");
    expect(ids(moveRows(xs, 1, dst, 0)!.dst)).toBe("a1 x x1' y");
    expect(ids(moveRows(xs, 1, [], 0)!.dst)).toBe("a1");
    expect(ids(moveRows(xs, 0, [], 0)!.src)).toBe("b b1' c");
  });
});
