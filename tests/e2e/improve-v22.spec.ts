// 개선 v22(improve-v22-spec): 앱과 호환되지 않는 일지 차단 · 칸반 다듬기 · 업무 타임라인 정돈. 가상 샘플만.
import { expect, test } from "@playwright/test";

const TODAY = "2026-10-22";

test.describe("앱과 호환되지 않는 일지(2절)", () => {
  test("시작할 때 새 DB 버전이면 열지 않고 '앱 업데이트가 필요합니다' · 최신 버전 확인 결과가 단추에", async ({
    page,
  }) => {
    await page.goto(`/?today=${TODAY}&newer=1&update=9.9.9`);
    const box = page.getByTestId("update-required");
    await expect(box).toBeVisible();
    await expect(box).toContainText("앱 업데이트가 필요합니다");
    await expect(box).toContainText("지금 설치된 앱 버전과 호환되지 않습니다");
    await expect(page.getByTestId("update-required-version")).toHaveText(
      /^DB v99 \(이 앱은 DB v\d+까지 지원\)$/,
    );
    await expect(page.getByTestId("week-title")).toHaveCount(0);
    await expect(page.getByTestId("update-required-update")).toHaveText("9.9.9 버전으로 업데이트");
  });

  test("호환되지 않는 워크스페이스로 바꾸려 하면 거부 — 지금 공간 그대로(전환 무결성)", async ({ page }) => {
    await page.goto(`/?today=${TODAY}&ws=2&newer=2`);
    await expect(page.getByTestId("week-title")).toContainText("2026-W43");
    const before = await page.evaluate(() =>
      (
        globalThis as unknown as { __wjbApp: { journalCounts(): Promise<Record<string, number>> } }
      ).__wjbApp.journalCounts(),
    );
    await page.keyboard.press("Control+Alt+Digit2");
    await expect(page.getByRole("status").filter({ hasText: "호환되지 않아 열지 않았습니다" })).toBeVisible();
    await expect(page).toHaveTitle("Work Journey Board — 회사");
    await expect(page.getByTestId("week-title")).toContainText("2026-W43");
    const after = await page.evaluate(() =>
      (
        globalThis as unknown as { __wjbApp: { journalCounts(): Promise<Record<string, number>> } }
      ).__wjbApp.journalCounts(),
    );
    expect(after).toEqual(before);
  });

  test("열려 있는 동안 다른 PC의 최신 앱이 올린 경우 — 창이 다시 활성화되면 쓰기를 멈추고 같은 화면", async ({
    page,
  }) => {
    await page.goto(`/?today=${TODAY}`);
    await expect(page.getByTestId("week-title")).toContainText("2026-W43");
    await page.evaluate(() =>
      (globalThis as unknown as { __wjbApp: { bumpSchema(): Promise<void> } }).__wjbApp.bumpSchema(),
    );
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByTestId("update-required")).toBeVisible();
    await expect(page.getByTestId("week-title")).toHaveCount(0);
  });
});

// ── V2: 칸반 상단 한 줄·업무 거르기·카드 추가 창·섹션 머리 끌기(improve-v22-spec 3·5·6절) ──
async function openKanban(page: import("@playwright/test").Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?today=2026-10-22&sample=showcase`);
  await page.getByTestId("week-title").waitFor();
  await page.getByTestId("rail-kanban").click();
  await expect(page.getByTestId("kanban-view")).toBeVisible();
}

test.describe("칸반 V2", () => {
  test("업무 거르기: 전체 → 하나만([이것만]) → 여러 개 체크 → 전체", async ({ page }) => {
    await openKanban(page);
    const btn = page.getByTestId("kanban-cat-filter");
    await expect(btn).toContainText("업무: 전체");
    const all = await page.getByTestId("kanban-card").count();
    await btn.click();
    const rows = page.getByTestId("kanban-cat-row");
    await rows.first().hover();
    await page.getByTestId("kanban-cat-only").first().click();
    const one = await page.getByTestId("kanban-card").count();
    expect(one).toBeLessThan(all);
    await expect(btn).not.toContainText("업무: 전체");
    await rows.nth(1).click();
    await expect(btn).toContainText("2개 선택");
    expect(await page.getByTestId("kanban-card").count()).toBeGreaterThanOrEqual(one);
    await page.getByTestId("kanban-cat-all").click();
    await expect(btn).toContainText("업무: 전체");
    expect(await page.getByTestId("kanban-card").count()).toBe(all);
  });

  test("카드 추가 창: 섹션 이름 제목·업무 띠·시작 시간/마감일 따로 행·[닫기]·하단 안내 글 없음", async ({
    page,
  }) => {
    await openKanban(page);
    await page.locator("[data-testid='kanban-col-todo'] [data-testid='kanban-add-card']").click();
    const dlg = page.getByTestId("kanban-item-dialog");
    await expect(dlg.getByRole("heading")).toHaveText("카드 추가 — TODO");
    await expect(dlg.getByTestId("kanban-item-category")).toBeVisible();
    await expect(dlg.getByTestId("kanban-item-close")).toHaveText("닫기");
    await expect(dlg).not.toContainText("Ctrl+Enter");
    await dlg.getByTestId("kanban-item-line").first().fill("가상 v22 카드");
    await dlg.getByRole("button", { name: "이번 주 금", exact: true }).click();
    await expect(dlg.getByTestId("kanban-item-due")).toContainText("D-");
    await dlg.getByTestId("kanban-item-start").click();
    await page.keyboard.press("Enter");
    await expect(dlg.getByTestId("kanban-item-start")).toContainText("⏰ ");
    await dlg.getByTestId("kanban-item-save").click();
    const c = page.getByTestId("kanban-card").filter({ hasText: "가상 v22 카드" });
    await expect(c).toHaveCount(1);
    await expect(c).toContainText("D-");
    await expect(page.getByTestId("important-panel")).toContainText("가상 v22 카드");
  });

  test("섹션 머리: Alt+Shift+→/←로 순서 바꾸기 · 되돌리기 · TODO/DONE 고정", async ({ page }) => {
    await openKanban(page);
    for (const n of ["가상 A", "가상 B"]) {
      await page.getByTestId("kanban-add-section").click();
      await page.getByTestId("kanban-section-dialog").getByRole("textbox").fill(n);
      await page.getByTestId("kanban-section-save").click();
      await expect(page.getByTestId("kanban-section-dialog")).toHaveCount(0);
    }
    const names = () => page.getByTestId("kanban-col-name").allTextContents();
    expect(await names()).toEqual(["TODO", "가상 A", "가상 B", "DONE"]);
    const headA = page.getByTestId("kanban-col-section").first().getByTestId("kanban-col-head");
    await headA.focus();
    await page.keyboard.press("Alt+Shift+ArrowRight");
    await expect.poll(names).toEqual(["TODO", "가상 B", "가상 A", "DONE"]);
    await page.getByRole("button", { name: "되돌리기" }).last().click();
    await expect.poll(names).toEqual(["TODO", "가상 A", "가상 B", "DONE"]);
    // TODO 머리는 끌 수 없음
    await expect(page.getByTestId("kanban-col-todo").getByTestId("kanban-col-head")).not.toHaveAttribute(
      "draggable",
      "true",
    );
    // 끌어 놓기: B 머리를 TODO에 놓으면 맨 앞(사용자 섹션 중)
    await page
      .getByTestId("kanban-col-section")
      .nth(1)
      .getByTestId("kanban-col-head")
      .dragTo(page.getByTestId("kanban-col-todo"));
    await expect.poll(names).toEqual(["TODO", "가상 B", "가상 A", "DONE"]);
  });
});

// ── V3: 배치 모드·완료 축하 모션(improve-v22-spec 4·7절) ──
test.describe("칸반 V3", () => {
  test("자유 배치: 상자 옮기기·크기·읽는 순서로 섹션 순서 · 다시 열어도 그대로 · 좁은 창은 균등 · 초기화", async ({
    page,
  }) => {
    await openKanban(page);
    for (const n of ["가상 A", "가상 B"]) {
      await page.getByTestId("kanban-add-section").click();
      await page.getByTestId("kanban-section-dialog").getByRole("textbox").fill(n);
      await page.getByTestId("kanban-section-save").click();
      await expect(page.getByTestId("kanban-section-dialog")).toHaveCount(0);
    }
    const board = page.getByTestId("kanban-board");
    await expect(board).toHaveAttribute("data-layout", "equal");
    await page.getByTestId("kanban-layout-free").click();
    await expect(board).toHaveAttribute("data-layout", "free");
    await expect(page.getByTestId("kanban-layout-reset")).toBeVisible();
    const names = () => page.getByTestId("kanban-col-name").allTextContents();
    // B 상자를 같은 줄 A 앞으로 → 섹션 순서 = 왼쪽 위부터 읽는 순서
    const item = (n: string) =>
      page
        .getByTestId("kanban-free-item")
        .filter({ has: page.getByTestId("kanban-col-name").getByText(n, { exact: true }) });
    const a = (await item("가상 A").boundingBox())!;
    const bHead = item("가상 B").getByTestId("kanban-col-head");
    const bb = (await bHead.boundingBox())!;
    await page.mouse.move(bb.x + 30, bb.y + 10);
    await page.mouse.down();
    await page.mouse.move(a.x + 10, bb.y + 10, { steps: 6 });
    await page.mouse.up();
    await expect.poll(names).toEqual(["TODO", "가상 B", "가상 A", "DONE"]);
    // 크기: 오른쪽 아래 모서리 끌기 → 8px 격자
    const before = (await item("가상 A").boundingBox())!;
    const h = (await item("가상 A").getByTestId("kanban-free-resize").boundingBox())!;
    await page.mouse.move(h.x + 5, h.y + 5);
    await page.mouse.down();
    await page.mouse.move(h.x + 45, h.y - 95, { steps: 5 });
    await page.mouse.up();
    const after = (await item("가상 A").boundingBox())!;
    expect(Math.round(after.width - before.width)).toBe(40);
    expect(after.width % 8).toBe(0);
    // 다시 열어도 그대로(일지 설정)
    await page.getByTestId("rail-board").click();
    await page.getByTestId("rail-kanban").click();
    await expect(board).toHaveAttribute("data-layout", "free");
    expect(Math.round((await item("가상 A").boundingBox())!.width)).toBe(Math.round(after.width));
    // 좁은 창: 균등으로 보임(저장값 유지)
    await page.setViewportSize({ width: 860, height: 800 });
    await expect(board).toHaveAttribute("data-layout", "equal");
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(board).toHaveAttribute("data-layout", "free");
    // 초기화 → 균등 모습 자리
    await page.getByTestId("kanban-layout-reset").click();
    const ys = await page
      .getByTestId("kanban-free-item")
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(ys).size).toBe(1);
    await page.getByTestId("kanban-layout-equal").click();
    await expect(board).toHaveAttribute("data-layout", "equal");
  });

  test("완료 축하: DONE에 놓으면 체크·색종이(자유 배치에서도) · 설정에서 끄면 없음", async ({ page }) => {
    await openKanban(page);
    await page.getByTestId("kanban-layout-free").click();
    const card = page.getByTestId("kanban-card").first();
    await card.dragTo(page.getByTestId("kanban-col-done").getByTestId("kanban-col-head"));
    await expect(page.getByTestId("kanban-celebrate")).toBeVisible();
    await expect(page.getByTestId("kanban-col-done").getByTestId("kanban-col-count")).toContainText("1");
    await expect(page.getByTestId("kanban-celebrate")).toHaveCount(0, { timeout: 3000 });
    // 설정 › 화면 › 완료 축하 모션 끄기
    await page.keyboard.press("Control+Comma");
    await page.getByTestId("celebrate-toggle").uncheck();
    await page.getByTestId("settings-back").click();
    await page.getByTestId("rail-kanban").click();
    await page
      .getByTestId("kanban-card")
      .first()
      .dragTo(page.getByTestId("kanban-col-done").getByTestId("kanban-col-head"));
    await expect(page.getByTestId("kanban-col-done").getByTestId("kanban-col-count")).toContainText("2");
    await expect(page.getByTestId("kanban-celebrate")).toHaveCount(0);
  });
});
