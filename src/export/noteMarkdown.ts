// 메모 보드 → 마크다운(features-1102-spec F4). 순수 함수 — 저장소·화면과 무관, 골든 테스트로 고정(tests/unit/noteMarkdown.test.ts).
// 주 = `#`, 상자 = `##`(읽는 순서: 위→아래, 같은 줄이면 왼→오른쪽), 서식 = 굵게·기울임·취소선·링크·목록·번호·체크·제목,
// 글자 크기·색·형광펜은 버림. 이미지는 옆 폴더 파일로(또는 설명만), 관계선은 문서 끝 목록.
import { readingOrder, type NoteDoc, type NoteEdge, type PMNode } from "../domain/note";
import { weekRange, type WeekId } from "../domain/week";

export interface MarkdownWeek {
  weekId: WeekId;
  doc: NoteDoc;
  /** 연결된 업무 항목 id → `업무 · 10/20(화) · 항목 글`(없으면 null — 지워진 항목) */
  itemLabel: (itemId: string) => string | null;
  /** 이미지 상자의 원본 형식(asset id → mime) */
  assetMime?: (assetId: string) => string | null;
}

export interface MarkdownOptions {
  links: boolean;
  edges: boolean;
  /** 비어 있는 주도 제목만 */
  emptyWeeks: boolean;
  images: "files" | "none";
  /** 이미지 폴더 이름(`메모보드_2026-W43_images`) — 문서 안 상대 경로 */
  imageDir: string;
}

export interface MarkdownImage {
  assetId: string;
  /** imageDir 안 파일 이름 */
  file: string;
}

const esc = (t: string) => t.replace(/([\\`*_[\]<>#|])/g, "\\$1");

function inline(nodes: PMNode[] | undefined): string {
  let out = "";
  for (const n of nodes ?? []) {
    if (n.type === "hardBreak") {
      out += "  \n";
      continue;
    }
    if (n.type !== "text") {
      out += inline(n.content);
      continue;
    }
    let t = esc(n.text ?? "");
    const marks = n.marks ?? [];
    const has = (m: string) => marks.some((x) => x.type === m);
    if (!t.trim()) {
      out += t;
      continue;
    }
    // 앞뒤 공백은 서식 밖으로(마크다운은 `** 굵게**`를 서식으로 읽지 않음)
    const lead = /^\s*/.exec(t)![0];
    const trail = /\s*$/.exec(t)![0];
    t = t.trim();
    if (has("bold")) t = `**${t}**`;
    if (has("italic")) t = `*${t}*`;
    if (has("strike")) t = `~~${t}~~`;
    const link = marks.find((x) => x.type === "link");
    if (link && typeof link.attrs?.href === "string") t = `[${t}](${link.attrs.href})`;
    out += lead + t + trail;
  }
  return out;
}

function blocks(nodes: PMNode[] | undefined, indent = ""): string[] {
  const out: string[] = [];
  for (const n of nodes ?? []) {
    switch (n.type) {
      case "paragraph": {
        const t = inline(n.content);
        if (t.trim()) out.push(indent + t.trim().replace(/\n/g, `\n${indent}`));
        else if (!indent) out.push("");
        break;
      }
      case "heading": {
        const level = n.attrs?.level === 1 ? "###" : "####";
        const t = inline(n.content).trim();
        if (t) out.push(`${indent}${level} ${t}`);
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
              : n.type === "taskList"
                ? item.attrs?.checked
                  ? "- [x] "
                  : "- [ ] "
                : "- ";
          const [first, ...rest] = item.content ?? [];
          const firstText =
            first?.type === "paragraph" || first?.type === "heading" ? inline(first.content).trim() : "";
          out.push(`${indent}${head}${firstText}`);
          const sub = first && firstText === "" && first.type !== "paragraph" ? [first, ...rest] : rest;
          out.push(...blocks(sub, `${indent}  `));
        });
        break;
      }
      case "horizontalRule":
        out.push(`${indent}---`);
        break;
      default:
        out.push(...blocks(n.content, indent));
    }
  }
  return out;
}

/** 맨 위 블록끼리는 빈 줄로 나눈다(마크다운은 빈 줄 없는 다음 줄을 같은 문단·목록으로 읽음) */
function topBlocks(nodes: PMNode[] | undefined): string[] {
  const out: string[] = [];
  for (const n of nodes ?? []) {
    const lines = blocks([n]).filter((l, i, a) => !(l === "" && (i === 0 || i === a.length - 1)));
    if (!lines.length) continue;
    if (out.length) out.push("");
    out.push(...lines);
  }
  return out;
}

const firstLine = (lines: string[]) => {
  const l = lines.find((x) => x.trim() !== "") ?? "";
  return l.replace(/^\s*(?:[-*]|\d+\.)\s+(?:\[[ x]\]\s+)?/, "").replace(/^#+\s+/, "");
};

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const extOf = (mime: string | null | undefined) =>
  mime === "image/webp" ? "webp" : mime === "image/jpeg" ? "jpg" : "png";

/** 메모 보드 여러 주 → 마크다운 한 문서 + 함께 저장할 이미지 목록 */
export function notesToMarkdown(
  weeks: MarkdownWeek[],
  opts: MarkdownOptions,
): { markdown: string; images: MarkdownImage[] } {
  const parts: string[] = [];
  const images: MarkdownImage[] = [];
  for (const w of weeks) {
    const { start, end } = weekRange(w.weekId);
    const boxes = readingOrder(w.doc.boxes);
    if (!boxes.length && !opts.emptyWeeks) continue;
    const sec: string[] = [`# ${w.weekId} 이번 주 메모 (${md(start)}~${md(end)})`, ""];
    const titleOf = new Map<string, string>();
    for (const b of boxes) {
      let title: string;
      let body: string[];
      if (b.kind === "text") {
        const lines = topBlocks(b.content.content);
        title = firstLine(lines) || "메모";
        const firstIdx = lines.findIndex((x) => x.trim() !== "");
        // 첫 줄이 문단이면 제목으로 올리고 본문에서 뺀다(목록·체크는 그대로 둔다)
        const plain =
          firstIdx >= 0 && !/^\s*(?:[-*]|\d+\.)\s/.test(lines[firstIdx]!) && !/^#/.test(lines[firstIdx]!);
        body = plain ? lines.slice(firstIdx + 1) : lines;
      } else if (b.kind === "image") {
        title = `이미지 — ${b.caption.trim() || "설명 없음"}`;
        if (opts.images === "files") {
          const file = `${b.id}.${extOf(w.assetMime?.(b.asset))}`;
          if (!images.some((x) => x.file === file)) images.push({ assetId: b.asset, file });
          body = [
            `![${esc(b.caption.trim() || "이미지")}](${`${opts.imageDir}/${file}`.replace(/ /g, "%20")})`,
          ];
        } else body = [];
      } else {
        title = `링크 — ${b.title.trim() || b.url}`;
        body = [`<${b.url}>`, ...(b.note.trim() ? ["", esc(b.note.trim())] : [])];
      }
      titleOf.set(b.id, title);
      sec.push(`## ${title}`);
      if (opts.links && b.refs?.length) {
        for (const r of b.refs) {
          const label = w.itemLabel(r.item);
          if (label) sec.push(`> 연결: ${label}`);
        }
      }
      while (body.length && body[0] === "") body.shift();
      while (body.length && body.at(-1) === "") body.pop();
      if (body.length) sec.push("", ...body);
      sec.push("");
    }
    const edges = (w.doc.edges ?? []).filter((e) => titleOf.has(e.from) && titleOf.has(e.to));
    if (opts.edges && edges.length) {
      sec.push("---", "", "### 관계선");
      for (const e of edges) sec.push(`- ${edgeLine(e, titleOf)}`);
      sec.push("");
    }
    parts.push(
      sec
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trimEnd(),
    );
  }
  return { markdown: parts.length ? `${parts.join("\n\n")}\n` : "", images };
}

function edgeLine(e: NoteEdge, titleOf: Map<string, string>): string {
  const arrow = e.dir === "both" ? "↔" : e.dir === "none" ? "—" : e.dash ? "⇢" : "→";
  const label = e.label.trim() ? ` : ${e.label.trim()}` : "";
  const dash = e.dash ? " (점선)" : "";
  return `${titleOf.get(e.from)} ${arrow} ${titleOf.get(e.to)}${label}${dash}`;
}
