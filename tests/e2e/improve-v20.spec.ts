// 개선 v20(improve-v20-spec): 업무노트 삭제 잠금·삭제 확인 창·복제·끌기 손잡이 아이콘, 노트 표 손잡이·표시선·열 커서. 가상 샘플만.
import { test, expect, type Page } from "@playwright/test";

async function openHub(page: Page) {
  await page.goto("/?today=2026-10-22&sample=showcase");
  await page.getByTestId("week-title").waitFor();
  await page.keyboard.press("Alt+4");
  await page.getByLabel("업무를 선택해 주세요", { exact: true }).selectOption({ index: 1 });
}
async function newNote(page: Page, title: string) {
  const popup = page.waitForEvent("popup");
  await page.getByTestId("cabi-new-note").click();
  const child = await popup;
  await child.getByTestId("cabi-note-editor").waitFor();
  await child.getByLabel("노트 제목", { exact: true }).fill(title);
  await child.locator("[contenteditable=true]").first().fill("가상 절차 본문");
  await child.evaluate(async () => {
    const { flushCabiDocument } = await import("../../src/ui/cabinet/cabiService" + ".ts");
    await flushCabiDocument();
  });
  return child;
}
const row = (page: Page, title: string) =>
  page.getByTestId("cabi-note-row").filter({ has: page.getByText(title, { exact: true }) });

test("목록: 끌기 손잡이는 6점(복사 모양 아님), 복제하면 (사본)이 생기고 알림 [열기]", async ({ page }) => {
  await openHub(page);
  const child = await newNote(page, "가상 복제 원본");
  await child.close();
  const r = row(page, "가상 복제 원본");
  await expect(r).toHaveCount(1);
  // 끌기 손잡이 = 점 6개(circle), 복제 단추 = 겹친 사각형(rect)
  await expect(r.getByTestId("cabi-drag-grip").locator("circle")).toHaveCount(6);
  await expect(r.getByTestId("cabi-note-duplicate").locator("rect")).toHaveCount(1);
  await r.getByTestId("cabi-note-duplicate").click();
  await expect(page.getByTestId("cabi-note-notice")).toContainText("가상 복제 원본 (사본)");
  await expect(row(page, "가상 복제 원본 (사본)")).toHaveCount(1);
  await r.getByTestId("cabi-note-duplicate").click();
  await expect(row(page, "가상 복제 원본 (사본 2)")).toHaveCount(1);
});

test("삭제 잠금: 편집 화면에서 잠그면 메뉴 삭제·목록 삭제가 막히고, 풀면 확인 창(처음 초점 취소)으로 삭제", async ({
  page,
}) => {
  await openHub(page);
  const c = await newNote(page, "가상 잠금 노트");
  const lock = c.getByTestId("note-delete-lock");
  await expect(lock).toHaveAttribute("aria-pressed", "false");
  await lock.click();
  await expect(lock).toHaveAttribute("aria-pressed", "true");
  await expect(lock).toContainText("삭제 잠김");
  await c.getByRole("button", { name: /내보내기/ }).click();
  await expect(c.getByTestId("note-delete")).toBeDisabled();
  await expect(c.getByTestId("note-delete-locked-hint")).toBeVisible();
  // 목록: 🗑 대신 🔒
  const r = row(page, "가상 잠금 노트");
  await expect(r.getByTestId("cabi-note-locked")).toBeVisible();
  await expect(r.getByTestId("cabi-note-delete")).toHaveCount(0);
  // 잠긴 채 편집은 된다
  await c.locator("[contenteditable=true]").first().press("End");
  await c.keyboard.type(" 고침");
  // 풀고 삭제 → 확인 창
  await lock.click();
  await expect(lock).toHaveAttribute("aria-pressed", "false");
  await expect(c.getByTestId("note-delete")).toBeEnabled();
  await c.getByTestId("note-delete").click();
  const dlg = c.getByTestId("delete-note-dialog");
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText("가상 잠금 노트");
  await expect(dlg).toContainText("되돌릴 수 없습니다");
  await expect(c.getByTestId("delete-note-cancel")).toBeFocused();
  await c.keyboard.press("Enter"); // 초점 = 취소
  await expect(dlg).toHaveCount(0);
  await expect(r).toHaveCount(1);
  await c.close();
  // 목록에서 삭제 → 같은 확인 창
  await expect(r.getByTestId("cabi-note-delete")).toBeVisible();
  await r.getByTestId("cabi-note-delete").click();
  await expect(page.getByTestId("delete-note-dialog")).toBeVisible();
  await page.getByTestId("delete-note-confirm").click();
  await expect(r).toHaveCount(0);
});

async function tableNote(page: Page) {
  await openHub(page);
  const c = await newNote(page, "가상 표 노트");
  await c.getByTestId("cabi-import-input").setInputFiles({
    name: "table.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "앞 문단\n\n| A | B | C |\n|---|---|---|\n| a1 | b1 | c1 |\n| a2 | b2 | c2 |\n\n뒤 문단",
    ),
  });
  await c.getByRole("dialog").getByRole("button", { name: "현재 위치에 삽입", exact: true }).click();
  return c;
}

test("표: 행 이끌이는 왼쪽 테두리·열 이끌이는 위 테두리(표 손잡이와 겹치지 않음), 끄는 동안 원래 행 바탕+들어갈 선, Esc 취소", async ({
  page,
}) => {
  const c = await tableNote(page);
  const table = c.locator("[contenteditable=true] table");
  await table.locator("tr").nth(1).locator("td").first().click();
  const t = (await table.boundingBox())!;
  const rowGrip = c.getByTestId("table-row-grip");
  const colGrip = c.getByTestId("table-column-grip");
  const rg = (await rowGrip.boundingBox())!,
    cg = (await colGrip.boundingBox())!;
  // 행 이끌이는 표 왼쪽 테두리에 걸침, 열 이끌이는 위 테두리에 걸침
  expect(rg.x).toBeLessThan(t.x + 2);
  expect(rg.x + rg.width).toBeGreaterThan(t.x);
  expect(cg.y).toBeLessThan(t.y + 2);
  expect(cg.y + cg.height).toBeGreaterThan(t.y);
  // 표 손잡이(블록)와 겹치지 않는다
  await table.locator("th").first().hover();
  const block = c.getByTestId("cabi-block-grip");
  await expect(block).toHaveAttribute("data-block", "table");
  const bg = (await block.boundingBox())!;
  expect(bg.x + bg.width).toBeLessThanOrEqual(rg.x + 0.5);
  // 행 끌기: 표시선이 보이고, Esc면 그대로
  await table.locator("tr").nth(1).locator("td").first().click();
  const g = (await rowGrip.boundingBox())!;
  const dest = (await table.locator("tr").nth(2).locator("td").first().boundingBox())!;
  await c.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await c.mouse.down();
  await c.mouse.move(dest.x + 15, dest.y + dest.height - 4, { steps: 8 });
  await expect(c.getByTestId("table-drag-source")).toBeVisible();
  const line = c.getByTestId("table-drop-line");
  await expect(line).toBeVisible();
  const l = (await line.boundingBox())!;
  expect(Math.abs(l.y - (dest.y + dest.height))).toBeLessThan(4); // a2 아래 경계
  expect(l.width).toBeGreaterThan(t.width - 1);
  await c.keyboard.press("Escape");
  await expect(line).toHaveCount(0);
  await c.mouse.up();
  await expect(table.locator("tr").nth(1)).toContainText("a1");
  // 다시 끌어 놓으면 이동
  await table.locator("tr").nth(1).locator("td").first().click();
  const g2 = (await rowGrip.boundingBox())!;
  await c.mouse.move(g2.x + g2.width / 2, g2.y + g2.height / 2);
  await c.mouse.down();
  await c.mouse.move(dest.x + 15, dest.y + dest.height - 4, { steps: 8 });
  await c.mouse.up();
  await expect(table.locator("tr").nth(2)).toContainText("a1");
  await expect(c.getByTestId("table-drop-line")).toHaveCount(0);
});

test("표: 열 경계 위 커서는 col-resize(↔), 표 손잡이로 표 전체를 다른 줄로 옮긴다", async ({ page }) => {
  const c = await tableNote(page);
  const table = c.locator("[contenteditable=true] table");
  const first = (await table.locator("th").first().boundingBox())!;
  await c.mouse.move(first.x + first.width - 2, first.y + first.height / 2);
  await expect
    .poll(() =>
      c.evaluate(
        ([x, y]) => getComputedStyle(document.elementFromPoint(x!, y!)!).cursor,
        [first.x + first.width - 2, first.y + first.height / 2],
      ),
    )
    .toBe("col-resize");
  // 표 손잡이 끌기 → "앞 문단" 위로
  await table.locator("th").first().hover();
  const block = c.getByTestId("cabi-block-grip");
  await expect(block).toHaveAttribute("data-block", "table");
  await expect(c.locator("[contenteditable=true] > *").first()).toHaveJSProperty("tagName", "P");
  const target = c.locator("[contenteditable=true] > p").first();
  await block.dragTo(target, { targetPosition: { x: 20, y: 2 } });
  // 표는 tableWrapper 안에 그려진다 — 맨 위 블록이 표가 됨
  await expect(c.locator("[contenteditable=true] > *").first().locator("table")).toHaveCount(1);
  await expect(c.locator("[contenteditable=true] > *").first().locator("th").first()).toHaveText("A");
});

// ── 새 판 확인 403 대응(improve-v20-spec 6절) — 브라우저 모드 가짜 확인 ?update=rate·blocked·latest ──
import { openSettings } from "./settings-helper";
const updateCalls = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as { __wjb: { updateCalls(): string[] } }).__wjb.updateCalls());
async function openUpdate(page: Page, mode: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?today=2026-10-22&update=${mode}`);
  await expect(page.getByTestId("journal-status")).toContainText("SQLite");
  await expect.poll(() => updateCalls(page)).toEqual(["check"]);
  await openSettings(page, "update");
  return page.getByTestId("update-settings");
}

test("업데이트 확인 한도 초과: 꼬리표를 떼고 '약 N분 뒤(시각)' 안내, 그때까지 확인 단추 잠김, [릴리스 페이지 열기]", async ({
  page,
}) => {
  const sec = await openUpdate(page, "rate");
  await expect(sec.getByTestId("update-status")).toContainText("GitHub 확인 횟수 한도");
  await expect(sec.getByTestId("update-status")).not.toContainText("[update:");
  const help = sec.getByTestId("update-fail-help");
  await expect(help).toHaveAttribute("data-kind", "rate");
  await expect(help).toContainText(/약 1[78]분 뒤\(\d\d:\d\d\)/);
  await expect(sec.getByTestId("update-check")).toBeDisabled();
  await expect(sec.getByTestId("update-check")).toContainText(/\d\d:\d\d부터/);
  await expect(help.getByRole("button", { name: /릴리스 페이지 열기/ })).toBeVisible();
});

test("업데이트 확인 차단: 회사망 안내 + 직접 설치 안내 + [릴리스 페이지 열기], 확인 단추는 다시 누를 수 있음", async ({
  page,
}) => {
  const sec = await openUpdate(page, "blocked");
  await expect(sec.getByTestId("update-status")).toContainText("회사망·보안 장비");
  const help = sec.getByTestId("update-fail-help");
  await expect(help).toHaveAttribute("data-kind", "blocked");
  await expect(help).toContainText("직접 받아 설치");
  await expect(sec.getByTestId("update-check")).toBeEnabled();
});

test("대체 경로로 찾은 새 판(노트 없음): 창에 '변경 내용은 릴리스 페이지에서' + 크기 표시 생략", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?today=2026-10-22&update=latest");
  await expect(page.getByTestId("update-banner")).toContainText("9.9.9");
  await page.getByTestId("update-banner").getByRole("button", { name: "자세히·설치" }).click();
  await expect(page.getByTestId("update-notes-page")).toContainText("릴리스 페이지에서");
  await expect(page.getByRole("dialog")).not.toContainText("MB");
});
