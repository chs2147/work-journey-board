// 주간 메모 도크 E2E(weekly-note-spec N1): 상자 만들기·옮기기·폭·삭제/되돌리기·Alt+M·예전 요일 메모·주 이동 저장·도크.
// 브라우저 모드, 오늘 = 2026-10-22(목, 2026-W43), 가상 샘플(W43에 예전 요일 메모가 있음).
import { expect, test, type Locator, type Page } from "@playwright/test";

const saved = (page: Page) => expect(page.getByTestId("save-state")).toHaveText("저장됨 ✓");
const boxes = (page: Page) => page.getByTestId("note-box");
const geom = (box: Locator) =>
  box.evaluate((el) => {
    const s = (el as HTMLElement).style;
    return { x: parseFloat(s.left), y: parseFloat(s.top), w: parseFloat(s.width) };
  });

async function goWeek(page: Page, key: "Alt+ArrowRight" | "Alt+ArrowLeft", week: string) {
  await page.keyboard.press(key);
  await expect(page.getByTestId("week-title")).toContainText(week);
}

/** 빈 주(W44)로 가서 메모 판 빈 곳 (x, y)를 클릭해 새 상자를 만든다 */
async function newBoxInW44(page: Page, x = 100, y = 60) {
  await goWeek(page, "Alt+ArrowRight", "2026-W44");
  await expect(page.getByTestId("note-empty")).toBeVisible();
  const c = (await page.getByTestId("note-canvas").boundingBox())!;
  await page.mouse.click(c.x + x, c.y + y);
  await expect(boxes(page)).toHaveCount(1);
  await expect(page.locator(":focus")).toHaveClass(/note-prose/);
}

/**
 * 키를 누르고, 편집기(ProseMirror)가 바뀐 선택(있음/없음)을 읽을 때까지 기다린다.
 * 편집기는 selectionchange 이벤트로 선택을 읽는데, 부하가 걸린 헤드리스 브라우저에서는 이 이벤트가 다음 키보다 늦게 올 수 있다
 * (예: → 로 선택을 접은 직후 Enter가 먼저 처리되면 선택된 글이 지워진다). TipTap은 편집기 DOM에 `editor`를 달아 둔다.
 */
async function pressAndSync(page: Page, key: string, selected: boolean) {
  await page.keyboard.press(key);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const ed = (
          document.activeElement as { editor?: { state: { selection: { empty: boolean } } } } | null
        )?.editor;
        return ed ? !ed.state.selection.empty : null;
      }),
    )
    .toBe(selected);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?today=2026-10-22");
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
});

test("예전 요일 메모는 상자 1개로 보이고, 고치면 이 주 메모로 저장된다(안내가 사라짐)", async ({ page }) => {
  const dock = page.getByTestId("note-dock");
  await expect(dock).toContainText("예전 요일 메모를 옮겨 보여 주는 중");
  await expect(boxes(page)).toHaveCount(1);
  await expect(page.locator(".note-prose li")).toHaveText([
    "(목) 부서 월례 회의 참석",
    "(금) 하반기 교육 신청 마감 확인",
  ]);
  await page.locator(".note-prose li").last().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" — 신청 완료");
  await saved(page);
  await expect(dock).not.toContainText("예전 요일 메모를 옮겨 보여 주는 중");
  await goWeek(page, "Alt+ArrowRight", "2026-W44");
  await goWeek(page, "Alt+ArrowLeft", "2026-W43");
  await expect(page.locator(".note-prose li").last()).toHaveText(
    "(금) 하반기 교육 신청 마감 확인 — 신청 완료",
  );
  await expect(dock).not.toContainText("예전 요일 메모");
  // 주간 요약 자동 집계에 메모 글이 들어간다
  await page.keyboard.press("Alt+KeyS");
  await expect(page.getByTestId("summary-auto")).toContainText(
    "- (금) 하반기 교육 신청 마감 확인 — 신청 완료",
  );
});

test("빈 곳 클릭 → 그 자리(8px 칸)에 상자, 글을 쓰면 저장되고 다른 주에 다녀와도 그대로", async ({
  page,
}) => {
  await newBoxInW44(page, 203, 61);
  await page.keyboard.type("가상 확인 사항");
  expect(await geom(boxes(page).first())).toEqual({ x: 200, y: 64, w: 320 }); // 가까운 8px 칸
  await expect(page.getByTestId("note-counts")).toHaveText("상자 1개");
  await page.keyboard.press("Escape"); // 편집 끝 → 상자 선택
  await saved(page);
  await goWeek(page, "Alt+ArrowLeft", "2026-W43");
  await goWeek(page, "Alt+ArrowRight", "2026-W44");
  await expect(page.locator(".note-prose")).toHaveText("가상 확인 사항");
});

test("서식 단축키: 제목(Ctrl+Alt+1)·굵게·취소선(Ctrl+Shift+X)·글머리(Ctrl+Shift+8), 상자 안 실행 취소", async ({
  page,
}) => {
  await newBoxInW44(page);
  await page.keyboard.type("가상 제목");
  await page.keyboard.press("Control+Alt+Digit1");
  await page.keyboard.press("Enter");
  await page.keyboard.type("지난 안");
  await pressAndSync(page, "Shift+Home", true);
  await page.keyboard.press("Control+Shift+KeyX");
  await page.keyboard.press("Control+KeyB");
  await pressAndSync(page, "ArrowRight", false);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Control+Shift+Digit8");
  await page.keyboard.type("목록 한 줄");
  const prose = page.locator(".note-prose");
  await expect(prose.locator("h1")).toHaveText("가상 제목");
  await expect(prose.locator("s strong, strong s")).toHaveText("지난 안");
  await expect(prose.locator("ul li")).toHaveText("목록 한 줄");
  await page.keyboard.press("Control+KeyZ"); // 상자 안 글 실행 취소(편집기 기록)
  await expect(prose.locator("ul li")).toHaveText("");
  await page.keyboard.press("Escape");
  await saved(page);
  await page.keyboard.press("Alt+KeyS");
  await expect(page.getByTestId("summary-auto")).toContainText("[메모]\n가상 제목\n지난 안");
  await expect(page.getByTestId("summary-auto")).not.toContainText("목록 한 줄");
});

test("상자 ⋯ 메뉴: 첫 줄 글이 길어도 누를 수 있고, 배경색·복제가 된다", async ({ page }) => {
  await newBoxInW44(page);
  await page.keyboard.type("버튼 밑까지 닿는 아주 긴 가상 제목 한 줄입니다 아주 길게");
  await page.keyboard.press("Control+Alt+Digit2");
  await page.keyboard.press("Escape");
  const box = boxes(page).first();
  await box.getByRole("button", { name: "상자 메뉴" }).click(); // 편집기가 버튼을 가리면 여기서 실패
  await box.getByRole("menuitemradio", { name: "노랑" }).click();
  await expect(box).toHaveClass(/bg_yellow/);
  await box.getByRole("button", { name: "상자 메뉴" }).click();
  await box.getByRole("menuitem", { name: "복제" }).click();
  await expect(boxes(page)).toHaveCount(2);
  const [a, b] = [await geom(boxes(page).nth(0)), await geom(boxes(page).nth(1))];
  expect([b.x - a.x, b.y - a.y]).toEqual([24, 24]);
});

test("아무것도 안 쓴 새 상자는 편집을 끝내면 저절로 없어진다", async ({ page }) => {
  await newBoxInW44(page);
  await page.keyboard.press("Escape");
  await expect(boxes(page)).toHaveCount(0);
  await expect(page.getByTestId("note-empty")).toBeVisible();
});

test("위 막대로 옮기기 · 오른쪽 손잡이로 폭 조절(8px 칸, 최소 160) · 다시 읽어도 그대로", async ({
  page,
}) => {
  await newBoxInW44(page, 100, 60);
  await page.keyboard.type("옮길 상자");
  const box = boxes(page).first();
  const start = await geom(box);
  // 옮기기: 막대를 잡고 오른쪽 아래로
  const grip = box.getByRole("button", { name: "상자 위치 이동(끌기)" });
  const g = (await grip.boundingBox())!;
  await page.mouse.move(g.x + 40, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + 40 + 85, g.y + g.height / 2 + 43, { steps: 5 });
  await page.mouse.up();
  const moved = await geom(box);
  expect([moved.x - start.x, moved.y - start.y]).toEqual([88, 40]);
  // 폭: 오른쪽 손잡이를 왼쪽으로 많이 → 최소 160
  const handle = box.getByRole("button", { name: "폭 조절(끌기)" });
  const h = (await handle.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x - 400, h.y + h.height / 2, { steps: 5 });
  await page.mouse.up();
  expect((await geom(box)).w).toBe(160);
  await saved(page);
  await goWeek(page, "Alt+ArrowLeft", "2026-W43");
  await goWeek(page, "Alt+ArrowRight", "2026-W44");
  expect(await geom(boxes(page).first())).toEqual({ ...moved, w: 160 });
});

test("선택한 상자: 화살표로 8px 이동, Delete로 삭제 → [되돌리기], Ctrl+Z로 이동 취소", async ({ page }) => {
  await newBoxInW44(page, 100, 60);
  await page.keyboard.type("지울 상자");
  await page.keyboard.press("Escape");
  const box = boxes(page).first();
  await expect(box).toBeFocused();
  const start = await geom(box);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  expect(await geom(box)).toEqual({ ...start, x: start.x + 8, y: start.y + 32 });
  await page.keyboard.press("Control+KeyZ");
  expect(await geom(box)).toEqual({ ...start, x: start.x + 8 });
  await page.keyboard.press("Delete");
  await expect(boxes(page)).toHaveCount(0);
  await page.getByRole("button", { name: "되돌리기" }).click();
  await expect(boxes(page)).toHaveCount(1);
  await expect(page.locator(".note-prose")).toHaveText("지울 상자");
  // 선택 상태에서 Enter → 다시 편집(글 끝)
  await boxes(page)
    .first()
    .click({ position: { x: 4, y: 4 } });
  await expect(boxes(page).first()).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.type("!");
  await expect(page.locator(".note-prose")).toHaveText("지울 상자!");
});

test("Alt+M: 보드 ↔ 메모(마지막으로 쓴 상자의 글 끝), 메모가 접혀 있으면 펼친다", async ({ page }) => {
  await expect(page.locator(":focus")).toHaveValue("테스트 데이터 이관 스크립트 작성 착수");
  await page.getByRole("button", { name: "메모 접기" }).click();
  await expect(page.getByTestId("note-canvas")).toHaveCount(0);
  await page.keyboard.press("Alt+KeyT"); // 접기 버튼(메모 도크 안)에서 보드로 — 도크 안에서 Alt+M은 보드로 가는 쪽
  await expect(page.locator(":focus")).toHaveValue("테스트 데이터 이관 스크립트 작성 착수");
  await page.keyboard.press("Alt+KeyM");
  await expect(page.getByTestId("note-canvas")).toBeVisible();
  await expect(page.locator(":focus")).toHaveClass(/note-prose/);
  await page.keyboard.type(" 추가");
  await expect(page.locator(".note-prose li").last()).toHaveText("(금) 하반기 교육 신청 마감 확인 추가");
  await page.keyboard.press("Alt+KeyM");
  await expect(page.locator(":focus")).toHaveValue("테스트 데이터 이관 스크립트 작성 착수");
});

test("크게 보기는 보드를 숨기고, 경계선으로 높이 조절 · 접었다 펴도 높이 유지", async ({ page }) => {
  await page.getByRole("button", { name: "크게 보기" }).click();
  await expect(page.getByTestId("category-header").first()).toBeHidden();
  await page.getByRole("button", { name: "보드와 함께 보기" }).click();
  await expect(page.getByTestId("category-header").first()).toBeVisible();
  await page.getByRole("button", { name: "크게 보기" }).click();
  await page.keyboard.press("Escape"); // 크게 보기 버튼에 포커스 — Esc로 돌아온다
  await expect(page.getByTestId("category-header").first()).toBeVisible();
  // 경계선을 위로 끌어 높이 키우기
  const dock = page.getByTestId("note-dock");
  const h0 = (await dock.boundingBox())!.height;
  const split = (await page.getByRole("button", { name: "메모 높이 조절(끌기)" }).boundingBox())!;
  await page.mouse.move(split.x + split.width / 2, split.y + 4);
  await page.mouse.down();
  await page.mouse.move(split.x + split.width / 2, split.y - 96, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await dock.boundingBox())!.height - h0)).toBe(100);
  await page.getByRole("button", { name: "메모 접기" }).click();
  await expect(page.getByTestId("note-canvas")).toHaveCount(0);
  await page.getByRole("button", { name: "메모 펼치기" }).click();
  await expect.poll(async () => Math.round((await dock.boundingBox())!.height - h0)).toBe(100);
});
