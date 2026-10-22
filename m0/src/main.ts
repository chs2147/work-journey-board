// Work Journey Board I-M0 설치 검증 화면.
// 자동 점검(실행·설치 위치·WebView2·OneDrive·실행 기록) + 저장 폴더 테스트(파일·SQLite·백업) + 수동 확인 항목을 모아
// 한 번에 복사할 수 있는 결과 보고서를 만든다. 네트워크를 쓰지 않는다.
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import Database from "@tauri-apps/plugin-sql";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

type Status = "ok" | "bad" | "warn" | "wait";
interface Check { label: string; status: Status; value: string }

interface EnvInfo {
  app_version: string; os: string; arch: string; os_version: string;
  webview2_version: string | null; webview2_error: string | null;
  exe_path: string | null; local_data_dir: string | null; documents_dir: string | null; home_dir: string | null;
  onedrive_env: [string, string][]; documents_in_onedrive: boolean;
}
interface RunInfo { runs: number[]; log_path: string }
interface FileTest { path: string; written_bytes: number; read_matches: boolean; backup_dir_ok: boolean }

const MARK: Record<Status, string> = { ok: "✅", bad: "❌", warn: "⚠️", wait: "…" };
const inTauri = "__TAURI_INTERNALS__" in window;

const auto: Check[] = [];
const folder: Check[] = [];
const manual = {
  delivery: "", admin: "", smartscreen: "", antivirus: "", reboot: false, memo: "",
};
let folderNote = "";
let busy = false;

const fmt = (s: number) => new Date(s * 1000).toLocaleString("ko-KR");
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function joinPath(dir: string, name: string) {
  const sep = dir.includes("\\") ? "\\" : "/";
  return dir.endsWith(sep) ? dir + name : dir + sep + name;
}

// 결과를 지역 배열에 모은 뒤 한 번에 교체한다(중복 실행 시 항목이 겹치지 않게).
async function runAutoChecks() {
  const out = await collectAutoChecks();
  auto.splice(0, auto.length, ...out);
}

async function collectAutoChecks(): Promise<Check[]> {
  const auto: Check[] = [];
  if (!inTauri) {
    auto.push({ label: "실행 환경", status: "warn", value: "Tauri 앱 밖(브라우저)에서 열렸습니다. 설치한 앱에서 실행하세요." });
    return auto;
  }
  try {
    const env = await invoke<EnvInfo>("env_info");
    auto.push({ label: "앱 실행", status: "ok", value: `WJB M0 Probe v${env.app_version} · ${env.os}/${env.arch}` });
    const exe = env.exe_path ?? "";
    const perUser = /\\appdata\\local\\/i.test(exe);
    auto.push({
      label: "설치 위치(현재 사용자 전용)",
      status: perUser ? "ok" : "warn",
      value: exe ? `${exe}${perUser ? "" : "  ← %LOCALAPPDATA% 아래가 아님"}` : "알 수 없음",
    });
    auto.push(env.webview2_version
      ? { label: "WebView2 런타임", status: "ok", value: env.webview2_version }
      : { label: "WebView2 런타임", status: "bad", value: env.webview2_error ?? "버전 확인 실패" });
    auto.push({
      label: "OneDrive 환경 변수",
      status: env.onedrive_env.length ? "warn" : "ok",
      value: env.onedrive_env.length ? env.onedrive_env.map(([k, v]) => `${k}=${v}`).join(" | ") : "없음(OneDrive 미사용)",
    });
    auto.push({
      label: "\"문서\" 폴더 OneDrive 리디렉션",
      status: env.documents_in_onedrive || !env.documents_dir ? "warn" : "ok",
      value: `${env.documents_dir ?? "알 수 없음"}${env.documents_in_onedrive ? "  ← OneDrive로 동기화됨(저장 폴더로 쓰면 안 됨)" : ""}`,
    });
    auto.push({ label: "앱 로컬 데이터 폴더", status: "ok", value: env.local_data_dir ?? "알 수 없음" });
  } catch (e) {
    auto.push({ label: "환경 정보", status: "bad", value: errText(e) });
  }
  try {
    const run = await invoke<RunInfo>("record_run");
    const n = run.runs.length;
    const prev = n > 1 ? `직전 실행 ${fmt(run.runs[n - 2])}` : "첫 실행";
    auto.push({ label: "실행 기록(재실행 확인)", status: "ok", value: `이번이 ${n}번째 실행 · ${prev} · 기록 파일 ${run.log_path}` });
  } catch (e) {
    auto.push({ label: "실행 기록(재실행 확인)", status: "bad", value: errText(e) });
  }
  return auto;
}

async function runFolderTest() {
  if (!inTauri || busy) return;
  const picked = await open({ directory: true, multiple: false, title: "테스트할 저장 폴더 선택" });
  if (!picked || Array.isArray(picked)) return;
  await testFolder(picked);
}

async function testFolder(dir: string) {
  busy = true;
  folder.length = 0;
  folderNote = "";
  render();
  try {
    const od = await invoke<boolean>("is_onedrive_path", { path: dir });
    folder.push({ label: "선택한 폴더", status: od ? "warn" : "ok", value: `${dir}${od ? "  ← OneDrive 동기화 폴더" : ""}` });
    if (od) folderNote = "OneDrive 폴더에 저장하면 업무 기록이 클라우드로 올라갑니다. 실제 앱에서는 OneDrive 밖 폴더(예: C:\\Users\\<사용자>\\WorkJourney)를 권장합니다.";

    const ft = await invoke<FileTest>("file_roundtrip", { dir });
    folder.push({ label: "파일 쓰기·읽기", status: ft.read_matches ? "ok" : "bad", value: `${ft.path} (${ft.written_bytes} B, 읽은 내용 ${ft.read_matches ? "일치" : "불일치"})` });
    folder.push({ label: "backups 하위 폴더 생성", status: ft.backup_dir_ok ? "ok" : "bad", value: ft.backup_dir_ok ? joinPath(dir, "backups") : "생성 실패" });

    await sqliteTest(dir);
  } catch (e) {
    folder.push({ label: "폴더 테스트", status: "bad", value: errText(e) });
  } finally {
    busy = false;
    render();
  }
}

// tauri-plugin-sql로 "사용자가 고른 폴더의 절대 경로" DB를 열 수 있는지(README 12-4 #2),
// journal_mode=DELETE가 다시 열어도 유지되는지(data-spec 3-1), VACUUM INTO 백업이 되는지(data-spec 7-2) 확인.
async function sqliteTest(dir: string) {
  const dbPath = joinPath(dir, "wjb-m0-test.db");
  const url = `sqlite:${dbPath}`;
  let db: Database | null = null;
  try {
    db = await Database.load(url);
    folder.push({ label: "SQLite 열기(절대 경로)", status: "ok", value: dbPath });
  } catch (e) {
    folder.push({ label: "SQLite 열기(절대 경로)", status: "bad", value: `${dbPath} → ${errText(e)}` });
    return;
  }
  try {
    await db.select("PRAGMA journal_mode = DELETE");
    await db.execute("CREATE TABLE IF NOT EXISTS m0_probe (id INTEGER PRIMARY KEY, at TEXT NOT NULL, note TEXT NOT NULL)");
    await db.execute("INSERT INTO m0_probe (at, note) VALUES ($1, $2)", [new Date().toISOString(), "한글 저장 테스트 ✓"]);
    await db.close(url);
    db = null;

    const db2 = await Database.load(url);
    const jm = await db2.select<{ journal_mode: string }[]>("PRAGMA journal_mode");
    const mode = (jm[0]?.journal_mode ?? "?").toLowerCase();
    folder.push({ label: "journal_mode 유지(다시 연 뒤)", status: mode === "delete" ? "ok" : "warn", value: mode });
    const rows = await db2.select<{ n: number; note: string }[]>("SELECT COUNT(*) AS n, MAX(note) AS note FROM m0_probe");
    const ok = rows[0]?.note === "한글 저장 테스트 ✓";
    folder.push({ label: "SQLite 쓰기·읽기(한글)", status: ok ? "ok" : "bad", value: `행 ${rows[0]?.n ?? 0}개, 마지막 값 "${rows[0]?.note ?? ""}"` });

    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const backup = joinPath(joinPath(dir, "backups"), `wjb-m0-test_${stamp}.db`);
    await db2.execute(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
    const size = await invoke<number | null>("file_size", { path: backup });
    folder.push({ label: "VACUUM INTO 백업", status: size ? "ok" : "bad", value: size ? `${backup} (${size} B)` : `${backup} 생성 안 됨` });
    await db2.close(url);
  } catch (e) {
    folder.push({ label: "SQLite 테스트", status: "bad", value: errText(e) });
    if (db) await db.close(url).catch(() => undefined);
  }
}

function report(): string {
  const line = (c: Check) => `${MARK[c.status]} ${c.label}: ${c.value}`;
  const pick = (v: string) => v || "(미입력)";
  return [
    "[Work Journey Board I-M0 설치 검증 결과]",
    `작성 시각: ${new Date().toLocaleString("ko-KR")}`,
    "",
    "■ 자동 점검",
    ...auto.map(line),
    "",
    "■ 저장 폴더 테스트",
    ...(folder.length ? folder.map(line) : ["(아직 실행 안 함)"]),
    "",
    "■ 수동 확인",
    `- 설치 파일 전달 경로: ${pick(manual.delivery)}`,
    `- 관리자 권한 요청 없이 설치: ${pick(manual.admin)}`,
    `- SmartScreen: ${pick(manual.smartscreen)}`,
    `- 사내 백신: ${pick(manual.antivirus)}`,
    `- 재부팅 후 재실행 정상: ${manual.reboot ? "예" : "미확인"}`,
    `- 메모: ${manual.memo || "-"}`,
  ].join("\n");
}

function rows(list: Check[]) {
  return list.map((c) => `
    <div class="row"><span class="st ${c.status}">${MARK[c.status]}</span><span class="k">${esc(c.label)}</span><span class="v">${esc(c.value)}</span></div>`).join("");
}

function select(id: keyof typeof manual, options: string[]) {
  const cur = manual[id] as string;
  return `<select data-k="${id}"><option value="">선택…</option>${options
    .map((o) => `<option ${o === cur ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
}

function render() {
  const app = document.getElementById("app")!;
  app.innerHTML = `
    <h1>Work Journey Board — M0 설치 검증</h1>
    <p class="lead">이 앱은 회사 PC에서 설치·실행·파일 저장이 되는지만 확인합니다. 인터넷으로 아무것도 보내지 않습니다.</p>

    <section>
      <h2>1. 자동 점검 (앱을 열면 바로 실행)</h2>
      ${rows(auto)}
    </section>

    <section>
      <h2>2. 저장 폴더 테스트</h2>
      <p class="lead">실제로 일지를 둘 만한 폴더를 골라 보세요. 한글·공백이 든 폴더(예: <b>C:\\Users\\&lt;사용자&gt;\\업무 일지</b>)도 한 번 시험해 주세요.</p>
      <div class="actions"><button class="primary" id="pick" ${busy || !inTauri ? "disabled" : ""}>${busy ? "테스트 중…" : "폴더 선택 후 테스트"}</button></div>
      ${rows(folder)}
      ${folderNote ? `<div class="note warn">${esc(folderNote)}</div>` : ""}
    </section>

    <section>
      <h2>3. 수동 확인 (설치하면서 본 것)</h2>
      <div class="row"><span></span><span class="k">설치 파일 전달 경로</span><span class="v">${select("delivery", ["GitHub Release에서 바로 다운로드", "GitHub 접속/다운로드 차단 → 다른 경로(메모에 기록)"])}</span></div>
      <div class="row"><span></span><span class="k">관리자 권한 요청 없이 설치</span><span class="v">${select("admin", ["예(권한 요청 없음)", "아니오(관리자 암호 요구됨)"])}</span></div>
      <div class="row"><span></span><span class="k">SmartScreen</span><span class="v">${select("smartscreen", ["경고 없음", "경고 → '추가 정보 → 실행'으로 통과", "차단(실행 버튼 없음)"])}</span></div>
      <div class="row"><span></span><span class="k">사내 백신</span><span class="v">${select("antivirus", ["반응 없음", "경고만 표시", "격리·삭제됨"])}</span></div>
      <label class="chk"><input type="checkbox" id="reboot" ${manual.reboot ? "checked" : ""}/> 재부팅 후 다시 실행했고, 위 "실행 기록"의 실행 횟수가 늘었다</label>
      <div class="row"><span></span><span class="k">메모</span><span class="v"><input id="memo" style="width:100%" value="${esc(manual.memo)}" placeholder="막힌 지점, 다른 전달 경로, IT 문의 결과 등"/></span></div>
    </section>

    <section>
      <h2>4. 결과 보고서</h2>
      <p class="lead">[결과 복사] 후 Claude 세션에 붙여넣어 주세요. 업무 내용은 들어 있지 않습니다(경로·버전·판정만).</p>
      <textarea id="report" readonly>${esc(report())}</textarea>
      <div class="actions"><button class="primary" id="copy" ${inTauri ? "" : "disabled"}>결과 복사</button><span id="copied" class="lead"></span></div>
    </section>`;

  document.getElementById("pick")?.addEventListener("click", runFolderTest);
  app.querySelectorAll<HTMLSelectElement>("select[data-k]").forEach((el) =>
    el.addEventListener("change", () => { (manual as Record<string, unknown>)[el.dataset.k!] = el.value; render(); }));
  document.getElementById("reboot")?.addEventListener("change", (e) => { manual.reboot = (e.target as HTMLInputElement).checked; render(); });
  document.getElementById("memo")?.addEventListener("change", (e) => { manual.memo = (e.target as HTMLInputElement).value; render(); });
  document.getElementById("copy")?.addEventListener("click", async () => {
    const msg = document.getElementById("copied")!;
    try { await writeText(report()); msg.textContent = "복사됨 ✓ (클립보드 쓰기 정상)"; }
    catch (e) { msg.textContent = `복사 실패: ${errText(e)} — 위 칸을 직접 선택해 복사하세요`; }
  });
}

render();
runAutoChecks().then(render);
