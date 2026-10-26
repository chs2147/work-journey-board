// 메모 보드 줌·패닝 계산(improve-1026-spec 11절). 순수 함수만 — 화면은 이 값으로 판을 CSS scale로 그린다.
import type { NoteBox } from "./note";

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 2;
/** `80% ▾` 목록·[−][+] 단계 */
export const ZOOM_STEPS = [0.25, 0.5, 0.67, 0.8, 0.9, 1, 1.25, 1.5, 2] as const;
/** [화면에 맞춤] 여백(문서 px) */
export const FIT_PAD = 24;

export const clampZoom = (z: number) => Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 100) / 100;

/** [+]/[−]·Ctrl+= / Ctrl+-: 지금 값에서 다음 단계(사이 값이면 가까운 쪽 단계로) */
export function stepZoom(z: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((s) => s > z + 0.001) ?? ZOOM_MAX;
  return [...ZOOM_STEPS].reverse().find((s) => s < z - 0.001) ?? ZOOM_MIN;
}

/** Ctrl+휠·두 손가락 벌리기: 휠 양만큼 연속으로(한 칸 ≈ 14%) */
export const wheelZoom = (z: number, deltaY: number) => clampZoom(z * Math.pow(1.0015, -deltaY));

/** 상자들이 차지하는 범위(문서 좌표, 왼쪽 위 0,0부터) */
export function contentExtent(boxes: readonly NoteBox[]): { w: number; h: number } {
  return boxes.reduce((m, b) => ({ w: Math.max(m.w, b.x + b.w), h: Math.max(m.h, b.y + (b.h ?? 48)) }), {
    w: 0,
    h: 0,
  });
}

/** [화면에 맞춤]·Ctrl+1: 모든 상자가 보이는 배율(100%보다 키우지는 않음). 상자가 없으면 100% */
export function fitZoom(boxes: readonly NoteBox[], viewW: number, viewH: number): number {
  const { w, h } = contentExtent(boxes);
  if (w === 0 || h === 0 || viewW <= 0 || viewH <= 0) return 1;
  return clampZoom(Math.min(1, viewW / (w + FIT_PAD), viewH / (h + FIT_PAD)));
}

/**
 * 배율을 바꿔도 화면의 한 점(커서 또는 가운데) 아래 문서 위치가 그대로 있게 하는 스크롤 위치.
 * at = 보이는 영역 안의 점(px), scroll = 지금 스크롤(px)
 */
export function anchoredScroll(
  scroll: { left: number; top: number },
  at: { x: number; y: number },
  from: number,
  to: number,
): { left: number; top: number } {
  const docX = (scroll.left + at.x) / from;
  const docY = (scroll.top + at.y) / from;
  return { left: Math.max(0, docX * to - at.x), top: Math.max(0, docY * to - at.y) };
}

/** 판 크기(문서 px): 상자 범위 + 여유, 그리고 보이는 영역을 배율로 나눈 크기 중 큰 쪽 — 축소해도 빈 곳을 누를 수 있게 */
export function canvasSize(
  boxes: readonly NoteBox[],
  view: { w: number; h: number },
  zoom: number,
  room: { right: number; bottom: number },
): { w: number; h: number } {
  const { w, h } = contentExtent(boxes);
  return {
    w: Math.max(w + room.right, Math.floor(view.w / zoom)),
    h: Math.max(h + room.bottom, Math.floor(view.h / zoom)),
  };
}
