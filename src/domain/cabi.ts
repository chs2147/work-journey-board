// Cabi.NET: 업무 소유 문서와 보드의 날짜 독립 식별자. SQL·창 API에 의존하지 않는다.
import { boxText, emptyContent, parseNoteDoc, type NoteDoc, type PMNode, type TextBox } from "./note";

export type BoardOwner = { kind: "week"; weekId: string } | { kind: "task"; categoryId: string };
export type CabiReference =
  { kind: "note" | "folder" | "link"; id: string } | { kind: "memo"; weekId: string; boxId: string };
export interface CabiNote {
  id: string;
  categoryId: string;
  title: string;
  content: PMNode;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface CabiNoteSummary extends Omit<CabiNote, "content"> {
  excerpt: string;
}
export interface TaskBoard {
  id: string;
  categoryId: string;
  doc: NoteDoc;
  revision: number;
  updatedAt: string;
}
export interface WeeklyMemo {
  weekId: string;
  boxId: string;
  title: string;
  text: string;
  entryIds: string[];
  updatedAt: string;
}
export class CabiConflictError extends Error {
  constructor() {
    super("다른 창에서 문서가 변경되었습니다. 내 내용을 내보낸 뒤 최신 문서를 다시 열어 주세요.");
  }
}
export const CABI_MAX = 4_000_000;
export const cabiTitle = (title: string) =>
  title.replace(/\s+/g, " ").trim().slice(0, 200) || "제목 없는 노트";
export function parseCabiReference(value: unknown): CabiReference | undefined {
  if (!value || typeof value !== "object") return;
  const v = value as Record<string, unknown>;
  if (["note", "folder", "link"].includes(String(v.kind)) && typeof v.id === "string" && v.id.length < 200)
    return { kind: v.kind as "note" | "folder" | "link", id: v.id };
  if (
    v.kind === "memo" &&
    typeof v.weekId === "string" &&
    /^\d{4}-W\d{2}$/.test(v.weekId) &&
    typeof v.boxId === "string" &&
    v.boxId.length < 200
  )
    return { kind: "memo", weekId: v.weekId, boxId: v.boxId };
}
const blocks = new Set([
  "doc",
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "hardBreak",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
  "image",
  "text",
]);
const marks = new Set(["bold", "italic", "strike", "code", "link", "textColor"]);
// Block editor JSON only; never persist executable HTML, data URI or remote image src.
export function cleanCabiContent(raw: unknown): PMNode {
  let count = 0;
  const visit = (v: unknown, depth: number): PMNode | null => {
    if (!v || typeof v !== "object" || depth > 24 || ++count > 50_000) return null;
    const n = v as PMNode;
    if (!blocks.has(n.type)) return null;
    if (n.type === "text") {
      if (typeof n.text !== "string" || !n.text) return null;
      return {
        type: "text",
        text: n.text,
        ...(n.marks
          ? {
              marks: n.marks
                .filter(
                  (m) =>
                    marks.has(m.type) && (m.type !== "link" || /^https?:\/\//i.test(String(m.attrs?.href))),
                )
                .map((m) => ({
                  type: m.type,
                  ...(m.type === "link"
                    ? { attrs: { href: String(m.attrs?.href).slice(0, 2048) } }
                    : m.type === "textColor"
                      ? {
                          attrs: {
                            color: ["gray", "orange", "blue", "green", "red"].includes(String(m.attrs?.color))
                              ? m.attrs?.color
                              : "gray",
                          },
                        }
                      : {}),
                })),
            }
          : {}),
      };
    }
    if (n.type === "image") {
      const asset = n.attrs?.asset;
      return typeof asset === "string" && /^[\w-]{1,200}$/.test(asset)
        ? { type: "image", attrs: { asset, alt: String(n.attrs?.alt ?? "").slice(0, 500) } }
        : {
            type: "paragraph",
            content: [{ type: "text", text: String(n.attrs?.alt || "(이미지 제외)").slice(0, 500) }],
          };
    }
    const attrs =
      n.type === "heading"
        ? { level: Math.max(1, Math.min(3, Number(n.attrs?.level) || 1)) }
        : n.type === "taskItem"
          ? { checked: n.attrs?.checked === true }
          : n.type === "orderedList"
            ? { start: Math.max(1, Number(n.attrs?.start) || 1) }
            : n.type === "codeBlock"
              ? { language: String(n.attrs?.language ?? "").slice(0, 50) }
              : ["tableCell", "tableHeader"].includes(n.type)
                ? {
                    colspan: 1,
                    rowspan: 1,
                    colwidth: Array.isArray(n.attrs?.colwidth)
                      ? n.attrs.colwidth
                          .slice(0, 20)
                          .map((v) => Math.min(1200, Math.max(60, Number(v) || 120)))
                      : null,
                  }
                : undefined;
    return {
      type: n.type,
      ...(attrs ? { attrs } : {}),
      ...(n.content
        ? { content: n.content.map((c) => visit(c, depth + 1)).filter((c): c is PMNode => !!c) }
        : {}),
    };
  };
  const content = visit(raw, 0);
  return content?.type === "doc" && content.content?.length ? content : emptyContent();
}
export function cabiText(content: PMNode): string {
  if (content.type === "text") return content.text ?? "";
  const separator = ["paragraph", "heading", "listItem", "taskItem", "codeBlock", "tableRow"].includes(
    content.type,
  )
    ? "\n"
    : "";
  return (content.content ?? []).map(cabiText).join("") + separator;
}
export function cabiAssetIds(content: PMNode): string[] {
  const ids = new Set<string>();
  const visit = (n: PMNode) => {
    if (n.type === "image" && typeof n.attrs?.asset === "string") ids.add(n.attrs.asset);
    n.content?.forEach(visit);
  };
  visit(content);
  return [...ids];
}
export function referenceBox(
  id: string,
  reference: CabiReference,
  title: string,
  x: number,
  y: number,
  z: number,
): TextBox {
  return {
    id,
    kind: "text",
    x,
    y,
    w: 320,
    z,
    bg: null,
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: title || "원본" }] }],
    },
    resource: reference,
  };
}
/** A copy is independent: fresh IDs, internal edges only, no implicit entry links. */
export function cloneBoardSelection(
  doc: NoteDoc,
  ids: string[],
  nextId: () => string,
  at: { x: number; y: number },
  assets: Record<string, string> = {},
): NoteDoc {
  const selected = doc.boxes.filter((b) => ids.includes(b.id));
  if (!selected.length) return { v: 1, boxes: [] };
  const x = Math.min(...selected.map((b) => b.x)),
    y = Math.min(...selected.map((b) => b.y));
  const map = new Map(selected.map((b) => [b.id, nextId()]));
  const boxes = selected.map((b, i) => {
    const { refs: _refs, ...rest } = b;
    void _refs;
    return {
      ...rest,
      id: map.get(b.id)!,
      x: Math.max(0, at.x + b.x - x),
      y: Math.max(0, at.y + b.y - y),
      z: i + 1,
      ...(b.kind === "image"
        ? { asset: assets[b.asset] ?? b.asset }
        : b.kind === "link" && b.asset
          ? { asset: assets[b.asset] ?? b.asset }
          : {}),
    };
  });
  return parseNoteDoc(
    JSON.stringify({
      v: 1,
      boxes,
      edges: (doc.edges ?? [])
        .filter((e) => map.has(e.from) && map.has(e.to))
        .map((e) => ({ ...e, id: nextId(), from: map.get(e.from), to: map.get(e.to) })),
    }),
  );
}
export function memoSummary(box: NoteDoc["boxes"][number]) {
  return boxText(box)
    .replace(/^[-\s]+/, "")
    .slice(0, 120);
}
