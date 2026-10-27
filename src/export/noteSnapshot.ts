// 메모 보드 스냅샷(improve-1027v3-spec 1절): 메모 문서 JSON + 이미지 → Canvas 2D 그림(PNG).
// 화면을 캡처하지 않고 문서로 직접 그린다 — 화면에 없는 주(엑셀)도 그릴 수 있고, CSP(외부·data 글꼴)와 부딪히지 않는다.
// 배치(layoutSnapshot)는 글자 폭 재기 함수만 받는 순수 계산, 그리기(drawSnapshot)만 캔버스를 쓴다. 외부 통신 없음.
import { readingOrder, type NoteBox, type NoteDoc, type PMNode } from "../domain/note";
import { midPoint, routeEdge, type Point, type Rect } from "../domain/noteEdge";

/** 항상 라이트 테마(인쇄·문서용) — tokens.css 라이트 값과 같게 */
export const SNAP_THEME = {
  page: "#ffffff",
  canvas: "#fbfaf7",
  card: "#ffffff",
  sub: "#f1efe8",
  line: "#d3d1c7",
  lineStrong: "#b4b2a9",
  text1: "#2c2c2a",
  text2: "#5f5e5a",
  text3: "#8a8983",
  accent: "#185fa5",
  mark: "#fff1bf",
  bg: { yellow: "#fff6c9", blue: "#e6eefb", green: "#e3f1ea", pink: "#fbe4ec" },
  color: { gray: "#5f5e5a", orange: "#a8471a", blue: "#1f5fa8", green: "#0f6e46", red: "#b3261e" },
  tone: ["#2a78d6", "#eb6834", "#1baf7a", "#c98500", "#d55181", "#6250d6"],
} as const;

export const SNAP_FONT = '"Pretendard Variable", Pretendard, "Malgun Gothic", sans-serif';
const PAD = 24;
const HEAD_H = 44;
const LINE = 1.65;
const STRIP_LINE = 24;
const FOLD_AT = 5;
const FOLD_SHOW = 4;
const SIZES: Record<string, number> = { s: 12, m: 14, l: 17, xl: 21 };

/** 연결 띠 한 줄(보드 항목에서 만든 글) — 없는 항목은 "삭제됨" */
export interface SnapLine {
  catName: string;
  /** 업무 색(hex) */
  color: string;
  dateLabel: string;
  text: string;
  /** 보드 순서(업무 → 날짜 → 칸 안) */
  order: string;
}

export interface SnapImage {
  mime: string;
  data: string;
  width: number;
  height: number;
}

export interface SnapshotInput {
  doc: NoteDoc;
  images: Record<string, SnapImage>;
  /** 항목 id → 띠 줄 */
  lines: Record<string, SnapLine>;
  title: string;
  subtitle: string;
  /** 지워진 항목 줄 글 */
  goneText: string;
  /** 접힌 줄 글(n = 더 있는 수) */
  moreText(n: number): string;
}

export type Measure = (text: string, font: string) => number;

// ── 배치 ───────────────────────────────────────────

/** 그릴 글 조각 하나(상자 안쪽 좌표, y = 줄 가운데) */
export interface TextOp {
  kind: "text";
  x: number;
  y: number;
  w: number;
  text: string;
  font: string;
  size: number;
  color: string;
  underline: boolean;
  strike: boolean;
  highlight: boolean;
}
export type DrawOp =
  | TextOp
  | { kind: "rule"; x: number; y: number; w: number }
  | { kind: "check"; x: number; y: number; checked: boolean }
  | { kind: "dot"; x: number; y: number; color: string };

interface Style {
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  highlight: boolean;
  color: string;
}

export const fontOf = (s: { size: number; bold?: boolean; italic?: boolean }) =>
  `${s.italic ? "italic " : ""}${s.bold ? 700 : 400} ${s.size}px ${SNAP_FONT}`;

function markStyle(base: Style, marks: PMNode["marks"]): Style {
  const s = { ...base };
  for (const m of marks ?? []) {
    if (m.type === "bold") s.bold = true;
    else if (m.type === "italic") s.italic = true;
    else if (m.type === "underline") s.underline = true;
    else if (m.type === "strike") s.strike = true;
    else if (m.type === "highlight") s.highlight = true;
    else if (m.type === "fontSize") s.size = SIZES[String(m.attrs?.size)] ?? s.size;
    else if (m.type === "textColor")
      s.color = SNAP_THEME.color[String(m.attrs?.color) as keyof typeof SNAP_THEME.color] ?? s.color;
    else if (m.type === "link") {
      s.underline = true;
      s.color = SNAP_THEME.accent;
    }
  }
  return s;
}

/** 줄바꿈 단위: 빈칸 덩어리 / 빈칸 아닌 덩어리(한글도 낱말 단위 — 화면의 word-break: keep-all과 같게) */
const tokens = (t: string) => t.match(/\s+|[^\s]+/g) ?? [];

/** 문단 하나(글 조각들)를 폭 width에 맞춰 줄로 나눈다 → 그릴 조각과 높이 */
export function layoutInline(
  nodes: PMNode[],
  base: Style,
  x0: number,
  y0: number,
  width: number,
  measure: Measure,
): { ops: TextOp[]; height: number } {
  const ops: TextOp[] = [];
  let y = y0;
  let line: { op: TextOp; size: number }[] = [];
  let x = 0;
  const flush = () => {
    // 줄 끝 빈칸은 버린다
    while (line.length && !line[line.length - 1]!.op.text.trim()) line.pop();
    const h = Math.max(base.size, ...line.map((l) => l.size)) * LINE;
    for (const l of line) ops.push({ ...l.op, y: y + h / 2 });
    y += h;
    line = [];
    x = 0;
  };
  const push = (text: string, s: Style) => {
    const font = fontOf(s);
    const w = measure(text, font);
    line.push({
      op: { kind: "text", x: x0 + x, y: 0, w, text, font, size: s.size, color: s.color, ...pick(s) },
      size: s.size,
    });
    x += w;
  };
  for (const n of nodes) {
    if (n.type === "hardBreak") {
      flush();
      continue;
    }
    if (n.type !== "text" || !n.text) continue;
    const s = markStyle(base, n.marks);
    for (const tk of tokens(n.text)) {
      const font = fontOf(s);
      const w = measure(tk, font);
      if (!tk.trim()) {
        if (x > 0) push(tk, s);
        continue;
      }
      if (x > 0 && x + w > width) flush();
      if (w <= width) {
        push(tk, s);
        continue;
      }
      // 한 덩어리가 줄보다 길면 글자 단위로 자른다
      let part = "";
      for (const ch of tk) {
        if (x + measure(part + ch, font) > width && (part || x > 0)) {
          if (part) push(part, s);
          flush();
          part = ch;
        } else part += ch;
      }
      if (part) push(part, s);
    }
  }
  if (line.length || ops.length === 0 || y === y0) flush();
  return { ops, height: y - y0 };
}

const pick = (s: Style) => ({ underline: s.underline, strike: s.strike, highlight: s.highlight });

/** 글 상자 본문(ProseMirror 문서) 배치 — 블록 간격 4px, 목록 들여쓰기 1.4em, 체크 목록 상자 13px */
export function layoutProse(doc: PMNode, width: number, measure: Measure): { ops: DrawOp[]; height: number } {
  const ops: DrawOp[] = [];
  const base: Style = {
    size: 14,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    highlight: false,
    color: SNAP_THEME.text1,
  };
  const blocks = (nodes: PMNode[], x: number, y: number, w: number, st: Style, gap: number): number => {
    let cy = y;
    nodes.forEach((n, i) => {
      if (i > 0) cy += gap;
      cy = block(n, x, cy, w, st);
    });
    return cy;
  };
  const block = (n: PMNode, x: number, y: number, w: number, st: Style): number => {
    switch (n.type) {
      case "paragraph":
      case "heading": {
        const s = n.type === "heading" ? { ...st, size: n.attrs?.level === 1 ? 20 : 17, bold: true } : st;
        const r = layoutInline(n.content ?? [], s, x, y, w, measure);
        ops.push(...r.ops);
        return y + r.height;
      }
      case "horizontalRule":
        ops.push({ kind: "rule", x, y: y + 8, w });
        return y + 17;
      case "bulletList":
      case "orderedList": {
        const indent = 14 * 1.4;
        let cy = y;
        const start = typeof n.attrs?.start === "number" ? n.attrs.start : 1;
        (n.content ?? []).forEach((li, i) => {
          const marker = n.type === "bulletList" ? "•" : `${start + i}.`;
          const font = fontOf(st);
          const mw = measure(marker, font);
          ops.push({
            kind: "text",
            x: x + indent - mw - 6,
            y: cy + (st.size * LINE) / 2,
            w: mw,
            text: marker,
            font,
            size: st.size,
            color: st.color,
            underline: false,
            strike: false,
            highlight: false,
          });
          cy = blocks(li.content ?? [], x + indent, cy, w - indent, st, 0);
        });
        return cy;
      }
      case "taskList": {
        let cy = y;
        for (const li of n.content ?? []) {
          const checked = !!li.attrs?.checked;
          ops.push({ kind: "check", x, y: cy + 3, checked });
          const s = checked ? { ...st, color: SNAP_THEME.text3, strike: true } : st;
          cy = blocks(li.content ?? [], x + 19, cy, w - 19, s, 0);
        }
        return cy;
      }
      default:
        return blocks(n.content ?? [], x, y, w, st, 0);
    }
  };
  const end = blocks(doc.content ?? [], 0, 0, width, base, 4);
  return { ops, height: Math.max(end, 14 * LINE) };
}

/** 글을 폭에 맞춰 자르고 … */
export function ellipsize(text: string, width: number, font: string, measure: Measure): string {
  if (measure(text, font) <= width) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(`${text.slice(0, mid)}…`, font) <= width) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}

/** 배치된 상자 하나 — 그릴 것은 상자 안쪽 좌표 */
export interface BoxLayout {
  box: NoteBox;
  rect: Rect;
  bg: string;
  stripH: number;
  ops: DrawOp[];
  /** 그림 자리(이미지 상자·링크 썸네일) */
  image?: { asset: string; x: number; y: number; w: number; h: number; radius: number };
  /** 링크 카드의 머리글자(썸네일 없을 때)·주소 줄 */
  initial?: { x: number; y: number; text: string; color: string };
  urlBar?: number;
}

export interface SnapshotLayout {
  width: number;
  height: number;
  /** 문서 좌표 → 그림 좌표 */
  dx: number;
  dy: number;
  boxes: BoxLayout[];
  edges: {
    points: Point[];
    d: string;
    mid: Point;
    dir: "one" | "both" | "none";
    dash: boolean;
    label: string;
  }[];
}

function stripOps(
  box: NoteBox,
  input: SnapshotInput,
  width: number,
  measure: Measure,
): { ops: DrawOp[]; height: number } {
  const refs = box.refs ?? [];
  if (!refs.length) return { ops: [], height: 0 };
  const lines = refs
    .map((r) => ({ item: r.item, line: input.lines[r.item] }))
    // 보드 순서, 지워진 항목은 맨 아래(LinkStrip과 같게)
    .sort((a, b) =>
      !a.line || !b.line ? Number(!a.line) - Number(!b.line) : a.line.order < b.line.order ? -1 : 1,
    );
  const fold = lines.length >= FOLD_AT;
  const shown = fold ? lines.slice(0, FOLD_SHOW) : lines;
  const ops: DrawOp[] = [];
  const font = fontOf({ size: 12 });
  const text = (x: number, y: number, t: string, color: string, w: number): TextOp => ({
    kind: "text",
    x,
    y,
    w,
    text: t,
    font,
    size: 12,
    color,
    underline: false,
    strike: false,
    highlight: false,
  });
  shown.forEach(({ line }, i) => {
    const y = i * STRIP_LINE + STRIP_LINE / 2;
    if (!line) {
      ops.push(text(8, y, ellipsize(input.goneText, width - 16, font, measure), SNAP_THEME.text3, 0));
      return;
    }
    ops.push({ kind: "dot", x: 12, y, color: line.color });
    const t = ellipsize(`${line.catName} · ${line.dateLabel} · ${line.text}`, width - 30, font, measure);
    ops.push(text(22, y, t, SNAP_THEME.text1, measure(t, font)));
  });
  if (fold)
    ops.push(
      text(
        8,
        shown.length * STRIP_LINE + STRIP_LINE / 2,
        input.moreText(lines.length - FOLD_SHOW),
        SNAP_THEME.accent,
        0,
      ),
    );
  return { ops, height: (shown.length + (fold ? 1 : 0)) * STRIP_LINE + 1 };
}

const shift = (ops: DrawOp[], dx: number, dy: number): DrawOp[] =>
  ops.map((o) => ({ ...o, x: o.x + dx, y: o.y + dy }));

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** 문서 → 상자·선 배치(그림 크기 포함). 상자 높이는 화면 값이 아니라 이 배치로 잰 값 */
export function layoutSnapshot(input: SnapshotInput, measure: Measure): SnapshotLayout {
  const boxes: BoxLayout[] = [];
  for (const box of [...input.doc.boxes].sort((a, b) => a.z - b.z)) {
    const inner = box.w - 2;
    const strip = stripOps(box, input, inner, measure);
    const top = 1 + strip.height;
    const L: BoxLayout = {
      box,
      rect: { x: box.x, y: box.y, w: box.w, h: 0 },
      bg: SNAP_THEME.card,
      stripH: strip.height,
      ops: shift(strip.ops, 1, 1),
    };
    let h: number;
    if (box.kind === "text") {
      if (box.bg) L.bg = SNAP_THEME.bg[box.bg];
      const pad = strip.height ? 6 : 8;
      const prose = layoutProse(box.content, inner - 24 - 14, measure);
      L.ops.push(...shift(prose.ops, 13, top + pad));
      h = top + pad + prose.height + 8 + 1;
    } else if (box.kind === "image") {
      const img = input.images[box.asset];
      const pad = 4;
      const iw = inner - pad * 2;
      const ih = img ? Math.round((iw * img.height) / Math.max(1, img.width)) : 60;
      let y = top + pad;
      if (img) L.image = { asset: box.asset, x: 1 + pad, y, w: iw, h: ih, radius: 4 };
      else
        L.ops.push({
          ...textOp("(이미지 없음)", 1 + pad + 8, y + 30, 13, SNAP_THEME.text3),
          w: 0,
        });
      y += ih;
      if (box.caption.trim()) {
        const r = layoutInline(
          [{ type: "text", text: box.caption }],
          { ...plain(13), color: SNAP_THEME.text2 },
          1 + pad + 4,
          y + 4,
          iw - 8,
          measure,
        );
        L.ops.push(...r.ops);
        y += 4 + r.height + 2;
      }
      h = y + pad + 1;
    } else {
      const thumb = box.asset ? input.images[box.asset] : undefined;
      const x = 1 + 12;
      const y = top + 12;
      if (thumb) L.image = { asset: box.asset!, x, y, w: 44, h: 44, radius: 9 };
      else {
        const dom = domainOf(box.url);
        let hsh = 0;
        for (const ch of dom) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
        L.initial = {
          x,
          y,
          text: (dom.match(/[\p{L}\p{N}]/u)?.[0] ?? "#").toUpperCase(),
          color: SNAP_THEME.tone[hsh % 6]!,
        };
      }
      const tx = x + 44 + 10;
      const tw = inner - 12 - 44 - 10 - 28;
      const title = layoutInline(
        [{ type: "text", text: box.title }],
        { ...plain(14), bold: true },
        tx,
        y,
        tw,
        measure,
      );
      const dom = layoutInline(
        [{ type: "text", text: domainOf(box.url) }],
        { ...plain(12), color: SNAP_THEME.text3 },
        tx,
        y + title.height,
        tw,
        measure,
      );
      L.ops.push(...title.ops, ...dom.ops);
      let ty = y + title.height + dom.height;
      if (box.note) {
        const note = layoutInline(
          [{ type: "text", text: box.note }],
          { ...plain(12), color: SNAP_THEME.text2 },
          tx,
          ty,
          tw,
          measure,
        );
        L.ops.push(...note.ops);
        ty += note.height;
      }
      const mainBottom = Math.max(ty, y + 44) + 10;
      L.urlBar = mainBottom;
      const font = fontOf({ size: 11 });
      const url = ellipsize(box.url, inner - 24, font, measure);
      L.ops.push({ ...textOp(url, 13, mainBottom + 6 + 8, 11, SNAP_THEME.text3), w: measure(url, font) });
      h = mainBottom + 6 + 16 + 6 + 1;
    }
    L.rect.h = Math.ceil(h);
    boxes.push(L);
  }

  const rectOf = new Map(boxes.map((b) => [b.box.id, b.rect]));
  const edges: SnapshotLayout["edges"] = [];
  for (const e of input.doc.edges ?? []) {
    const a = rectOf.get(e.from);
    const b = rectOf.get(e.to);
    const r = a && b ? routeEdge(a, b) : null;
    if (r) edges.push({ ...r, mid: midPoint(r.points), dir: e.dir, dash: e.dash, label: e.label });
  }

  const xs = boxes.flatMap((b) => [b.rect.x, b.rect.x + b.rect.w]);
  const ys = boxes.flatMap((b) => [b.rect.y, b.rect.y + b.rect.h]);
  const minX = xs.length ? Math.min(...xs) : 0;
  const minY = ys.length ? Math.min(...ys) : 0;
  const maxX = xs.length ? Math.max(...xs) : 320;
  const maxY = ys.length ? Math.max(...ys) : 120;
  const headW =
    measure(input.title, fontOf({ size: 14, bold: true })) +
    16 +
    measure(input.subtitle, fontOf({ size: 11 }));
  return {
    width: Math.ceil(Math.max(maxX - minX + PAD * 2, headW + 28, 360)),
    height: Math.ceil(maxY - minY + PAD * 2 + HEAD_H),
    dx: PAD - minX,
    dy: PAD + HEAD_H - minY,
    boxes,
    edges,
  };
}

const plain = (size: number): Style => ({
  size,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  highlight: false,
  color: SNAP_THEME.text1,
});

function textOp(text: string, x: number, y: number, size: number, color: string): TextOp {
  return {
    kind: "text",
    x,
    y,
    w: 0,
    text,
    font: fontOf({ size }),
    size,
    color,
    underline: false,
    strike: false,
    highlight: false,
  };
}

/** 그림 배율: 긴 변이 maxSide(px)를 넘지 않게 */
export function snapshotScale(
  layout: { width: number; height: number },
  want: number,
  maxSide = 8192,
): number {
  return Math.min(want, maxSide / Math.max(layout.width, layout.height));
}

// ── 그리기(캔버스) ──────────────────────────────────

type Ctx = CanvasRenderingContext2D;

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function arrow(ctx: Ctx, from: Point, to: Point) {
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  const s = 8;
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - s * Math.cos(a - 0.45), to.y - s * Math.sin(a - 0.45));
  ctx.lineTo(to.x - s * Math.cos(a + 0.45), to.y - s * Math.sin(a + 0.45));
  ctx.closePath();
  ctx.fill();
}

function drawOps(ctx: Ctx, ops: DrawOp[], ox: number, oy: number) {
  for (const o of ops) {
    const x = ox + o.x;
    const y = oy + o.y;
    if (o.kind === "rule") {
      ctx.fillStyle = SNAP_THEME.lineStrong;
      ctx.fillRect(x, y, o.w, 1);
    } else if (o.kind === "check") {
      ctx.strokeStyle = SNAP_THEME.lineStrong;
      ctx.lineWidth = 1.2;
      roundRect(ctx, x + 0.5, y + 0.5, 12, 12, 2);
      if (o.checked) {
        ctx.fillStyle = SNAP_THEME.accent;
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(x + 3, y + 6.5);
        ctx.lineTo(x + 5.5, y + 9);
        ctx.lineTo(x + 10, y + 4);
        ctx.stroke();
      } else ctx.stroke();
    } else if (o.kind === "dot") {
      ctx.fillStyle = o.color;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.font = o.font;
      const w = o.w || ctx.measureText(o.text).width;
      if (o.highlight) {
        ctx.fillStyle = SNAP_THEME.mark;
        ctx.fillRect(x, y - o.size * 0.62, w, o.size * 1.24);
      }
      ctx.fillStyle = o.color;
      ctx.fillText(o.text, x, y);
      if (o.underline || o.strike) {
        ctx.fillStyle = o.color;
        if (o.underline) ctx.fillRect(x, y + o.size * 0.5, w, Math.max(1, o.size / 14));
        if (o.strike) ctx.fillRect(x, y - o.size * 0.05, w, Math.max(1, o.size / 14));
      }
    }
  }
}

/** 그림 데이터(base64) → 그릴 수 있는 이미지 */
async function loadImages(images: Record<string, SnapImage>, ids: string[]) {
  const out = new Map<string, HTMLImageElement>();
  await Promise.all(
    ids.map(async (id) => {
      const im = images[id];
      if (!im) return;
      const el = new Image();
      el.src = `data:${im.mime};base64,${im.data}`;
      try {
        await el.decode();
        out.set(id, el);
      } catch {
        // 깨진 그림은 빈 자리로
      }
    }),
  );
  return out;
}

/** 앱 글꼴(Pretendard)을 다 불러온 뒤에 재고 그린다 */
export async function snapshotFontsReady() {
  const f = typeof document !== "undefined" ? document.fonts : undefined;
  if (!f) return;
  await Promise.all([
    f.load(fontOf({ size: 14 }), "가A"),
    f.load(fontOf({ size: 14, bold: true }), "가A"),
  ]).catch(() => undefined);
  await f.ready;
}

/** 배치 → 캔버스 */
export async function drawSnapshot(
  input: SnapshotInput,
  layout: SnapshotLayout,
  scale: number,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(layout.width * scale));
  canvas.height = Math.max(1, Math.round(layout.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("그림을 만들 수 없습니다");
  const imgs = await loadImages(
    input.images,
    layout.boxes.flatMap((b) => (b.image ? [b.image.asset] : [])),
  );
  ctx.scale(scale, scale);
  ctx.textBaseline = "middle";
  ctx.fillStyle = SNAP_THEME.page;
  ctx.fillRect(0, 0, layout.width, layout.height);
  // 제목 띠
  ctx.fillStyle = SNAP_THEME.text1;
  ctx.font = fontOf({ size: 14, bold: true });
  ctx.fillText(input.title, 14, HEAD_H / 2);
  const tw = ctx.measureText(input.title).width;
  ctx.fillStyle = SNAP_THEME.text3;
  ctx.font = fontOf({ size: 11 });
  ctx.fillText(input.subtitle, 14 + tw + 16, HEAD_H / 2 + 1);
  ctx.fillStyle = SNAP_THEME.line;
  ctx.fillRect(0, HEAD_H - 1, layout.width, 1);
  ctx.fillStyle = SNAP_THEME.canvas;
  ctx.fillRect(0, HEAD_H, layout.width, layout.height - HEAD_H);

  // 관계선(상자 뒤)
  ctx.save();
  ctx.translate(layout.dx, layout.dy);
  for (const e of layout.edges) {
    ctx.strokeStyle = SNAP_THEME.text2;
    ctx.fillStyle = SNAP_THEME.text2;
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    ctx.setLineDash(e.dash ? [6, 4] : []);
    ctx.stroke(new Path2D(e.d));
    ctx.setLineDash([]);
    const p = e.points;
    if (e.dir !== "none") arrow(ctx, p[p.length - 2]!, p[p.length - 1]!);
    if (e.dir === "both") arrow(ctx, p[1]!, p[0]!);
  }
  ctx.restore();

  for (const b of layout.boxes) {
    const x = b.rect.x + layout.dx;
    const y = b.rect.y + layout.dy;
    const r = b.box.kind === "link" ? 10 : 6;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.06)";
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 1;
    ctx.fillStyle = b.bg;
    roundRect(ctx, x, y, b.rect.w, b.rect.h, r);
    ctx.fill();
    ctx.restore();
    ctx.save();
    roundRect(ctx, x, y, b.rect.w, b.rect.h, r);
    ctx.clip();
    if (b.stripH) {
      ctx.fillStyle = SNAP_THEME.sub;
      ctx.fillRect(x, y, b.rect.w, b.stripH);
      ctx.fillStyle = SNAP_THEME.line;
      ctx.fillRect(x, y + b.stripH, b.rect.w, 1);
    }
    if (b.urlBar !== undefined) {
      ctx.fillStyle = SNAP_THEME.line;
      ctx.fillRect(x, y + b.urlBar, b.rect.w, 1);
    }
    ctx.restore();
    ctx.strokeStyle = SNAP_THEME.line;
    ctx.lineWidth = 1;
    roundRect(ctx, x + 0.5, y + 0.5, b.rect.w - 1, b.rect.h - 1, r);
    ctx.stroke();
    if (b.image) {
      const el = imgs.get(b.image.asset);
      ctx.save();
      roundRect(ctx, x + b.image.x, y + b.image.y, b.image.w, b.image.h, b.image.radius);
      ctx.clip();
      if (el) {
        // 링크 썸네일은 꽉 채워 자른다(object-fit: cover)
        const k = Math.max(b.image.w / el.naturalWidth, b.image.h / el.naturalHeight);
        const w = el.naturalWidth * k;
        const h = el.naturalHeight * k;
        ctx.drawImage(el, x + b.image.x + (b.image.w - w) / 2, y + b.image.y + (b.image.h - h) / 2, w, h);
      } else {
        ctx.fillStyle = SNAP_THEME.sub;
        ctx.fillRect(x + b.image.x, y + b.image.y, b.image.w, b.image.h);
      }
      ctx.restore();
    }
    if (b.initial) {
      ctx.fillStyle = b.initial.color;
      roundRect(ctx, x + b.initial.x, y + b.initial.y, 44, 44, 9);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = fontOf({ size: 20, bold: true });
      ctx.textAlign = "center";
      ctx.fillText(b.initial.text, x + b.initial.x + 22, y + b.initial.y + 23);
      ctx.textAlign = "left";
    }
    drawOps(ctx, b.ops, x, y);
  }

  // 관계선 이름표(상자 위)
  ctx.save();
  ctx.translate(layout.dx, layout.dy);
  for (const e of layout.edges) {
    if (!e.label) continue;
    ctx.font = fontOf({ size: 12 });
    const w = ctx.measureText(e.label).width + 12;
    ctx.fillStyle = SNAP_THEME.card;
    ctx.strokeStyle = SNAP_THEME.line;
    roundRect(ctx, e.mid.x - w / 2, e.mid.y - 10, w, 20, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = SNAP_THEME.text2;
    ctx.textAlign = "center";
    ctx.fillText(e.label, e.mid.x, e.mid.y + 1);
    ctx.textAlign = "left";
  }
  ctx.restore();
  return canvas;
}

/** 캔버스로 글자 폭 재기 */
export function canvasMeasure(): Measure {
  const ctx = document.createElement("canvas").getContext("2d");
  const cache = new Map<string, number>();
  return (text, font) => {
    const k = `${font}|${text}`;
    let w = cache.get(k);
    if (w === undefined) {
      if (ctx) {
        ctx.font = font;
        w = ctx.measureText(text).width;
      } else w = text.length * 8;
      cache.set(k, w);
    }
    return w;
  };
}

/** 문서 → PNG(또는 WebP) Blob. scale = 해상도 배율(화면 2배, 엑셀 1.5배) */
export async function renderNoteSnapshot(
  input: SnapshotInput,
  opt: { scale: number; type?: "image/png" | "image/webp" },
): Promise<{ blob: Blob; width: number; height: number }> {
  await snapshotFontsReady();
  const layout = layoutSnapshot(input, canvasMeasure());
  const scale = snapshotScale(layout, opt.scale);
  const canvas = await drawSnapshot(input, layout, scale);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, opt.type ?? "image/png"));
  if (!blob) throw new Error("그림을 만들 수 없습니다");
  return { blob, width: layout.width, height: layout.height };
}

/** 그 주 보드(업무·칸)에서 연결 띠 줄들 — LinkStrip과 같은 글·순서 */
export function snapLines(
  categories: { id: string; name: string; color: string }[],
  cells: Record<string, { id: string; text: string }[]>,
  colorOf: (key: string) => string,
  dateLabel: (date: string) => string,
): Record<string, SnapLine> {
  const index = new Map(categories.map((c, i) => [c.id, i]));
  const out: Record<string, SnapLine> = {};
  for (const [key, items] of Object.entries(cells)) {
    const sep = key.indexOf("|");
    const date = key.slice(0, sep);
    const categoryId = key.slice(sep + 1);
    const cat = categories.find((c) => c.id === categoryId);
    items.forEach((it, idx) => {
      if (!it.text.trim()) return;
      out[it.id] = {
        catName: cat?.name ?? "",
        color: colorOf(cat?.color ?? "c1"),
        dateLabel: dateLabel(date),
        text: it.text,
        order: `${String(index.get(categoryId) ?? 999).padStart(4, "0")}|${date}|${String(idx).padStart(4, "0")}`,
      };
    });
  }
  return out;
}

/** 스냅샷에 그릴 것이 있나(상자 1개 이상) */
export const hasSnapshotContent = (doc: NoteDoc) => readingOrder(doc.boxes).length > 0;
