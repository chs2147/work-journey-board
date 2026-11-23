import { test, expect, type Page } from "@playwright/test";

async function hub(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/?today=2026-10-22&sample=showcase");
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
  await page.keyboard.press("Alt+4");
  await expect(page.getByTestId("cabi-hub")).toBeVisible();
  await page.getByLabel("업무를 선택해 주세요", { exact: true }).selectOption({ index: 1 });
}
async function openNote(page: Page) {
  const popup = page.waitForEvent("popup");
  await page.getByTestId("cabi-new-note").click();
  const child = await popup;
  await expect(child.getByTestId("cabi-note-editor")).toBeVisible();
  return child;
}
async function openBoard(page: Page) {
  const popup = page.waitForEvent("popup");
  await page.getByTestId("cabi-open-board").click();
  const child = await popup;
  await expect(child.getByTestId("note-scroll")).toBeVisible();
  return child;
}

test("노트 간 이미지 블록 붙여넣기는 독립 자산으로 저장되어 원본 삭제 후에도 유지된다", async ({ page }) => {
  await hub(page);
  const source = await openNote(page);
  await source.getByLabel("노트 제목", { exact: true }).fill("이미지 원본 노트");
  const png = await source.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 20;
    canvas.getContext("2d")!.fillRect(0, 0, 20, 20);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  await source
    .locator('input[type="file"]')
    .last()
    .setInputFiles({
      name: "가상 그림.png",
      mimeType: "image/png",
      buffer: Buffer.from(png, "base64"),
    });
  await expect(source.locator('[contenteditable="true"] img')).toHaveCount(1);
  const original = await source.evaluate(async () => {
    const { cabiClient, flushCabiDocument } = (await import(
      "../../src/ui/cabinet/cabiService" + ".ts"
    )) as typeof import("../../src/ui/cabinet/cabiService");
    await flushCabiDocument();
    const note = (await cabiClient().listNotes()).find((n) => n.title === "이미지 원본 노트")!;
    const doc = await cabiClient().note(note.id);
    return { ...note, asset: String(doc.content.content?.find((n) => n.type === "image")?.attrs?.asset) };
  });
  const target = await openNote(page);
  await target.getByLabel("노트 제목", { exact: true }).fill("이미지 사본 노트");
  await target.locator('[contenteditable="true"]').evaluate((element, asset) => {
    const data = new DataTransfer();
    data.setData("text/html", `<figure data-cabi-asset="${asset}" alt="가상 그림"></figure>`);
    element.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, original.asset);
  await expect(target.locator('[contenteditable="true"] img')).toHaveCount(1);
  const copiedAsset = await target.evaluate(async () => {
    const { cabiClient, flushCabiDocument } = (await import(
      "../../src/ui/cabinet/cabiService" + ".ts"
    )) as typeof import("../../src/ui/cabinet/cabiService");
    await flushCabiDocument();
    const note = (await cabiClient().listNotes()).find((n) => n.title === "이미지 사본 노트")!;
    return String(
      (await cabiClient().note(note.id)).content.content?.find((n) => n.type === "image")?.attrs?.asset,
    );
  });
  expect(copiedAsset).not.toBe(original.asset);
  await source.close();
  await page.evaluate(async (n) => {
    const { cabiClient } = (await import(
      "../../src/ui/cabinet/cabiService" + ".ts"
    )) as typeof import("../../src/ui/cabinet/cabiService");
    await cabiClient().removeNote(n.id, n.revision);
  }, original);
  await target.reload();
  await expect(target.locator('[contenteditable="true"] img')).toHaveCount(1);
  await expect
    .poll(() =>
      target
        .locator('[contenteditable="true"] img')
        .evaluate((img) => (img as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(target.getByRole("alert")).toHaveCount(0);
});

test("업무 노트는 모달리스 창에서 저장되고 Markdown 구조·링크를 유지한다", async ({ page }) => {
  await hub(page);
  const note = await openNote(page);
  await note.getByLabel("노트 제목", { exact: true }).fill("가상 Cabi.NET 노트");
  await note.locator('[contenteditable="true"]').fill("가상 본문 기록");
  await expect(page.getByTestId("cabi-note-row")).toContainText("가상 Cabi.NET 노트");
  await note.getByTestId("cabi-import-input").setInputFiles({
    name: "가상 문서.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "# 검토 제목\n\n- [x] 검증 항목\n\n[예시 링크](https://example.com)\n\n| 이름 | 값 |\n| --- | --- |\n| 가상 | 1 |\n\n![제외](data:image/png;base64,AAA)",
    ),
  });
  const dialog = note.getByRole("dialog", { name: "Markdown 가져오기 미리보기" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "현재 위치에 삽입", exact: true }).click();
  await expect(note.locator('[contenteditable="true"] h1')).toContainText("검토 제목");
  await expect(note.locator('[contenteditable="true"] a')).toHaveAttribute("href", "https://example.com");
  await expect(note.locator('[contenteditable="true"] table')).toHaveCount(1);
  await expect(note.getByRole("alert")).toHaveCount(0);
  // Main remains usable while the note is open; no modal overlay.
  await page.getByRole("button", { name: "카드 보기", exact: true }).click();
  await expect(page.getByTestId("cabi-note-row")).toBeVisible();
  await note.evaluate(async () => {
    const { flushCabiDocument } = (await import(
      "../../src/ui/cabinet/cabiService" + ".ts"
    )) as typeof import("../../src/ui/cabinet/cabiService");
    await flushCabiDocument();
  });
  await note.close();
  const reopened = page.waitForEvent("popup");
  await page.getByTestId("cabi-note-row").getByRole("button").first().dblclick();
  const again = await reopened;
  await expect(again.locator('[contenteditable="true"] table')).toHaveCount(1);
});

test("업무당 보드 하나·누적 메모 원본 연결·주간 메모 사본 생성", async ({ page, context }) => {
  await hub(page);
  const board = await openBoard(page);
  const count = context.pages().length;
  await page.getByTestId("cabi-open-board").click();
  await expect.poll(() => context.pages().length).toBe(count);
  await board.getByRole("button", { name: "주간 메모", exact: true }).click();
  const panel = board.getByTestId("cabi-weekly-panel");
  await expect(panel.locator('input[type="checkbox"]').first()).toBeVisible();
  await panel.locator('input[type="checkbox"]').first().check();
  await panel.getByRole("button", { name: "1개 보드에 추가", exact: true }).click();
  await expect(board.getByTestId("note-box")).toHaveCount(1);
  await expect(board.getByTestId("note-box").first()).not.toContainText("불러오는 중");
  await panel.locator('input[type="checkbox"]').nth(1).check();
  await panel.getByRole("combobox").last().selectOption("copy");
  await panel.getByRole("button", { name: "1개 보드에 추가", exact: true }).click();
  await expect(board.getByTestId("note-box")).toHaveCount(2);
  await expect(board.getByRole("alert")).toHaveCount(0);
  await board.evaluate(async () => {
    const { flushCabiDocument } = (await import(
      "../../src/ui/cabinet/cabiService" + ".ts"
    )) as typeof import("../../src/ui/cabinet/cabiService");
    await flushCabiDocument();
  });
  const before = await page.evaluate(async () => {
    const m = (await import(
      "../../src/ui/common/appStore" + ".ts"
    )) as typeof import("../../src/ui/common/appStore");
    const j = m.useAppStore.getState().journal;
    if (j.state !== "ready") throw Error("not ready");
    return (await j.repo.cabi.listBoards()).length;
  });
  expect(before).toBe(1);
  await page.getByLabel("업무를 선택해 주세요", { exact: true }).selectOption("");
  await expect(page.getByRole("button", { name: "보드 미리보기", exact: true })).toHaveCount(0);
});

test("창 간 복제는 토큰으로 양방향 전달하고 원본 객체·이미지를 보존한다", async ({ page }) => {
  await hub(page);
  const board = await openBoard(page);
  const packet = await page.evaluate(async () => {
    const { useNote, flushNote } = (await import(
      "../../src/ui/note/noteStore" + ".ts"
    )) as typeof import("../../src/ui/note/noteStore");
    const { registerCabiDrag } = (await import(
      "../../src/ui/cabinet/cabiService" + ".ts"
    )) as typeof import("../../src/ui/cabinet/cabiService");
    const s = useNote.getState();
    await flushNote(true, true);
    const token = crypto.randomUUID();
    await registerCabiDrag(
      token,
      { kind: "week", weekId: s.weekId },
      s.doc,
      s.doc.boxes.map((b) => b.id),
    );
    return { token, count: s.doc.boxes.length };
  });
  await board.getByTestId("note-canvas").evaluate((el, token) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", "wjb-cabi-drag:" + token);
    const r = el.getBoundingClientRect();
    el.dispatchEvent(
      new DragEvent("dragover", {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
        clientX: r.left + 40,
        clientY: r.top + 40,
      }),
    );
  }, packet.token);
  await expect(board.getByTestId("cabi-drop-preview")).toContainText(`${packet.count}개 복제`);
  await board.getByTestId("note-canvas").evaluate((el, token) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", "wjb-cabi-drag:" + token);
    const r = el.getBoundingClientRect();
    el.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
        clientX: r.left + 40,
        clientY: r.top + 40,
      }),
    );
  }, packet.token);
  await expect(
    board.getByTestId("note-box").or(board.getByTestId("note-image")).or(board.getByTestId("note-link")),
  ).toHaveCount(packet.count);
  const reverse = await board.evaluate(async () => {
    const { registerCabiDrag } = (await import(
      "../../src/ui/cabinet/cabiService" + ".ts"
    )) as typeof import("../../src/ui/cabinet/cabiService");
    const { useNote, flushNote } = (await import(
      "../../src/ui/note/noteStore" + ".ts"
    )) as typeof import("../../src/ui/note/noteStore");
    const s = useNote.getState();
    await flushNote(true, true);
    const token = crypto.randomUUID();
    await registerCabiDrag(
      token,
      { kind: "task", categoryId: s.task!.categoryId },
      s.doc,
      s.doc.boxes.map((b) => b.id),
    );
    return token;
  });
  await page.getByTestId("note-canvas").evaluate((el, token) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", "wjb-cabi-drag:" + token);
    const r = el.getBoundingClientRect();
    el.dispatchEvent(
      new DragEvent("dragover", {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
        clientX: r.left + 40,
        clientY: r.top + 100,
      }),
    );
    el.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
        clientX: r.left + 40,
        clientY: r.top + 100,
      }),
    );
  }, reverse);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { useNote } = (await import(
          "../../src/ui/note/noteStore" + ".ts"
        )) as typeof import("../../src/ui/note/noteStore");
        return useNote.getState().doc.boxes.length;
      }),
    )
    .toBe(packet.count * 2);
  await expect(page.getByText("그림을 찾을 수 없습니다", { exact: true })).toHaveCount(0);
  await expect(board.getByText("그림을 찾을 수 없습니다", { exact: true })).toHaveCount(0);
});

test("보드에 붙인 업무노트는 제목만 보이는 바로가기 — 본문 없음·높이 고정·↗로 노트 열기(improve-v25 S4)", async ({
  page,
}) => {
  await hub(page);
  const task = await page
    .getByLabel("업무를 선택해 주세요", { exact: true })
    .evaluate((s: HTMLSelectElement) => s.selectedOptions[0]!.textContent!.trim());
  const n = await openNote(page);
  await n.getByLabel("노트 제목", { exact: true }).fill("가상 바로가기 노트");
  const editor = n.locator("[contenteditable=true]");
  await editor.fill("가상 본문 첫 줄");
  const id = new URL(n.url()).searchParams.get("id")!;
  await n.evaluate(async () => {
    const { flushCabiDocument } = (await import(
      "../../src/ui/cabinet/cabiService" + ".ts"
    )) as typeof import("../../src/ui/cabinet/cabiService");
    await flushCabiDocument();
  });
  await n.close();
  const b = await openBoard(page);
  await b.evaluate(async (id) => {
    const { referenceBox } = (await import(
      "../../src/domain/cabi" + ".ts"
    )) as typeof import("../../src/domain/cabi");
    const { importBoardObjects } = (await import(
      "../../src/ui/note/noteStore" + ".ts"
    )) as typeof import("../../src/ui/note/noteStore");
    importBoardObjects({
      v: 1,
      boxes: [
        // 예전에 높이를 늘려 둔 카드도 바로가기 높이로
        { ...referenceBox("s4-card", { kind: "note", id }, "가상 바로가기 노트", 40, 60, 1), frameH: 300 },
        referenceBox("s4-gone", { kind: "note", id: "없는-노트" }, "가상 지난 노트", 40, 260, 2),
      ],
    });
  }, id);
  const card = b.locator('[data-box-id="s4-card"]');
  await expect(card.getByTestId("note-shortcut-title")).toHaveText("가상 바로가기 노트");
  await expect(card).toContainText(`업무노트 · ${task}`);
  await expect(card).not.toContainText("가상 본문 첫 줄");
  expect((await card.boundingBox())!.height).toBeLessThan(100);
  const gone = b.locator('[data-box-id="s4-gone"]');
  await expect(gone).toHaveAttribute("data-missing", "true");
  await expect(gone).toContainText("원본 없음");
  await expect(gone.getByRole("button", { name: "노트 열기", exact: true })).toHaveCount(0);
  // 선택하면 [항목 연결]·[카드만 삭제]
  await b.mouse.click(900, 700);
  await card.getByTestId("note-shortcut-title").click();
  await expect(card.getByRole("button", { name: "카드만 삭제", exact: true })).toBeVisible();
  const popup = b.context().waitForEvent("page");
  await card.getByRole("button", { name: "노트 열기", exact: true }).click();
  const opened = await popup;
  await expect(opened.getByLabel("노트 제목", { exact: true })).toHaveValue("가상 바로가기 노트");
  await opened.close();
  await card.getByRole("button", { name: "카드만 삭제", exact: true }).click();
  await expect(card).toHaveCount(0);
});
