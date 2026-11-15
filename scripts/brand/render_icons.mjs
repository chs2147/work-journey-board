// 앱 아이콘 PNG 렌더 — 디자인 시점 도구(앱 실행·빌드와 무관). src/shared/brand/icon*.svg → 크기별 PNG.
// 16~32px은 작은 판(icon-small.svg), 그 이상은 기본판(icon.svg). 이어서 pack_icons.py가 .ico·.icns를 묶는다.
// 실행: node scripts/brand/render_icons.mjs <출력 폴더> [--variant dev]   (Playwright Chromium 사용, PW_CHROMIUM_PATH로 경로 지정 가능)
// --variant dev = 비공식 판(DEV·Preview) 설치 아이콘(release-channel-spec 6절): 바탕을 DEV 주황으로, 48px 이상은 아래에 "DEV" 띠(직각).
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2];
const variant = process.argv[3] === "--variant" ? process.argv[4] : null;
if (variant !== null && variant !== "dev") throw new Error("--variant dev 만 있습니다");
// DEV 색 = tokens.css --dev-accent(#c2410c)·--dev-band-text(#7c2d12)
const DEV_TILE = "#c2410c",
  DEV_BAND = "#7c2d12";
function devVariant(src, small) {
  const tile = small
    ? '<rect width="32" height="32" rx="7" fill="#185fa5"/>'
    : '<rect width="64" height="64" rx="14" fill="#185fa5"/>';
  if (!src.includes(tile)) throw new Error("아이콘 바탕 사각형을 찾지 못했습니다");
  let out = src.replace(tile, tile.replace("#185fa5", DEV_TILE));
  if (!small)
    // 아래 띠: 바탕 둥근 모서리 안쪽으로 잘라 직각 띠(clipPath) + 흰 글자 DEV
    out = out.replace(
      "</svg>",
      `  <defs><clipPath id="devTile"><rect width="64" height="64" rx="14"/></clipPath></defs>
  <g clip-path="url(#devTile)"><rect x="0" y="45" width="64" height="19" fill="${DEV_BAND}"/></g>
  <text x="32" y="59.5" text-anchor="middle" font-family="Inter Display, Inter, DejaVu Sans, sans-serif" font-weight="800" font-size="14" letter-spacing="1.5" fill="#ffffff">DEV</text>
</svg>`,
    );
  return out;
}
if (!out) throw new Error("출력 폴더를 주세요");
mkdirSync(out, { recursive: true });
const svg = (name) => readFileSync(join("src/shared/brand", name), "utf8");
const SMALL = [16, 24, 32];
const LARGE = [48, 64, 128, 256, 512, 1024];

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
const page = await browser.newPage();
for (const size of [...SMALL, ...LARGE]) {
  const small = SMALL.includes(size);
  const base = small ? svg("icon-small.svg") : svg("icon.svg");
  const src = variant === "dev" ? devVariant(base, small) : base;
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
