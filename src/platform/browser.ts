import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import sample from "../../fixtures/sample-weeks.json";
import sampleLong from "../../fixtures/sample-long.json";
import sampleInsights from "../../fixtures/sample-insights.json";
import { DATA_FILE } from "../data/backup";
import { prepareConnection } from "../data/driver";
import { openSqlJs } from "../data/drivers/sqlJs";
import { migrate } from "../data/migrate";
import { seedSample } from "../data/seed";
import { createFakeFs } from "./fakeFs";
import { baseName, dirOf, isOneDriveLike, type AppConfig, type Platform } from "./index";

// 브라우저 모드(개발·E2E): 메모리 위의 가짜 폴더 + sql.js. 새로고침하면 처음 상태로 돌아간다.
// 주소 옵션
//   ?today=YYYY-MM-DD   오늘 날짜 고정
//   ?empty=1            기본 일지를 샘플 없이 빈 상태로
//   ?sample=long        6주 + 연도 경계 가상 샘플(I-M2 통합 검증, fixtures/sample-long.json)
//   ?sample=insights    약 6개월·종료/재개·링크·연결 메모·연차 가상 샘플(M3-S1 인사이트, fixtures/sample-insights.json)
//   ?fresh=1            설정 없음 → 첫 실행 화면
//   ?existing=/경로     그 폴더에 샘플이 든 기존 일지를 미리 만들어 둠(첫 실행 "기존 일지 열기" 시험)
//   ?config=/경로       설정의 저장 폴더를 그 경로로(없는 폴더면 "저장 폴더를 찾을 수 없음" 화면)
const params = new URLSearchParams(globalThis.location?.search ?? "");
const isDate = (s: string | null) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? "");
let fixedToday = isDate(params.get("today")) ? params.get("today")! : null;

export const DEMO_HOME = "/demo";
export const DEMO_DIR = "/demo/WorkJourney";
const ONEDRIVE_ROOTS = ["/demo/OneDrive - Company"];

const fs = createFakeFs((bytes, label) => openSqlJs(wasmUrl, bytes, label));
let config: AppConfig | null = null;
let exitHandler: (() => Promise<void>) | null = null;
let lastClipboard: string | null = null;
let lastExport: { path: string; size: number } | null = null;
/** 브라우저 모드는 링크를 실제로 열지 않고 적어 두기만 한다(외부 접속 없음 — E2E 확인용) */
const openedUrls: string[] = [];

async function makeJournal(dir: string, withSample: boolean) {
  await fs.ensureDir(dir);
  const d = await fs.openDatabase(fs.join(dir, DATA_FILE));
  await prepareConnection(d);
  await migrate(d);
  const which = params.get("sample");
  if (withSample)
    await seedSample(d, which === "long" ? sampleLong : which === "insights" ? sampleInsights : sample);
  await d.close();
}

const ready = (async () => {
  await fs.ensureDir(fs.join(ONEDRIVE_ROOTS[0]!, "문서"));
  const existing = params.get("existing");
  if (existing) await makeJournal(existing, true);
  if (params.get("config")) {
    config = { dataDir: params.get("config")! };
  } else if (params.get("fresh") !== "1") {
    await makeJournal(DEMO_DIR, params.get("empty") !== "1");
    config = { dataDir: DEMO_DIR };
  }
})();

export const browserPlatform: Platform = {
  kind: "browser",
  now() {
    const real = new Date();
    if (!fixedToday) return real;
    const [y, m, d] = fixedToday.split("-").map(Number);
    return new Date(y!, m! - 1, d!, real.getHours(), real.getMinutes(), real.getSeconds());
  },

  async loadConfig() {
    await ready;
    return config;
  },
  async saveConfig(c) {
    config = { ...c };
  },

  suggestedDataDir: async () => DEMO_DIR,
  async pickFolder(title) {
    // 실제 폴더 대화상자 대신 경로 입력(E2E는 page.on("dialog")로 응답)
    const p = window.prompt(title, DEMO_DIR);
    if (!p?.trim()) return null;
    await fs.ensureDir(p.trim());
    return p.trim();
  },
  isOneDrivePath: async (path) => isOneDriveLike(path, ONEDRIVE_ROOTS),
  stat: (p) => fs.stat(p),
  ensureDir: (p) => fs.ensureDir(p),
  copyNew: (a, b) => fs.copyNew(a, b),
  openFolder: async () => undefined,
  async pickSaveFile(title, defaultPath) {
    // 실제 저장 대화상자 대신 경로 입력(E2E는 page.on("dialog")로 응답)
    const p = window.prompt(title, defaultPath);
    return p?.trim() ? p.trim() : null;
  },
  async writeExport(path, bytes) {
    // 브라우저 모드: 내려받기로 대신한다(외부 통신 없음). 파일 이름은 고른 경로의 이름
    const name = baseName(path);
    const url = URL.createObjectURL(
      new Blob([bytes as BlobPart], {
        type: name.toLowerCase().endsWith(".png")
          ? "image/png"
          : name.toLowerCase().endsWith(".webp")
            ? "image/webp"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    await fs.ensureDir(dirOf(path)); // 실제 저장 대화상자에서 고른 폴더는 늘 있다
    lastExport = { path, size: bytes.byteLength };
  },
  openFile: async () => undefined,
  async openUrl(url) {
    openedUrls.push(url);
  },
  async writeClipboard(text) {
    lastClipboard = text; // E2E 확인용(엔진마다 클립보드 권한이 달라 직접 읽지 않는다)
    await navigator.clipboard?.writeText(text).catch(() => undefined);
  },
  join: fs.join,

  openDatabase: (p) => fs.openDatabase(p),
  verifyCopy: (p) => fs.verifyCopy(p),
  backupFs: fs.backupFs,

  onExit(handler) {
    exitHandler = handler;
  },
};

// E2E 훅: "창 닫기" 흉내, 가짜 파일 목록, 마지막 클립보드 글, 날짜 넘기기(앱을 켠 채 며칠·몇 주가 지난 상황 — 통합 시나리오)
Object.assign(globalThis, {
  __wjb: {
    exit: () => exitHandler?.(),
    files: () => fs.listAll(),
    clipboard: () => lastClipboard,
    lastExport: () => lastExport,
    openedUrls: () => [...openedUrls],
    setToday(date: string) {
      if (!isDate(date)) throw new Error(`날짜 형식이 아닙니다: ${date}`);
      fixedToday = date;
    },
  },
});
