import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { cleanCabiContent, cabiText } from "./cabi";
import type { PMNode } from "./note";
interface Md {
  type: string;
  value?: string;
  url?: string;
  identifier?: string;
  alt?: string;
  depth?: number;
  ordered?: boolean;
  start?: number;
  checked?: boolean | null;
  lang?: string;
  children?: Md[];
}
export function importCabiMarkdown(
  source: string,
  images: Record<string, string> = {},
): { content: PMNode; title: string; excluded: number } {
  let excluded = 0;
  const text = source
    .replace(/data:[^\s<>()"']+/gi, () => {
      excluded++;
      return "";
    })
    .replace(/(?:^[ \t]*[A-Za-z0-9+/]{80,}={0,2}[ \t]*(?:\n|$))+/gm, (s) => {
      if (s.replace(/\s/g, "").length < 256) return s;
      excluded++;
      return "";
    });
  const root = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }) as Md;
  const defs = new Map<string, string>();
  const collect = (n: Md) => {
    if (n.type === "definition" && n.identifier && n.url) defs.set(n.identifier.toLowerCase(), n.url);
    n.children?.forEach(collect);
  };
  collect(root);
  const convert = (n: Md, active: NonNullable<PMNode["marks"]> = []): PMNode[] => {
    const children = () => (n.children ?? []).flatMap((c) => convert(c, active));
    switch (n.type) {
      case "text":
        return n.value ? [{ type: "text", text: n.value, ...(active.length ? { marks: active } : {}) }] : [];
      case "strong":
      case "emphasis":
      case "delete":
        return (n.children ?? []).flatMap((c) =>
          convert(c, [
            ...active,
            { type: n.type === "strong" ? "bold" : n.type === "emphasis" ? "italic" : "strike" },
          ]),
        );
      case "inlineCode":
        return [{ type: "text", text: n.value || " ", marks: [...active, { type: "code" }] }];
      case "link":
      case "linkReference": {
        const href = n.url ?? defs.get(n.identifier?.toLowerCase() ?? "") ?? "";
        if (!/^https?:\/\//i.test(href)) {
          excluded++;
          return children();
        }
        return (n.children ?? []).flatMap((c) => convert(c, [...active, { type: "link", attrs: { href } }]));
      }
      case "image":
      case "imageReference": {
        const url = n.url ?? defs.get(n.identifier?.toLowerCase() ?? "") ?? "";
        const asset = images[url.replace(/^\.\//, "")] ?? images[url.split("/").at(-1) ?? ""];
        if (asset && !/^[a-z]+:/i.test(url)) return [{ type: "image", attrs: { asset, alt: n.alt ?? "" } }];
        excluded++;
        return [
          { type: "text", text: `[${n.alt || "이미지"}]${url && !/^data:/i.test(url) ? ` (${url})` : ""}` },
        ];
      }
      case "html":
        excluded++;
        return [
          {
            type: "text",
            text:
              (n.value ?? "").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<[^>]*>/g, "") ||
              " ",
          },
        ];
      case "definition":
        return [];
      case "break":
        return [{ type: "hardBreak" }];
      case "code":
        return [
          {
            type: "codeBlock",
            attrs: { language: n.lang ?? "" },
            content: n.value ? [{ type: "text", text: n.value }] : [],
          },
        ];
      case "thematicBreak":
        return [{ type: "horizontalRule" }];
      case "heading":
        return [{ type: "heading", attrs: { level: Math.min(3, n.depth ?? 1) }, content: children() }];
      case "paragraph": {
        const parts = children(),
          out: PMNode[] = [],
          run: PMNode[] = [];
        const flush = () => {
          if (run.length) {
            out.push({ type: "paragraph", content: [...run] });
            run.length = 0;
          }
        };
        for (const part of parts) {
          if (part.type === "image") {
            flush();
            out.push(part);
          } else run.push(part);
        }
        flush();
        return out.length ? out : [{ type: "paragraph" }];
      }
      case "blockquote":
        return [{ type: "blockquote", content: children() }];
      case "list": {
        const task = (n.children ?? []).some((c) => typeof c.checked === "boolean");
        return [
          {
            type: task ? "taskList" : n.ordered ? "orderedList" : "bulletList",
            ...(n.ordered ? { attrs: { start: n.start ?? 1 } } : {}),
            content: (n.children ?? []).map((c) => ({
              type: task ? "taskItem" : "listItem",
              ...(task ? { attrs: { checked: !!c.checked } } : {}),
              content: convert(c, active),
            })),
          },
        ];
      }
      case "table":
        return [
          {
            type: "table",
            content: (n.children ?? []).map((row, i) => ({
              type: "tableRow",
              content: (row.children ?? []).map((cell) => ({
                type: i ? "tableCell" : "tableHeader",
                content: [
                  { type: "paragraph", content: (cell.children ?? []).flatMap((c) => convert(c, active)) },
                ],
              })),
            })),
          },
        ];
      case "root":
        return children();
      case "listItem":
        return children();
      default:
        return children();
    }
  };
  const content = cleanCabiContent({ type: "doc", content: convert(root) });
  const first = content.content?.find((n) => n.type === "heading" && n.attrs?.level === 1);
  return { content, title: first ? cabiText(first).trim() : "", excluded };
}
const esc = (s: string) => s.replace(/([\\`*_[\]<>|])/g, "\\$1");
export function exportCabiMarkdown(
  title: string,
  content: PMNode,
  imagePath: (id: string) => string | null = () => null,
): string {
  const inline = (n: PMNode): string => {
    if (n.type === "hardBreak") return "  \n";
    if (n.type !== "text") return (n.content ?? []).map(inline).join("");
    let t = esc(n.text ?? "");
    for (const m of n.marks ?? []) {
      if (m.type === "bold") t = `**${t}**`;
      if (m.type === "italic") t = `*${t}*`;
      if (m.type === "strike") t = `~~${t}~~`;
      if (m.type === "code") t = `\`${(n.text ?? "").replace(/`/g, "\\`")}\``;
      if (m.type === "link") t = `[${t}](${String(m.attrs?.href).replace(/\)/g, "%29")})`;
    }
    return t;
  };
  const block = (n: PMNode, depth = 0): string => {
    const inside = () => (n.content ?? []).map((c) => block(c, depth)).join("\n\n");
    switch (n.type) {
      case "doc":
        return inside();
      case "heading":
        return "#".repeat(Number(n.attrs?.level) || 1) + " " + inline(n);
      case "paragraph":
        return inline(n);
      case "blockquote":
        return inside()
          .split("\n")
          .map((l) => "> " + l)
          .join("\n");
      case "codeBlock":
        return (
          "```" +
          String(n.attrs?.language ?? "") +
          "\n" +
          (n.content ?? []).map((c) => c.text ?? "").join("") +
          "\n```"
        );
      case "horizontalRule":
        return "---";
      case "bulletList":
      case "orderedList":
      case "taskList":
        return (n.content ?? [])
          .map((item, i) => {
            const mark =
              n.type === "taskList"
                ? `- [${item.attrs?.checked ? "x" : " "}] `
                : n.type === "orderedList"
                  ? `${i + Number(n.attrs?.start ?? 1)}. `
                  : "- ";
            const text = (item.content ?? []).map((c) => block(c, depth + 1)).join("\n\n");
            return text
              .split("\n")
              .map((l, j) => (j ? " ".repeat(mark.length) : mark) + l)
              .join("\n");
          })
          .join("\n");
      case "table":
        return (n.content ?? [])
          .flatMap((row, i) => {
            const line =
              "| " + (row.content ?? []).map((c) => inline(c).replace(/\n/g, "<br>")).join(" | ") + " |";
            return i ? [line] : [line, "| " + (row.content ?? []).map(() => "---").join(" | ") + " |"];
          })
          .join("\n");
      case "image": {
        const path = imagePath(String(n.attrs?.asset));
        return path
          ? `![${esc(String(n.attrs?.alt ?? ""))}](${path})`
          : `[${String(n.attrs?.alt || "이미지 제외")}]`;
      }
      default:
        return inside();
    }
  };
  return `# ${title.replace(/\n/g, " ")}\n\n${block(content)}\n`;
}
