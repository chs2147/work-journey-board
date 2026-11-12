// 워크스페이스 전환 무결성(v1.8.1 긴급 수정): 공간을 바꿔도 각 공간의 기록·메모·이미지·요약이 그 공간 일지에 그대로 남는다.
// 1.8.0 결함 = 전환 직후 메모 정리가 "이전 공간의 메모"를 기준으로 "새 공간의 이미지"를 지움(그림을 찾을 수 없습니다).
// 그림은 테스트가 그 자리에서 그린 단색 도형(가상 이미지)만 쓴다.
import { CURRENT_SCHEMA } from "./schema-helper";
import { seedV16, openCopyV16 } from "./v16-helper";
import { expect, test, type Page } from "@playwright/test";

const TODAY = "2026-10-22";
const images = (page: Page) => page.getByTestId("note-image");
const missing = (page: Page) => page.getByText("그림을 찾을 수 없습니다");
const saved = (page: Page) =>
  expect(page.locator('[data-testid="save-state"][data-idle="true"]')).toHaveText("저장됨");

async function makePng(page: Page, color: string): Promise<Buffer> {
  const b64 = await page.evaluate((c) => {
    const cv = document.createElement("canvas");
    cv.width = 240;
    cv.height = 160;
    const ctx = cv.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 240, 160);
    ctx.fillStyle = c;
    ctx.fillRect(24, 16, 120, 96);
    return cv.toDataURL("image/png").split(",")[1]!;
  }, color);
  return Buffer.from(b64, "base64");
}

async function addImage(page: Page, color: string, name: string) {
  const before = await images(page).count();
  await page
    .getByTestId("note-image-input")
    .setInputFiles({ name: `${name}.png`, mimeType: "image/png", buffer: await makePng(page, color) });
  await expect(images(page)).toHaveCount(before + 1);
  await saved(page);
}

async function switchTo(page: Page, n: 1 | 2, name: string) {
  await page.keyboard.press(`Control+Alt+Digit${n}`);
  await expect(page).toHaveTitle(`Work Journey Board — ${name}`);
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
}

/** 지금 연 공간 일지에 저장된 이미지 수(저장소에서 직접 — 화면 표시와 따로 확인) */
const storedAssets = (page: Page) =>
  page.evaluate(async () => {
    const w = globalThis as unknown as { __wjbApp: { assetCount(): Promise<number> } };
    return w.__wjbApp.assetCount();
  });

test("Cabi.NET 노트·이미지·업무 보드는 공간을 3회 왕복해도 보존된다", async ({ page }) => {
  await page.keyboard.press("Alt+4");
  await page.getByTestId("cabi-hub").waitFor();
  await page.getByLabel("업무를 선택해 주세요", { exact: true }).selectOption({ index: 1 });
  const ownerId = await page.getByLabel("업무를 선택해 주세요", { exact: true }).inputValue();
  const notePromise = page.waitForEvent("popup");
  await page.getByTestId("cabi-new-note").click();
  const note = await notePromise;
  await note.getByTestId("cabi-note-editor").waitFor();
  await note.getByLabel("노트 제목", { exact: true }).fill("가상 공간 보존 노트");
  await note.locator('[contenteditable="true"]').fill("가상 노트 본문 보존");
  await note
    .locator('input[type="file"][accept="image/png,image/jpeg,image/webp,image/gif"]')
    .setInputFiles({ name: "가상.png", mimeType: "image/png", buffer: await makePng(page, "#5a8b6c") });
  await expect(note.locator('[contenteditable="true"] img')).toHaveCount(1);
  const boardPromise = page.waitForEvent("popup");
  await page.getByTestId("cabi-open-board").click();
  const board = await boardPromise;
  await board.getByTestId("note-scroll").waitFor();
  await board.getByRole("button", { name: "업무 경과일", exact: true }).click();
  await expect(board.getByTestId("live-widget")).toHaveCount(1);
  await board.evaluate(async () => {
    const { useNote, resizeFrameLive, beginGesture, endGesture } = (await import(
      "../../src/ui/note/noteStore" + ".ts"
    )) as typeof import("../../src/ui/note/noteStore");
    const b = useNote.getState().doc.boxes[0]!;
    const before = beginGesture();
    resizeFrameLive(b.id, b.x, b.y, 360, 320);
    endGesture(before);
  });
  const counts = () =>
    page.evaluate(async () => {
      const w = globalThis as unknown as { __wjbApp: { journalCounts(): Promise<Record<string, number>> } };
      return w.__wjbApp.journalCounts();
    });
  // Switch immediately: the workspace controller must flush both modeless windows first.
  for (let round = 0; round < 3; round++) {
    await switchTo(page, 2, "개인");
    expect(await counts()).toMatchObject({ cabi_note: 0, cabi_board: 0, cabi_asset: 0 });
    await switchTo(page, 1, "회사");
    expect(await counts()).toMatchObject({ cabi_note: 1, cabi_board: 1, cabi_asset: 1 });
  }
  await expect.poll(() => note.isClosed()).toBe(true);
  await expect.poll(() => board.isClosed()).toBe(true);
  await expect(page.getByTestId("cabi-note-row")).toContainText("가상 공간 보존 노트");
  await page.getByLabel("업무를 선택해 주세요", { exact: true }).selectOption(ownerId);
  const reopen = page.waitForEvent("popup");
  await page.getByTestId("cabi-open-board").click();
  const restoredBoard = await reopen;
  await expect(restoredBoard.getByTestId("live-widget")).toHaveCount(1);
  expect(
    await restoredBoard.getByTestId("live-widget").evaluate((el) => el.getBoundingClientRect().height),
  ).toBe(320);
  expect(
    await restoredBoard.evaluate(async () => {
      const { useNote } = (await import(
        "../../src/ui/note/noteStore" + ".ts"
      )) as typeof import("../../src/ui/note/noteStore");
      const s = useNote.getState();
      return s.doc.boxes
        .filter((b) => b.kind === "text" && b.widget)
        .map((b) => (b.kind === "text" ? b.widget : null));
    }),
  ).toEqual([expect.objectContaining({ type: "elapsed" })]);
});

test("Cabi.NET 복제 응답이 공간 전환 뒤 도착해도 새 공간에 이전 객체를 쓰지 않는다", async ({ page }) => {
  await page.goto(`/?today=${TODAY}&sample=showcase&ws=2`);
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
  await page.keyboard.press("Alt+4");
  await page.getByLabel("업무를 선택해 주세요", { exact: true }).selectOption({ index: 1 });
  const popup = page.waitForEvent("popup");
  await page.getByTestId("cabi-open-board").click();
  const board = await popup;
  await board.getByTestId("note-scroll").waitFor();
  await board.getByRole("button", { name: "주간 메모", exact: true }).click();
  const panel = board.getByTestId("cabi-weekly-panel");
  await panel.locator('input[type="checkbox"]').nth(1).check();
  await panel.getByRole("combobox").last().selectOption("copy");
  await panel.getByRole("button", { name: "1개 보드에 추가", exact: true }).click();
  await expect(board.getByTestId("note-box")).toHaveCount(1);
  await board.evaluate(async () => {
    const notes = (await import(
      "../../src/ui/note/noteStore" + ".ts"
    )) as typeof import("../../src/ui/note/noteStore");
    notes.setMulti(notes.useNote.getState().doc.boxes.map((b) => b.id));
    const transfer = (await import(
      "../../src/ui/cabinet/boardTransfer" + ".ts"
    )) as typeof import("../../src/ui/cabinet/boardTransfer");
    await transfer.copyBoardObjects();
  });
  await page.evaluate(async () => {
    const { useAppStore } = (await import(
      "../../src/ui/common/appStore" + ".ts"
    )) as typeof import("../../src/ui/common/appStore");
    const j = useAppStore.getState().journal;
    if (j.state !== "ready") throw Error("not ready");
    const original = j.repo.cabi.copyOwnedAssets.bind(j.repo.cabi);
    const state = globalThis as unknown as {
      __cabiTransferEntered?: boolean;
      __cabiTransferRelease?: () => void;
    };
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    state.__cabiTransferRelease = release;
    j.repo.cabi.copyOwnedAssets = async (...args) => {
      state.__cabiTransferEntered = true;
      await gate;
      return original(...args);
    };
  });
  const pending = page.evaluate(async () => {
    const { pasteBoardObjects } = (await import(
      "../../src/ui/cabinet/boardTransfer" + ".ts"
    )) as typeof import("../../src/ui/cabinet/boardTransfer");
    try {
      await pasteBoardObjects();
      return "unexpected success";
    } catch (e) {
      return String(e);
    }
  });
  await page.waitForFunction(
    () => (globalThis as unknown as { __cabiTransferEntered?: boolean }).__cabiTransferEntered,
  );
  await switchTo(page, 2, "개인");
  const before = await page.evaluate(() =>
    (globalThis as unknown as { __wjbApp: { noteSnapshot(): Promise<unknown> } }).__wjbApp.noteSnapshot(),
  );
  await page.evaluate(() =>
    (globalThis as unknown as { __cabiTransferRelease: () => void }).__cabiTransferRelease(),
  );
  expect(await pending).not.toBe("unexpected success");
  const after = await page.evaluate(() =>
    (globalThis as unknown as { __wjbApp: { noteSnapshot(): Promise<unknown> } }).__wjbApp.noteSnapshot(),
  );
  expect(after).toEqual(before);
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?today=${TODAY}&ws=2`);
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
});

test("이미지를 붙이고 공간을 오가도 두 공간의 이미지가 모두 남는다(1.8.0 유실 결함)", async ({ page }) => {
  const base1 = await images(page).count();
  await addImage(page, "#2a78d6", "회사-그림");
  const stored1 = await storedAssets(page);

  await switchTo(page, 2, "개인");
  const base2 = await images(page).count();
  await expect(missing(page)).toHaveCount(0);
  await addImage(page, "#e55", "개인-그림");
  const stored2 = await storedAssets(page);

  for (let round = 0; round < 3; round++) {
    await switchTo(page, 1, "회사");
    await expect(images(page)).toHaveCount(base1 + 1);
    await expect(missing(page)).toHaveCount(0);
    expect(await storedAssets(page)).toBe(stored1);

    await switchTo(page, 2, "개인");
    await expect(images(page)).toHaveCount(base2 + 1);
    await expect(missing(page)).toHaveCount(0);
    expect(await storedAssets(page)).toBe(stored2);
  }
});

test("이미지를 지운 뒤 바로 공간을 바꿔도: 지운 공간만 정리되고, 다른 공간 이미지는 그대로", async ({
  page,
}) => {
  await addImage(page, "#2a78d6", "회사-그림");
  await switchTo(page, 2, "개인");
  await addImage(page, "#e55", "개인-그림");
  const keep2 = await storedAssets(page);
  await switchTo(page, 1, "회사");
  const n1 = await images(page).count();
  // 회사 이미지 하나를 지우고(메모 판에서 Delete) 곧바로 전환
  await images(page)
    .last()
    .click({ position: { x: 8, y: 30 } });
  await page.keyboard.press("Delete");
  await expect(images(page)).toHaveCount(n1 - 1);
  await switchTo(page, 2, "개인");
  await expect(missing(page)).toHaveCount(0);
  expect(await storedAssets(page)).toBe(keep2);
  await switchTo(page, 1, "회사");
  await expect(images(page)).toHaveCount(n1 - 1);
  await expect(missing(page)).toHaveCount(0);
});

test("기록·메모 글·요약 수정본도 공간마다 따로: 입력 직후 전환해도 그 공간 일지에 저장되고 섞이지 않는다", async ({
  page,
}) => {
  // 회사: 오늘 칸 첫 항목에 글을 붙이고 저장 대기 중에 바로 전환
  const cell = page.locator(":focus");
  await expect(cell).toBeVisible();
  await page.keyboard.press("End");
  await page.keyboard.type(" (회사 확인)");
  await switchTo(page, 2, "개인");
  await expect(page.getByText(/\(회사 확인\)/)).toHaveCount(0);
  // 개인: 메모 글 상자
  const c = (await page.getByTestId("note-canvas").boundingBox())!;
  await page.mouse.click(c.x + 300, c.y + 60);
  await expect(page.locator(":focus")).toHaveClass(/note-prose/);
  await page.keyboard.type("개인 메모 가상");
  await switchTo(page, 1, "회사");
  await expect(page.getByText("개인 메모 가상")).toHaveCount(0);
  await expect(page.locator("textarea").filter({ hasText: /\(회사 확인\)/ })).toHaveCount(1);
  await switchTo(page, 2, "개인");
  await expect(page.getByTestId("note-box").filter({ hasText: "개인 메모 가상" })).toHaveCount(1);
  await expect(page.getByText(/\(회사 확인\)/)).toHaveCount(0);
});

test("Universe: 다른 공간을 읽기 전용으로 켜고 [그 공간에서 열기]로 오가도 두 공간의 이미지·기록이 그대로(CLAUDE.md 4-7)", async ({
  page,
}) => {
  const base1 = await images(page).count();
  await addImage(page, "#2a78d6", "회사-그림");
  const stored1 = await storedAssets(page);
  for (let round = 0; round < 3; round++) {
    // 회사에서 Universe → 개인 공간 켜기(읽기 전용) → 개인 항목 [그 공간에서 열기]
    await page.keyboard.press("Alt+Digit5");
    await expect(page.getByTestId("universe-view")).toBeVisible();
    {
      await page.getByTestId("u-static").click();
      for (const id of ["u-toggle-filter", "u-toggle-detail"]) {
        const toggle = page.getByTestId(id);
        if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
      }
    }
    await page.getByTestId("u-view-list").click();
    const toggle = page.getByTestId("u-ws-toggle").nth(1);
    if (!(await toggle.isChecked())) await toggle.check();
    await page
      .getByTestId("universe-list")
      .getByTestId("u-row")
      .filter({ hasText: "아침 달리기 5km" })
      .click();
    await page.getByTestId("u-open").click();
    await expect(page).toHaveTitle("Work Journey Board — 개인");
    await expect(missing(page)).toHaveCount(0);
    if (round === 0) await addImage(page, "#e55", "개인-그림");
    await expect(images(page)).not.toHaveCount(0);
    await expect(missing(page)).toHaveCount(0);
    const stored2 = await storedAssets(page);
    expect(stored2).toBeGreaterThan(0);
    // 다시 회사로: 그림·저장소 개수 그대로
    await switchTo(page, 1, "회사");
    await expect(images(page)).toHaveCount(base1 + 1);
    await expect(missing(page)).toHaveCount(0);
    expect(await storedAssets(page)).toBe(stored1);
  }
});

test("Universe 직접 연결은 만든 공간 일지에만: 공간을 오가도 그 공간에 그대로, 다른 공간에는 없음(CLAUDE.md 4-7)", async ({
  page,
}) => {
  const count = () =>
    page.evaluate(() =>
      (globalThis as unknown as { __wjbApp: { relationCount(): Promise<number> } }).__wjbApp.relationCount(),
    );
  await page.keyboard.press("Alt+Digit5");
  await expect(page.getByTestId("universe-view")).toBeVisible();
  {
    await page.getByTestId("u-static").click();
    for (const id of ["u-toggle-filter", "u-toggle-detail"]) {
      const toggle = page.getByTestId(id);
      if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
    }
  }
  await page.getByTestId("u-view-list").click();
  await page
    .getByTestId("universe-list")
    .getByTestId("u-row")
    .filter({ has: page.locator("td", { hasText: /^\s*업무 항목$/ }) })
    .first()
    .click();
  await page.getByTestId("u-connect").click();
  await page.getByTestId("u-link-candidate").first().click();
  await page.getByTestId("u-link-save").click();
  await expect(page.getByTestId("u-rel-row")).toHaveCount(1);
  expect(await count()).toBe(1);
  for (let round = 0; round < 3; round++) {
    await switchTo(page, 2, "개인");
    expect(await count()).toBe(0);
    await switchTo(page, 1, "회사");
    expect(await count()).toBe(1);
  }
  await page.keyboard.press("Alt+Digit5");
  await expect(page.getByTestId("universe-view")).toBeVisible();
  {
    await page.getByTestId("u-static").click();
    for (const id of ["u-toggle-filter", "u-toggle-detail"]) {
      const toggle = page.getByTestId(id);
      if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
    }
  }
  await page.getByTestId("u-view-map").click();
  await expect(page.getByTestId("u-rel-line")).toHaveCount(1);
});

test("지식 카드·근거 묶음도 공간마다 따로: 카드는 만든 공간 일지에만, 공간을 바꾸면 근거 묶음·보드 ◆가 비워진다(CLAUDE.md 4-7)", async ({
  page,
}) => {
  const count = () =>
    page.evaluate(() =>
      (globalThis as unknown as { __wjbApp: { cardCount(): Promise<number> } }).__wjbApp.cardCount(),
    );
  await page.keyboard.press("Alt+Digit5");
  await expect(page.getByTestId("universe-view")).toBeVisible();
  {
    await page.getByTestId("u-static").click();
    for (const id of ["u-toggle-filter", "u-toggle-detail"]) {
      const toggle = page.getByTestId(id);
      if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
    }
  }
  await page.getByTestId("u-view-list").click();
  await page
    .getByTestId("universe-list")
    .getByTestId("u-row")
    .filter({ has: page.locator("td", { hasText: /^\s*업무 항목$/ }) })
    .first()
    .click();
  await page.getByTestId("u-pack-add").click();
  await expect(page.getByTestId("pack-badge")).toHaveText("1");
  await page.getByTestId("u-make-card").click();
  await page.getByTestId("u-card-title").fill("가상: 회사 카드");
  await page.getByTestId("u-card-save").click();
  await expect(page.getByTestId("u-detail-title")).toHaveText("가상: 회사 카드");
  expect(await count()).toBe(1);
  for (let round = 0; round < 3; round++) {
    await switchTo(page, 2, "개인");
    expect(await count()).toBe(0);
    await expect(page.getByTestId("pack-badge")).toHaveCount(0); // 이전 공간 원문은 묶음에 남지 않는다
    await expect(page.getByTestId("card-badge")).toHaveCount(0);
    await switchTo(page, 1, "회사");
    expect(await count()).toBe(1);
  }
});

test("마감일도 공간마다 따로: 정한 공간 일지에만, 공간을 오가도(3번) 꼬리표·중요 업무 묶음이 그 공간에만(v10, CLAUDE.md 4-7)", async ({
  page,
}) => {
  const count = () =>
    page.evaluate(() =>
      (globalThis as unknown as { __wjbApp: { dueCount(): Promise<number> } }).__wjbApp.dueCount(),
    );
  await page.keyboard.press("Alt+KeyU");
  await page.keyboard.type("1026");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("due-chip")).toHaveCount(1);
  await page.getByTestId("rail-important").click();
  await expect(page.getByTestId("important-group-due")).toBeVisible();
  expect(await count()).toBe(1);
  for (let round = 0; round < 3; round++) {
    await switchTo(page, 2, "개인");
    expect(await count()).toBe(0);
    await expect(page.getByTestId("due-chip")).toHaveCount(0);
    await expect(page.getByTestId("important-group-due")).toHaveCount(0);
    await switchTo(page, 1, "회사");
    expect(await count()).toBe(1);
    await expect(page.getByTestId("due-chip")).toHaveText("⏳ 10/26(월) D-4");
  }
});

test("v11 Markdown 생성 후 공간 3회 왕복해 링크·글 보존, 읽기 중 전환하면 생성 취소", async ({ page }) => {
  await expect(page.locator("[data-note-drop]")).toBeVisible();
  const note = page.locator(".note-prose").filter({ hasText: "v11 공간 전용" });
  await page.evaluate(() => {
    const el = document.querySelector("[data-note-drop]")!;
    const dt = new DataTransfer();
    dt.items.add(
      new File(["# v11 공간 전용\n\n[링크](https://example.com)"], "공간.md", { type: "text/markdown" }),
    );
    el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await expect(note).toHaveCount(1);
  await saved(page);
  for (let i = 0; i < 3; i++) {
    await switchTo(page, 2, "개인");
    await expect(note).toHaveCount(0);
    await switchTo(page, 1, "회사");
    await expect(note).toHaveCount(1);
    await expect(note.locator('a[href="https://example.com"]')).toHaveAttribute(
      "href",
      "https://example.com",
    );
  }
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      if (this.name !== "지연.md") return original.call(this);
      document.body.dataset.reading = "true";
      return new Promise<ArrayBuffer>((resolve) => {
        (globalThis as unknown as { releaseMd(): void }).releaseMd = () =>
          void original.call(this).then(resolve);
      });
    };
    const el = document.querySelector("[data-note-drop]")!;
    const dt = new DataTransfer();
    dt.items.add(new File(["오면 안 되는 지연 메모"], "지연.md", { type: "text/markdown" }));
    el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await expect(page.locator("body")).toHaveAttribute("data-reading", "true");
  await switchTo(page, 2, "개인");
  await page.evaluate(() => (globalThis as unknown as { releaseMd(): void }).releaseMd());
  await expect(page.locator(".note-prose").filter({ hasText: "오면 안 되는 지연 메모" })).toHaveCount(0);
  await switchTo(page, 1, "회사");
  await expect(page.locator(".note-prose").filter({ hasText: "오면 안 되는 지연 메모" })).toHaveCount(0);
});

test("v12 completion and undo stay in their own workspace across three round trips", async ({ page }) => {
  const count = () =>
    page.evaluate(() =>
      (
        globalThis as unknown as { __wjbApp: { completedCount(week: string): Promise<number> } }
      ).__wjbApp.completedCount("2026-W43"),
    );
  const row = () =>
    page.getByTestId("cell-차세대 정산 시스템 구축-2026-10-22").locator("[data-item-index]").first();
  const originalFlag = await row().getAttribute("data-flagged");
  const before = await count();
  await row().hover();
  await row().getByTestId("item-completion").click();
  await expect(row()).toHaveAttribute("data-done", "true");
  expect(await count()).toBe(before + 1);
  await switchTo(page, 2, "개인");
  const otherBefore = await count();
  await switchTo(page, 1, "회사");
  for (let i = 0; i < 3; i++) {
    await expect(row()).toHaveAttribute("data-done", "true");
    expect(await count()).toBe(before + 1);
    await switchTo(page, 2, "개인");
    expect(await count()).toBe(otherBefore);
    await switchTo(page, 1, "회사");
  }
  await row().hover();
  await row().getByTestId("item-completion").click();
  await expect(row()).not.toHaveAttribute("data-done", "true");
  expect(await row().getAttribute("data-flagged")).toBe(originalFlag);
  expect(await count()).toBe(before);
});

test("v13 백업 보관 정책·보호 사본이 공간별로 유지되고 3회 왕복 후 이미지/기록이 그대로", async ({
  page,
}) => {
  const { openSettings } = await import("./settings-helper");
  await addImage(page, "#2a78d6", "v13-회사-그림");
  const count1 = await storedAssets(page);
  async function policy(days: number) {
    await openSettings(page, "data");
    await page.getByTestId("backup-policy-open").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("spinbutton", { name: "일일 보관 기준" }).fill(String(days));
    await dialog.getByRole("button", { name: "정리 미리보기", exact: true }).click();
    await page.getByTestId("backup-policy-apply").click();
    await expect(dialog).toContainText("보관 정책 적용");
    await expect(dialog.getByRole("button", { name: "닫기", exact: true })).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "지금 백업", exact: true }).click();
    await expect(page.getByTestId("last-backup")).toContainText(`DB 구조 v${CURRENT_SCHEMA}`);
    await page.keyboard.press("Escape");
  }
  await policy(7);
  await switchTo(page, 2, "개인");
  await addImage(page, "#e55", "v13-개인-그림");
  const count2 = await storedAssets(page);
  await policy(90);
  for (let i = 0; i < 3; i++) {
    await switchTo(page, 1, "회사");
    expect(await storedAssets(page)).toBe(count1);
    await openSettings(page, "data");
    await expect(page.getByTestId("settings-cat-data")).toContainText("일일 최근 7일");
    await page.keyboard.press("Escape");
    await switchTo(page, 2, "개인");
    expect(await storedAssets(page)).toBe(count2);
    await openSettings(page, "data");
    await expect(page.getByTestId("settings-cat-data")).toContainText("일일 최근 90일");
    await page.keyboard.press("Escape");
  }
  const names = await page.evaluate(() =>
    (globalThis as unknown as { __wjb: { files(): string[] } }).__wjb.files(),
  );
  expect(names.filter((n) => n.includes("_manual_app-v"))).toHaveLength(2);
  await expect(missing(page)).toHaveCount(0);
});

test("v13 정책 창을 연 상태로 공간을 바꾸면 이전 공간의 창을 닫음", async ({ page }) => {
  const { openSettings } = await import("./settings-helper");
  await openSettings(page, "data");
  await page.getByTestId("backup-policy-open").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await switchTo(page, 2, "개인");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await switchTo(page, 1, "회사");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("v14 묶음 이동 후 공간 3회 왕복: 글/이미지/위치 보존, 실행 취소 분리, 이동 중 전환 취소", async ({
  page,
}) => {
  await addImage(page, "#337766", "v14-가상-묶음");
  await page.getByRole("button", { name: "크게 보기", exact: true }).click();
  const snapshot = () =>
    page.evaluate(async () => {
      const w = globalThis as unknown as {
        __wjbApp: { noteSnapshot(): Promise<{ doc: { boxes: unknown[] }; canUndo: boolean }> };
      };
      const result = await w.__wjbApp.noteSnapshot();
      return { boxes: result.doc.boxes, canUndo: result.canUndo };
    });
  const chooseGroup = async () => {
    const c = (await page.getByTestId("note-canvas").boundingBox())!;
    await page.mouse.move(c.x + 4, c.y + 4);
    await page.mouse.down();
    await page.mouse.move(c.x + 900, c.y + 500, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByTestId("note-group-frame")).toBeVisible();
  };
  await chooseGroup();
  const body = page.getByTestId("note-box").first().locator(".note-prose");
  await body.scrollIntoViewIfNeeded();
  const r = (await body.boundingBox())!;
  await page.mouse.move(r.x + 60, r.y + 20);
  await page.mouse.down();
  await page.mouse.move(r.x + 100, r.y + 44, { steps: 5 });
  await page.mouse.up();
  await saved(page);
  const expected = await page.locator('[data-testid="note-canvas"] > [data-box-id]').evaluateAll((ns) =>
    ns.map((n) => ({
      id: (n as HTMLElement).dataset.boxId,
      x: parseFloat((n as HTMLElement).style.left),
      y: parseFloat((n as HTMLElement).style.top),
    })),
  );
  await expect
    .poll(async () =>
      ((await snapshot()).boxes as { id: string; x: number; y: number }[]).map((b) => ({
        id: b.id,
        x: b.x,
        y: b.y,
      })),
    )
    .toEqual(expected);
  const company = (await snapshot()).boxes;
  const assets = await storedAssets(page);
  await switchTo(page, 2, "개인");
  const personal = (await snapshot()).boxes;
  for (let round = 0; round < 3; round++) {
    await switchTo(page, 1, "회사");
    expect((await snapshot()).boxes).toEqual(company);
    expect((await snapshot()).canUndo).toBe(false);
    expect(await storedAssets(page)).toBe(assets);
    await switchTo(page, 2, "개인");
    expect((await snapshot()).boxes).toEqual(personal);
    expect((await snapshot()).canUndo).toBe(false);
  }
  await switchTo(page, 1, "회사");
  await chooseGroup();
  await body.scrollIntoViewIfNeeded();
  const t = (await body.boundingBox())!;
  await page.mouse.move(t.x + 60, t.y + 20);
  await page.mouse.down();
  await page.mouse.move(t.x + 110, t.y + 52, { steps: 5 });
  await switchTo(page, 2, "개인");
  await page.mouse.up();
  expect((await snapshot()).boxes).toEqual(personal);
  await switchTo(page, 1, "회사");
  expect((await snapshot()).boxes).toEqual(company);
  expect(await storedAssets(page)).toBe(assets);
});

const journalCounts = (page: Page) =>
  page.evaluate(() =>
    (
      globalThis as unknown as { __wjbApp: { journalCounts(): Promise<Record<string, number>> } }
    ).__wjbApp.journalCounts(),
  );

test("v16 다른 주 복제 후 공간 3회 왕복: 원본 메모·이미지·Cabinet은 그대로, 연결과 항목만 증가", async ({
  page,
}) => {
  await addImage(page, "#327ad4", "v16-보존-그림");
  await seedV16(page);
  const before = await journalCounts(page);
  const dialog = await openCopyV16(page);
  await dialog.getByLabel("복제할 날짜").fill("2026-10-29");
  await dialog.getByRole("button", { name: "복제", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const company = await journalCounts(page);
  expect(company.entry_item).toBe(before.entry_item! + 2);
  expect(company.note_entry_link).toBe(before.note_entry_link! + 2);
  expect(company.cabinet_link).toBe(before.cabinet_link! + 1);
  for (const key of ["note_boxes", "note_asset", "cabinet_item"]) expect(company[key]).toBe(before[key]);
  await switchTo(page, 2, "개인");
  const personal = await journalCounts(page);
  for (let round = 0; round < 3; round++) {
    await switchTo(page, 1, "회사");
    expect(await journalCounts(page)).toEqual(company);
    await expect(missing(page)).toHaveCount(0);
    await expect(page.locator('[data-box-id="v16-memo"] [data-testid="link-strip"]')).toHaveAttribute(
      "data-count",
      "4",
    );
    await switchTo(page, 2, "개인");
    expect(await journalCounts(page)).toEqual(personal);
    await expect(missing(page)).toHaveCount(0);
  }
});

test("v20 노트 삭제 잠금·복제 후 공간 3회 왕복: 사본·이미지·잠금이 그 공간에만 그대로(CLAUDE.md 4-7)", async ({
  page,
}) => {
  await page.keyboard.press("Alt+4");
  await page.getByTestId("cabi-hub").waitFor();
  await page.getByLabel("업무를 선택해 주세요", { exact: true }).selectOption({ index: 1 });
  const notePromise = page.waitForEvent("popup");
  await page.getByTestId("cabi-new-note").click();
  const note = await notePromise;
  await note.getByTestId("cabi-note-editor").waitFor();
  await note.getByLabel("노트 제목", { exact: true }).fill("가상 v20 잠금 노트");
  await note.locator('[contenteditable="true"]').fill("가상 v20 본문");
  await note
    .locator('input[type="file"][accept="image/png,image/jpeg,image/webp,image/gif"]')
    .setInputFiles({ name: "가상.png", mimeType: "image/png", buffer: await makePng(page, "#8a5a2c") });
  await expect(note.locator('[contenteditable="true"] img')).toHaveCount(1);
  await note.getByTestId("note-delete-lock").click();
  await expect(note.getByTestId("note-delete-lock")).toHaveAttribute("aria-pressed", "true");
  await note.evaluate(async () => {
    const { flushCabiDocument } = await import("../../src/ui/cabinet/cabiService" + ".ts");
    await flushCabiDocument();
  });
  const row = (title: string) =>
    page.getByTestId("cabi-note-row").filter({ has: page.getByText(title, { exact: true }) });
  await row("가상 v20 잠금 노트").getByTestId("cabi-note-duplicate").click();
  await expect(row("가상 v20 잠금 노트 (사본)")).toHaveCount(1);
  const company = await journalCounts(page);
  expect(company).toMatchObject({ cabi_note: 2, cabi_asset: 2 });
  for (let round = 0; round < 3; round++) {
    await switchTo(page, 2, "개인");
    expect(await journalCounts(page)).toMatchObject({ cabi_note: 0, cabi_asset: 0 });
    await switchTo(page, 1, "회사");
    expect(await journalCounts(page)).toMatchObject({ cabi_note: 2, cabi_asset: 2 });
  }
  if (!(await page.getByTestId("cabi-hub").isVisible())) await page.keyboard.press("Alt+4");
  await page.getByTestId("cabi-hub").waitFor();
  await page.getByLabel("업무를 선택해 주세요", { exact: true }).selectOption({ index: 1 });
  await expect(row("가상 v20 잠금 노트").getByTestId("cabi-note-locked")).toBeVisible();
  await expect(row("가상 v20 잠금 노트 (사본)").getByTestId("cabi-note-delete")).toBeVisible();
});

test("v21 칸반 섹션·상태 이력·시작 화면은 공간마다 따로: 공간을 3번 오가도 그 공간 일지에만(CLAUDE.md 4-7)", async ({
  page,
}) => {
  const kanbanCounts = async () => {
    const c = await journalCounts(page);
    return { section: c.kanban_section, log: c.item_status_log, bulk: c.kanban_bulk };
  };
  const hop = async (n: 1 | 2, name: string) => {
    await page.keyboard.press(`Control+Alt+Digit${n}`);
    await expect(page).toHaveTitle(`Work Journey Board — ${name}`);
  };
  const base2 = await (async () => {
    await hop(2, "개인");
    await expect(page.getByTestId("week-title")).toContainText("2026-W43");
    const c = await kanbanCounts();
    await hop(1, "회사");
    await expect(page.getByTestId("week-title")).toContainText("2026-W43");
    return c;
  })();
  // 회사: 항목 추가 → 섹션 만들기 → 카드를 섹션으로 → 시작 화면 = 칸반
  await page.keyboard.press("Alt+Digit6");
  await expect(page.getByTestId("kanban-view")).toBeVisible();
  await page.getByTestId("kanban-add-item").click();
  const dlg = page.getByTestId("kanban-item-dialog");
  await dlg.getByTestId("kanban-item-category").selectOption({ index: 0 });
  await dlg.getByTestId("kanban-item-line").first().fill("가상 공간 칸반 카드");
  await dlg.getByTestId("kanban-item-save").click();
  await page.getByTestId("kanban-add-section").click();
  await page.getByTestId("kanban-section-dialog").getByRole("textbox").fill("가상 섹션");
  await page.getByTestId("kanban-section-save").click();
  const theCard = page
    .getByTestId("kanban-card")
    .filter({ has: page.getByTestId("kanban-card-text").getByText("가상 공간 칸반 카드", { exact: true }) });
  await theCard.dragTo(page.getByTestId("kanban-col-section"));
  await expect(page.getByTestId("kanban-col-section").getByText("가상 공간 칸반 카드")).toBeVisible();
  await page.getByTestId("rail-settings").click();
  await page.locator("#settings-tab-screen").click();
  await page.getByTestId("start-view-select").selectOption("kanban");
  await expect(page.getByTestId("start-view-select")).toHaveValue("kanban");
  const company = await kanbanCounts();
  expect(company.section).toBe(1);
  expect(company.log).toBeGreaterThanOrEqual(1);

  for (let round = 0; round < 3; round++) {
    await hop(2, "개인");
    // 개인: 시작 화면 = 주간 보드(기본), 섹션·이력은 그대로(늘지 않음)
    await expect(page.getByTestId("week-title")).toContainText("2026-W43");
    await expect(page.getByTestId("kanban-view")).toHaveCount(0);
    expect(await kanbanCounts()).toEqual(base2);
    await hop(1, "회사");
    // 회사: 시작 화면 = 칸반, 카드는 그 섹션에 그대로
    await expect(page.getByTestId("kanban-view")).toBeVisible();
    await expect(page.getByTestId("kanban-col-section").getByTestId("kanban-col-name")).toHaveText(
      "가상 섹션",
    );
    await expect(page.getByTestId("kanban-col-section").getByText("가상 공간 칸반 카드")).toBeVisible();
    expect(await kanbanCounts()).toEqual(company);
  }
});
