// 온라인 공간용 플랫폼(Connected Preview, docs/v2-design/87·89) — 제품 화면을 그대로 띄운다.
// 일지 = 이 기기 일지(E-1: 실앱은 Rust가 정한 Preview 폴더 안 파일, 브라우저 모드는 메모리). 앱이 보는 경로는
// 가짜 폴더 `/online/<공간>/work-journey.db`이고, 백업 사본(VACUUM INTO)은 그 가짜 폴더(메모리)에만 — 사용자 폴더·원본 일지·
// 정식판 설정은 건드리지 않는다. 내보내기·폴더 고르기·Cabinet 폴더 열기·새 판 확인은 하지 않는다. 링크 열기만 OS 브라우저로(실앱).
// 업무노트·업무 메모보드·Cabi.NET 파일 목록은 정식판처럼 별도 OS 창(실앱: Tauri 창 다리, 자식 창은 DB를 열지 않고 이 창이 읽어 줌).
import type { SqlJsStatic } from "sql.js";
import { SqlJsDriver } from "../data/drivers/sqlJs";
import { DATA_FILE } from "../data/backup";
import type { SqlDriver } from "../data/driver";
import type { ThemePref } from "../shared/theme";
import { browserCabiBridge, type CabiBridge } from "./cabiBridge";
import { createFakeFs } from "./fakeFs";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AppConfig, CabinetWindowBridge, FolderWindows, Platform, SpaceDriver } from "./index";

export const ONLINE_ROOT = "/online";

/** 감싼 일지 드라이버 → 안쪽 드라이버. 동기화 엔진은 안쪽으로 써서 자기 쓰기가 "앱이 고침" 신호를 내지 않게 한다
 * (E-3 실기: 엔진 쓰기 → 신호 → 1초 뒤 동기화 → 엔진 쓰기 … 고리로 매초 동기화) */
const rawOf = new WeakMap<SqlDriver, SqlDriver>();
export const rawJournalDriver = (d: SqlDriver): SqlDriver => rawOf.get(d) ?? d;

/** 정해진 시간 안에 끝나지 않으면 기다리지 않고 넘어간다(종료가 멈추지 않게) */
export function within<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    work.catch(() => undefined),
    new Promise<undefined>((r) => setTimeout(() => r(undefined), ms)),
  ]);
}

export function createOnlinePlatform(opts: {
  SQL: SqlJsStatic;
  /** 이 기기 일지 열기(열 때마다 새 드라이버) */
  openJournal: () => Promise<SpaceDriver>;
  workspaceId: string;
  theme?: ThemePref;
  /** 일지에 실제로 바뀐 쓰기가 있을 때(동기화 보내기 예약) */
  onWrite?: () => void;
  /** 별도 창 다리(실앱 = Tauri 창). 없으면 브라우저 팝업 다리(브라우저 모드) */
  windows?: { cabi: CabiBridge; folderWindows?: FolderWindows; cabinetWindow?: CabinetWindowBridge };
}): Platform {
  const fs = createFakeFs(async (bytes, label) => new SqlJsDriver(new opts.SQL.Database(bytes), label));
  const dataDir = `${ONLINE_ROOT}/${opts.workspaceId}`;
  void fs.ensureDir(dataDir);
  const journalFile = fs.join(dataDir, DATA_FILE);
  // 자리표시(앱이 폴더에 일지가 있는지 볼 때) — 실제 내용은 openJournal 쪽
  fs.writeFile(journalFile, new Uint8Array(), Date.now());
  /** 백업 사본(VACUUM INTO '<가짜 경로>')은 이 기기 일지의 바이트를 받아 가짜 폴더에 둔다 */
  const journalDriver = async (): Promise<SqlDriver> => {
    const d = await opts.openJournal();
    const wrapped: SqlDriver = {
      label: d.label,
      async execute(sql, params) {
        const m = /^VACUUM INTO '(.+)'$/s.exec(sql.trim());
        if (!m) {
          const r = await d.execute(sql, params);
          if (r.changes) opts.onWrite?.();
          return r;
        }
        const target = m[1]!.replace(/''/g, "'");
        if (!target.startsWith(`${dataDir}/`)) throw new Error(`unable to open database: ${target}`);
        if ((await fs.stat(target)).exists) throw new Error(`output file already exists: ${target}`);
        await fs.ensureDir(target.slice(0, target.lastIndexOf("/")));
        fs.writeFile(target, await d.exportBytes(), Date.now());
        return { changes: 0 };
      },
      select: (sql, params) => d.select(sql, params),
      async batch(st) {
        const n = await d.batch(st);
        if (n) opts.onWrite?.();
        return n;
      },
      close: () => d.close(),
    };
    rawOf.set(wrapped, d);
    return wrapped;
  };
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
    openDatabase: (p) => (p === journalFile ? journalDriver() : fs.openDatabase(p)),
    verifyCopy: (p) => fs.verifyCopy(p),
    backupFs: fs.backupFs,
    // 메인 창을 닫으면: 앱의 종료 처리(입력 중 저장·노트 창 저장 후 닫기) → 일지 닫기 → 남은 별도 창 정리 → 창 닫기
    // (실기: 메인을 닫아도 노트 창이 남던 문제)
    onExit(handler) {
      if (isTauri()) void closeWithChildren(handler);
    },
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

/** 별도 창(메인·스플래시 밖)을 모두 없앤다 — 저장은 앱의 종료·닫기 처리가 먼저 끝낸 뒤 */
export async function destroyChildWindows() {
  if (!isTauri()) return;
  const { getAllWebviewWindows } = await import("@tauri-apps/api/webviewWindow");
  const all = await getAllWebviewWindows();
  await Promise.all(
    all
      .filter((w) => w.label !== "main" && w.label !== "splash")
      .map((w) => w.destroy().catch(() => undefined)),
  );
}
async function closeWithChildren(handler: () => Promise<void>) {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  let closing = false;
  await win.onCloseRequested(async (event) => {
    if (closing) return;
    closing = true;
    event.preventDefault();
    // 무엇이 막혀도 끝난다: 동기화 멈춤 → 저장(시간 제한) → 일지 닫기(시간 제한) → 별도 창 정리 → 프로세스 종료.
    // 이 기기 일지는 쓴 만큼 이미 파일에 있다(트랜잭션 단위) — 저장이 늦거나 실패해도 닫는다.
    // Rust 쪽에도 닫기 요청 뒤 일정 시간이 지나면 강제로 끝내는 안전장치가 있다(lib.rs, Preview만)
    const { stopOnlineSync } = await import("../ui/preview/onlineSync");
    stopOnlineSync();
    await within(handler(), 5000);
    const { closeOnlineSpace } = await import("../ui/common/appController");
    await within(closeOnlineSpace(), 3000);
    await within(destroyChildWindows(), 2000);
    try {
      await invoke("preview_exit");
    } catch {
      await win.destroy().catch(() => undefined);
    }
  });
}
