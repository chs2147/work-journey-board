import type { NoteRepository } from "../note/noteStore";
import { cabiCall, cabiClient } from "./cabiService";
import type { TaskBoard } from "../../domain/cabi";

/** Same board engine, explicit task owner: no synthetic week row or week asset IDs. */
export function taskNotePort(initial: TaskBoard): NoteRepository {
  let board = initial;
  let saves: Promise<unknown> = Promise.resolve();
  const r = cabiClient();
  return {
    getSettings: () => cabiCall("settings"),
    updateSettings: (patch) => cabiCall("settings", patch),
    getItemsByIds: (ids) => cabiCall("items", ids),
    async getWeekNote() {
      const fresh = await r.board(board.categoryId);
      if (!fresh) throw new Error("업무 보드를 찾을 수 없습니다.");
      if (fresh.revision === board.revision) board = fresh;
      return { doc: fresh.doc, legacy: false };
    },
    async saveWeekNote(_week, doc, baseline) {
      const job = saves.then(async () => {
        board = await r.saveBoard(board.categoryId, board.revision, doc, baseline);
      });
      saves = job.catch(() => undefined);
      await job;
    },
    getNoteAssetMeta: () => r.assetMeta("board", board.id),
    getNoteAssets: () => r.assets("board", board.id),
    getNoteAsset: (id) => r.asset(id),
    getNoteAssetView: (id) => r.assetView(id),
    setNoteAssetThumb: (id, thumb) => r.setThumb(id, thumb),
    addNoteAsset: (_week, a, thumb) => r.addAsset("board", board.id, a, thumb),
    pruneNoteAssets: (_week, keep) => r.pruneAssets("board", board.id, keep),
  };
}
