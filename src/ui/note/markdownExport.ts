// 메모 보드 마크다운 내보내기(features-1102-spec F4): 범위의 주간 메모를 모아 마크다운 + 이미지 목록을 만들고,
// 저장 대화상자에서 고른 .md와 옆 `<이름>_images` 폴더에 쓴다(Platform.writeExport — Rust가 확장자·폴더 재검사). 네트워크 없음.
import { create } from "zustand";
import type { JournalRepository } from "../../data/repository";
import { emptyDoc, type NoteDoc } from "../../domain/note";
import {
  addDays,
  DAY_LABELS,
  dayIndex,
  weekIdOf,
  weekRange,
  type DateStr,
  type WeekId,
} from "../../domain/week";
import { notesToMarkdown, type MarkdownOptions } from "../../export/noteMarkdown";
import { baseName, dirOf, exportPathProblem, MD_IMAGE_DIR_SUFFIX } from "../../platform";
import { STR } from "../../shared/strings";
import { reportError, toast, useBoard } from "../board/boardStore";
import { useAppStore } from "../common/appStore";
import { flushNote, useNote } from "./noteStore";

export type MdRange = "week" | "4w" | "custom";

interface MdExportState {
  open: boolean;
  range: MdRange;
  from: DateStr;
  to: DateStr;
  links: boolean;
  edges: boolean;
  emptyWeeks: boolean;
  images: "files" | "none";
}

export const useMdExport = create<MdExportState>(() => ({
  open: false,
  range: "week",
  from: "",
  to: "",
  links: true,
  edges: true,
  emptyWeeks: false,
  images: "files",
}));

export function openMdExport() {
  const { weekId, today } = useBoard.getState();
  const { start } = weekRange(weekId);
  useMdExport.setState({ open: true, range: "week", from: addDays(start, -21), to: today || start });
}
export const closeMdExport = () => useMdExport.setState({ open: false });

/** 고른 범위의 주 목록(오래된 주 먼저) — 기간 지정은 최대 53주 */
export function rangeWeeks(s: MdExportState, weekId: WeekId): WeekId[] | null {
  if (s.range === "week") return [weekId];
  const end = s.range === "4w" ? weekRange(weekId).end : s.to;
  const start = s.range === "4w" ? addDays(weekRange(weekId).start, -21) : s.from;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) return null;
  const out: WeekId[] = [];
  for (let d = weekRange(weekIdOf(start)).start; d <= end && out.length <= 53; d = addDays(d, 7))
    out.push(weekIdOf(d));
  return out.length > 53 ? null : out;
}

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}(${DAY_LABELS[dayIndex(d)]})`;

export function fileLabel(weeks: WeekId[]) {
  return weeks.length === 1 ? weeks[0]! : `${weeks[0]}~${weeks.at(-1)!.slice(5)}`;
}

/** 범위의 메모 → 마크다운(지금 보고 있는 주는 화면의 최신 문서) */
export async function buildMarkdown(repo: JournalRepository, s: MdExportState, imageDir: string) {
  const weekId = useBoard.getState().weekId;
  const weeks = rangeWeeks(s, weekId);
  if (!weeks) return null;
  await flushNote();
  const saved = await repo.getWeekNotesBetween(weeks[0]!, weeks.at(-1)!);
  const docs: Record<WeekId, NoteDoc> = { ...saved };
  const live = useNote.getState();
  if (weeks.includes(live.weekId)) docs[live.weekId] = live.doc;
  const input = await Promise.all(
    weeks.map(async (w) => {
      const doc = docs[w] ?? emptyDoc();
      const needItems = s.links && doc.boxes.some((b) => b.refs?.length);
      const view = needItems ? await repo.getWeek(w, { note: false }) : null;
      const names = new Map(view?.categories.map((c) => [c.category.id, c.category.name]) ?? []);
      const items = new Map(
        Object.values(view?.items ?? {})
          .flat()
          .map((it) => [it.id, it]),
      );
      const metas = doc.boxes.some((b) => b.kind === "image") ? await repo.getNoteAssetMeta(w) : [];
      const mime = new Map(metas.map((m) => [m.id, m.mime]));
      return {
        weekId: w,
        doc,
        itemLabel: (id: string) => {
          const it = items.get(id);
          return it ? `${names.get(it.categoryId) ?? ""} · ${md(it.date)} · ${it.text}` : null;
        },
        assetMime: (id: string) => mime.get(id) ?? null,
      };
    }),
  );
  const opts: MarkdownOptions = {
    links: s.links,
    edges: s.edges,
    emptyWeeks: s.emptyWeeks,
    images: s.images,
    imageDir,
  };
  return { weeks, ...notesToMarkdown(input, opts) };
}

const b64 = (data: string) => Uint8Array.from(atob(data), (c) => c.charCodeAt(0));

export async function saveMarkdown() {
  const j = useAppStore.getState().journal;
  const platform = useAppStore.getState().platform;
  if (j.state !== "ready" || !platform) return;
  const s = useMdExport.getState();
  try {
    const weeks = rangeWeeks(s, useBoard.getState().weekId);
    if (!weeks) return toast(STR.mdExport.badRange);
    const settings = await j.repo.getSettings();
    let dir = settings.ui.lastExportDir;
    if (!dir || !(await platform.stat(dir)).isDir) {
      dir = platform.join(j.dataDir, "exports");
      await platform.ensureDir(dir);
    }
    const path = await platform.pickSaveFile(
      STR.mdExport.saveTitle,
      platform.join(dir, STR.mdExport.fileName(fileLabel(weeks))),
      "markdown",
    );
    if (!path) return;
    const problem = exportPathProblem(path, j.dataDir, "markdown");
    if (problem) return toast(problem);
    const stem = baseName(path).replace(/\.md$/i, "");
    const imageDir = `${stem}${MD_IMAGE_DIR_SUFFIX}`;
    const built = await buildMarkdown(j.repo, s, imageDir);
    if (!built) return toast(STR.mdExport.badRange);
    let n = 0;
    for (const img of built.images) {
      const asset = await j.repo.getNoteAsset(img.assetId);
      if (!asset) continue;
      const p = platform.join(dirOf(path), imageDir, img.file);
      if (exportPathProblem(p, j.dataDir, "markdownImage")) continue;
      await platform.writeExport(p, b64(asset.data));
      n++;
    }
    await platform.writeExport(path, new TextEncoder().encode(built.markdown));
    await j.repo.updateSettings({ ui: { lastExportDir: dirOf(path) } });
    closeMdExport();
    toast(STR.mdExport.saved(baseName(path), n));
  } catch (e) {
    reportError(e);
  }
}

export async function copyMarkdown() {
  const j = useAppStore.getState().journal;
  const platform = useAppStore.getState().platform;
  if (j.state !== "ready" || !platform) return;
  try {
    const built = await buildMarkdown(j.repo, { ...useMdExport.getState(), images: "none" }, "");
    if (!built) return toast(STR.mdExport.badRange);
    await platform.writeClipboard(built.markdown);
    toast(STR.mdExport.copied);
  } catch (e) {
    reportError(e);
  }
}
