// 링크 공유 미리보기 그림(Open Graph) — site/og-image.png(1200×630). 사이트의 아이콘·워드마크·화면 그림만 쓴다(외부 통신 없음).
//   node scripts/site/og.mjs      (PW_CHROMIUM_PATH로 Chromium 위치를 줄 수 있음)
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const SITE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "site");
const u = (p) => pathToFileURL(join(SITE, p)).href;

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
@font-face{font-family:Gowun;src:url("${u("gowun-dodum.woff2")}") format("woff2")}
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;overflow:hidden;background:#fbf8f2;font-family:Gowun,sans-serif;color:#393832;position:relative}
.band{position:absolute;inset:0 0 0 auto;width:560px;background:#f1e9dc;border-radius:0 0 0 48px}
.copy{position:absolute;left:72px;top:88px;width:520px}
.brand{display:flex;align-items:center;gap:16px}
.brand img.icon{width:64px;height:64px}
.brand img.word{height:40px}
h1{margin-top:48px;font-size:52px;line-height:1.32;letter-spacing:-.05em;font-weight:400}
h1 em{font-style:normal;color:#a45e43}
p{margin-top:24px;font-size:22px;line-height:1.7;color:#6c655b}
.chips{position:absolute;left:72px;bottom:64px;display:flex;gap:10px}
.chips span{padding:8px 16px;border-radius:999px;background:#ece4d7;color:#775a43;font-size:17px}
.shot{position:absolute;right:56px;top:96px;width:560px;border-radius:12px;overflow:hidden;box-shadow:0 24px 60px rgba(75,57,37,.18);border:1px solid #e9e1d5;background:#fff}
.shot img{display:block;width:100%}
</style></head><body>
<div class="band"></div>
<div class="copy">
  <div class="brand"><img class="icon" src="${u("icon.svg")}"><img class="word" src="${u("wordmark.svg")}"></div>
  <h1>기록은 가볍게,<br><em>흐름은 선명하게.</em></h1>
  <p>매일 2분의 짧은 기록이 한 주의 요약과<br>업무의 흐름이 되는 개인 업무 일지</p>
</div>
<div class="chips"><span>주간 보드</span><span>칸반 보드</span><span>주간 요약·엑셀</span><span>Universe</span><span>Cabi.NET</span></div>
<div class="shot"><img src="${u("shots/board.webp")}"></div>
</body></html>`;

const { chromium } = await import("playwright");
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
const tmp = join(mkdtempSync(join(tmpdir(), "wjb-og-")), "og.html");
writeFileSync(tmp, html, "utf8");
await page.goto(pathToFileURL(tmp).href, { waitUntil: "load" });
await page.evaluate(() => globalThis.document.fonts.ready);
await page.screenshot({ path: join(SITE, "og-image.png") });
// 아이폰 홈 화면·일부 메신저용 PNG 아이콘(180×180)
const icon = await browser.newPage({ viewport: { width: 180, height: 180 } });
await icon.setContent(`<body style="margin:0;background:#fbf8f2"><img src="${u("icon.svg")}" style="display:block;width:180px;height:180px"></body>`);
await icon.waitForLoadState("load");
await icon.screenshot({ path: join(SITE, "apple-touch-icon.png") });
await browser.close();
console.log("✓ site/og-image.png (1200×630) · site/apple-touch-icon.png (180×180)");
