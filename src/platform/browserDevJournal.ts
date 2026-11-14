// 브라우저 모드(가짜 폴더)의 DEV 일지 폴더 다루기 — 실앱 Rust `dev_guard.rs`와 같은 규칙(시험·개발용)
import { DATA_FILE } from "../data/backup";
import { OfficialJournalError, type DevFolderStatus, type DevJournalOps } from "./index";
import type { FakeFs } from "./fakeFs";

export const DEV_MARKER = ".wjb-dev-journal";

export function browserDevJournal(fs: FakeFs): DevJournalOps {
  const status = async (dir: string): Promise<DevFolderStatus> => {
    if (!(await fs.stat(dir)).isDir) return "missing";
    if ((await fs.stat(fs.join(dir, DEV_MARKER))).exists) return "dev";
    return (await fs.stat(fs.join(dir, DATA_FILE))).exists ? "official" : "empty";
  };
  const mark = (dir: string, how: string) =>
    fs.writeFile(fs.join(dir, DEV_MARKER), new TextEncoder().encode(JSON.stringify({ channel: "dev", how })));
  return {
    folderStatus: status,
    async prepareFolder(dir) {
      const s = await status(dir);
      if (s === "dev") return;
      if (s === "empty") return mark(dir, "new");
      if (s === "official") throw new OfficialJournalError(dir);
      throw new Error("FOLDER_MISSING");
    },
    async copyOfficial(src, dest) {
      if ((await status(src)) !== "official") throw new Error("SOURCE_NOT_OFFICIAL");
      const n = (p: string) => p.replace(/\/+$/, "");
      if (n(dest) === n(src) || n(dest).startsWith(n(src) + "/") || n(src).startsWith(n(dest) + "/"))
        throw new Error("DEST_OVERLAPS_SOURCE");
      await fs.ensureDir(dest);
      if ((await status(dest)) !== "empty") throw new Error("DEST_NOT_EMPTY");
      await fs.copyNew(fs.join(src, DATA_FILE), fs.join(dest, DATA_FILE));
      mark(dest, "copy-official");
    },
  };
}
