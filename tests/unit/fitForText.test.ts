// 온라인 공간 그림 줄이기(docs/v2-design/96): 글씨가 읽히는 폭·화소 기준 — 로컬(긴 변 1600)과 비교
import { describe, expect, it } from "vitest";
import { fitForText, fitWithin, ONLINE_IMAGE_MAX_PIXELS } from "../../src/domain/note";

describe("온라인 그림 크기(fitForText)", () => {
  it("작은 그림은 그대로", () => {
    expect(fitForText(1280, 720)).toEqual({ width: 1280, height: 720 });
  });
  it("넓은 고해상도 화면 캡처는 폭 1600(로컬과 같음)", () => {
    expect(fitForText(2880, 1800)).toEqual({ width: 1600, height: 1000 });
    expect(fitWithin(2880, 1800)).toEqual({ width: 1600, height: 1000 });
  });
  it("세로로 긴 전체 페이지 캡처는 폭을 지켜 글씨가 남는다(로컬 긴 변 1600은 480폭)", () => {
    const online = fitForText(1200, 4000);
    expect(fitWithin(1200, 4000)).toEqual({ width: 480, height: 1600 });
    expect(online.width).toBeGreaterThan(900);
    expect(online.width * online.height).toBeLessThanOrEqual(ONLINE_IMAGE_MAX_PIXELS + 4000);
  });
  it("아주 긴 그림도 캔버스 한계(긴 변 8192) 안", () => {
    const r = fitForText(800, 30000);
    expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(8192);
  });
  it("비율을 지킨다", () => {
    const r = fitForText(4000, 3000);
    expect(r.width / r.height).toBeCloseTo(4 / 3, 2);
  });
});
