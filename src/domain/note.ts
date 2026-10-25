// 주간 메모(weekly-note-spec): 한 주에 문서 1개, 자유 배치 상자들. 순수 함수만(UI·저장소·플랫폼 import 금지).
// 상자 안 글은 편집기(ProseMirror 계열)의 문서 JSON — 허용하는 노드·서식은 스펙 4-3 표뿐이고, 밖은 버린다.
import { DAY_LABELS, dayIndex, weekDays, type DateStr, type WeekId } from "./week";

/** 편집기 문서 노드(ProseMirror JSON) */
export interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

export const NOTE_BG = ["yellow", "blue", "green", "pink"] as const;
export type NoteBg = (typeof NOTE_BG)[number];

export interface TextBox {
  id: string;
  kind: "text";
  x: number;
  y: number;
  w: number;
  z: number;
  /** 화면에서 잰 높이(새 상자 자리·판 높이 계산용, 저장은 참고값) */
  h?: number;
  bg: NoteBg | null;
  content: PMNode;
}

export type NoteBox = TextBox;

export interface NoteDoc {
  v: 1;
  boxes: NoteBox[];
}

/** 위치 눈금(px) — 상자는 8px 단위로 맞춘다(스펙 4-1) */
export const GRID = 8;
export const BOX_MIN_W = 160;
export const BOX_MAX_W = 960;
export const BOX_DEFAULT_W = 320;
/** 새 상자를 아래에 붙일 때 간격 */
export const BOX_GAP = 16;

export const snap = (n: number) => Math.max(0, Math.round(n / GRID) * GRID);
export const clampWidth = (w: number) => Math.min(BOX_MAX_W, Math.max(BOX_MIN_W, snap(w)));

export const emptyDoc = (): NoteDoc => ({ v: 1, boxes: [] });
export const emptyContent = (): PMNode => ({ type: "doc", content: [{ type: "paragraph" }] });

// ── 허용 스키마(스펙 4-3) ─────────────────────────────
const BLOCKS = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "horizontalRule",
  "hardBreak",
  "text",
]);
const MARKS = new Set(["bold", "italic", "underline", "strike", "fontSize", "textColor", "highlight"]);
export const FONT_SIZES = ["s", "m", "l", "xl"] as const;
export const TEXT_COLORS = ["gray", "orange", "blue", "green", "red"] as const;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

const INLINE = new Set(["text", "hardBreak"]);
const inlineOf = (n: PMNode): PMNode[] => (INLINE.has(n.type) ? [n] : (n.content ?? []).flatMap(inlineOf));

/** 벗겨 낸 뒤 자리가 안 맞는 노드 정리: 글 자리에는 글만, 블록 자리에 남은 글은 문단으로 감싼다 */
function fit(nodes: PMNode[], inline: boolean): PMNode[] {
  if (inline) return nodes.flatMap(inlineOf);
  const out: PMNode[] = [];
  let run: PMNode[] = [];
  const flush = () => {
    if (run.length) out.push({ type: "paragraph", content: run });
    run = [];
  };
  for (const n of nodes) {
    if (INLINE.has(n.type)) run.push(n);
    else {
      flush();
      out.push(n);
    }
  }
  flush();
  return out;
}

/** 허용 밖 노드·서식은 버리고(글은 살림) 남은 문서. 문서가 아니면 null */
export function sanitizeContent(raw: unknown): PMNode | null {
  if (!isObj(raw) || raw.type !== "doc") return null;
  const walk = (n: unknown): PMNode[] => {
    if (!isObj(n) || typeof n.type !== "string") return [];
    const kids = Array.isArray(n.content) ? n.content.flatMap(walk) : undefined;
    if (!BLOCKS.has(n.type)) return kids ?? []; // 모르는 노드는 벗기고 안의 내용만
    const out: PMNode = { type: n.type };
    if (n.type === "text") {
      if (typeof n.text !== "string" || n.text === "") return [];
      out.text = n.text;
      const marks = Array.isArray(n.marks)
        ? n.marks.filter(
            (m): m is { type: string; attrs?: Record<string, unknown> } =>
              isObj(m) && MARKS.has(String(m.type)),
          )
        : [];
      if (marks.length)
        out.marks = marks.map((m) => (m.attrs ? { type: m.type, attrs: m.attrs } : { type: m.type }));
      return [out];
    }
    if (n.type === "heading")
      out.attrs = { level: n.attrs && (n.attrs as { level?: unknown }).level === 1 ? 1 : 2 };
    if (n.type === "taskItem") out.attrs = { checked: Boolean(isObj(n.attrs) && n.attrs.checked) };
    if (n.type === "orderedList" && isObj(n.attrs) && typeof n.attrs.start === "number")
      out.attrs = { start: n.attrs.start };
    if (kids?.length) out.content = fit(kids, n.type === "paragraph" || n.type === "heading");
    return [out];
  };
  const content = fit((Array.isArray(raw.content) ? raw.content : []).flatMap(walk), false);
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

/** 저장된 JSON → 메모 문서(잘못된 상자는 버린다). 읽을 수 없으면 빈 문서 */
export function parseNoteDoc(json: string | null | undefined): NoteDoc {
  if (!json) return emptyDoc();
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return emptyDoc();
  }
  if (!isObj(raw) || !Array.isArray(raw.boxes)) return emptyDoc();
  const boxes: NoteBox[] = [];
  for (const b of raw.boxes) {
    if (!isObj(b) || typeof b.id !== "string" || b.kind !== "text") continue;
    const content = sanitizeContent(b.content);
    if (!content) continue;
    boxes.push({
      id: b.id,
      kind: "text",
      x: snap(num(b.x, 0)),
      y: snap(num(b.y, 0)),
      w: clampWidth(num(b.w, BOX_DEFAULT_W)),
      z: num(b.z, 0),
      ...(typeof b.h === "number" ? { h: b.h } : {}),
      bg: NOTE_BG.includes(b.bg as NoteBg) ? (b.bg as NoteBg) : null,
      content,
    });
  }
  return { v: 1, boxes };
}

// ── 글 추출(자동 집계·엑셀, 스펙 6절) ─────────────────
function inlineText(n: PMNode | undefined): string {
  if (!n) return "";
  if (n.type === "text") return n.text ?? "";
  if (n.type === "hardBreak") return "\n";
  return (n.content ?? []).map(inlineText).join("");
}

/** 블록들 → 줄. 목록은 `- `·`1. `·체크 `- `/`- (완료) `, 중첩은 2칸 들여쓰기, 줄바꿈은 같은 들여쓰기로 이어 쓴다 */
function blockLines(nodes: PMNode[] | undefined, indent: string): string[] {
  const out: string[] = [];
  for (const n of nodes ?? []) {
    switch (n.type) {
      case "paragraph":
      case "heading": {
        const t = inlineText(n).trim();
        if (t) out.push(...t.split("\n").map((l) => indent + l));
        break;
      }
      case "bulletList":
      case "orderedList":
      case "taskList": {
        const start = typeof n.attrs?.start === "number" ? n.attrs.start : 1;
        (n.content ?? []).forEach((item, i) => {
          const head =
            n.type === "orderedList"
              ? `${start + i}. `
              : n.type === "taskList" && item.attrs?.checked
                ? "- (완료) "
                : "- ";
          // 항목 = 첫 문단(글) + 안에 든 목록들(한 단계 더 들여쓰기)
          const kids = item.content ?? [];
          const text = kids
            .filter((k) => k.type === "paragraph" || k.type === "heading")
            .map((k) => inlineText(k).trim())
            .filter(Boolean)
            .join("\n");
          const nested = kids.filter((k) => k.type.endsWith("List"));
          if (text) {
            const [firstLine, ...more] = text.split("\n");
            out.push(indent + head + firstLine);
            for (const l of more) out.push(indent + " ".repeat(head.length) + l);
          }
          out.push(...blockLines(nested, indent + "  "));
        });
        break;
      }
      default:
        break; // 구분선 등은 글로 쓰지 않는다
    }
  }
  return out;
}

/** 읽는 순서: 위 → 아래, 같은 줄(위치 차 16px 이하)이면 왼쪽 → 오른쪽 */
export function readingOrder(boxes: NoteBox[]): NoteBox[] {
  return [...boxes].sort((a, b) => (Math.abs(a.y - b.y) <= 16 ? a.x - b.x : a.y - b.y));
}

/** 메모의 글만(상자 사이 빈 줄). 글이 없으면 "" */
export function noteToText(doc: NoteDoc): string {
  return readingOrder(doc.boxes)
    .map((b) => blockLines(b.content.content, "").join("\n"))
    .filter((t) => t.trim() !== "")
    .join("\n\n");
}

export const isNoteEmpty = (doc: NoteDoc) => noteToText(doc) === "";

// ── 예전 요일 메모 → 주간 메모(스펙 5-1, 11절 #5) ─────
/** 요일 메모를 상자 1개의 글머리 목록으로: `(목) 내용`. 메모가 없으면 빈 문서 */
export function docFromDayMemos(
  weekId: WeekId,
  memos: Record<DateStr, string>,
  newId: () => string,
): NoteDoc {
  const items: PMNode[] = weekDays(weekId)
    .filter((d) => (memos[d] ?? "").trim() !== "")
    .map((d) => {
      const lines = memos[d]!.trim().split("\n");
      const inline: PMNode[] = [{ type: "text", text: `(${DAY_LABELS[dayIndex(d)]}) ${lines[0]}` }];
      for (const l of lines.slice(1))
        inline.push({ type: "hardBreak" }, ...(l ? [{ type: "text", text: l }] : []));
      return { type: "listItem", content: [{ type: "paragraph", content: inline }] };
    });
  if (!items.length) return emptyDoc();
  return {
    v: 1,
    boxes: [
      {
        id: newId(),
        kind: "text",
        x: 24,
        y: 24,
        w: 480,
        z: 1,
        bg: null,
        content: { type: "doc", content: [{ type: "bulletList", content: items }] },
      },
    ],
  };
}

// ── 상자 배치 ────────────────────────────────────────
/** 가장 아래 상자 아래(왼쪽 정렬) — Ctrl+Enter·[+ 텍스트 상자] */
export function positionBelow(doc: NoteDoc): { x: number; y: number } {
  if (!doc.boxes.length) return { x: 24, y: 24 };
  const bottom = doc.boxes.reduce((m, b) => Math.max(m, b.y + (b.h ?? 48)), 0);
  const left = Math.min(...doc.boxes.map((b) => b.x));
  return { x: snap(left), y: snap(bottom + BOX_GAP) };
}

export const topZ = (doc: NoteDoc) => doc.boxes.reduce((m, b) => Math.max(m, b.z), 0);
