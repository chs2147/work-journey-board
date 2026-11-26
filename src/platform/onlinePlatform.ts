// 온라인 공간용 플랫폼(Connected Preview, docs/v2-design/87·89) — 제품 화면을 그대로 띄운다.
// 일지 = 이 기기 일지(E-1: 실앱은 Rust가 정한 Preview 폴더 안 파일, 브라우저 모드는 메모리). 앱이 보는 경로는
// 가짜 폴더 `/online/<공간>/work-journey.db`이고, 백업 사본(VACUUM INTO)은 그 가짜 폴더(메모리)에만 — 사용자 폴더·원본 일지·
// 정식판 설정은 건드리지 않는다. 내보내기는 하지 않는다. 새 판 확인·설치는 실앱이면 정식 경로(Rust update.rs)를 그대로 쓴다
// (hotfix 1.54.1 — 예전엔 늘 "새 판 없음"이라 온라인 공간을 연 정식판이 새 판을 못 찾았다. DEV·Preview는 updateStore가 막는다). Cabinet 폴더는 이 기기 경로만 사용한다. 링크 열기만 OS 브라우저로(실앱).
// 업무노트·업무 메모보드·Cabi.NET 파일 목록은 정식판처럼 별도 OS 창(실앱: Tauri 창 다리, 자식 창은 DB를 열지 않고 이 창이 읽어 줌).
import type { SqlJsStatic } from "sql.js";
import { SqlJsDriver } from "../data/drivers/sqlJs";
import { DATA_FILE } from "../data/backup";
import type { SqlDriver } from "../data/driver";
import type { ThemePref } from "../shared/theme";
import { browserCabiBridge, type CabiBridge } from "./cabiBridge";
import { createFakeFs } from "./fakeFs";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { STR } from "../shared/strings";
import { showClosingOverlay } from "../ui/common/closingOverlay";
export { showClosingOverlay };
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
  nativeCabinet?: Pick<
    Platform,
    | "stat"
    | "pickFolder"
    | "pickFolders"
    | "cabinetSetRoots"
    | "cabinetList"
    | "cabinetOpen"
    | "cabinetReveal"
  >;
  windows?: { cabi: CabiBridge; folderWindows?: FolderWindows; cabinetWindow?: CabinetWindowBridge };
  /** 새 판 확인·내려받기·설치(실앱 = 정식 경로). 없으면(브라우저 모드) 새 판 없음 */
  updates?: Pick<Platform, "updateCheck" | "updateDownload" | "updateInstall">;
  /** 이 PC 워크스페이스(닫힌 일지)의 업데이트 전 백업에 쓸 플랫폼(실앱) */
  localPlatform?: Platform;
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
  const inside = async (p: string) => {
    if (p !== dataDir && !p.startsWith(`${dataDir}/`)) throw new Error("ONLINE_SPACE_ONLY");
  };
  let config: AppConfig = { dataDir, ...(opts.theme ? { theme: opts.theme } : {}) };
  const none = async () => undefined;
  const cabinet = opts.nativeCabinet;
  let cabinetRoots: string[] = [];
  return {
    kind: "browser",
    ephemeralBackups: true,
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
    pickCabinetFolder: cabinet?.pickFolder,
    isOneDrivePath: async () => false,
    stat: (p) => fs.stat(p),
    // 이 공간 폴더 밖에는 만들지 않는다 — 온라인 공간 안에서 이 PC 새 공간(가짜 폴더 = 메모리, 다시 켜면 사라짐)이
    // 생기지 않게(UX-3 실기: 새 워크스페이스가 일반 일지로 만들어져 동기화가 깨짐)
    ensureDir: (p) => inside(p).then(() => fs.ensureDir(p)),
    copyNew: (a, b) => inside(b).then(() => fs.copyNew(a, b)),
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
    openDatabase: (p) => (p === journalFile ? journalDriver() : inside(p).then(() => fs.openDatabase(p))),
    verifyCopy: (p) => fs.verifyCopy(p),
    backupFs: fs.backupFs,
    // 메인 창을 닫으면: 앱의 종료 처리(입력 중 저장·노트 창 저장 후 닫기) → 일지 닫기 → 남은 별도 창 정리 → 창 닫기
    // (실기: 메인을 닫아도 노트 창이 남던 문제)
    onExit(handler) {
      if (isTauri()) void listenClosing(handler);
    },
    pickFolders: cabinet?.pickFolders ?? (async () => null),
    async cabinetSetRoots(roots) {
      cabinetRoots = roots;
      await cabinet?.cabinetSetRoots(roots);
    },
    async cabinetStat(path) {
      return cabinet && cabinetRoots.includes(path) ? cabinet.stat(path) : { exists: false, isDir: false };
    },
    cabinetList: cabinet?.cabinetList ?? (async () => []),
    cabinetOpen: cabinet?.cabinetOpen ?? none,
    cabinetReveal: cabinet?.cabinetReveal ?? none,
    droppedPaths: async () => null,
    resolveShortcut: async () => null,
    updateCheck: opts.updates?.updateCheck ?? (async () => null),
    updateDownload: opts.updates?.updateDownload ?? none,
    updateInstall: opts.updates?.updateInstall ?? none,
    ...(opts.localPlatform ? { localPlatform: opts.localPlatform } : {}),
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
/**
 * 앱 닫기(Rust가 주도, src-tauri/src/preview_close.rs): Rust가 닫기를 막고 `preview-closing`을 보내면
 * 즉시 덮개 → 동기화 멈춤 → 저장(2.5초 제한) → 일지 닫기(1초 제한) → `preview_exit`(단계·경과 ms 진단용).
 * Rust는 4초 안에 응답이 없어도 일지를 닫고 끝낸다(8초 안전장치). 이 기기 일지는 쓴 만큼 이미 파일에 있다.
 */
async function listenClosing(handler: () => Promise<void>) {
  const { listen } = await import("@tauri-apps/api/event");
  let closing = false;
  await listen("preview-closing", async () => {
    if (closing) return;
    closing = true;
    const t0 = performance.now();
    const steps: [string, number][] = [];
    const mark = (s: string) => steps.push([s, Math.round(performance.now() - t0)]);
    showClosingOverlay(STR.onlineSpaces.sync.closingExit);
    mark("overlay_shown");
    (globalThis as { __wjbStopOnlineSync?: () => void }).__wjbStopOnlineSync?.();
    mark("sync_stopped");
    await within(handler(), 2500);
    mark("saved");
    const { closeOnlineSpace } = await import("../ui/common/appController");
    await within(closeOnlineSpace(), 1000);
    mark("journal_closed");
    await invoke("preview_exit", { steps }).catch(() => undefined);
  });
}
