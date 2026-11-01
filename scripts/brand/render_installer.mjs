// 설치 프로그램(NSIS) 그림 렌더 — 디자인 시점 도구(앱 실행·빌드와 무관, release-phase2-spec 3절 A안·5절 B3).
// 시작·끝 화면 왼쪽 그림 164×314 + 중간 화면 머리 그림 150×57을 PNG로 그린다. 이어서 pack_installer.py가 BMP(24비트)로 바꿔
// src-tauri/installer/에 둔다. 만든 이 = sanbonjini M1 공식 SVG(높이 40px — 브랜드 최소, 보호 여백 6px 이상).
// 실행: node scripts/brand/render_installer.mjs <출력 폴더>   (Playwright Chromium, PW_CHROMIUM_PATH로 경로 지정 가능)
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2];
if (!out) throw new Error("출력 폴더를 주세요");
mkdirSync(out, { recursive: true });
const read = (p) => readFileSync(p, "utf8");
const icon = read("src/shared/brand/icon.svg");
// 워드마크는 currentColor 글자 — 시그니처 본문색으로
const wordmark = read("src/shared/brand/wordmark.svg").replace(/fill="currentColor"/g, 'fill="#423c34"');
const m1 = read("src/shared/brand/sanbonjini/m1-en-color.svg");
const font = readFileSync("src/shared/fonts/GowunDodum-Regular.woff2").toString("base64");

const page = (w, h, body) => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:"Gowun Dodum";src:url(data:font/woff2;base64,${font}) format("woff2")}
html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:#ede6dc;font-family:"Gowun Dodum",sans-serif;color:#423c34}
svg{display:block}
</style></head><body>${body}</body></html>`;

const sidebar = page(
  164,
  314,
  `<div style="box-sizing:border-box;width:164px;height:314px;padding:22px 16px 14px;display:flex;flex-direction:column;justify-content:space-between">
  <div style="display:flex;flex-direction:column;gap:10px">
    <div style="width:44px;height:44px">${icon.replace("<svg ", '<svg width="44" height="44" ')}</div>
    <div style="width:132px">${wordmark.replace("<svg ", '<svg width="132" ')}</div>
    <div style="font-size:12px;color:#6b6054">오늘 한 일을, 한 줄씩</div>
  </div>
  <div style="display:flex;flex-direction:column;gap:5px">
    <i style="display:block;height:6px;width:78%;border-radius:3px;background:#2a78d6"></i>
    <i style="display:block;height:6px;width:60%;border-radius:3px;background:#eb6834"></i>
    <i style="display:block;height:6px;width:70%;border-radius:3px;background:#1baf7a"></i>
  </div>
  <div style="height:40px;padding:6px 0 0">${m1.replace("<svg ", '<svg height="40" ').replace(/ width="\d+"/, "")}</div>
</div>`,
);

const header = page(
  150,
  57,
  `<div style="width:150px;height:57px;display:flex;align-items:center;justify-content:flex-end;padding-right:10px;box-sizing:border-box;background:#fcf9f3">
  <div style="width:40px;height:40px">${icon.replace("<svg ", '<svg width="40" height="40" ')}</div>
</div>`,
);

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
const tab = await browser.newPage();
for (const [name, html, w, h] of [
  ["sidebar", sidebar, 164, 314],
  ["header", header, 150, 57],
]) {
  await tab.setViewportSize({ width: w, height: h });
  await tab.setContent(html);
  await tab.evaluate(() => globalThis.document.fonts.ready);
  await tab.screenshot({ path: join(out, `${name}.png`), clip: { x: 0, y: 0, width: w, height: h } });
}
await browser.close();
console.log(`rendered sidebar.png·header.png → ${out}`);
