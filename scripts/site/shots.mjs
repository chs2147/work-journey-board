// 소개 사이트·README 화면 그림 — 실제 앱(브라우저 모드, 가상 샘플·시그니처 테마)을 2배 해상도로 찍는다.
//   npm run dev 를 띄운 채: node scripts/site/shots.mjs [http://localhost:5173] [이름]
//   → site/shots/*.webp(폭 1600 안팎) · docs/screenshots/*-signature.png(원본 2배)
//   PNG → WebP 변환은 Python Pillow(scripts/site/webp.py). 화면 속 기록은 모두 가상 예시(CLAUDE.md 4-2).
import { join, dirname } from "node:path";
/* global document, HTMLElement -- page.evaluate 안(브라우저)에서만 쓴다 */
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RAW = join(tmpdir(), "wjb-site-shots");
mkdirSync(RAW, { recursive: true });
const base = process.argv[2] ?? "http://localhost:5173";
const only = process.argv[3];
const show = "/?sample=showcase&today=2026-10-22&theme=signature";

const { chromium } = await import("playwright");
const browser = await chromium.launch(
  process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
);

/** raw PNG → site webp(폭 width) · README png(원본 그대로) */
const out = [];
const webp = (name, width) => out.push(["webp", name, width]);
const png = (name, dest) => out.push(["png", name, dest]);

async function page(url, vw = 1440, vh = 900) {
  const p = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 2 });
  await p.goto(base + url);
  await p.waitForSelector('[data-testid="journal-status"]');
  await p.waitForTimeout(700);
  return p;
}
const settle = async (p, ms = 600) => {
  await p.mouse.move(0, 0);
  await p.waitForTimeout(ms);
};
/** 중요 업무 패널을 닫아 보드 열을 넓게(Alt+2 = 열기/닫기) */
async function closeImportant(p) {
  if (await p.getByTestId("important-panel").isVisible()) await p.keyboard.press("Alt+Digit2");
  await p.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : 0));
}
const shot = (p, name, target) => (target ?? p).screenshot({ path: join(RAW, `${name}.png`) });

async function kanbanSetup(p) {
  await p.keyboard.press("Alt+Digit6");
  await p.getByTestId("kanban-view").waitFor();
  await p.getByTestId("kanban-add-section").click();
  await p.getByTestId("kanban-section-dialog").getByRole("textbox").fill("검토 중");
  await p.getByTestId("kanban-section-save").click();
  const move = async (text, to) =>
    p.getByTestId("kanban-card").filter({ hasText: text }).first().dragTo(p.getByTestId(to));
  await move("점검 결과 보고서 초안 작성", "kanban-col-section");
  await move("설계안 팀 리뷰", "kanban-col-section");
  await move("지표 정의서 v0.3 공유", "kanban-col-done");
  // 1.40: ★ 항목도 사용자 섹션에 — 중요 업무 목록에 섹션 칩
  await move("개발계 1차 배포 일정 확정", "kanban-col-section");
}

const steps = {
  board: async () => {
    const p = await page(show, 1600, 1100);
    await closeImportant(p);
    await settle(p);
    await shot(p, "board");
    webp("board", 1600);
    png("board", "board-signature.png");
    // 메모 보드 크게 보기 — 업무 연결 메모·이미지·관계선이 한눈에
    await p.getByRole("button", { name: "크게 보기" }).first().click();
    await settle(p, 900);
    const dock = (await p.getByTestId("note-dock").boundingBox());
    await p.screenshot({ path: join(RAW, "memo-board.png"), clip: { x: dock.x, y: dock.y + 40, width: Math.min(dock.width, 1240), height: 400 } });
    webp("memo-board", 1600);
    await p.close();
  },
  summary: async () => {
    const p = await page(show, 1600, 1000);
    await closeImportant(p);
    await p.getByTestId("summary-toggle").click();
    await settle(p, 900);
    await shot(p, "summary");
    webp("summary", 1600);
    png("summary", "summary-signature.png");
    await p.close();
  },
  insights: async () => {
    const p = await page(show, 1600, 1000);
    await closeImportant(p);
    await p.keyboard.press("Alt+3");
    await p.getByTestId("timeline-week").first().waitFor();
    await settle(p, 900);
    await shot(p, "insights");
    webp("insights", 1600);
    png("insights", "insights-signature.png");
    // 다시 보기: 이번 주 수요일 항목의 연결 메모 펼치기
    const week = p.locator('[data-testid="timeline-week"][class*="weekNow"]');
    await week.scrollIntoViewIfNeeded();
    await week.getByTestId("timeline-item").filter({ hasText: "설계안 팀 리뷰" }).getByTestId("memo-chip").click();
    await week.getByTestId("timeline-item").filter({ hasText: "설계안 팀 리뷰" }).hover();
    await p.waitForTimeout(500);
    await shot(p, "memo-revisit", week);
    webp("memo-revisit", 1800);
    await p.close();
  },
  kanban: async () => {
    const p = await page(show, 1600, 1000);
    await kanbanSetup(p);
    await settle(p, 8000); // 알림이 모두 사라진 뒤
    await shot(p, "kanban");
    webp("kanban", 1600);
    png("kanban", "kanban-signature.png");
    // 카드 추가 창(업무 띠·시작 시간·마감일)
    await p.locator("[data-testid='kanban-col-section'] [data-testid='kanban-add-card']").click();
    const dlg = p.getByTestId("kanban-item-dialog");
    await dlg.getByTestId("kanban-item-category").selectOption({ label: "차세대 정산 시스템 구축" });
    // 1.40: 여러 줄 = 카드 여러 장("카드 1·2" 꼬리표, [카드 2장 추가])
    const line = dlg.getByTestId("kanban-item-line").first();
    await line.fill("운영 이관 체크리스트 검토");
    await line.press("End");
    await line.press("Enter");
    await p.keyboard.type("이관 리허설 일정 협의");
    await dlg.getByRole("button", { name: "다음 주 금", exact: true }).click();
    await p.waitForTimeout(300);
    await shot(p, "kanban-add", dlg);
    webp("kanban-add", 1200);
    p.once("dialog", (d) => void d.accept()); // 적던 내용 버리기 확인
    await dlg.getByTestId("kanban-item-close").click();
    await dlg.waitFor({ state: "detached" });
    // 자유 배치
    await p.getByTestId("kanban-layout-free").click();
    const done = p.locator("[data-key] [data-testid='kanban-col-done'] [data-testid='kanban-col-head']");
    const b = await done.boundingBox();
    await p.mouse.move(b.x + 60, b.y + 10);
    await p.mouse.down();
    await p.mouse.move(b.x - 300, b.y + 360, { steps: 8 });
    await p.mouse.up();
    await settle(p, 900);
    await shot(p, "kanban-free");
    webp("kanban-free", 1600);
    await p.close();
  },
  universe: async () => {
    const p = await page(show, 1440, 1000);
    await p.keyboard.press("Alt+5");
    await p.waitForTimeout(2500);
    await settle(p, 600);
    await shot(p, "universe");
    webp("universe", 1440);
    await p.close();
  },
  cabi: async () => {
    const p = await page(show, 1440, 1000);
    await p.getByTestId("rail-cabinet").click();
    await p.getByLabel("업무를 선택해 주세요", { exact: true }).selectOption({ index: 1 });
    await settle(p, 800);
    await shot(p, "cabi-hub");
    webp("cabi-hub", 1440);
    const notePromise = p.waitForEvent("popup");
    await p.getByTestId("cabi-new-note").click();
    const note = await notePromise;
    await note.setViewportSize({ width: 1180, height: 820 });
    await note.getByTestId("cabi-note-editor").waitFor();
    await note.getByLabel("노트 제목", { exact: true }).fill("검토 방향과 결정 사항");
    await note
      .locator('[contenteditable="true"]')
      .fill("가상 샘플 업무의 검토 방향과 결정 사항을 기록합니다.\n업무 자료와 주간 메모를 연결해 맥락을 이어 갑니다.");
    await note.waitForTimeout(800);
    await note.screenshot({ path: join(RAW, "cabi-note.png") });
    webp("cabi-note", 1180);
    const boardPromise = p.waitForEvent("popup");
    await p.getByTestId("cabi-open-board").click();
    const board = await boardPromise;
    await board.setViewportSize({ width: 1180, height: 820 });
    await board.getByTestId("note-scroll").waitFor();
    await board.getByRole("button", { name: "주간 메모", exact: true }).click();
    const panel = board.getByTestId("cabi-weekly-panel");
    await panel.locator('input[type="checkbox"]').first().check();
    await panel.getByRole("button", { name: "1개 보드에 추가", exact: true }).click();
    await board.getByTestId("note-box").waitFor();
    await board.waitForTimeout(800);
    await board.screenshot({ path: join(RAW, "cabi-board.png") });
    webp("cabi-board", 1180);
    await board.close();
    await note.close();
    await p.close();
  },
};

for (const [name, run] of Object.entries(steps)) {
  if (only && only !== name) continue;
  await run();
  console.log(`✓ ${name}`);
}
await browser.close();

for (const [kind, name, arg] of out) {
  const src = join(RAW, `${name}.png`);
  if (kind === "webp") {
    execFileSync("python3", [join(ROOT, "scripts/site/webp.py"), src, join(ROOT, "site/shots", `${name}.webp`), String(arg)]);
    console.log(`  → site/shots/${name}.webp`);
  } else {
    execFileSync("cp", [src, join(ROOT, "docs/screenshots", arg)]);
    console.log(`  → docs/screenshots/${arg}`);
  }
}
