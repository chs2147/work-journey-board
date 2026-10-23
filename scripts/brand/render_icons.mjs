// 앱 아이콘 PNG 렌더 — 디자인 시점 도구(앱 실행·빌드와 무관). src/shared/brand/icon*.svg → 크기별 PNG.
// 16~32px은 작은 판(icon-small.svg), 그 이상은 기본판(icon.svg). 이어서 pack_icons.py가 .ico·.icns를 묶는다.
// 실행: node scripts/brand/render_icons.mjs <출력 폴더>   (Playwright Chromium 사용, PW_CHROMIUM_PATH로 경로 지정 가능)
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2];
if (!out) throw new Error("출력 폴더를 주세요");
mkdirSync(out, { recursive: true });
const svg = (name) => readFileSync(join("src/shared/brand", name), "utf8");
const SMALL = [16, 24, 32];
const LARGE = [48, 64, 128, 256, 512, 1024];

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
const page = await browser.newPage();
for (const size of [...SMALL, ...LARGE]) {
  const src = SMALL.includes(size) ? svg("icon-small.svg") : svg("icon.svg");
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${src.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`,
  );
  await page.screenshot({
    path: join(out, `${size}.png`),
    omitBackground: true,
    clip: { x: 0, y: 0, width: size, height: size },
  });
}
await browser.close();
console.log(`rendered ${SMALL.length + LARGE.length} sizes → ${out}`);
