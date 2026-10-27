// 행을 메모 판에 놓을 때(improve-1027v3-spec 3절): 상자 둘레 16px = 그 상자, 빈 곳 새 상자 자리는 겹치면 아래로 비킴.
import { describe, expect, it } from "vitest";
import { boxAtPoint, freeSpot, type NoteDoc, type TextBox } from "../../src/domain/note";

const box = (id: string, x: number, y: number, w = 200, h = 80, z = 1): TextBox => ({
  id,
  kind: "text",
  x,
  y,
  w,
  h,
  z,
  bg: null,
  content: { type: "doc", content: [] },
});
const doc = (...boxes: TextBox[]): NoteDoc => ({ v: 1, boxes });

describe("boxAtPoint", () => {
  const d = doc(box("a", 100, 100), box("b", 150, 120, 200, 80, 2));
  it("안·둘레 16px 안은 그 상자, 그 밖은 없음", () => {
    expect(boxAtPoint(d, { x: 110, y: 110 })?.id).toBe("a");
    expect(boxAtPoint(d, { x: 90, y: 110 })?.id).toBe("a"); // 왼쪽 10px
    expect(boxAtPoint(d, { x: 200, y: 195 })?.id).toBe("b"); // 아래쪽 안
    expect(boxAtPoint(d, { x: 80, y: 110 })).toBeUndefined(); // 20px 밖
  });
  it("겹치면 위에 그려진 상자, 대기 상자는 뺀다", () => {
    expect(boxAtPoint(d, { x: 170, y: 150 })?.id).toBe("b");
    expect(boxAtPoint(d, { x: 170, y: 150 }, 16, "b")?.id).toBe("a");
  });
});

describe("freeSpot", () => {
  it("겹치지 않으면 그대로", () => {
    expect(freeSpot(doc(box("a", 0, 0)), { x: 600, y: 0 })).toEqual({ x: 600, y: 0 });
  });
  it("겹치면 그 상자 아래(간격 16, 8px 칸)로, 아래 상자와도 겹치면 한 번 더", () => {
    const d = doc(box("a", 100, 100), box("b", 100, 200));
    expect(freeSpot(d, { x: 120, y: 110 })).toEqual({ x: 120, y: 296 });
  });
});
