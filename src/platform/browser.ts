import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import sample from "../../fixtures/sample-weeks.json";
import sampleLong from "../../fixtures/sample-long.json";
import sampleInsights from "../../fixtures/sample-insights.json";
import { BACKUP_DIR, DATA_FILE } from "../data/backup";
import { prepareConnection } from "../data/driver";
import { openSqlJs, sqlJsCalls } from "../data/drivers/sqlJs";
import { migrate } from "../data/migrate";
import { seedSample, type SampleData } from "../data/seed";
import { isThemePref } from "../shared/theme";
import { createFakeFs } from "./fakeFs";
import { makeYearSample } from "./sampleYear";
import { baseName, dirOf, isOneDriveLike, type AppConfig, type Platform } from "./index";

// 브라우저 모드(개발·E2E): 메모리 위의 가짜 폴더 + sql.js. 새로고침하면 처음 상태로 돌아간다.
// 주소 옵션
//   ?today=YYYY-MM-DD   오늘 날짜 고정
//   ?empty=1            기본 일지를 샘플 없이 빈 상태로
//   ?sample=long        6주 + 연도 경계 가상 샘플(I-M2 통합 검증, fixtures/sample-long.json)
//   ?sample=year        가상 1년치(업무 6개·항목 약 4,400개·52주 메모) — 성능 측정(optimize-1031-plan O1)
//   ?sample=year-img    위 + 주마다 메모 이미지 2장(800×500 PNG)
//   ?sample=insights    약 6개월·종료/재개·링크·연결 메모·연차 가상 샘플(M3-S1 인사이트, fixtures/sample-insights.json)
//   ?sample=showcase    기본 샘플 + 2026-W43 메모 보드(업무 연결 메모·이미지 메모·관계선) — README·소개 사이트 화면용(fixtures/sample-showcase.json)
//   ?corrupt=1          일지 파일을 깨진 바이트로(멀쩡한 일일 백업 1개는 남김) → "데이터 파일 문제" 화면·복원 시험
//   ?fresh=1            설정 없음 → 첫 실행 화면
//   ?existing=/경로     그 폴더에 샘플이 든 기존 일지를 미리 만들어 둠(첫 실행 "기존 일지 열기" 시험)
//   ?config=/경로       설정의 저장 폴더를 그 경로로(없는 폴더면 "저장 폴더를 찾을 수 없음" 화면)
//   ?update=0.9.0       새 판 확인이 이 판을 돌려준다(가짜 — 인터넷에 묻지 않음) · ?update=fail = 연결 실패 · ?update=bad = SHA 불일치
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
/** 이번 실행에서 내보낸 파일들(E2E 확인용 — 마크다운은 글도) */
const exportLog: { path: string; size: number; text?: string }[] = [];
/** 브라우저 모드는 링크를 실제로 열지 않고 적어 두기만 한다(외부 접속 없음 — E2E 확인용) */
const openedUrls: string[] = [];
/** 가짜 새 판 확인(외부 접속 없음 — E2E 확인용): 확인·내려받기·설치 호출 기록 */
const updateCalls: string[] = [];
const fakeUpdate = params.get("update");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function makeJournal(dir: string, withSample: boolean) {
  await fs.ensureDir(dir);
  const d = await fs.openDatabase(fs.join(dir, DATA_FILE));
  await prepareConnection(d);
  await migrate(d);
  const which = params.get("sample");
  if (withSample)
    await seedSample(
      d,
      which === "year" || which === "year-img"
        ? await makeYearSample(which === "year-img")
        : which === "long"
          ? sampleLong
          : which === "insights"
            ? sampleInsights
            : which === "showcase"
              ? ((await import("../../fixtures/sample-showcase.json")).default as SampleData)
              : sample,
    );
  await d.close();
}

/** Cabinet 흉내용 가상 작업 폴더(features-1102-spec F5) — 가상 이름·크기만 */
export const DEMO_WORK = "/demo/업무";
function seedWorkFolders() {
  const t = (d: string) => new Date(`${d}:00`).getTime();
  const f = (p: string, kb: number, when: string) =>
    fs.writeFile(fs.join(DEMO_WORK, p), new Uint8Array(Math.round(kb * 1024)), t(when));
  f("정산/설계/정산 배치 설계서 v2.docx", 210, "2026-10-21T16:12");
  f("정산/설계/화면 흐름.pptx", 1840, "2026-10-20T11:03");
  f("정산/테스트/2026-10 이관/샘플 데이터/accounts_sample.csv", 52, "2026-10-21T17:20");
  f("정산/테스트/2026-10 이관/이관_스크립트_v3.sql", 18, "2026-10-22T10:05");
  f("정산/테스트/2026-10 이관/검증표.xlsx", 64, "2026-10-22T09:41");
  f("정산/테스트/2026-10 이관/이관 절차.docx", 210, "2026-10-20T16:12");
  f("정산/테스트/2026-10 이관/흐름도.png", 92, "2026-10-20T11:03");
  f("정산/테스트/2026-10 이관/.임시", 1, "2026-10-20T11:03");
  f("정산/테스트/테스트 계획.xlsx", 40, "2026-10-14T09:00");
  f("정산/회의록/2026-10-20 배치 협의.docx", 30, "2026-10-20T18:00");
  f("보안점검/계정 점검표.xlsx", 88, "2026-10-19T15:30");
}

/** 브라우저 모드 Cabinet 호출 기록(E2E 확인용 — 실제로 열지 않음) */
const cabinetCalls: string[] = [];
let cabinetRoots: string[] = [];
const underRoots = (path: string) =>
  !path.split("/").includes("..") &&
  cabinetRoots.some((r) => path === r || path.startsWith(`${r.replace(/\/+$/, "")}/`));

const ready = (async () => {
  await fs.ensureDir(fs.join(ONEDRIVE_ROOTS[0]!, "문서"));
  seedWorkFolders();
  const existing = params.get("existing");
  if (existing) await makeJournal(existing, true);
  if (params.get("config")) {
    config = { dataDir: params.get("config")! };
  } else if (params.get("fresh") !== "1") {
    await makeJournal(DEMO_DIR, params.get("empty") !== "1");
    config = { dataDir: DEMO_DIR };
    if (params.get("corrupt") === "1") {
      // 파손 흉내(optimize-1031-plan O5): 멀쩡한 일일 백업을 하나 남기고 일지 파일을 깨진 바이트로
      const journal = fs.join(DEMO_DIR, DATA_FILE);
      await fs.ensureDir(fs.join(DEMO_DIR, BACKUP_DIR));
      await fs.copyNew(journal, fs.join(DEMO_DIR, BACKUP_DIR, "work-journey_2026-10-21.db"));
      fs.writeFile(journal, new TextEncoder().encode("이것은 SQLite 파일이 아닙니다 ".repeat(200)));
    }
  }
  // ?theme=dark — 이 PC 설정(config.json)에 테마가 적혀 있는 상태 흉내(improve-1027v5-spec 4-2)
  const theme = params.get("theme");
  if (config && isThemePref(theme)) config.theme = theme;
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
    return config?.dataDir ? { ...config } : null;
  },
  async saveConfig(patch) {
    // 실앱처럼 합쳐 쓴다(저장 폴더가 없는 상태에서 테마만 오면 테마만 남는 것까지는 흉내 내지 않음)
    config = { ...(config ?? { dataDir: "" }), ...patch };
  },
  setWindowTheme: async () => undefined,

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
  restoreJournal: (dir, name, before) => fs.restoreJournal(dir, name, before),
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
            : name.toLowerCase().endsWith(".md")
              ? "text/markdown"
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
    exportLog.push({
      path,
      size: bytes.byteLength,
      text: name.toLowerCase().endsWith(".md") ? new TextDecoder().decode(bytes) : undefined,
    });
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

  async pickFolders(title) {
    // 실제 폴더 대화상자 대신 경로 입력(여러 개는 ;로) — E2E는 page.on("dialog")로 응답
    const p = window.prompt(title, `${DEMO_WORK}/정산/설계`);
    if (!p?.trim()) return null;
    return p
      .split(";")
      .map((x) => x.trim())
      .filter(Boolean);
  },
  async cabinetSetRoots(roots) {
    cabinetRoots = [...roots];
  },
  async cabinetList(path) {
    if (!underRoots(path)) throw new Error("등록한 폴더 안의 경로만 열 수 있습니다");
    return fs.listDir(path);
  },
  async cabinetOpen(path) {
    if (!underRoots(path)) throw new Error("등록한 폴더 안의 경로만 열 수 있습니다");
    cabinetCalls.push(`open ${path}`);
  },
  async cabinetReveal(path) {
    if (!underRoots(path)) throw new Error("등록한 폴더 안의 경로만 열 수 있습니다");
    cabinetCalls.push(`reveal ${path}`);
  },
  async droppedPaths(dropped) {
    // 브라우저는 놓은 파일의 경로를 주지 않는다 — 가상 작업 폴더에서 같은 이름을 찾아 흉내(E2E·시연용)
    const all = [
      ...new Set([
        ...fs.listAll().flatMap((p) => p.split("/").map((_, i, a) => a.slice(0, i + 1).join("/"))),
      ]),
    ];
    const found = dropped.flatMap((f) => {
      const hit = all.find((p) => p.startsWith(`${DEMO_WORK}/`) && baseName(p) === f.name);
      return hit ? [{ path: hit, isDir: fs.isDir(hit) }] : [];
    });
    return found.length ? found : null;
  },

  async updateCheck() {
    updateCalls.push("check");
    await sleep(50);
    if (fakeUpdate === "fail") throw new Error("GitHub에 연결하지 못했습니다(가짜)");
    if (!fakeUpdate) return null;
    const version = fakeUpdate === "bad" ? "0.9.0" : fakeUpdate;
    return {
      version,
      notes: `**Work Journey Board v${version}** (개발 중 사전 릴리스)\n\n**가상 개선 묶음** — 2026-10-28\n\n### 새 기능\n- 가상 기능 하나\n- 가상 기능 둘\n\n### 주의\n- 데이터 형식: 변경 없음\n\n### 설치 파일\n\n| 파일 | 용도 |\n|---|---|\n| a | b |`,
      size: 5_200_000,
      hasHash: true,
    };
  },
  async updateDownload(onProgress) {
    updateCalls.push("download");
    const total = 5_200_000;
    for (let i = 1; i <= 4; i++) {
      await sleep(60);
      onProgress((total * i) / 4, total);
    }
    if (fakeUpdate === "bad") throw new Error("받은 설치 파일이 SHA256SUMS와 다릅니다 — 설치하지 않습니다");
  },
  async updateInstall() {
    updateCalls.push("install");
  },
};

// E2E 훅: "창 닫기" 흉내, 가짜 파일 목록, 마지막 클립보드 글, 날짜 넘기기(앱을 켠 채 며칠·몇 주가 지난 상황 — 통합 시나리오)
Object.assign(globalThis, {
  __wjb: {
    exit: () => exitHandler?.(),
    files: () => fs.listAll(),
    clipboard: () => lastClipboard,
    lastExport: () => lastExport,
    exportLog: () => [...exportLog],
    openedUrls: () => [...openedUrls],
    updateCalls: () => [...updateCalls],
    cabinetCalls: () => [...cabinetCalls],
    /** DB 호출 수(조회·쓰기·batch) — 주 전환당 왕복 수 측정 */
    queries: () => sqlJsCalls.n,
    setToday(date: string) {
      if (!isDate(date)) throw new Error(`날짜 형식이 아닙니다: ${date}`);
      fixedToday = date;
    },
  },
});
