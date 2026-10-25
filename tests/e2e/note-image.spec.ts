// 주간 메모 이미지 상자 E2E(weekly-note-spec N2): 파일에서·캡처 붙여넣기·끌어다 놓기, 줄여서 저장(긴 변 1600·WebP),
// 크기(비율 유지)·설명·크게 보기·이미지로 저장·삭제/되돌리기, 다른 주에 다녀와도 그대로, 자동 집계 `- (이미지) 설명`.
// 그림은 테스트가 그 자리에서 그린 단색 도형(가상 이미지)만 쓴다.
import { expect, test, type Page } from "@playwright/test";

const saved = (page: Page) => expect(page.getByTestId("save-state")).toHaveText("저장됨 ✓");
const images = (page: Page) => page.getByTestId("note-image");

/** 브라우저 안 canvas로 그린 가상 그림(PNG) — 파일 입력·붙여넣기·끌어다 놓기에 같이 쓴다 */
async function makePng(page: Page, width: number, height: number, color = "#2a78d6"): Promise<Buffer> {
  const b64 = await page.evaluate(
    ([w, h, c]) => {
      const cv = document.createElement("canvas");
      cv.width = w as number;
      cv.height = h as number;
      const ctx = cv.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = c as string;
      ctx.fillRect(cv.width * 0.1, cv.height * 0.1, cv.width * 0.5, cv.height * 0.6);
      ctx.beginPath();
      ctx.arc(cv.width * 0.75, cv.height * 0.6, Math.min(cv.width, cv.height) * 0.15, 0, Math.PI * 2);
      ctx.fill();
      return cv.toDataURL("image/png").split(",")[1]!;
    },
    [width, height, color] as const,
  );
  return Buffer.from(b64, "base64");
}

/** 메모 도크 안 요소에 그림 붙여넣기(Ctrl+V와 같은 paste 이벤트) */
async function pasteImage(page: Page, selector: string, png: Buffer) {
  await page
    .locator(selector)
    .first()
    .evaluate((el, b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], "capture.png", { type: "image/png" }));
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }, png.toString("base64"));
}

/** 이미지 상자의 저장 정보(브라우저 모드 저장소에서 읽음) */
const assetInfo = (page: Page) =>
  page.evaluate(async () => {
    const img = document.querySelector<HTMLImageElement>('[data-testid="note-image"] img');
    return img
      ? { w: img.naturalWidth, h: img.naturalHeight, mime: img.src.slice(5, img.src.indexOf(";")) }
      : null;
  });

async function goW44(page: Page) {
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("week-title")).toContainText("2026-W44");
  await expect(page.getByTestId("note-empty")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?today=2026-10-22");
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
});

test("[이미지 넣기] → 큰 그림은 긴 변 1600px로 줄여 저장, 처음 폭 480, 설명은 자동 집계에, 다른 주에 다녀와도 그대로", async ({
  page,
}) => {
  await goW44(page);
  const png = await makePng(page, 3200, 1800);
  await page
    .getByTestId("note-image-input")
    .setInputFiles({ name: "가상.png", mimeType: "image/png", buffer: png });
  await expect(images(page)).toHaveCount(1);
  await expect(page.getByTestId("note-counts")).toHaveText("상자 0개 · 이미지 1개");
  const info = await assetInfo(page);
  expect([info?.w, info?.h]).toEqual([1600, 900]);
  // Chromium은 WebP로 바꿔 저장(WebKit처럼 WebP로 못 쓰는 엔진은 PNG)
  expect(["image/webp", "image/png"]).toContain(info?.mime);
  const box = images(page).first();
  expect(await box.evaluate((el) => (el as HTMLElement).style.width)).toBe("480px");
  await expect(box).toBeFocused(); // 넣은 그림이 선택된다
  // 설명: 선택 상태에서 Enter → 설명 입력 → Enter로 다시 선택
  await page.keyboard.press("Enter");
  await page.keyboard.type("가상 응답 시간 그래프");
  await page.keyboard.press("Enter");
  await expect(box).toBeFocused();
  await saved(page);
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
  await page.keyboard.press("Alt+ArrowRight");
  await expect(images(page)).toHaveCount(1);
  await expect(images(page).locator("input")).toHaveValue("가상 응답 시간 그래프");
  await expect(images(page).locator("img")).toHaveAttribute("alt", "이미지: 가상 응답 시간 그래프");
  await page.keyboard.press("Alt+KeyS");
  await expect(page.getByTestId("summary-auto")).toContainText("[메모]\n- (이미지) 가상 응답 시간 그래프");
});

test("빈 곳 클릭 → Ctrl+V(캡처) → 그 자리에 이미지 상자(빈 글 상자는 사라짐), 글이 있는 상자에서 붙이면 그 아래", async ({
  page,
}) => {
  await goW44(page);
  const c = (await page.getByTestId("note-canvas").boundingBox())!;
  await page.mouse.click(c.x + 403, c.y + 101);
  await expect(page.locator(":focus")).toHaveClass(/note-prose/);
  await pasteImage(page, ":focus", await makePng(page, 400, 300));
  await expect(images(page)).toHaveCount(1);
  await expect(page.getByTestId("note-box")).toHaveCount(0);
  const pos = await images(page)
    .first()
    .evaluate((el) => [
      (el as HTMLElement).style.left,
      (el as HTMLElement).style.top,
      (el as HTMLElement).style.width,
    ]);
  expect(pos).toEqual(["400px", "104px", "400px"]); // 작은 그림은 제 크기
  // 글 상자 아래에 붙이기
  await page.mouse.click(c.x + 24, c.y + 24);
  await page.keyboard.type("가상 메모");
  await pasteImage(page, ":focus", await makePng(page, 200, 100, "#e55"));
  await expect(images(page)).toHaveCount(2);
  const textBox = page.getByTestId("note-box").first();
  const [tb, ib] = [
    await textBox.evaluate((el) => (el as HTMLElement).offsetTop + (el as HTMLElement).offsetHeight),
    await images(page)
      .last()
      .evaluate((el) => (el as HTMLElement).offsetTop),
  ];
  expect(ib).toBeGreaterThan(tb);
  await expect(page.locator(".note-prose")).toHaveText("가상 메모");
});

test("탐색기에서 끌어다 놓기 → 놓은 자리, 그림이 아닌 파일은 안내만", async ({ page }) => {
  await goW44(page);
  const png = (await makePng(page, 300, 200)).toString("base64");
  const c = (await page.getByTestId("note-canvas").boundingBox())!;
  const drop = (files: { name: string; type: string; b64: string }[]) =>
    page.getByTestId("note-canvas").evaluate(
      (el, { files: fs, x, y }) => {
        const dt = new DataTransfer();
        for (const f of fs)
          dt.items.add(
            new File([Uint8Array.from(atob(f.b64), (ch) => ch.charCodeAt(0))], f.name, { type: f.type }),
          );
        for (const type of ["dragenter", "dragover", "drop"])
          el.dispatchEvent(
            new DragEvent(type, {
              dataTransfer: dt,
              clientX: x,
              clientY: y,
              bubbles: true,
              cancelable: true,
            }),
          );
      },
      { files, x: c.x + 600, y: c.y + 48 },
    );
  await drop([{ name: "가상.png", type: "image/png", b64: png }]);
  await expect(images(page)).toHaveCount(1);
  expect(
    await images(page)
      .first()
      .evaluate((el) => (el as HTMLElement).style.left),
  ).toBe("600px");
  await drop([{ name: "문서.txt", type: "text/plain", b64: btoa("x") }]);
  await expect(images(page)).toHaveCount(1);
});

test("크기 손잡이(비율 유지, 최소 80) · 그림 끌어 옮기기 · 다시 누르면 크게 보기(Esc) · 삭제 → 되돌리기", async ({
  page,
}) => {
  await goW44(page);
  await page
    .getByTestId("note-image-input")
    .setInputFiles({ name: "a.png", mimeType: "image/png", buffer: await makePng(page, 600, 300) });
  const box = images(page).first();
  await expect(box).toBeFocused();
  const imgH = () =>
    box.locator("img").evaluate((el) => (el as HTMLImageElement).getBoundingClientRect().height);
  expect(Math.round(await imgH())).toBe(Math.round((470 * 300) / 600)); // 폭 480 - 테두리 2 - 안쪽 여백 8
  // 크기: 왼쪽으로 많이 → 최소 80
  const handle = box.getByRole("button", { name: "크기 조절(끌기, 비율 유지)" });
  await handle.scrollIntoViewIfNeeded(); // 도크(280px)보다 큰 그림 — 손잡이가 판 아래쪽에 있다
  const h = (await handle.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x - 1000, h.y + h.height / 2, { steps: 4 });
  await page.mouse.up();
  expect(await box.evaluate((el) => (el as HTMLElement).style.width)).toBe("80px");
  await page.keyboard.press("Control+KeyZ");
  expect(await box.evaluate((el) => (el as HTMLElement).style.width)).toBe("480px");
  // 그림을 끌어 옮기기
  const left0 = await box.evaluate((el) => parseFloat((el as HTMLElement).style.left));
  await box.locator("img").scrollIntoViewIfNeeded();
  const ib = (await box.locator("img").boundingBox())!;
  await page.mouse.move(ib.x + 50, ib.y + 50);
  await page.mouse.down();
  await page.mouse.move(ib.x + 50 + 80, ib.y + 50, { steps: 4 });
  await page.mouse.up();
  expect((await box.evaluate((el) => parseFloat((el as HTMLElement).style.left))) - left0).toBe(80);
  await expect(page.getByTestId("note-image-preview")).toHaveCount(0); // 끌기는 크게 보기가 아니다
  // 선택된 그림을 한 번 더 누르면 크게 보기
  await box.locator("img").click();
  await expect(page.getByTestId("note-image-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("note-image-preview")).toHaveCount(0);
  // 삭제 → 되돌리기
  await box.click({ position: { x: 2, y: 2 } });
  await page.keyboard.press("Delete");
  await expect(images(page)).toHaveCount(0);
  await page.getByRole("button", { name: "되돌리기" }).click();
  await expect(images(page)).toHaveCount(1);
  await expect(images(page).locator("img")).toBeVisible();
});

test("⋯ → 이미지로 저장…: .webp/.png로 저장(형식 바꿈), 다른 확장자·backups 폴더는 거부", async ({
  page,
}) => {
  await goW44(page);
  await page
    .getByTestId("note-image-input")
    .setInputFiles({ name: "a.png", mimeType: "image/png", buffer: await makePng(page, 640, 360) });
  const box = images(page).first();
  const saveAs = async (answer: string | ((d: string) => string)) => {
    page.once("dialog", (d) => void d.accept(typeof answer === "string" ? answer : answer(d.defaultValue())));
    await box.getByRole("button", { name: "상자 메뉴" }).click();
    await box.getByRole("menuitem", { name: "이미지로 저장…" }).click();
  };
  const last = () =>
    page.evaluate(() =>
      (
        globalThis as unknown as { __wjb: { lastExport(): { path: string; size: number } | null } }
      ).__wjb.lastExport(),
    );

  let defaultName = "";
  const download = page.waitForEvent("download");
  await saveAs((d) => ((defaultName = d), d));
  await download;
  expect(defaultName).toMatch(/[\\/]exports[\\/]메모이미지_2026-W44_1\.(webp|png)$/);
  await expect(page.getByText(/이미지를 저장했습니다: 메모이미지_2026-W44_1\./)).toBeVisible();
  expect((await last())?.size).toBeGreaterThan(100);

  const png = page.waitForEvent("download");
  await saveAs("/demo/WorkJourney/exports/가상.png");
  await png; // (헤드리스 브라우저는 한글 내려받기 이름을 "download"로 바꾸므로 경로는 저장 기록으로 본다)
  await expect.poll(async () => (await last())?.path).toBe("/demo/WorkJourney/exports/가상.png");

  await saveAs("/demo/WorkJourney/exports/가상.jpg");
  await expect(page.getByText("이미지 파일(.png 또는 .webp)로만 저장할 수 있습니다")).toBeVisible();
  await saveAs("/demo/WorkJourney/backups/가상.png");
  await expect(page.getByText("백업 폴더에는 내보낼 수 없습니다")).toBeVisible();
  expect((await last())?.path).toBe("/demo/WorkJourney/exports/가상.png");
});

test("그림이 아닌 파일·너무 큰 파일은 넣지 않고 안내", async ({ page }) => {
  await goW44(page);
  await page
    .getByTestId("note-image-input")
    .setInputFiles({ name: "x.png", mimeType: "image/png", buffer: Buffer.from("not an image") });
  await expect(page.getByText("그림을 읽지 못했습니다(파일이 손상되었을 수 있습니다)")).toBeVisible();
  await expect(images(page)).toHaveCount(0);
});

test("설정 > 백업에 일지 파일·메모 이미지 용량, 지운 이미지는 주를 옮길 때 일지에서도 정리", async ({
  page,
}) => {
  await goW44(page);
  await page
    .getByTestId("note-image-input")
    .setInputFiles({ name: "a.png", mimeType: "image/png", buffer: await makePng(page, 800, 450) });
  await expect(images(page)).toHaveCount(1);
  await saved(page);
  const usage = async () => {
    await page.getByRole("button", { name: "설정" }).click();
    const text = await page.getByTestId("storage-usage").textContent();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "설정" })).toHaveCount(0);
    return text ?? "";
  };
  expect(await usage()).toMatch(/^일지 파일 [\d.]+ (KB|MB) · 그 안의 메모 이미지 1개\([\d.]+ (B|KB)\)$/);
  // 지운 직후에는 되돌릴 수 있게 남겨 두고, 주를 옮기면(실행 취소 기록도 사라짐) 정리
  await images(page).first().focus();
  await page.keyboard.press("Delete");
  await expect(images(page)).toHaveCount(0);
  expect(await usage()).toContain("메모 이미지 1개");
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
  await expect.poll(usage).not.toContain("메모 이미지");
});

test("보드 칸에서 캡처를 붙이면 안내 → [메모에 붙이기]로 메모 이미지 상자(메모가 접혀 있으면 펼침)", async ({
  page,
}) => {
  await page.getByRole("button", { name: "메모 접기" }).click();
  await page.keyboard.press("Alt+KeyT"); // 보드 오늘 칸
  await expect(page.locator(":focus")).toHaveValue("테스트 데이터 이관 스크립트 작성 착수");
  await pasteImage(page, ":focus", await makePng(page, 320, 200));
  await expect(page.locator(":focus")).toHaveValue("테스트 데이터 이관 스크립트 작성 착수"); // 칸 글은 그대로
  await page.getByRole("button", { name: "메모에 붙이기" }).click();
  await expect(page.getByTestId("note-dock")).toHaveAttribute("data-dock-mode", "auto");
  await expect(images(page)).toHaveCount(1);
  await expect(page.getByTestId("note-box")).toHaveCount(1); // 예전 요일 메모 상자 아래에 붙음
});
