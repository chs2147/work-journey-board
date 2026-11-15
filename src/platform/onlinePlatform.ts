// D-4 온라인 공간용 플랫폼(Connected Preview, docs/v2-design/87) — 제품 화면을 그대로 띄우되,
// 일지는 메모리 위 가짜 폴더(`/online/<공간>/work-journey.db`)에만 있고 사용자 폴더·원본 일지·정식판 설정은 건드리지 않는다.
// 내보내기·폴더 고르기·Cabinet 폴더 열기·새 판 확인은 하지 않는다(읽기 전용 보기). 링크 열기만 OS 브라우저로(실앱).
// 업무노트·업무 메모보드·Cabi.NET 파일 목록은 정식판처럼 별도 OS 창(실앱: Tauri 창 다리, 자식 창은 DB를 열지 않고 이 창이 읽어 줌).
import type { SqlJsStatic } from "sql.js";
import { SqlJsDriver } from "../data/drivers/sqlJs";
import { DATA_FILE } from "../data/backup";
import type { SqlDriver } from "../data/driver";
import type { ThemePref } from "../shared/theme";
import { browserCabiBridge, type CabiBridge } from "./cabiBridge";
import { createFakeFs } from "./fakeFs";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AppConfig, CabinetWindowBridge, FolderWindows, Platform } from "./index";

export const ONLINE_ROOT = "/online";

export function createOnlinePlatform(opts: {
  SQL: SqlJsStatic;
  journal: Uint8Array;
  workspaceId: string;
  theme?: ThemePref;
  /** 드라이버 감싸기(읽기 전용 문지기) */
  wrap: (d: SqlDriver) => SqlDriver;
  /** 별도 창 다리(실앱 = Tauri 창). 없으면 브라우저 팝업 다리(브라우저 모드) */
  windows?: { cabi: CabiBridge; folderWindows?: FolderWindows; cabinetWindow?: CabinetWindowBridge };
}): Platform {
  const fs = createFakeFs(async (bytes, label) => new SqlJsDriver(new opts.SQL.Database(bytes), label));
  const dataDir = `${ONLINE_ROOT}/${opts.workspaceId}`;
  void fs.ensureDir(dataDir);
  fs.writeFile(fs.join(dataDir, DATA_FILE), opts.journal, Date.now());
  let config: AppConfig = { dataDir, ...(opts.theme ? { theme: opts.theme } : {}) };
  const none = async () => undefined;
  return {
    kind: "browser",
    cabi: opts.windows?.cabi ?? browserCabiBridge(),
    ...(opts.windows?.folderWindows ? { folderWindows: opts.windows.folderWindows } : {}),
    ...(opts.windows?.cabinetWindow ? { cabinetWindow: opts.windows.cabinetWindow } : {}),
    now: () => new Date(),
    loadConfig: async () => config,
    async saveConfig(patch) {
      config = { ...config, ...patch, dataDir }; // 저장 폴더는 바꾸지 않는다
    },
    async setWindowTitle(title) {
      document.title = title;
    },
    setWindowTheme: none,
    suggestedDataDir: async () => dataDir,
    pickFolder: async () => null,
    isOneDrivePath: async () => false,
    stat: (p) => fs.stat(p),
    ensureDir: (p) => fs.ensureDir(p),
    copyNew: (a, b) => fs.copyNew(a, b),
    restoreJournal: async () => {
      throw new Error("ONLINE_READ_ONLY");
    },
    openFolder: none,
    pickSaveFile: async () => null,
    writeExport: async () => {
      throw new Error("ONLINE_READ_ONLY");
    },
    openFile: none,
    async openUrl(url) {
      // 실앱: OS 기본 브라우저로 넘기기만(Rust open_url이 http/https만 재검사). 브라우저 모드는 아무것도 하지 않음
      if (!isTauri()) return;
      await invoke("open_url", { url });
    },
    async writeClipboard(text) {
      await navigator.clipboard?.writeText(text).catch(() => undefined);
    },
    join: fs.join,
    openDatabase: async (p) => opts.wrap(await fs.openDatabase(p)),
    verifyCopy: (p) => fs.verifyCopy(p),
    backupFs: fs.backupFs,
    onExit: () => undefined,
    pickFolders: async () => null,
    cabinetSetRoots: none,
    cabinetList: async () => [],
    cabinetOpen: none,
    cabinetReveal: none,
    droppedPaths: async () => null,
    resolveShortcut: async () => null,
    updateCheck: async () => null,
    updateDownload: none,
    updateInstall: none,
  };
}
