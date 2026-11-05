// 빠른 이용 가이드(features-1102-spec F6) — 원본 docs/guide/NN-이름.md → 소개 사이트 site/guide/index.html · PDF.
//   node scripts/guide/guide.mjs build              HTML 만들기(원본만 읽음, 결정적 — 같은 원본이면 같은 결과)
//   node scripts/guide/guide.mjs pdf                HTML → site/guide/work-journey-board-guide.pdf(Playwright Chromium 인쇄)
//   node scripts/guide/guide.mjs shots [주소]       브라우저 모드(가상 샘플 ?sample=showcase)로 장면 스크린샷 → site/guide/shots/
//   node scripts/guide/guide.mjs check              CI: 대응표·이미지 파일·HTML이 원본과 같은지
// 외부 통신 없음(shots는 로컬 개발 서버만). 새 의존성 없음 — 마크다운은 이 파일의 작은 변환기로(가이드에 쓰는 문법만).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(ROOT, "docs", "guide");
const OUT = join(ROOT, "site", "guide");
const HTML = join(OUT, "index.html");
const PDF = join(OUT, "work-journey-board-guide.pdf");
const SITE_URL = "https://chs2147.github.io/work-journey-board/";

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// 단축키 맥 표기(macos-spec 3-2) — 앱의 src/shared/platformText.ts `macText`와 같은 규칙(단위 테스트가 둘이 같은지 본다).
// 가이드는 한 벌로 쓰고(윈도우 표기), 단축키 옆에 맥 표기를 괄호로 덧붙인다: `Ctrl+Shift+F` (`⇧⌘F`)
const MOD_SYMBOL = { Ctrl: "⌘", Alt: "⌥", Shift: "⇧" };
const MOD_ORDER = ["⌃", "⌥", "⇧", "⌘"];
const KEY_SYMBOL = { Enter: "↩", Delete: "⌦", Backspace: "⌫", Tab: "⇥" };
const COMBO =
  /\b((?:(?:Ctrl|Alt|Shift)\+)+)(F\d{1,2}(?!\d)|Enter|Delete|Backspace|Tab|Esc|[←→↑↓](?:\/[←→↑↓])?|[A-Z0-9](?![A-Za-z0-9])|[-=,.[\]/]|[가-힣]+)/g;

/** 단축키 글(윈도우 표기) → 맥 표기. 단축키가 없으면 그대로 */
export function macKeys(s) {
  return s
    .replace(/Win\+Shift\+S/g, "⇧⌘4")
    .replace(COMBO, (_, mods, key) => {
      const syms = mods
        .split("+")
        .filter(Boolean)
        .map((m) => MOD_SYMBOL[m] ?? m);
      const ordered = MOD_ORDER.filter((x) => syms.includes(x)).join("");
      return /^[가-힣]/.test(key) ? `${ordered}+${key}` : ordered + (KEY_SYMBOL[key] ?? key);
    })
    .replace(/(^|[\s(·])Delete(?=$|[\s)·])/g, "$1⌫");
}

/** 코드 조각 하나: 단축키면 맥 표기를 괄호로 덧붙인다 */
function codeSpan(raw) {
  const mac = macKeys(raw);
  const win = `<code>${esc(raw)}</code>`;
  return mac === raw ? win : `${win}<span class="mac"> (<code>${esc(mac)}</code>)</span>`;
}

/** 글 안 서식: `코드`(단축키는 맥 표기 덧붙임) · **굵게** · [글](주소) · 탐색기(Finder) */
function inline(text) {
  const parts = text.split(/(`[^`]+`)/g);
  const hasFinder = text.includes("Finder");
  return parts
    .map((p) => {
      if (p.startsWith("`") && p.endsWith("`") && p.length > 1) return codeSpan(p.slice(1, -1));
      return (hasFinder ? esc(p) : esc(p).replace(/탐색기/g, "탐색기(Finder)"))
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, href) => {
          const ext = /^https?:/.test(href);
          return `<a href="${href}"${ext ? ' target="_blank" rel="noopener"' : ""}>${t}${ext ? " ↗" : ""}</a>`;
        });
    })
    .join("");
}

/** 장면 하나의 마크다운 → HTML(제목 줄 제외) */
export function mdToHtml(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) {
      i++;
      continue;
    }
    const img = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(l);
    if (img) {
      out.push(
        `<figure><img src="${esc(img[2])}" alt="${esc(img[1])}"><figcaption>${esc(img[1])}</figcaption></figure>`,
      );
      i++;
    } else if (/^### /.test(l)) {
      // 장면 안 소제목(예: 설치 — Windows / macOS) — 굵기가 하나뿐인 글꼴에서도 눈에 띄게 색 띠로
      out.push(`<h3>${inline(l.slice(4))}</h3>`);
      i++;
    } else if (/^\d+\. /.test(l)) {
      const items = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) items.push(lines[i++].replace(/^\d+\. /, ""));
      out.push(`<ol class="steps">${items.map((t) => `<li>${inline(t)}</li>`).join("")}</ol>`);
    } else if (/^- /.test(l)) {
      const items = [];
      while (i < lines.length && /^- /.test(lines[i])) items.push(lines[i++].slice(2));
      out.push(`<ul>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</ul>`);
    } else if (/^\|/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) =>
        r
          .replace(/^\||\|$/g, "")
          .split(/(?<!\\)\|/)
          .map((c) => c.trim());
      const [head, , ...body] = rows;
      out.push(
        `<table><thead><tr>${cells(head)
          .map((c) => `<th>${inline(c)}</th>`)
          .join("")}</tr></thead><tbody>${body
          .map(
            (r) =>
              `<tr>${cells(r)
                .map((c) => `<td>${inline(c)}</td>`)
                .join("")}</tr>`,
          )
          .join("")}</tbody></table>`,
      );
    } else {
      const para = [];
      while (i < lines.length && lines[i].trim() && !/^(\d+\. |- |\||!\[)/.test(lines[i]))
        para.push(lines[i++]);
      const text = para.join(" ");
      const tip = /^\*\*(팁|언제 쓰나요)\*\*/.test(text);
      out.push(`<p${tip ? ' class="lead"' : ""}>${inline(text)}</p>`);
    }
  }
  return out.join("\n");
}

/** 원본 장면 목록(번호순) — map.md·README 제외 */
export function readScenes(src = SRC) {
  return readdirSync(src)
    .filter((f) => /^\d{2}-[a-z0-9-]+\.md$/.test(f))
    .sort()
    .map((file) => {
      const md = readFileSync(join(src, file), "utf8");
      const num = Number(file.slice(0, 2));
      const title = /^# (.+)$/m.exec(md)?.[1]?.trim() ?? file;
      const body = md.replace(/^# .+\n/, "");
      return { file, num, id: `s${num}`, title, body, label: num >= 90 ? "부록" : String(num) };
    });
}

function readMeta(src = SRC) {
  const map = readFileSync(join(src, "map.md"), "utf8");
  return {
    version: /^기준 판: (\S+)/m.exec(map)?.[1] ?? "?",
    updated: /^갱신: (\S+)/m.exec(map)?.[1] ?? "?",
    map,
  };
}

export function buildHtml(src = SRC) {
  const scenes = readScenes(src);
  const { version, updated } = readMeta(src);
  const toc = scenes
    .map(
      (s) =>
        `<li><a href="#${s.id}"><span class="no">${s.num >= 90 ? "" : s.label}</span>${esc(s.title)}</a></li>`,
    )
    .join("");
  const sections = scenes
    .map(
      (s) =>
        `<section class="scene" id="${s.id}">\n<h2><span class="no">${s.num >= 90 ? "부록" : `장면 ${s.label}`}</span>${esc(s.title)}</h2>\n${mdToHtml(s.body)}\n</section>`,
    )
    .join("\n");
  return `<!doctype html>
<!-- 만든 파일 — 고치지 마세요. 원본 docs/guide/*.md → node scripts/guide/guide.mjs build -->
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>빠른 이용 가이드 · Work Journey Board</title>
<link rel="icon" href="../icon.svg">
<link rel="canonical" href="https://chs2147.github.io/work-journey-board/guide/">
<link rel="apple-touch-icon" href="https://chs2147.github.io/work-journey-board/apple-touch-icon.png">
<!-- 링크 공유 미리보기(Open Graph·트위터 카드) — 그림은 scripts/site/og.mjs가 만든다 -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="Work Journey Board">
<meta property="og:locale" content="ko_KR">
<meta property="og:url" content="https://chs2147.github.io/work-journey-board/guide/">
<meta property="og:title" content="빠른 이용 가이드 · Work Journey Board">
<meta property="og:description" content="설치부터 매일 2분 기록, 주간 보고, 메모 보드, Cabinet, 백업까지 — 장면별 사용법(HTML·PDF).">
<meta property="og:image" content="https://chs2147.github.io/work-journey-board/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Work Journey Board 빠른 이용 가이드">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="빠른 이용 가이드 · Work Journey Board">
<meta name="twitter:description" content="설치부터 매일 2분 기록, 주간 보고, 메모 보드, Cabinet, 백업까지 — 장면별 사용법(HTML·PDF).">
<meta name="twitter:image" content="https://chs2147.github.io/work-journey-board/og-image.png">
<style>
@font-face{font-family:Gowun;src:url("../gowun-dodum.woff2") format("woff2");font-display:swap}
:root{--ink:#393832;--soft:#71695f;--paper:#fbf8f2;--cream:#f5f0e7;--line:#e8e0d4;--clay:#a45e43}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:Gowun,"Malgun Gothic",sans-serif;font-size:16px;line-height:1.8;word-break:keep-all;overflow-wrap:anywhere;font-synthesis:none}
a{color:var(--clay)}
.wrap{max-width:920px;margin:0 auto;padding:0 24px}
header.top{border-bottom:1px solid var(--line);background:var(--paper);position:sticky;top:0;z-index:2}
header.top .wrap{display:flex;align-items:center;gap:14px;height:64px}
header.top img.icon{width:30px;height:30px}
header.top img.word{height:22px}
header.top nav{margin-left:auto;display:flex;gap:18px;font-size:13px}
header.top nav a{color:var(--soft);text-decoration:none}
.hero{padding:48px 0 24px}
.hero h1{font-size:36px;letter-spacing:-.04em;margin:0 0 8px}
.hero p{color:var(--soft);margin:0}
.meta{font-size:13px;color:#8b7e6f;margin-top:10px}
.dl{display:inline-block;margin-top:18px;padding:10px 16px;border-radius:6px;background:#775a43;color:#fffaf3;text-decoration:none;font-size:14px}
.toc{background:var(--cream);border:1px solid var(--line);border-radius:12px;padding:20px 24px;margin:24px 0 8px}
.toc h2{font-size:15px;margin:0 0 8px;color:var(--soft)}
.toc ol{list-style:none;margin:0;padding:0;columns:2;column-gap:32px}
.toc li{break-inside:avoid}
.toc a{display:flex;gap:10px;padding:3px 0;color:var(--ink);text-decoration:none}
.toc .no{display:inline-block;min-width:22px;color:var(--clay)}
.scene{padding:40px 0 24px;border-bottom:1px solid var(--line)}
.scene h2{font-size:26px;letter-spacing:-.03em;margin:0 0 16px;display:flex;flex-direction:column;gap:2px}
.scene h2 .no{font-size:12px;letter-spacing:.12em;color:var(--clay)}
.scene p.lead{margin:12px 0 4px}
.scene h3{font-size:17px;margin:22px 0 6px;padding:2px 0 2px 10px;border-left:4px solid var(--clay);color:var(--clay)}
ol.steps{counter-reset:s;list-style:none;padding:0;margin:12px 0}
ol.steps li{counter-increment:s;position:relative;padding:6px 0 6px 40px}
ol.steps li::before{content:counter(s);position:absolute;left:0;top:8px;width:26px;height:26px;border-radius:50%;background:var(--clay);color:#fff;font-size:13px;line-height:26px;text-align:center}
ul{padding-left:22px}
code{font-family:Consolas,"Malgun Gothic",monospace;font-size:.88em;background:#efe8dc;border-radius:4px;padding:1px 5px}
.mac{color:var(--soft);white-space:nowrap}
.mac code{font-family:-apple-system,"Apple SD Gothic Neo","Segoe UI Symbol","Noto Sans Symbols 2","Noto Sans Symbols",system-ui,sans-serif;font-size:1em;letter-spacing:.04em}
figure{margin:18px 0;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#fff}
figure img{display:block;width:100%;height:auto}
figcaption{font-size:13px;color:var(--soft);padding:8px 14px;border-top:1px solid var(--line);background:var(--cream)}
table{border-collapse:collapse;width:100%;margin:12px 0;font-size:14px}
th,td{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}
th{background:var(--cream)}
footer{padding:32px 0 48px;color:#9c8f81;font-size:12px}
@media (max-width:640px){.toc ol{columns:1}.hero h1{font-size:28px}header.top nav{display:none}}
@media print{
  @page{size:A4;margin:16mm 14mm 18mm}
  body{font-size:11.5pt;background:#fff}
  header.top{position:static}
  header.top nav,.dl{display:none}
  .scene{break-before:page;border:0;padding-top:0}
  figure,table,ol.steps li{break-inside:avoid}
  .scene h3{break-after:avoid}
  a{text-decoration:none;color:var(--ink)}
}
</style>
</head>
<body>
<header class="top"><div class="wrap">
<a href="../"><img class="icon" src="../icon.svg" alt=""></a><img class="word" src="../wordmark.svg" alt="Work Journey Board">
<nav aria-label="가이드 메뉴"><a href="../">소개</a><a href="#toc">목차</a><a href="./work-journey-board-guide.pdf">PDF</a></nav>
</div></header>
<main class="wrap">
<div class="hero">
<h1>빠른 이용 가이드</h1>
<p>자주 쓰는 장면별로 — 언제 쓰나요 → 순서 → 화면 → 팁.</p>
<p class="meta">v${esc(version)} 기준 · 갱신 ${esc(updated)} · 화면은 가상 샘플입니다</p>
<a class="dl" href="./work-journey-board-guide.pdf">PDF로 내려받기</a>
</div>
<nav class="toc" id="toc" aria-label="목차"><h2>목차</h2><ol>${toc}</ol></nav>
${sections}
</main>
<footer class="wrap">Work Journey Board · Copyright 2026 sanbonjini · <a href="${SITE_URL}">소개 사이트</a></footer>
</body>
</html>
`;
}

/** 원본에서 쓰는 그림 경로(shots/…) */
export function imagesOf(scenes) {
  return scenes.flatMap((s) => [...s.body.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]));
}

export function check(src = SRC, out = OUT) {
  const errs = [];
  const scenes = readScenes(src);
  const { map } = readMeta(src);
  if (!scenes.length) errs.push("docs/guide에 장면 파일이 없습니다");
  for (const s of scenes)
    if (!new RegExp(`\\|\\s*${String(s.num).padStart(2, "0")}\\s*\\|`).test(map))
      errs.push(`map.md 대응표에 장면 ${String(s.num).padStart(2, "0")}(${s.file})이 없습니다`);
  for (const img of imagesOf(scenes))
    if (!existsSync(join(out, img))) errs.push(`그림 파일이 없습니다: site/guide/${img}`);
  for (const s of scenes)
    for (const m of s.body.matchAll(/\]\(#(s\d+)\)/g))
      if (!scenes.some((x) => x.id === m[1])) errs.push(`${s.file}: 없는 장면으로 가는 링크 #${m[1]}`);
  const html = join(out, "index.html");
  if (!existsSync(html)) errs.push("site/guide/index.html이 없습니다 — node scripts/guide/guide.mjs build");
  else if (readFileSync(html, "utf8") !== buildHtml(src))
    errs.push("site/guide/index.html이 원본과 다릅니다 — node scripts/guide/guide.mjs build 후 함께 커밋");
  if (!existsSync(join(out, "work-journey-board-guide.pdf")))
    errs.push("PDF가 없습니다 — node scripts/guide/guide.mjs pdf");
  return errs;
}

async function pdf() {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch(
    process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  );
  const page = await browser.newPage();
  await page.goto(pathToFileURL(HTML).href, { waitUntil: "load" });
  await page.evaluate(() => globalThis.document.fonts.ready);
  await page.pdf({
    path: PDF,
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate:
      '<div style="width:100%;font-size:8px;color:#9c8f81;text-align:center">Work Journey Board 빠른 이용 가이드 · <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    margin: { top: "16mm", bottom: "18mm", left: "14mm", right: "14mm" },
  });
  await browser.close();
}

/** 장면 스크린샷(가상 샘플) — 개발 서버(npm run dev)가 떠 있어야 한다 */
async function shots(base = "http://localhost:1420") {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch(
    process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  );
  mkdirSync(join(OUT, "shots"), { recursive: true });
  const show = "/?sample=showcase&today=2026-10-22&theme=signature";
  const steps = {
    "01-setup": { url: "/?fresh=1&theme=signature" },
    "02-daily": { url: show },
    "03-carry": { url: "/?today=2026-10-22&theme=signature" },
    // 중요 업무 패널은 처음부터 열려 있다(Alt+2는 닫기가 됨)
    "04-important": { url: show },
    "05-memo": { url: show, run: (p) => p.getByRole("button", { name: "크게 보기" }).first().click() },
    "06-summary": { url: show, run: (p) => p.getByTestId("summary-toggle").click() },
    "07-export": { url: show, run: (p) => p.keyboard.press("Alt+E") },
    "08-insights": { url: show, run: (p) => p.keyboard.press("Alt+3") },
    "09-search": {
      url: show,
      run: async (p) => {
        await p.keyboard.press("Control+Shift+F");
        await p.keyboard.type("배치");
        await p.keyboard.press("Enter");
      },
    },
    "10-holiday": {
      url: "/?sample=showcase&today=2026-10-02&theme=signature",
      run: async (p) => {
        await p.getByTestId("rail-settings").click();
        await p.locator("#settings-tab-calendar").click();
      },
    },
    "11-cabinet": {
      url: show,
      run: async (p) => {
        await p.keyboard.press("Alt+4");
        await p.locator('[data-testid="cabinet-row"][data-kind="folder"]').nth(1).dblclick();
        await p.locator('[data-testid="folder-row"][data-name="2026-10 이관"]').dblclick();
      },
    },
    "12-backup": {
      url: show,
      run: async (p) => {
        await p.getByTestId("rail-settings").click();
        await p.locator("#settings-tab-data").click();
      },
    },
    "13-workspace": {
      url: `${show}&ws=2`,
      run: (p) => p.getByTestId("workspace-button").click(),
    },
    "14-universe": {
      url: show,
      run: async (p) => {
        await p.keyboard.press("Alt+5");
        await p.getByTestId("u-toggle-detail").click();
        await p.waitForTimeout(600);
        // 직접 연결 하나(가상 기록끼리) — 굵은 화살표와 "왜 이어졌나" 문구가 보이게(UV2)
        await p.getByTestId("u-connect").click();
        await p.getByTestId("u-link-search").fill("배치 현행");
        await p.getByTestId("u-link-candidate").first().click();
        await p.getByTestId("u-link-type-follow-up").check();
        await p.getByTestId("u-link-save").click();
        await p.waitForTimeout(400);
        await p.mouse.move(0, 0);
        await p.waitForTimeout(4500); // 저장 알림이 사라진 뒤
      },
    },
  };
  for (const [name, st] of Object.entries(steps)) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await page.goto(base + st.url);
    await page.waitForSelector('[data-testid="journal-status"]');
    await page.waitForTimeout(600);
    if (st.run) await st.run(page);
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, "shots", `${name}.png`) });
    await page.close();
    console.log(`✓ shots/${name}.png`);
  }
  await browser.close();
}

const [cmd, arg] = process.argv.slice(2);
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (cmd === "build") {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(HTML, buildHtml(), "utf8");
    console.log(`✓ site/guide/index.html (${readScenes().length}장면)`);
  } else if (cmd === "pdf") {
    await pdf();
    console.log("✓ site/guide/work-journey-board-guide.pdf");
  } else if (cmd === "shots") {
    await shots(arg);
  } else if (cmd === "check") {
    const errs = check();
    if (errs.length) {
      for (const e of errs) console.error(`✗ ${e}`);
      process.exit(1);
    }
    console.log(`✓ 이용 가이드 확인(${readScenes().length}장면)`);
  } else {
    console.error("사용법: guide.mjs build | pdf | shots [주소] | check");
    process.exit(2);
  }
}
