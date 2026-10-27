// 메모 보드 스냅샷 동작(improve-1027v3-spec 1절): 지금 주 → PNG 저장(저장 대화상자, 내보내기와 같은 규칙) · 클립보드 복사,
// 다른 주(엑셀) → 저장소에서 읽어 그린다. 파일 쓰기는 Platform만(CLAUDE.md 4-3), 외부 통신 없음.
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
import { useNote } from "./noteStore";

const colorOf = (key: string) => CATEGORY_COLORS[key as CategoryColorKey]?.light ?? CATEGORY_COLORS.c1.light;

function baseInput(weekId: WeekId, now: Date) {
  return {
    title: STR.note.snapshotHead(weekTitle(weekId)),
    subtitle: STR.note.snapshotSub(localDate(now)),
    goneText: STR.linked.gone,
    moreText: (n: number) => STR.linked.more(n).replace(/^▾ /, ""),
  };
}

/** 지금 보고 있는 주의 메모(대기 상자 빼고) */
function currentInput(now: Date): SnapshotInput {
  const { doc, assets, pendingId, weekId } = useNote.getState();
  const { view, cells } = useBoard.getState();
  const categories = (view?.categories ?? []).map((c) => c.category);
  return {
    ...baseInput(weekId, now),
    doc: { ...doc, boxes: doc.boxes.filter((b) => b.id !== pendingId) },
    images: assets,
    lines: snapLines(categories, cells, colorOf, shortDateLabel),
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
    lines: snapLines(
      view.categories.map((c) => c.category),
      view.items,
      colorOf,
      shortDateLabel,
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
  const j = useAppStore.getState().journal;
  const platform = useAppStore.getState().platform;
  if (j.state !== "ready" || !platform) return;
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
      platform.join(dir, STR.note.snapshotFileName(weekId)),
      "image",
    );
    if (!path) return;
    const problem = exportPathProblem(path, j.dataDir, "image");
    if (problem) return toast(problem);
    const webp = path.toLowerCase().endsWith(".webp");
    const { blob } = await renderNoteSnapshot(currentInput(platform.now()), {
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
  if (empty()) return toast(STR.note.snapshotEmpty);
  try {
    const { blob } = await renderNoteSnapshot(currentInput(platform?.now() ?? new Date()), { scale: 2 });
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    toast(STR.note.snapshotCopied);
  } catch {
    toast(STR.note.snapshotCopyFailed);
  }
}
