// 메모 관계선의 모양(note-relation-spec 1-1): 두 상자 사이 **둥근 모서리 꺾은선**(직각, 2026-10-27 사용자 결정).
// 순수 함수만 — 선은 저장하지 않고 늘 지금 상자 자리(x·y·w·잰 높이)에서 계산한다.
import type { NoteBox } from "./note";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface EdgeRoute {
  /** 꺾이는 점들(처음 = 출발 상자 가장자리, 끝 = 도착 상자 가장자리) */
  points: Point[];
  /** SVG path(모서리 둥글게) */
  d: string;
  /** 이름표·도구 막대 자리(선 길이의 가운데) */
  mid: Point;
}

/** 높이를 아직 재지 못한 상자의 기본 높이 */
export const BOX_FALLBACK_H = 48;
/** 끝을 테두리에서 띄우는 거리(화살촉이 상자 밑으로 들어가지 않게) */
export const EDGE_GAP = 4;
/** 모서리 반지름 */
export const EDGE_RADIUS = 10;
/** 두 상자가 이만큼 이상 같은 높이(너비)에 겹치면 꺾지 않고 곧게 */
const STRAIGHT_OVERLAP = 12;

export const rectOf = (b: NoteBox): Rect => ({ x: b.x, y: b.y, w: b.w, h: b.h ?? BOX_FALLBACK_H });

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * 경로: 두 상자가 가로로 더 떨어져 있으면 옆면 → 옆면(가로-세로-가로), 세로로 더 떨어져 있으면 아랫면/윗면(세로-가로-세로).
 * 마주 보는 면이 충분히 겹치면 한 줄로 곧게. 두 상자가 겹치면(나갈 틈이 없음) null.
 * b가 크기 0인 점이면(끌어서 잇는 중의 커서) 그 점까지 이어진다.
 */
export function routeEdge(a: Rect, b: Rect, gap = EDGE_GAP, radius = EDGE_RADIUS): EdgeRoute | null {
  const sepX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const sepY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  if (sepX <= 0 && sepY <= 0) return null;
  const point = b.w === 0 && b.h === 0;
  let points: Point[];
  if (sepX >= sepY) {
    const right = b.x >= a.x + a.w;
    const g = Math.min(gap, sepX / 3);
    const x1 = right ? a.x + a.w + g : a.x - g;
    const x2 = point ? b.x : right ? b.x - g : b.x + b.w + g;
    const lo = Math.max(a.y, b.y);
    const hi = Math.min(a.y + a.h, b.y + b.h);
    if (point ? b.y >= a.y && b.y <= a.y + a.h : hi - lo >= STRAIGHT_OVERLAP) {
      const y = point ? b.y : (lo + hi) / 2;
      points = [
        { x: x1, y },
        { x: x2, y },
      ];
    } else {
      const y1 = a.y + a.h / 2;
      const y2 = b.y + b.h / 2;
      const mx = (x1 + x2) / 2;
      points = [
        { x: x1, y: y1 },
        { x: mx, y: y1 },
        { x: mx, y: y2 },
        { x: x2, y: y2 },
      ];
    }
  } else {
    const down = b.y >= a.y + a.h;
    const g = Math.min(gap, sepY / 3);
    const y1 = down ? a.y + a.h + g : a.y - g;
    const y2 = point ? b.y : down ? b.y - g : b.y + b.h + g;
    const lo = Math.max(a.x, b.x);
    const hi = Math.min(a.x + a.w, b.x + b.w);
    if (point ? b.x >= a.x && b.x <= a.x + a.w : hi - lo >= STRAIGHT_OVERLAP) {
      const x = point ? b.x : (lo + hi) / 2;
      points = [
        { x, y: y1 },
        { x, y: y2 },
      ];
    } else {
      const x1 = a.x + a.w / 2;
      const x2 = b.x + b.w / 2;
      const my = (y1 + y2) / 2;
      points = [
        { x: x1, y: y1 },
        { x: x1, y: my },
        { x: x2, y: my },
        { x: x2, y: y2 },
      ];
    }
  }
  points = points.map((p) => ({ x: round(p.x), y: round(p.y) }));
  return { points, d: roundedPath(points, radius), mid: midPoint(points) };
}

/** 꺾인 점마다 반지름 r(이웃 선분 절반을 넘지 않게)로 둥글린 path */
export function roundedPath(points: Point[], radius = EDGE_RADIUS): string {
  if (points.length < 2) return "";
  const [first] = points;
  const parts = [`M${first!.x} ${first!.y}`];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i - 1]!;
    const c = points[i]!;
    const n = points[i + 1]!;
    const lin = Math.hypot(c.x - p.x, c.y - p.y);
    const lout = Math.hypot(n.x - c.x, n.y - c.y);
    const r = Math.min(radius, lin / 2, lout / 2);
    if (r < 0.5) {
      parts.push(`L${c.x} ${c.y}`);
      continue;
    }
    const ax = round(c.x - ((c.x - p.x) / lin) * r);
    const ay = round(c.y - ((c.y - p.y) / lin) * r);
    const bx = round(c.x + ((n.x - c.x) / lout) * r);
    const by = round(c.y + ((n.y - c.y) / lout) * r);
    parts.push(`L${ax} ${ay}`, `Q${c.x} ${c.y} ${bx} ${by}`);
  }
  const last = points.at(-1)!;
  parts.push(`L${last.x} ${last.y}`);
  return parts.join(" ");
}

/** 꺾은선 길이의 가운데 점 */
export function midPoint(points: Point[]): Point {
  const lens = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
  let half = lens.reduce((s, l) => s + l, 0) / 2;
  for (let i = 0; i < lens.length; i++) {
    const l = lens[i]!;
    if (half <= l || i === lens.length - 1) {
      const k = l ? Math.min(1, half / l) : 0;
      const a = points[i]!;
      const b = points[i + 1]!;
      return { x: round(a.x + (b.x - a.x) * k), y: round(a.y + (b.y - a.y) * k) };
    }
    half -= l;
  }
  return points[0] ?? { x: 0, y: 0 };
}

/** 키보드로 잇기의 후보 순서(2-2): 가운데끼리 가까운 순 */
export function nearestBoxes(from: NoteBox, boxes: readonly NoteBox[]): NoteBox[] {
  const c = (b: NoteBox) => {
    const r = rectOf(b);
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  };
  const o = c(from);
  return boxes
    .filter((b) => b.id !== from.id)
    .map((b) => ({ b, d: Math.hypot(c(b).x - o.x, c(b).y - o.y) }))
    .sort((p, q) => p.d - q.d)
    .map((p) => p.b);
}
