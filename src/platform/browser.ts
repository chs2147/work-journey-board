import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import sample from "../../fixtures/sample-weeks.json";
import { DATA_FILE } from "../data/backup";
import { prepareConnection } from "../data/driver";
import { openSqlJs } from "../data/drivers/sqlJs";
import { migrate } from "../data/migrate";
import { seedSample } from "../data/seed";
import { createFakeFs } from "./fakeFs";
import { isOneDriveLike, type AppConfig, type Platform } from "./index";

// 브라우저 모드(개발·E2E): 메모리 위의 가짜 폴더 + sql.js. 새로고침하면 처음 상태로 돌아간다.
// 주소 옵션
//   ?today=YYYY-MM-DD   오늘 날짜 고정
//   ?empty=1            기본 일지를 샘플 없이 빈 상태로
//   ?fresh=1            설정 없음 → 첫 실행 화면
//   ?existing=/경로     그 폴더에 샘플이 든 기존 일지를 미리 만들어 둠(첫 실행 "기존 일지 열기" 시험)
//   ?config=/경로       설정의 저장 폴더를 그 경로로(없는 폴더면 "저장 폴더를 찾을 수 없음" 화면)
const params = new URLSearchParams(globalThis.location?.search ?? "");
const fixedToday = /^\d{4}-\d{2}-\d{2}$/.test(params.get("today") ?? "") ? params.get("today")! : null;

export const DEMO_HOME = "/demo";
export const DEMO_DIR = "/demo/WorkJourney";
const ONEDRIVE_ROOTS = ["/demo/OneDrive - Company"];

const fs = createFakeFs((bytes, label) => openSqlJs(wasmUrl, bytes, label));
let config: AppConfig | null = null;
let exitHandler: (() => Promise<void>) | null = null;

async function makeJournal(dir: string, withSample: boolean) {
  await fs.ensureDir(dir);
  const d = await fs.openDatabase(fs.join(dir, DATA_FILE));
  await prepareConnection(d);
  await migrate(d);
  if (withSample) await seedSample(d, sample);
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
  join: fs.join,

  openDatabase: (p) => fs.openDatabase(p),
  verifyCopy: (p) => fs.verifyCopy(p),
  backupFs: fs.backupFs,

  onExit(handler) {
    exitHandler = handler;
  },
};

// E2E에서 "창 닫기"를 흉내 내기 위한 훅과 가짜 파일 목록
Object.assign(globalThis, {
  __wjb: {
    exit: () => exitHandler?.(),
    files: () => fs.listAll(),
  },
});
