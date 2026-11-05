import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { homeDir } from "@tauri-apps/api/path";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getAllWebviewWindows, WebviewWindow } from "@tauri-apps/api/webviewWindow";
import Database from "@tauri-apps/plugin-sql";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open, save } from "@tauri-apps/plugin-dialog";
import { quickCheck, readSchemaVersion, backupStructureMatches } from "../data/migrate";
import type { BackupFs } from "../data/backup";
import { openTauriSql } from "../data/drivers/tauriSql";
import type { FsEntry } from "../domain/cabinet";
import {
  isOneDriveLike,
  mergeConfigJson,
  serialize,
  type AppConfig,
  parseConfig,
  type PathInfo,
  type CabinetFocus,
  type DroppedPath,
  type CabinetWindowBridge,
  type FolderWindowEvent,
  type FolderWindows,
  type Platform,
  type SplashWindow,
  type UpdateInfo,
} from "./index";
import { SPLASH_STATUS_EVENT } from "./splashEvents";
import { OS } from "../shared/os";

// 실앱(윈도우·맥, macos-spec). 파일 동작은 src-tauri/src/files.rs의 얇은 명령을 쓴다(삭제·이름 바꾸기는 Rust에서도 패턴 검사).
const SEP = OS === "windows" ? "\\" : "/";
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
      all
        .filter((w) => w.label.startsWith("folder-") || w.label === CABINET_LABEL)
        .map((w) => w.destroy().catch(() => undefined)),
    );
  },
  async onEvent(cb) {
    return listen<FolderWindowEvent>(FOLDER_EVENT, (e) => cb(e.payload));
  },
  async notifyNav(id, sub) {
    await emitTo("main", FOLDER_EVENT, { type: "nav", id, sub } satisfies FolderWindowEvent);
  },
};

// Cabinet 별도 창(improve-1102-spec C1): 창 `cabinet` = index.html?win=cabinet. 일지는 메인 창만 열고, 이벤트로 주고받는다.
const CABINET_LABEL = "cabinet";
const RPC = "cabinet-rpc";
const RPC_RESULT = "cabinet-rpc-result";
const SYNC = "cabinet-sync";
const FOCUS = "cabinet-focus";
let cabinetClosed: (() => void) | null = null;

const cabinetWindow: CabinetWindowBridge = {
  async open(focus, theme) {
    const existing = await WebviewWindow.getByLabel(CABINET_LABEL);
    if (existing) {
      await existing.unminimize().catch(() => undefined);
      await existing.setFocus();
      if (focus) await emitTo(CABINET_LABEL, FOCUS, focus satisfies CabinetFocus);
      return;
    }
    const q = new URLSearchParams({ win: "cabinet", t: theme, f: JSON.stringify(focus ?? {}) });
    const w = new WebviewWindow(CABINET_LABEL, {
      url: `index.html?${q.toString()}`,
      title: "Cabinet — 자주 쓰는 폴더·링크",
      width: 880,
      height: 600,
      minWidth: 560,
      minHeight: 360,
      dragDropEnabled: false,
      focus: true,
    });
    void w.once("tauri://destroyed", () => cabinetClosed?.());
  },
  async close() {
    const w = await WebviewWindow.getByLabel(CABINET_LABEL);
    await w?.destroy().catch(() => undefined);
  },
  onClosed(cb) {
    cabinetClosed = cb;
  },
  async serve(handler) {
    await listen<{ id: string; name: string; args: unknown[] }>(RPC, (e) => {
      const { id, name, args } = e.payload;
      void handler(name, args).then(
        (value) => emitTo(CABINET_LABEL, RPC_RESULT, { id, ok: true, value }),
        (err: unknown) =>
          emitTo(CABINET_LABEL, RPC_RESULT, {
            id,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }),
      );
    });
  },
  async sync(snapshot) {
    if (await WebviewWindow.getByLabel(CABINET_LABEL)) await emitTo(CABINET_LABEL, SYNC, snapshot);
  },
  async call(name, args) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
      let off: (() => void) | null = null;
      const timer = setTimeout(() => {
        off?.();
        reject(new Error("메인 창이 응답하지 않습니다"));
      }, 20_000);
      void listen<{ id: string; ok: boolean; value?: unknown; error?: string }>(RPC_RESULT, (e) => {
        if (e.payload.id !== id) return;
        clearTimeout(timer);
        off?.();
        if (e.payload.ok) resolve(e.payload.value);
        else reject(new Error(e.payload.error));
      }).then((u) => {
        off = u;
        void emitTo("main", RPC, { id, name, args });
      });
    });
  },
  onSync: (cb) => listen(SYNC, (e) => cb(e.payload)),
  onFocus: (cb) => listen<CabinetFocus>(FOCUS, (e) => cb(e.payload)),
  closeSelf: () => getCurrentWindow().close(),
  installDropBridge: () => invoke("cabinet_drop_bridge"),
};

/** 경로들 → 있는지·폴더인지 */
const statPaths = (paths: string[]): Promise<DroppedPath[]> =>
  Promise.all(
    paths.map(async (path) => {
      const r = await invoke<{ exists: boolean; is_dir: boolean }>("fs_stat", { path });
      return { path, isDir: r.is_dir, exists: r.exists };
    }),
  );

/**
 * 끌어 놓은 File → 경로. 윈도우 = WebView2가 아는 경로(cabinet.rs 다리, 1.5초 안에 답이 없으면 null),
 * 맥 = 놓은 직후 끌기 붙임판의 파일 경로(cabinet_drag_paths, 같은 이름만 — macos-spec 3-4). 폴더만 놓아 File 목록이 비어도 맥은 경로를 찾는다
 */
async function droppedPaths(files: File[]): Promise<DroppedPath[] | null> {
  if (OS === "macos") {
    const paths = await invoke<string[]>("cabinet_drag_paths", { names: files.map((f) => f.name) });
    return paths.length ? statPaths(paths) : null;
  }
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
  return statPaths(paths);
}

const backupFs: BackupFs = {
  join,
  ensureDir: (dir) => invoke("fs_ensure_dir", { dir }),
  list: (dir) => invoke<string[]>("fs_list", { dir }),
  rename: (from, to) => invoke("fs_rename_backup", { from, to }),
  remove: (path) => invoke("fs_remove_backup", { path }),
  removeChecked: (path, size, modified) =>
    invoke("fs_remove_backup", { path, expectedSize: size, expectedModified: modified }),
  stat: async (path) => {
    const r = await invoke<{
      exists: boolean;
      is_dir: boolean;
      size: number | null;
      modified: number | null;
      is_symlink: boolean;
    }>("fs_stat", { path });
    return { exists: r.exists, isDir: r.is_dir, size: r.size, modified: r.modified, isSymlink: r.is_symlink };
  },
  async inspect(path) {
    let d: Awaited<ReturnType<typeof openTauriSql>> | undefined;
    try {
      d = await openTauriSql(path);
      const schema = await readSchemaVersion(d);
      return { ok: (await quickCheck(d)) && (await backupStructureMatches(d, schema)), schema };
    } catch {
      return { ok: false, schema: null };
    } finally {
      await d?.close().catch(() => undefined);
    }
  },
};

export const tauriPlatform: Platform = {
  kind: "tauri",
  now: () => new Date(),

  async loadConfig() {
    return parseConfig(await invoke<string | null>("config_read"));
  },
  saveConfig: serialize(async (patch: Partial<AppConfig>) => {
    const raw = await invoke<string | null>("config_read");
    await invoke("config_write", { json: mergeConfigJson(raw, patch) });
  }),
  async setWindowTitle(title) {
    await getCurrentWindow().setTitle(title);
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
    const r = await invoke<{
      exists: boolean;
      is_dir: boolean;
      size: number | null;
      modified: number | null;
      is_symlink: boolean;
    }>("fs_stat", { path });
    return {
      exists: r.exists,
      isDir: r.is_dir,
      size: r.size,
      modified: r.modified,
      isSymlink: r.is_symlink,
    } satisfies PathInfo;
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

  onMenuAction(handler) {
    // src-tauri/src/menu.rs MENU_EVENT와 같은 이름
    void listen<string>("menu-action", (e) => handler(e.payload));
  },

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
  resolveShortcut: (path) => invoke<string | null>("cabinet_resolve_shortcut", { path }),
  folderWindows,
  cabinetWindow,

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
