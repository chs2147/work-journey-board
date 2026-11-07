import { test, expect, type Page } from "@playwright/test";
async function setup(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/?today=2026-11-07&sample=showcase");
  await expect(page.getByTestId("week-title")).toContainText("2026-W45");
  await page.keyboard.press("Alt+4");
  await page.getByLabel("업무를 선택해 주세요", { exact: true }).selectOption({ index: 1 });
  const categoryId = await page.getByLabel("업무를 선택해 주세요", { exact: true }).inputValue();
  await page.evaluate(async (categoryId) => {
    const { useAppStore } = (await import(
      "../../src/ui/common/appStore" + ".ts"
    )) as typeof import("../../src/ui/common/appStore");
    const { reload } = (await import(
      "../../src/ui/board/boardStore" + ".ts"
    )) as typeof import("../../src/ui/board/boardStore");
    const j = useAppStore.getState().journal;
    if (j.state !== "ready") throw Error("not ready");
    await j.repo.saveCell("2026-11-06", categoryId, [
      { id: "v17-review", depth: 0, text: "가상 검토 마일스톤", flagged: true, dueDate: "2026-11-08" },
      { id: "v17-start", depth: 0, text: "가상 착수 기록" },
    ]);
    await reload();
  }, categoryId);
  return categoryId;
}
async function board(page: Page) {
  const p = page.waitForEvent("popup");
  await page.getByTestId("cabi-open-board").click();
  const c = await p;
  await c.getByTestId("note-scroll").waitFor();
  return c;
}
async function add(c: Page, name: string) {
  await c.getByRole("button", { name: "Live Widget", exact: true }).click();
  await c.getByRole("button", { name, exact: true }).click();
}
test("위젯 세 종류·타임라인 표현·마일스톤 저장·원본 완료/취소 연동", async ({ page }) => {
  const id = await setup(page),
    c = await board(page);
  await add(c, "업무 경과일");
  await expect(c.getByTestId("live-widget")).toContainText("경과");
  await add(c, "업무 타임라인");
  const timeline = c.locator("[data-widget=timeline]");
  await expect(timeline).toContainText("가상 검토 마일스톤");
  await timeline.getByLabel("위젯 설정", { exact: true }).click();
  await timeline.getByLabel("업무 타임라인", { exact: true }).selectOption("milestones");
  await timeline.getByRole("button", { name: "마일스톤 관리", exact: true }).click();
  const dialog = timeline.getByRole("dialog");
  await dialog.getByRole("checkbox").first().check();
  await dialog.getByRole("button", { name: "적용", exact: true }).click();
  await expect(timeline).toContainText("간격은 균등 배치");
  await timeline.getByLabel("업무 타임라인", { exact: true }).selectOption("weeks");
  await expect(timeline).toContainText("2026-W45");
  await add(c, "중요 업무");
  const important = c.locator("[data-widget=important]");
  await expect(important).toContainText("가상 검토 마일스톤");
  await important.getByRole("button", { name: "완료 처리: 가상 검토 마일스톤", exact: true }).click();
  await expect(
    important.getByRole("button", { name: "완료 처리: 가상 검토 마일스톤", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(async () => {
      const { useAppStore } = (await import(
        "../../src/ui/common/appStore" + ".ts"
      )) as typeof import("../../src/ui/common/appStore");
      const j = useAppStore.getState().journal;
      if (j.state !== "ready") throw Error();
      return (await j.repo.getItemsByIds(["v17-review"]))[0]?.flagDoneAt;
    }),
  ).toBeTruthy();
  await page.evaluate(async (id) => {
    const { cabiCall } = (await import(
      "../../src/ui/cabinet/cabiService" + ".ts"
    )) as typeof import("../../src/ui/cabinet/cabiService");
    const { useAppStore } = (await import(
      "../../src/ui/common/appStore" + ".ts"
    )) as typeof import("../../src/ui/common/appStore");
    const j = useAppStore.getState().journal;
    if (j.state !== "ready") throw Error();
    const e = (await j.repo.getItemsByIds(["v17-review"]))[0]!;
    await cabiCall("widgetUndo", id, e.id, e.flagDoneAt);
  }, id);
  await expect(important).toContainText("가상 검토 마일스톤");
  const state = await c.evaluate(async () => {
    const { flushCabiDocument } = (await import(
      "../../src/ui/cabinet/cabiService" + ".ts"
    )) as typeof import("../../src/ui/cabinet/cabiService");
    const { useNote } = (await import(
      "../../src/ui/note/noteStore" + ".ts"
    )) as typeof import("../../src/ui/note/noteStore");
    await flushCabiDocument();
    const s = useNote.getState();
    return { categoryId: s.task!.categoryId, doc: s.doc };
  });
  expect(state.doc.boxes.filter((b) => b.kind === "text" && b.widget)).toHaveLength(3);
  const snapshots = await c.evaluate(async ({ doc, categoryId }) => {
    const { materializeWidgets, rasterizeWidgets } = (await import(
      "../../src/ui/cabinet/liveWidgetModel" + ".ts"
    )) as typeof import("../../src/ui/cabinet/liveWidgetModel");
    const plain = await materializeWidgets(doc, categoryId);
    const raster = await rasterizeWidgets(doc, categoryId);
    return { plain, rasterCount: Object.keys(raster.images).length };
  }, state);
  expect(snapshots.plain.boxes.every((b) => b.kind !== "text" || !b.widget)).toBe(true);
  expect(snapshots.rasterCount).toBe(3);
  await c.reload();
  await expect(c.getByTestId("live-widget")).toHaveCount(3);
  await expect(c.locator("[data-widget=timeline]").getByRole("button", { name: /2026-W45/ })).toBeVisible();
  await c.screenshot({ path: test.info().outputPath("v17-live-widgets.png"), fullPage: false });
  const packet = await c.evaluate(async () => {
    const { registerCabiDrag, flushCabiDocument } = (await import(
      "../../src/ui/cabinet/cabiService" + ".ts"
    )) as typeof import("../../src/ui/cabinet/cabiService");
    const { useNote } = (await import(
      "../../src/ui/note/noteStore" + ".ts"
    )) as typeof import("../../src/ui/note/noteStore");
    await flushCabiDocument();
    const s = useNote.getState(),
      token = crypto.randomUUID();
    await registerCabiDrag(
      token,
      { kind: "task", categoryId: s.task!.categoryId },
      s.doc,
      s.doc.boxes.map((b) => b.id),
    );
    return token;
  });
  const copied = await page.evaluate(async (token) => {
    const { receiveCabiDrag } = (await import(
      "../../src/ui/cabinet/cabiService" + ".ts"
    )) as typeof import("../../src/ui/cabinet/cabiService");
    const { useNote, importBoardObjects, flushNote } = (await import(
      "../../src/ui/note/noteStore" + ".ts"
    )) as typeof import("../../src/ui/note/noteStore");
    const doc = await receiveCabiDrag(
      token,
      { kind: "week", weekId: useNote.getState().weekId },
      { x: 24, y: 24 },
    );
    importBoardObjects(doc);
    await flushNote(true, true);
    return doc;
  }, packet);
  expect(copied.boxes).toHaveLength(3);
  expect(copied.boxes.every((b) => b.kind === "text" && !b.widget)).toBe(true);
});
test("노트 블록 메뉴·실제 드래그·선택 글자색·열린 노트 삭제", async ({ page }) => {
  await setup(page);
  const p = page.waitForEvent("popup");
  await page.getByTestId("cabi-new-note").click();
  const c = await p;
  const editor = c.locator("[contenteditable=true]");
  await editor.waitFor();
  await c.getByLabel("노트 제목", { exact: true }).fill("가상 v17 편집 검증");
  await editor.fill("첫 번째 기록\n두 번째 기록\n세 번째 기록");
  // Enter paragraphs explicitly: contenteditable fill may use line breaks.
  await editor.fill("첫 번째 기록");
  await editor.press("Enter");
  await editor.pressSequentially("두 번째 기록");
  await editor.press("Enter");
  await editor.pressSequentially("세 번째 기록");
  const paras = editor.locator("p");
  await paras.first().hover();
  const grip = c.getByLabel("블록 메뉴 · 드래그로 이동", { exact: true });
  await expect(grip).toBeVisible();
  await grip.click();
  await c.getByRole("menuitem", { name: "블록 아래로 이동", exact: true }).click();
  await expect(paras.first()).toHaveText("두 번째 기록");
  await paras.last().hover();
  await grip.dragTo(paras.first(), { targetPosition: { x: 40, y: 2 } });
  await expect(paras.first()).toHaveText("세 번째 기록");
  await paras.first().click();
  await c.keyboard.press("Home");
  await c.keyboard.press("Shift+End");
  await c.getByRole("button", { name: "글자색", exact: true }).click();
  await c.getByRole("button", { name: "빨강", exact: true }).click();
  await expect(editor.locator(".note-c-red")).toHaveText("세 번째 기록");
  await c.getByRole("button", { name: "링크 지정", exact: true }).click();
  await c.getByLabel("링크 주소", { exact: true }).fill("https://example.com");
  await c.getByRole("button", { name: "적용", exact: true }).click();
  await expect(editor.locator("a")).toHaveAttribute("href", "https://example.com");
  await c.screenshot({ path: test.info().outputPath("v17-note-editor.png") });
  // Deletion must flush the currently open child (including unsaved text) before closing it.
  const close = c.waitForEvent("close");
  await page.evaluate(async (id) => {
    const { cabiClient } = (await import(
      "../../src/ui/cabinet/cabiService" + ".ts"
    )) as typeof import("../../src/ui/cabinet/cabiService");
    const n = await cabiClient().note(id);
    await cabiClient().removeNote(n.id, n.revision);
  }, new URL(c.url()).searchParams.get("id")!);
  await close;
  await expect(page.getByTestId("cabi-note-row").filter({ hasText: "가상 v17 편집 검증" })).toHaveCount(0);
});
test("보드 삭제는 확인 문구 입력이 필요하고 원본 업무는 유지된다", async ({ page }) => {
  await setup(page);
  const c = await board(page);
  await add(c, "업무 경과일");
  await c.getByRole("button", { name: "업무 보드 삭제", exact: true }).click();
  const dialog = c.getByRole("dialog", { name: "업무 메모보드 삭제", exact: true });
  await expect(dialog).toBeVisible();
  const remove = dialog.getByRole("button", { name: "업무 보드 삭제", exact: true });
  await expect(remove).toBeDisabled();
  await dialog.getByRole("textbox").fill("삭제");
  await expect(remove).toBeEnabled();
  const closed = c.waitForEvent("close");
  await remove.click();
  await closed;
  await page.bringToFront();
  await expect(
    page.getByRole("button", { name: "처리 완료: 가상 검토 마일스톤", exact: true }),
  ).toBeVisible();
  const counts = await page.evaluate(async () => {
    const app = globalThis as unknown as { __wjbApp: { journalCounts(): Promise<Record<string, number>> } };
    return app.__wjbApp.journalCounts();
  });
  expect(counts.cabi_board).toBe(0);
  expect(counts.entry_item).toBeGreaterThan(0);
});
test("자료 카드의 네 연결점과 화살표·주간 목록 아이콘 정렬", async ({ page }) => {
  await setup(page);
  const c = await board(page);
  await c.getByRole("button", { name: "주간 메모", exact: true }).click();
  const panel = c.getByTestId("cabi-weekly-panel");
  const row = panel.locator("article").first();
  await row.getByRole("checkbox").check();
  const icon = row.getByRole("button", { name: "원본 열기", exact: true });
  const box = await row.getByRole("checkbox").boundingBox(),
    source = await icon.boundingBox();
  expect(Math.abs(box!.x + box!.width / 2 - (source!.x + source!.width / 2))).toBeLessThan(2);
  await panel.getByRole("button", { name: "1개 보드에 추가", exact: true }).click();
  await panel.getByRole("button", { name: "닫기", exact: true }).click();
  await add(c, "업무 경과일");
  const card = c.locator("[data-cabi-card]");
  await card.hover();
  const knobs = card.getByTestId("edge-knob");
  await expect(knobs).toHaveCount(4);
  for (const k of await knobs.all()) await expect(k).toHaveCSS("opacity", "1");
  const a = await card.locator("[data-side=bottom]").boundingBox(),
    b = await c.getByTestId("live-widget").boundingBox();
  await c.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2);
  await c.mouse.down();
  await c.mouse.move(b!.x + b!.width / 2, b!.y + 30, { steps: 12 });
  await c.mouse.up();
  await expect
    .poll(() =>
      c.evaluate(async () => {
        const { useNote } = (await import(
          "../../src/ui/note/noteStore" + ".ts"
        )) as typeof import("../../src/ui/note/noteStore");
        return useNote.getState().doc.edges?.length ?? 0;
      }),
    )
    .toBe(1);
});
test("노트 저장 실패 시 삭제를 중단하고 창을 다시 편집할 수 있다", async ({ page }) => {
  await setup(page);
  const p = page.waitForEvent("popup");
  await page.getByTestId("cabi-new-note").click();
  const c = await p;
  await c.getByTestId("cabi-note-editor").waitFor();
  const id = new URL(c.url()).searchParams.get("id")!;
  await page.evaluate(async () => {
    const { useAppStore } = (await import(
      "../../src/ui/common/appStore" + ".ts"
    )) as typeof import("../../src/ui/common/appStore");
    const j = useAppStore.getState().journal;
    if (j.state !== "ready") throw Error();
    const original = j.repo.cabi.saveNote.bind(j.repo.cabi);
    (globalThis as unknown as { __restoreNote: () => void }).__restoreNote = () => {
      j.repo.cabi.saveNote = original;
    };
    j.repo.cabi.saveNote = async () => {
      throw Error("가상 저장 실패");
    };
  });
  await c.locator("[contenteditable=true]").fill("실패해도 보존할 가상 본문");
  const failure = await page.evaluate(async (id) => {
    const { cabiClient } = (await import(
      "../../src/ui/cabinet/cabiService" + ".ts"
    )) as typeof import("../../src/ui/cabinet/cabiService");
    try {
      const n = await cabiClient().note(id);
      await cabiClient().removeNote(n.id, n.revision);
      return "unexpected";
    } catch (e) {
      return String(e);
    }
  }, id);
  expect(failure).toContain("가상 저장 실패");
  expect(c.isClosed()).toBe(false);
  await expect(c.locator("[contenteditable=true]")).toBeEditable();
  await page.evaluate(() => (globalThis as unknown as { __restoreNote: () => void }).__restoreNote());
  await c.getByTestId("save-failed").click();
  await expect(c.getByTestId("save-state")).toBeVisible();
  await c.reload();
  await expect(c.locator("[contenteditable=true]")).toContainText("실패해도 보존할 가상 본문");
});
