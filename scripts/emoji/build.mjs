// 칸반 섹션 아이콘(improve-v23-spec 8절) — Microsoft Fluent Emoji Flat(MIT)에서 Productivity 36개만 뽑아
// src/shared/sectionIcons.ts를 만든다. 앱은 이 SVG 글자만 번들(외부 통신 없음). 개발 의존성 @iconify-json/fluent-emoji-flat(버전 고정).
//   node scripts/emoji/build.mjs        (check: 생성물이 원본과 같은지)
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(ROOT, "node_modules/@iconify-json/fluent-emoji-flat/icons.json");
const OUT = join(ROOT, "src/shared/sectionIcons.ts");

/** [id, 한국어 이름] — 순서 = 고르기 판 순서 */
const SET = [
  ["clipboard", "할 일"],
  ["pushpin", "고정"],
  ["eyes", "검토"],
  ["pause-button", "보류"],
  ["rocket", "진행"],
  ["check-mark-button", "완료"],
  ["memo", "메모"],
  ["fire", "급함"],
  ["star", "중요"],
  ["bullseye", "목표"],
  ["light-bulb", "아이디어"],
  ["magnifying-glass-tilted-left", "조사"],
  ["test-tube", "테스트"],
  ["hammer-and-wrench", "작업"],
  ["gear", "설정"],
  ["construction", "공사 중"],
  ["speech-balloon", "논의"],
  ["megaphone", "공지"],
  ["package", "배포"],
  ["chequered-flag", "마무리"],
  ["compass", "방향"],
  ["bar-chart", "지표"],
  ["chart-increasing", "성장"],
  ["locked", "잠금"],
  ["handshake", "협업"],
  ["inbox-tray", "받은 일"],
  ["bookmark-tabs", "문서"],
  ["brain", "생각"],
  ["bell", "알림"],
  ["stopwatch", "시간"],
  ["spiral-calendar", "일정"],
  ["alarm-clock", "마감"],
  ["hourglass-not-done", "대기"],
  ["card-index-dividers", "분류"],
  ["file-folder", "폴더"],
  ["label", "꼬리표"],
];

const data = JSON.parse(readFileSync(SRC, "utf8"));
const icons = SET.map(([id, label]) => {
  const ic = data.icons[id];
  if (!ic) throw new Error(`없는 아이콘: ${id}`);
  // 같은 화면에 여러 개 그려도 그라디언트 id가 겹치지 않게 접두어
  const body = ic.body
    .replace(/id="([^"]+)"/g, `id="se-${id}-$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#se-${id}-$1)`);
  return { id, label, body };
});

const ts = `// 생성물 — node scripts/emoji/build.mjs (손대지 말 것)
// Microsoft Fluent Emoji Flat ${data.info?.version ?? ""} 일부 · MIT · © Microsoft Corporation — public/licenses/FluentEmoji-MIT.txt
export interface SectionIcon {
  id: string;
  label: string;
  /** viewBox 0 0 32 32 안의 SVG */
  body: string;
}
export const SECTION_ICONS: readonly SectionIcon[] = ${JSON.stringify(icons, null, 2)};
`;
if (process.argv[2] === "check") {
  const cur = readFileSync(OUT, "utf8");
  if (cur !== ts) {
    console.error("✗ src/shared/sectionIcons.ts가 생성 도구와 다릅니다 — node scripts/emoji/build.mjs");
    process.exit(1);
  }
  console.log("✓ 섹션 아이콘 생성물 일치");
} else {
  writeFileSync(OUT, ts);
  console.log(`✓ src/shared/sectionIcons.ts (${icons.length}개)`);
}
