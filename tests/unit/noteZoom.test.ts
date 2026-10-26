// 메모 보드 줌 계산(improve-1026-spec 11절): 단계·휠·화면에 맞춤·커서 기준 스크롤·판 크기 + 설정 기본값.
import { describe, expect, it } from "vitest";
import {
  anchoredScroll,
  canvasSize,
  clampZoom,
  fitZoom,
  stepZoom,
  wheelZoom,
} from "../../src/domain/noteZoom";
import type { NoteBox } from "../../src/domain/note";
import { DEFAULT_SETTINGS, mergeSettings } from "../../src/data/settings";

const box = (x: number, y: number, w: number, h: number): NoteBox => ({
  id: `${x}-${y}`,
  kind: "text",
  x,
  y,
  w,
  h,
  z: 1,
  bg: null,
  content: { type: "doc", content: [] },
});

describe("배율", () => {
  it("25~200%로 자르고, [+]/[−]는 다음 단계(사이 값이면 가까운 쪽)", () => {
    expect([clampZoom(0.1), clampZoom(3), clampZoom(0.8333)]).toEqual([0.25, 2, 0.83]);
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(0.83, -1)).toBe(0.8);
    expect(stepZoom(0.83, 1)).toBe(0.9);
    expect(stepZoom(2, 1)).toBe(2);
    expect(stepZoom(0.25, -1)).toBe(0.25);
  });

  it("휠: 위로 굴리면 확대, 아래로 축소, 범위 안", () => {
    expect(wheelZoom(1, -100)).toBeGreaterThan(1);
    expect(wheelZoom(1, 100)).toBeLessThan(1);
    expect(wheelZoom(0.26, 5000)).toBe(0.25);
  });

  it("화면에 맞춤: 모든 상자가 보이게, 100%보다 키우지 않음, 상자 없으면 100%", () => {
    expect(fitZoom([], 800, 600)).toBe(1);
    expect(fitZoom([box(0, 0, 300, 100)], 800, 600)).toBe(1);
    // 폭 1576 + 여백 24 = 1600 → 800/1600 = 0.5
    expect(fitZoom([box(0, 0, 320, 100), box(1256, 300, 320, 100)], 800, 600)).toBe(0.5);
  });

  it("배율을 바꿔도 커서 아래 문서 위치는 그대로", () => {
    // 100%에서 스크롤 200, 커서 100 → 문서 x 300. 200%면 600 - 100 = 500
    expect(anchoredScroll({ left: 200, top: 0 }, { x: 100, y: 50 }, 1, 2)).toEqual({ left: 500, top: 50 });
    expect(anchoredScroll({ left: 0, top: 0 }, { x: 100, y: 50 }, 1, 0.5)).toEqual({ left: 0, top: 0 });
  });

  it("판 크기: 상자 범위 + 여유와 '보이는 영역 ÷ 배율' 중 큰 쪽", () => {
    const room = { right: 40, bottom: 160 };
    expect(canvasSize([box(0, 0, 320, 100)], { w: 800, h: 300 }, 1, room)).toEqual({ w: 800, h: 300 });
    expect(canvasSize([box(0, 0, 320, 100)], { w: 800, h: 300 }, 0.5, room)).toEqual({ w: 1600, h: 600 });
    expect(canvasSize([box(900, 0, 320, 100)], { w: 800, h: 300 }, 1, room)).toEqual({ w: 1260, h: 300 });
  });

  it("설정: 배율·미니맵·뷰·메모 폭 기본값과 범위 밖 값 되돌리기", () => {
    expect(DEFAULT_SETTINGS.ui).toMatchObject({
      noteZoom: 1,
      noteMinimap: true,
      viewMode: "week",
      todaySplit: 0.42,
    });
    const bad = mergeSettings(DEFAULT_SETTINGS, { ui: { noteZoom: 9, viewMode: "month", todaySplit: 0.95 } });
    expect(bad.ui).toMatchObject({ noteZoom: 1, viewMode: "week", todaySplit: 0.42 });
    expect(mergeSettings(DEFAULT_SETTINGS, { ui: { noteZoom: 0.5, viewMode: "today" } }).ui).toMatchObject({
      noteZoom: 0.5,
      viewMode: "today",
    });
  });
});
