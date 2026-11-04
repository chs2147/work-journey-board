// Markdown → 일반 문단 + 기존 링크 mark. AST/HTML 파서는 네트워크·렌더링·스크립트를 실행하지 않는다.
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { Parser } from "htmlparser2";
import { isOpenableUrl, splitLinks } from "./links";
import type { PMNode } from "./note";

type MdNode = {
  type: string;
  value?: string;
  url?: string;
  alt?: string | null;
  identifier?: string;
  children?: MdNode[];
};
export const MARKDOWN_MAX_BYTES = 5 * 1024 * 1024;
export const MARKDOWN_MAX_FILES = 10;
export const isMarkdownFile = (name: string) => /\.(md|markdown)$/i.test(name);

/** 명시적인 data URI 및 충분히 긴 연속 base64 첨부 블록만 제외한다. */
function stripPayloads(source: string): { text: string; excluded: boolean } {
  let excluded = false;
  let text = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (/^---\n/.test(text)) text = text.replace(/^---\n[\s\S]*?\n(?:---|\.\.\.)\s*(?:\n|$)/, "");
  text = text.replace(
    /data:[^\s<>"'()]*?,[ \t]*(?:\n[ \t]*)?[^\s<>"'()]+(?:\n[ \t]*[A-Za-z0-9+/_=-]{40,})*/gi,
    () => {
      excluded = true;
      return "";
    },
  );
  text = text.replace(/(?:^[ \t]*[A-Za-z0-9+/_=-]{40,}[ \t]*(?:\n|$))+/gm, (block) => {
    const compact = block.replace(/\s/g, "");
    const lines = block.trim().split("\n").length;
    if (
      compact.length >= 128 &&
      (lines >= 3 || compact.length >= 256) &&
      /[A-Z]/.test(compact) &&
      /[a-z]/.test(compact) &&
      /[0-9+/=_-]/.test(compact)
    ) {
      excluded = true;
      return "";
    }
    return block;
  });
  return { text, excluded };
}

export function markdownToNote(source: string): { content: PMNode; text: string; excluded: boolean } {
  const clean = stripPayloads(source);
  let excluded = clean.excluded;
  const tree: MdNode = fromMarkdown(clean.text, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  const definitions = new Map<string, string>();
  const collect = (n: MdNode) => {
    if (n.type === "definition" && n.identifier && n.url) definitions.set(n.identifier.toLowerCase(), n.url);
    n.children?.forEach(collect);
  };
  collect(tree);
  const paragraphs: PMNode[] = [];
  let inline: PMNode[] = [];
  const line = () => {
    if (inline.length) {
      paragraphs.push({ type: "paragraph", content: inline });
      inline = [];
    }
  };
  const text = (value: string, href?: string) => {
    if (!value) return;
    if (href && isOpenableUrl(href)) {
      inline.push({ type: "text", text: value, marks: [{ type: "link", attrs: { href } }] });
      return;
    }
    // 단독 URL도 기존 URL 검증·문장 부호 처리로 링크화한다.
    for (const part of splitLinks(value)) {
      inline.push({
        type: "text",
        text: part.text,
        ...(part.url ? { marks: [{ type: "link", attrs: { href: part.url } }] } : {}),
      });
    }
  };
  const html = new Parser(
    {
      onopentag(name, attrs) {
        if (["script", "style", "iframe", "object", "template", "svg", "noscript"].includes(name)) {
          hidden++;
          excluded = true;
        }
        if (name === "img") {
          excluded = true;
          if (!hidden && attrs.alt) text(attrs.alt);
        }
        if (hidden) return;
        if (name === "a") htmlLink = attrs.href && isOpenableUrl(attrs.href) ? attrs.href : undefined;
        if (["p", "div", "br", "li", "tr", "h1", "h2", "h3", "pre"].includes(name)) line();
      },
      ontext(value) {
        if (!hidden) text(value, htmlLink);
      },
      onclosetag(name) {
        if (["script", "style", "iframe", "object", "template", "svg", "noscript"].includes(name))
          hidden = Math.max(0, hidden - 1);
        if (name === "a") htmlLink = undefined;
        if (!hidden && ["p", "div", "li", "tr", "h1", "h2", "h3", "pre"].includes(name)) line();
      },
    },
    { decodeEntities: true },
  );
  let hidden = 0;
  let htmlLink: string | undefined;
  const walk = (n: MdNode, href?: string) => {
    if (n.type === "definition") return;
    if (n.type === "html") {
      html.write(n.value ?? "");
      return;
    }
    if (hidden) return;
    if (n.type === "image" || n.type === "imageReference") {
      excluded = true;
      text(n.alt ?? "");
      return;
    }
    if (n.type === "link" || n.type === "linkReference") {
      const url = n.url ?? definitions.get(n.identifier?.toLowerCase() ?? "");
      n.children?.forEach((c) => walk(c, url && isOpenableUrl(url) ? url : undefined));
      return;
    }
    if (n.type === "text" || n.type === "inlineCode") {
      text(n.value ?? "", href ?? htmlLink);
      return;
    }
    if (n.type === "code") {
      line();
      (n.value ?? "").split("\n").forEach((v) => {
        text(v);
        line();
      });
      return;
    }
    if (n.type === "break") {
      inline.push({ type: "hardBreak" });
      return;
    }
    if (n.type === "tableRow") {
      line();
      n.children?.forEach((c, i) => {
        if (i) text("\t");
        c.children?.forEach((v) => walk(v));
      });
      line();
      return;
    }
    const block = ["paragraph", "heading", "listItem", "blockquote", "thematicBreak"].includes(n.type);
    if (block) line();
    n.children?.forEach((c) => walk(c, href));
    if (block) line();
  };
  walk(tree);
  html.end();
  line();
  const content: PMNode = { type: "doc", content: paragraphs.length ? paragraphs : [{ type: "paragraph" }] };
  return {
    content,
    text: paragraphs
      .map((p) => p.content?.map((n) => n.text ?? (n.type === "hardBreak" ? "\n" : "")).join("") ?? "")
      .join("\n"),
    excluded,
  };
}
