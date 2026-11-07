// 메모 보드 스냅샷 동작(improve-1027v3-spec 1절): 지금 주 → PNG 저장(저장 대화상자, 내보내기와 같은 규칙) · 클립보드 복사,
// 다른 주(엑셀) → 저장소에서 읽어 그린다. 파일 쓰기는 Platform만(CLAUDE.md 4-3), 외부 통신 없음.
import type { NoteDoc } from "../../domain/note";
import { workspacePart } from "../../export/filename";
import { workspaceLabel } from "../common/appController";
import type { JournalRepository } from "../../data/repository";
import { localDate } from "../../domain/localTime";
import { weekList } from "../../data/repository";
import { shortDateLabel, weekTitle, type WeekId } from "../../domain/week";
import { renderNoteSnapshot, snapLines, type SnapshotInput } from "../../export/noteSnapshot";
import { baseName, dirOf, exportPathProblem } from "../../platform";
import { CATEGORY_COLORS, type CategoryColorKey } from "../../shared/palette";
import { STR } from "../../shared/strings";
import { reportError, toast, useBoard } from "../board/boardStore";
import { useAppStore } from "../common/appStore";
import { useNote, noteExportContext, type NoteRepository } from "./noteStore";

const colorOf = (key: string) => CATEGORY_COLORS[key as CategoryColorKey]?.light ?? CATEGORY_COLORS.c1.light;

function baseInput(weekId: WeekId, now: Date) {
  return {
    title: STR.note.snapshotHead(weekTitle(weekId)),
    subtitle: STR.note.snapshotSub(localDate(now)),
    goneText: STR.linked.gone,
    moreText: (n: number) => STR.linked.more(n).replace(/^▾ /, ""),
  };
}

/** Cross-week shared links use the original entry's current label in PNG/Excel, too. */
async function linkedLines(
  repo: Pick<JournalRepository, "getItemsByIds">,
  doc: NoteDoc,
  lines: SnapshotInput["lines"],
) {
  const missing = [...new Set(doc.boxes.flatMap((b) => b.refs?.map((r) => r.item) ?? []))].filter(
    (id) => !lines[id],
  );
  for (const it of await repo.getItemsByIds(missing))
    lines[it.id] = {
      catName: it.categoryName,
      color: colorOf(it.categoryColor),
      dateLabel: shortDateLabel(it.date),
      text: it.text,
      order: `9999|${it.date}|${String(it.seq).padStart(4, "0")}`,
      flagged: !!it.flagged,
      done: !it.flagged && !!it.flagDoneAt,
    };
  return lines;
}

/** 지금 보고 있는 주의 메모(대기 상자 빼고) — 이미지는 원본을 이때만 읽는다(스토어는 크기만 들고 있음) */
async function currentInput(repo: NoteRepository, now: Date): Promise<SnapshotInput> {
  const { doc, pendingId, weekId, task } = useNote.getState();
  const frozen = task
    ? await (
        await import("../cabinet/liveWidgetModel")
      ).rasterizeWidgets(doc, task.categoryId, localDate(now))
    : { doc, images: {} };
  const assets = Object.fromEntries((await repo.getNoteAssets(weekId)).map(({ id, ...a }) => [id, a]));
  const { view, cells } = useBoard.getState();
  const categories = (view?.categories ?? []).map((c) => c.category);
  return {
    ...(useNote.getState().task
      ? {
          title: useNote.getState().task!.title,
          subtitle: STR.note.snapshotSub(localDate(now)),
          goneText: STR.linked.gone,
          moreText: (n: number) => STR.linked.more(n).replace(/^▾ /, ""),
        }
      : baseInput(weekId, now)),
    doc: { ...frozen.doc, boxes: frozen.doc.boxes.filter((b) => b.id !== pendingId) },
    images: { ...assets, ...frozen.images },
    lines: await linkedLines(repo, doc, snapLines(categories, cells, colorOf, shortDateLabel)),
  };
}

/** 저장소에서 읽은 그 주 메모 — 엑셀 "메모 보드" 시트용. 상자가 없으면 null */
export async function weekSnapshotInput(
  repo: JournalRepository,
  weekId: WeekId,
  now: Date,
): Promise<SnapshotInput | null> {
  const [view, rows] = await Promise.all([repo.getWeek(weekId), repo.getNoteAssets(weekId)]);
  if (!view.note.boxes.length) return null;
  return {
    ...baseInput(weekId, now),
    doc: view.note,
    images: Object.fromEntries(rows.map(({ id, ...a }) => [id, a])),
    lines: await linkedLines(
      repo,
      view.note,
      snapLines(
        view.categories.map((c) => c.category),
        view.items,
        colorOf,
        shortDateLabel,
      ),
    ),
  };
}

/** 범위 안 메모(상자 1개 이상)가 있는 주 — 예전 요일 메모도 주간 메모로 읽어 센다 */
export async function memoWeeks(repo: JournalRepository, from: WeekId, to: WeekId): Promise<WeekId[]> {
  const out: WeekId[] = [];
  for (const w of weekList(from, to)) if ((await repo.getWeekNote(w)).doc.boxes.length) out.push(w);
  return out;
}

const empty = () => {
  const { doc, pendingId } = useNote.getState();
  return !doc.boxes.some((b) => b.id !== pendingId);
};

/** [PNG 그림으로 저장…] */
export async function saveSnapshot() {
  const j = noteExportContext();
  const platform = useAppStore.getState().platform;
  if (!j || !platform) return;
  if (empty()) return toast(STR.note.snapshotEmpty);
  try {
    const settings = await j.repo.getSettings();
    let dir = settings.ui.lastExportDir;
    if (!dir || !(await platform.stat(dir)).isDir) {
      dir = platform.join(j.dataDir, "exports");
      await platform.ensureDir(dir);
    }
    const weekId = useNote.getState().weekId;
    const path = await platform.pickSaveFile(
      STR.note.snapshotTitle,
      platform.join(dir, STR.note.snapshotFileName(workspacePart(workspaceLabel()) + weekId)),
      "image",
    );
    if (!path) return;
    const problem = exportPathProblem(path, j.dataDir, "image");
    if (problem) return toast(problem);
    const webp = path.toLowerCase().endsWith(".webp");
    const { blob } = await renderNoteSnapshot(await currentInput(j.repo, platform.now()), {
      scale: 2,
      type: webp ? "image/webp" : "image/png",
    });
    await platform.writeExport(path, new Uint8Array(await blob.arrayBuffer()));
    await j.repo.updateSettings({ ui: { lastExportDir: dirOf(path) } });
    toast(STR.note.snapshotSaved(baseName(path)));
  } catch (e) {
    reportError(e);
  }
}

/** [그림으로 복사] — 메일·문서에 붙여넣기 */
export async function copySnapshot() {
  const platform = useAppStore.getState().platform;
  const j = noteExportContext();
  if (!j) return;
  if (empty()) return toast(STR.note.snapshotEmpty);
  try {
    // ClipboardItem은 누른 즉시(사용자 동작 안에서) 만들고 그림은 Promise로 넘긴다 — 맥 WKWebView(WebKit)는
    // 그림을 다 그린 뒤 만들면 거부한다(macos-spec W12). WebView2(Chromium)도 같은 형태를 받는다
    const blob = currentInput(j.repo, platform?.now() ?? new Date())
      .then((input) => renderNoteSnapshot(input, { scale: 2 }))
      .then((r) => r.blob);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    toast(STR.note.snapshotCopied);
  } catch {
    toast(STR.note.snapshotCopyFailed);
  }
}
