// 개선 v23(improve-v23-spec): 열 순서 병합·옮기기, 자유 배치 새 자리, 아이콘 추천, 설정 검사, 아이콘 세트.
import { describe, expect, it } from "vitest";
import {
  DONE,
  TODO,
  freeSpot,
  mergeColumnOrder,
  moveColumn,
  suggestIcon,
  defaultColumnIcon,
} from "../../src/domain/kanban";
import { DEFAULT_SETTINGS, mergeSettings, validKanbanColumns } from "../../src/data/settings";
import { SECTION_ICONS } from "../../src/shared/sectionIcons";

describe("열 순서(2절)", () => {
  it("저장 순서 없으면 TODO · 섹션 · DONE", () => {
    expect(mergeColumnOrder([], ["a", "b"])).toEqual([TODO, "a", "b", DONE]);
  });
  it("TODO·DONE 자리 유지, 새 섹션은 DONE 앞, 지운 섹션은 빠짐", () => {
    expect(mergeColumnOrder(["a", DONE, TODO, "gone"], ["a", "n"])).toEqual(["a", "n", DONE, TODO]);
    expect(mergeColumnOrder(["a", TODO, DONE], ["a", "n"])).toEqual(["a", TODO, "n", DONE]);
  });
  it("빠진 TODO·DONE은 맨 앞·맨 끝", () => {
    expect(mergeColumnOrder(["a"], ["a"])).toEqual([TODO, "a", DONE]);
  });
  it("옮기기", () => {
    const o = [TODO, "a", "b", DONE];
    expect(moveColumn(o, TODO, 3)).toEqual(["a", "b", TODO, DONE]);
    expect(moveColumn(o, DONE, 0)).toEqual([DONE, TODO, "a", "b"]);
    expect(moveColumn(o, "a", 1)).toEqual(o);
  });
});

describe("자유 배치 새 자리(3절)", () => {
  const view = { x: 0, y: 0, w: 1120, h: 700 };
  it("빈자리가 있으면 보이는 영역 안", () => {
    const r = freeSpot([{ x: 0, y: 0, w: 400, h: 600 }], view);
    expect(r.x).toBeGreaterThanOrEqual(400);
    expect(r.x + r.w).toBeLessThanOrEqual(1120);
  });
  it("꽉 차 있으면 맨 아래 왼쪽", () => {
    const r = freeSpot(
      [
        { x: 0, y: 0, w: 552, h: 600 },
        { x: 568, y: 0, w: 552, h: 600 },
      ],
      view,
    );
    expect(r).toMatchObject({ x: 0 });
    expect(r.y).toBeGreaterThanOrEqual(600);
  });
});

describe("아이콘(8절)", () => {
  it("기본·이름 추천", () => {
    expect(defaultColumnIcon(TODO)).toBe("clipboard");
    expect(defaultColumnIcon(DONE)).toBe("check-mark-button");
    expect(suggestIcon("코드 리뷰")).toBe("eyes");
    expect(suggestIcon("보류")).toBe("pause-button");
    expect(suggestIcon("기타")).toBe("pushpin");
  });
  it("세트 36개·id 겹침 없음·추천 id는 모두 세트 안", () => {
    const ids = SECTION_ICONS.map((i) => i.id);
    expect(ids).toHaveLength(36);
    expect(new Set(ids).size).toBe(36);
    for (const n of [
      "검토",
      "보류",
      "진행",
      "테스트",
      "배포",
      "아이디어",
      "조사",
      "긴급",
      "회의",
      "협업",
      "일정",
      "x",
    ])
      expect(ids).toContain(suggestIcon(n));
    expect(SECTION_ICONS.every((i) => !/https?:/.test(i.body))).toBe(true);
  });
  it("설정 검사·통째 교체 저장", () => {
    expect(validKanbanColumns({ order: ["a", "a", 3, ""], icons: { a: "rocket", b: "../x" } })).toEqual({
      order: ["a"],
      icons: { a: "rocket" },
    });
    const a = mergeSettings(DEFAULT_SETTINGS, {
      ui: { kanbanColumns: { order: [DONE, TODO], icons: { s1: "eyes" } } },
    });
    const b = mergeSettings(JSON.parse(JSON.stringify(a)), {});
    expect(b.ui.kanbanColumns).toEqual({ order: [DONE, TODO], icons: { s1: "eyes" } });
    const c = mergeSettings(b, { ui: { kanbanColumns: { order: [TODO, DONE], icons: {} } } });
    expect(c.ui.kanbanColumns.icons).toEqual({});
  });
});
