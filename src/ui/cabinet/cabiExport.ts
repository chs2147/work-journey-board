import { materializeWidgets } from "./liveWidgetModel";
import { CABI } from "../../shared/cabiStrings";
import { exportCabiMarkdown } from "../../domain/cabiMarkdown";
import { cabiText } from "../../domain/cabi";
import { readingOrder, type PMNode } from "../../domain/note";
import type { NoteAsset } from "../../data/repository";
import { baseName, dirOf, exportPathProblem } from "../../platform";
import { useAppStore } from "../common/appStore";
import { flushNote, noteExportContext, useNote } from "../note/noteStore";
import { toast } from "../board/boardStore";
import { exportImageBytes } from "../note/imageProcess";

const bytes = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
const fileName = (title: string) =>
  [...title]
    .map((c) => (c.charCodeAt(0) < 32 ? "_" : c))
    .join("")
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 100) || "Cabi.NET";
export async function writeCabiDocument(
  kind: "markdown" | "pdf",
  title: string,
  content: PMNode,
  asset: (id: string) => Promise<NoteAsset | null>,
  dataDir: string,
) {
  const p = useAppStore.getState().platform;
  if (!p) return;
  const path = await p.pickSaveFile(
    kind === "pdf" ? CABI.pdf : CABI.markdown,
    p.join(dataDir, "exports", fileName(title) + (kind === "pdf" ? ".pdf" : ".md")),
    kind,
  );
  if (!path) return;
  const problem = exportPathProblem(path, dataDir, kind);
  if (problem) throw new Error(problem);
  if (kind === "pdf") {
    const { cabiPdf } = await import("../../export/cabiPdf");
    await p.writeExport(path, await cabiPdf(title, content, asset));
  } else {
    const images = new Map<string, string>(),
      folder = baseName(path).replace(/\.md$/i, "") + "_images";
    const collect = (node: PMNode) => {
      if (node.type === "image" && typeof node.attrs?.asset === "string") images.set(node.attrs.asset, "");
      node.content?.forEach(collect);
    };
    collect(content);
    for (const id of images.keys()) {
      const a = await asset(id);
      if (!a) throw new Error(CABI.assetMissing);
      const ext = a.mime === "image/jpeg" ? "jpg" : a.mime.split("/")[1],
        name = `${id}.${ext}`;
      images.set(id, folder + "/" + name);
      await p.writeExport(p.join(dirOf(path), folder, name), bytes(a.data));
    }
    await p.writeExport(
      path,
      new TextEncoder().encode(exportCabiMarkdown(title, content, (id) => images.get(id) ?? null)),
    );
  }
  toast(CABI.exportDone);
}
export async function exportTaskBoard() {
  await flushNote(true, true);
  const current = noteExportContext(),
    s = useNote.getState();
  if (!current) return;
  const doc = s.task ? await materializeWidgets(s.doc, s.task.categoryId) : s.doc;
  const content: PMNode = {
    type: "doc",
    content: readingOrder(doc.boxes).flatMap((b): PMNode[] => {
      if (b.kind === "text") return b.content.content ?? [];
      if (b.kind === "image") return [{ type: "image", attrs: { asset: b.asset, alt: b.caption } }];
      return [
        {
          type: "paragraph",
          content: [
            { type: "text", text: b.title, marks: [{ type: "link", attrs: { href: b.url } }] },
            { type: "text", text: " " + b.note },
          ],
        },
      ];
    }),
  };
  if (s.doc.edges?.length)
    content.content!.push(
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "관계선" }] },
      ...s.doc.edges.map((e) => ({
        type: "paragraph",
        content: [{ type: "text", text: `${e.from} → ${e.to}${e.label ? ": " + e.label : ""}` }],
      })),
    );
  await writeCabiDocument(
    "markdown",
    s.task?.title ?? CABI.board,
    content,
    (id) => current.repo.getNoteAsset(id),
    current.dataDir,
  );
}
export async function pdfImage(a: NoteAsset) {
  return a.mime === "image/jpeg" || a.mime === "image/png"
    ? { mime: a.mime, data: bytes(a.data) }
    : { mime: "image/png", data: await exportImageBytes(a.mime, a.data, "png") };
}
export const notePlainText = cabiText;
