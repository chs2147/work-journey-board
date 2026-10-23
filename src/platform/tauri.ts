import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Database from "@tauri-apps/plugin-sql";
import { open } from "@tauri-apps/plugin-dialog";
import type { BackupFs } from "../data/backup";
import { openTauriSql } from "../data/drivers/tauriSql";
import { isOneDriveLike, type AppConfig, type PathInfo, type Platform } from "./index";

// 실앱(윈도우). 파일 동작은 src-tauri/src/files.rs의 얇은 명령을 쓴다(삭제·이름 바꾸기는 Rust에서도 패턴 검사).
const SEP = navigator.userAgent.includes("Windows") ? "\\" : "/";
const join = (...parts: string[]) =>
  parts
    .filter(Boolean)
    .map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, "") : p.replace(/^[\\/]+|[\\/]+$/g, "")))
    .join(SEP);

let oneDriveRoots: string[] | null = null;

const backupFs: BackupFs = {
  join,
  ensureDir: (dir) => invoke("fs_ensure_dir", { dir }),
  list: (dir) => invoke<string[]>("fs_list", { dir }),
  rename: (from, to) => invoke("fs_rename_backup", { from, to }),
  remove: (path) => invoke("fs_remove_backup", { path }),
};

export const tauriPlatform: Platform = {
  kind: "tauri",
  now: () => new Date(),

  async loadConfig() {
    const raw = await invoke<string | null>("config_read");
    if (!raw) return null;
    try {
      const c = JSON.parse(raw) as Partial<AppConfig>;
      return typeof c.dataDir === "string" && c.dataDir ? { dataDir: c.dataDir } : null;
    } catch {
      return null;
    }
  },
  saveConfig: (config) => invoke("config_write", { json: JSON.stringify(config, null, 2) }),

  async suggestedDataDir() {
    return join(await homeDir(), "WorkJourney");
  },
  async pickFolder(title) {
    const picked = await open({ directory: true, multiple: false, title });
    return typeof picked === "string" ? picked : null;
  },
  async isOneDrivePath(path) {
    oneDriveRoots ??= await invoke<string[]>("onedrive_roots");
    return isOneDriveLike(path, oneDriveRoots);
  },
  async stat(path) {
    const r = await invoke<{ exists: boolean; is_dir: boolean; size: number | null }>("fs_stat", { path });
    return { exists: r.exists, isDir: r.is_dir, size: r.size } satisfies PathInfo;
  },
  ensureDir: (dir) => invoke("fs_ensure_dir", { dir }),
  copyNew: (from, to) => invoke("fs_copy_new", { from, to }),
  openFolder: (path) => invoke("open_folder", { path }),
  join,

  openDatabase: (path) => openTauriSql(path),
  async verifyCopy(path) {
    const url = `sqlite:${path}`;
    const db = await Database.load(url);
    try {
      const rows = await db.select<{ quick_check: string }[]>("PRAGMA quick_check");
      return rows.length === 1 && rows[0]?.quick_check === "ok";
    } finally {
      await db.close(url);
    }
  },
  backupFs,

  onExit(handler) {
    const win = getCurrentWindow();
    let closing = false;
    void win.onCloseRequested(async (event) => {
      if (closing) return;
      closing = true;
      event.preventDefault();
      try {
        await handler();
      } finally {
        await win.destroy();
      }
    });
  },
};
