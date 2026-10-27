// 릴리스 노트(improve-1027v3-spec 5절, 공통 규칙 3-6).
//   node scripts/release-notes.mjs check                  현재 package.json 버전의 노트·README 제목이 있는지(ci.yml)
//   node scripts/release-notes.mjs body <버전> --out <파일>  GitHub 릴리스 본문 = 노트 + 설치 파일 표(build-windows.yml)
// --root <폴더>로 저장소 위치를 바꿀 수 있다(테스트용). 외부 통신 없음.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** 이 판부터 노트가 반드시 있어야 한다(그 전 릴리스는 고치지 않는다) */
const FIRST = "0.2.16";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const root = opt("--root") ?? process.cwd();
const [cmd, verArg] = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));

const cmp = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};
const notesPath = (v) => join(root, "docs", "release-notes", `v${v}.md`);
const readmeHeading = (v) =>
  readFileSync(join(root, "README.md"), "utf8")
    .split("\n")
    .find((l) => l.startsWith(`### v${v} (`));

function problems(v) {
  const out = [];
  const p = notesPath(v);
  if (!existsSync(p)) out.push(`노트 파일이 없습니다: docs/release-notes/v${v}.md`);
  else {
    const text = readFileSync(p, "utf8");
    if (!/^# \S/.test(text.trimStart())) out.push("노트 첫 줄은 '# 한 줄 요약'이어야 합니다");
    if (!/^## 주의\s*$/m.test(text))
      out.push("노트에 '## 주의' 절이 없습니다(데이터 형식·되돌려 설치·외부 통신)");
  }
  if (!readmeHeading(v)) out.push(`README Version History에 '### v${v} (날짜) — 요약' 제목이 없습니다`);
  return out;
}

function body(v) {
  const head = [`**Work Journey Board v${v}** (개발 중 사전 릴리스)`, ""];
  if (existsSync(notesPath(v))) {
    const text = readFileSync(notesPath(v), "utf8").replace(/\r\n/g, "\n").trim();
    const [first, ...rest] = text.split("\n");
    const title = first.replace(/^#\s*/, "").trim();
    const date = readmeHeading(v)?.match(/^### v\S+ \(([^)]+)\)/)?.[1];
    head.push(
      `**${title}**${date ? ` — ${date}` : ""}`,
      "",
      rest.join("\n").trim().replace(/^## /gm, "### "),
      "",
    );
  }
  return [
    ...head,
    "### 설치 파일",
    "",
    "| 파일 | 용도 |",
    "|---|---|",
    `| \`WorkJourneyBoard_${v}_setup.exe\` | 기본 설치 파일(현재 사용자 전용, WebView2 없으면 자동 설치) |`,
    "| `…_setup_offline.exe` | (있을 때만) WebView2 오프라인 설치판 — 인터넷이 막힌 PC용 |",
    "| `SHA256SUMS*.txt` | 무결성 확인: `certutil -hashfile <파일> SHA256` |",
    "",
    "앱은 새 판 확인·내려받기(GitHub)만 인터넷을 쓰며, 기록·메모는 어디에도 보내지 않습니다.",
    "",
  ].join("\n");
}

const version = verArg ?? JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
if (cmd === "check") {
  if (cmp(version, FIRST) < 0) {
    console.log(`v${version}: 노트 규칙 적용 전 판 — 건너뜀`);
  } else {
    const errs = problems(version);
    if (errs.length) {
      for (const e of errs) console.error(`✗ ${e}`);
      process.exit(1);
    }
    console.log(`✓ v${version} 릴리스 노트 확인`);
  }
} else if (cmd === "body") {
  const out = opt("--out");
  const errs = cmp(version, FIRST) < 0 ? [] : problems(version);
  if (errs.length) {
    for (const e of errs) console.error(`✗ ${e}`);
    process.exit(1);
  }
  const md = body(version);
  if (out) writeFileSync(out, md, "utf8");
  else process.stdout.write(md);
} else {
  console.error("사용법: release-notes.mjs check | body <버전> --out <파일>");
  process.exit(2);
}
