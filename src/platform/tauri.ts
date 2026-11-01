import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { homeDir } from "@tauri-apps/api/path";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getAllWebviewWindows, WebviewWindow } from "@tauri-apps/api/webviewWindow";
import Database from "@tauri-apps/plugin-sql";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { BackupFs } from "../data/backup";
import { openTauriSql } from "../data/drivers/tauriSql";
import type { FsEntry } from "../domain/cabinet";
import {
  isOneDriveLike,
  mergeConfigJson,
  parseConfig,
  type PathInfo,
  type FolderWindowEvent,
  type FolderWindows,
  type Platform,
  type SplashWindow,
  type UpdateInfo,
} from "./index";
import { SPLASH_STATUS_EVENT } from "./splashEvents";

// 실앱(윈도우). 파일 동작은 src-tauri/src/files.rs의 얇은 명령을 쓴다(삭제·이름 바꾸기는 Rust에서도 패턴 검사).
const SEP = navigator.userAgent.includes("Windows") ? "\\" : "/";
const join = (...parts: string[]) =>
  parts
    .filter(Boolean)
    .map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, "") : p.replace(/^[\\/]+|[\\/]+$/g, "")))
    .join(SEP);

let oneDriveRoots: string[] | null = null;

// 시작 스플래시 창(tauri.conf.json의 "splash"). 메인 창은 숨긴 채 시작하고 finish()에서 보인다(src-tauri/src/splash.rs).
let splashOpen = true;
const splash: SplashWindow = {
  status(text) {
    if (splashOpen) void emitTo("splash", SPLASH_STATUS_EVENT, text).catch(() => undefined);
  },
  async finish() {
    splashOpen = false;
    await invoke("splash_finish");
  },
};

// Cabinet 폴더 창(features-1102-spec F5): 폴더마다 별도 OS 창 `folder-<id>` — 같은 앱 화면(index.html?win=folder)을 띄운다.
// 창 위치·크기는 window-state 플러그인이 창 이름별로 기억한다. 폴더 창에는 DB 권한이 없다(capabilities/folder.json).
const FOLDER_EVENT = "cabinet-folder";
/** cabinet.rs DROP_MESSAGE·DROP_EVENT와 같아야 한다 */
const DROP_MESSAGE = "wjb-cabinet-drop";
const DROP_EVENT = "cabinet-drop";
const folderLabel = (id: string) => `folder-${id.replace(/[^A-Za-z0-9_-]/g, "")}`;

const folderWindows: FolderWindows = {
  async open(spec) {
    const label = folderLabel(spec.id);
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      await existing.unminimize().catch(() => undefined);
      await existing.setFocus();
      return;
    }
    const q = new URLSearchParams({ win: "folder", d: JSON.stringify(spec) });
    const w = new WebviewWindow(label, {
      url: `index.html?${q.toString()}`,
      title: `${spec.title} — Cabinet`,
      width: 760,
      height: 520,
      minWidth: 460,
      minHeight: 300,
      dragDropEnabled: false,
      focus: true,
    });
    void w.once("tauri://destroyed", () => {
      void emitTo("main", FOLDER_EVENT, { type: "closed", id: spec.id } satisfies FolderWindowEvent);
    });
  },
  async closeAll() {
    const all = await getAllWebviewWindows();
    await Promise.all(
      all.filter((w) => w.label.startsWith("folder-")).map((w) => w.destroy().catch(() => undefined)),
    );
  },
  async onEvent(cb) {
    return listen<FolderWindowEvent>(FOLDER_EVENT, (e) => cb(e.payload));
  },
  async notifyNav(id, sub) {
    await emitTo("main", FOLDER_EVENT, { type: "nav", id, sub } satisfies FolderWindowEvent);
  },
};

/** 끌어 놓은 File → WebView2가 아는 경로(cabinet.rs 다리). 다리가 없거나 1.5초 안에 답이 없으면 null */
async function droppedPaths(files: File[]): Promise<{ path: string; isDir: boolean }[] | null> {
  const wv = (
    globalThis as {
      chrome?: { webview?: { postMessageWithAdditionalObjects?: (m: string, o: File[]) => void } };
    }
  ).chrome?.webview;
  if (!wv?.postMessageWithAdditionalObjects || !files.length) return null;
  const paths = await new Promise<string[] | null>((resolve) => {
    let done = false;
    let off: (() => void) | null = null;
    const finish = (v: string[] | null) => {
      if (done) return;
      done = true;
      off?.();
      resolve(v);
    };
    void listen<string[]>(DROP_EVENT, (e) => finish(e.payload)).then((u) => {
      off = u;
      if (done) u();
      try {
        wv.postMessageWithAdditionalObjects!(DROP_MESSAGE, files);
      } catch {
        finish(null);
      }
    });
    setTimeout(() => finish(null), 1500);
  });
  if (!paths?.length) return null;
  return Promise.all(
    paths.map(async (path) => {
      const r = await invoke<{ is_dir: boolean }>("fs_stat", { path });
      return { path, isDir: r.is_dir };
    }),
  );
}

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
    return parseConfig(await invoke<string | null>("config_read"));
  },
  async saveConfig(patch) {
    const raw = await invoke<string | null>("config_read");
    await invoke("config_write", { json: mergeConfigJson(raw, patch) });
  },
  async setWindowTheme(pref) {
    // 시그니처는 밝은 바탕이라 창 제목 표시줄은 라이트
    await getCurrentWindow().setTheme(pref === "system" ? null : pref === "dark" ? "dark" : "light");
  },

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
  restoreJournal: (dataDir, backupName, beforeName) =>
    invoke("restore_journal", { dataDir, backupName, beforeName }),
  openFolder: (path) => invoke("open_folder", { path }),
  writeClipboard: (text) => writeText(text),
  async pickSaveFile(title, defaultPath, kind = "xlsx") {
    const filters =
      kind === "image"
        ? [{ name: "이미지", extensions: ["png", "webp"] }]
        : kind === "markdown"
          ? [{ name: "Markdown", extensions: ["md"] }]
          : [{ name: "Excel", extensions: ["xlsx"] }];
    const picked = await save({ title, defaultPath, filters });
    return picked ?? null;
  },
  writeExport: (path, bytes) => invoke("export_write", { path, bytes: Array.from(bytes) }),
  // opener의 open_path는 폴더·파일 모두 기본 프로그램으로 연다
  openFile: (path) => invoke("open_folder", { path }),
  openUrl: (url) => invoke("open_url", { url }),
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

  splash,

  async pickFolders(title) {
    const picked = await open({ directory: true, multiple: true, title });
    if (!picked) return null;
    return Array.isArray(picked) ? picked : [picked];
  },
  cabinetSetRoots: (roots) => invoke("cabinet_set_roots", { roots }),
  cabinetList: (path) => invoke<FsEntry[]>("cabinet_list", { path }),
  cabinetOpen: (path) => invoke("cabinet_open", { path }),
  cabinetReveal: (path) => invoke("cabinet_reveal", { path }),
  droppedPaths,
  folderWindows,

  // 새 판 확인·내려받기·설치(src-tauri/src/update.rs) — 주소·해시는 Rust가 들고 있다
  updateCheck: () => invoke<UpdateInfo | null>("update_check"),
  async updateDownload(onProgress) {
    const off = await listen<{ received: number; total: number }>("update-progress", (e) =>
      onProgress(e.payload.received, e.payload.total),
    );
    try {
      await invoke("update_download");
    } finally {
      off();
    }
  },
  updateInstall: () => invoke("update_install"),
};
