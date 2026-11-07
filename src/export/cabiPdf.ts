import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import type { PMNode } from "../domain/note";
import type { NoteAsset } from "../data/repository";
import { cabiText } from "../domain/cabi";
import { pdfImage } from "../ui/cabinet/cabiExport";

/** Local embedded CJK font + selectable text. Deterministic pagination, no print dialog/network. */
export async function cabiPdf(
  title: string,
  content: PMNode,
  asset: (id: string) => Promise<NoteAsset | null>,
): Promise<Uint8Array> {
  const [{ default: fontkit }, { fontData }] = await Promise.all([
    import("@pdf-lib/fontkit"),
    import("./cabiPdfFont"),
  ]);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const data = fontData.slice(fontData.indexOf(",") + 1),
    font = await pdf.embedFont(
      Uint8Array.from(atob(data), (c) => c.charCodeAt(0)),
      { subset: false },
    );
  pdf.setTitle(title);
  pdf.setCreator("Work Journey Board · Cabi.NET");
  const width = 595.28,
    height = 841.89,
    margin = 48,
    bottom = 50;
  let page = pdf.addPage([width, height]),
    y = height - margin;
  const newPage = () => {
    page = pdf.addPage([width, height]);
    y = height - margin;
  };
  const ensure = (h: number) => {
    if (y - h < bottom) newPage();
  };
  const wrap = (text: string, size: number, max: number) => {
    const lines: string[] = [];
    for (const paragraph of text.replace(/\t/g, "    ").split("\n")) {
      let line = "";
      for (const ch of paragraph) {
        if (line && font.widthOfTextAtSize(line + ch, size) > max) {
          lines.push(line);
          line = ch;
        } else line += ch;
      }
      lines.push(line);
    }
    return lines;
  };
  const draw = (text: string, size = 11, indent = 0, bg = false) => {
    const lineHeight = size * 1.65;
    for (const line of wrap(text, size, width - margin * 2 - indent)) {
      ensure(lineHeight);
      if (bg)
        page.drawRectangle({
          x: margin + indent - 4,
          y: y - lineHeight + 4,
          width: width - margin * 2 - indent + 8,
          height: lineHeight,
          color: rgb(0.95, 0.95, 0.93),
        });
      page.drawText(printable(line, font), {
        x: margin + indent,
        y: y - size,
        size,
        font,
        color: rgb(0.2, 0.23, 0.18),
      });
      y -= lineHeight;
    }
  };
  draw(title, 23);
  y -= 15;
  const render = async (n: PMNode, indent = 0, numberPath: number[] = []): Promise<void> => {
    if (n.type === "doc") {
      for (const child of n.content ?? []) await render(child, indent, numberPath);
      return;
    }
    if (n.type === "heading") {
      y -= 10;
      draw(
        cabiText(n).trim(),
        Number(n.attrs?.level) === 1 ? 20 : Number(n.attrs?.level) === 2 ? 16 : 13,
        indent,
      );
      y -= 7;
      return;
    }
    if (n.type === "bulletList" || n.type === "orderedList" || n.type === "taskList") {
      for (const [i, item] of (n.content ?? []).entries()) {
        const prefix =
          n.type === "orderedList"
            ? `${[...numberPath, i + Number(n.attrs?.start ?? 1)].join("-")}. `
            : n.type === "taskList"
              ? item.attrs?.checked
                ? "☑ "
                : "☐ "
              : "• ";
        const [first, ...rest] = item.content ?? [];
        if (first) draw(prefix + cabiText(first).trim(), 11, indent + 12);
        for (const child of rest)
          await render(
            child,
            indent + 18,
            n.type === "orderedList" ? [...numberPath, i + Number(n.attrs?.start ?? 1)] : [],
          );
      }
      y -= 6;
      return;
    }
    if (n.type === "horizontalRule") {
      ensure(16);
      page.drawLine({
        start: { x: margin, y: y - 8 },
        end: { x: width - margin, y: y - 8 },
        thickness: 0.6,
        color: rgb(0.68, 0.72, 0.65),
      });
      y -= 21;
      return;
    }
    if (n.type === "table") {
      for (const row of n.content ?? []) {
        const cells = row.content ?? [],
          cw = (width - margin * 2 - indent) / Math.max(1, cells.length),
          lines = cells.map((c) => wrap(cabiText(c).trim(), 10, cw - 14)),
          max = Math.max(1, ...lines.map((l) => l.length));
        let offset = 0;
        while (offset < max) {
          const available = Math.floor((y - bottom - 16) / 16);
          if (available < 1) {
            newPage();
            continue;
          }
          const count = Math.min(available, max - offset),
            rh = count * 16 + 14;
          ensure(rh);
          cells.forEach((cell, i) => {
            page.drawRectangle({
              x: margin + indent + i * cw,
              y: y - rh,
              width: cw,
              height: rh,
              borderWidth: 0.5,
              borderColor: rgb(0.68, 0.72, 0.64),
              color: cell.type === "tableHeader" ? rgb(0.93, 0.95, 0.91) : rgb(1, 1, 1),
            });
            for (let line = 0; line < count; line++) {
              const text = lines[i]?.[offset + line];
              if (text)
                page.drawText(printable(text, font), {
                  x: margin + indent + i * cw + 7,
                  y: y - 17 - line * 16,
                  size: 10,
                  font,
                });
            }
          });
          y -= rh;
          offset += count;
          if (offset < max) newPage();
        }
      }
      y -= 12;
      return;
    }
    if (n.type === "image") {
      const a = await asset(String(n.attrs?.asset));
      if (a) {
        const converted = await pdfImage(a),
          img =
            converted.mime === "image/jpeg"
              ? await pdf.embedJpg(converted.data)
              : await pdf.embedPng(converted.data);
        const scale = Math.min(1, (width - margin * 2 - indent) / img.width, 360 / img.height),
          h = img.height * scale;
        ensure(h + 20);
        page.drawImage(img, { x: margin + indent, y: y - h, width: img.width * scale, height: h });
        y -= h + 12;
      } else draw(String(n.attrs?.alt ?? "이미지 없음"), 10, indent);
      return;
    }
    if (n.type === "blockquote") {
      for (const c of n.content ?? []) await render(c, indent + 18, numberPath);
      return;
    }
    draw(cabiText(n).trim(), n.type === "codeBlock" ? 10 : 11, indent, n.type === "codeBlock");
    y -= 9;
  };
  await render(content);
  for (const [i, p] of pdf.getPages().entries())
    p.drawText(String(i + 1), { x: width / 2, y: 25, size: 9, font, color: rgb(0.5, 0.55, 0.46) });
  return pdf.save();
}
function printable(s: string, font: PDFFont) {
  return [...s]
    .map((ch) => {
      try {
        font.encodeText(ch);
        return ch;
      } catch {
        return "□";
      }
    })
    .join("");
}
