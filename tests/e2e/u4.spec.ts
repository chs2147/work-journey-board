// 개선 U4 E2E(improve-1026-spec 9·10절): 업무 기록 속 링크(보기/편집, Ctrl+클릭·↗ 열기) · 메모 글 속 링크 · 링크 카드(A 오프라인).
// 브라우저 모드는 링크를 실제로 열지 않고 적어 두기만 한다(__wjb.openedUrls) — 외부 접속 없음. 가상 샘플만.
import { expect, test, type Page } from "@playwright/test";

const TODAY = "2026-10-22";
const SETTLE = "차세대 정산 시스템 구축";
const URL1 = "https://wiki.example.local/deploy/checklist";
const saved = (page: Page) =>
  expect(page.locator('[data-testid="save-state"][data-idle="true"]')).toHaveText("저장됨");
const opened = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as { __wjb: { openedUrls(): string[] } }).__wjb.openedUrls());

/** 요소에 글(text/plain) 붙여넣기 이벤트 */
async function pasteText(page: Page, selector: string, text: string) {
  await page
    .locator(selector)
    .first()
    .evaluate((el, t) => {
      const dt = new DataTransfer();
      dt.setData("text/plain", t);
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }, text);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?today=${TODAY}`);
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
});

test("기록 속 링크: 칸을 벗어나면 밑줄 링크 + ↗, Ctrl+클릭·↗ = 기본 브라우저, 그냥 클릭 = 그 자리 편집, 집계는 글자 그대로", async ({
  page,
}) => {
  const cell = page.getByTestId(`cell-${SETTLE}-${TODAY}`);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type(`배포 절차 ${URL1} 확인`);
  await page.keyboard.press("Escape");
  await saved(page);
  const view = cell.getByTestId("item-view");
  await expect(view).toHaveCount(1);
  await expect(view.locator("[data-url]")).toHaveAttribute("data-url", URL1);
  await expect(cell.locator("textarea")).toHaveCount(1); // 링크 없는 첫 항목은 그대로 입력칸

  // Ctrl+클릭 = 열기(편집으로 바뀌지 않음)
  await view.getByText(URL1).click({ modifiers: ["Control"] });
  expect(await opened(page)).toEqual([URL1]);
  await expect(cell.getByTestId("item-view")).toHaveCount(1);
  // ↗ = 열기
  await view.getByRole("button", { name: `기본 브라우저로 열기: ${URL1}` }).click();
  expect(await opened(page)).toEqual([URL1, URL1]);

  // 그냥 클릭(앞 글자 위) = 그 자리에 커서를 둔 편집
  const box = (await view.getByText("배포 절차").boundingBox())!;
  await page.mouse.click(box.x + 2, box.y + box.height / 2);
  const ta = cell.locator("textarea").nth(1);
  await expect(ta).toBeFocused();
  await expect(ta).toHaveValue(`배포 절차 ${URL1} 확인`);
  expect(await ta.evaluate((e) => (e as HTMLTextAreaElement).selectionStart)).toBeLessThanOrEqual(2);
  await page.keyboard.press("Control+End"); // 주소가 줄바꿈되므로 글 끝으로
  await page.keyboard.type(" 완료");
  await page.keyboard.press("Escape");
  await saved(page);
  await expect(cell.getByTestId("item-view")).toContainText("확인 완료");

  // 키보드로 들어오면 바로 편집(보기 → 입력칸)
  await cell.locator("textarea").first().click();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowDown");
  await expect(cell.locator("textarea").nth(1)).toBeFocused();
  await page.keyboard.press("Escape");

  // 자동 집계에는 글자 그대로
  await page.keyboard.press("Alt+KeyS");
  await expect(page.getByTestId("summary-auto")).toContainText(`- (목) 배포 절차 ${URL1} 확인 완료`);
});

test("메모 판에 주소 붙여넣기 = 링크 카드, 글 상자 안 주소 = 글 속 링크(Ctrl+클릭 열기), 집계는 `- (링크) 제목 — 주소`", async ({
  page,
}) => {
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("week-title")).toContainText("2026-W44");
  const c = (await page.getByTestId("note-canvas").boundingBox())!;
  // 빈 곳 클릭(커서 자리) → 주소 붙여넣기 → 그 자리에 카드
  await page.mouse.click(c.x + 80, c.y + 40);
  await expect(page.getByTestId("note-ghost")).toHaveCount(1);
  await pasteText(page, '[data-testid="note-ghost"] .note-prose', `  ${URL1}  `);
  const card = page.getByTestId("note-link");
  await expect(card).toHaveCount(1);
  await expect(page.getByTestId("note-ghost")).toHaveCount(0);
  await expect(card.getByTestId("link-title")).toHaveText("deploy/checklist");
  await expect(card).toContainText("wiki.example.local");

  // 두 번 눌러 제목·메모 고치기 → Enter
  await card.getByTestId("link-title").dblclick();
  const title = card.getByRole("textbox", { name: "제목(비우면 주소에서 만듦)" });
  await title.fill("가상 배포 절차 문서");
  await card.getByRole("textbox", { name: "메모(선택)" }).fill("리허설 전 확인");
  await card.getByRole("textbox", { name: "메모(선택)" }).press("Enter");
  await expect(card.getByTestId("link-title")).toHaveText("가상 배포 절차 문서");
  await expect(card).toContainText("리허설 전 확인");

  // Ctrl+클릭 카드 = 열기, ↗ = 열기
  await card.getByTestId("link-title").click({ modifiers: ["Control"] });
  await card.getByRole("button", { name: `기본 브라우저로 열기: ${URL1}` }).click();
  expect(await opened(page)).toEqual([URL1, URL1]);

  // 글 상자 안에 주소를 치면(뒤에 띄어쓰기) 글 속 링크 — 카드가 생기지 않는다
  await page.mouse.click(c.x + 500, c.y + 40);
  await page.keyboard.type("참고 https://docs.example.local/a ");
  const link = page.locator(".note-prose a.note-link");
  await expect(link).toHaveAttribute("href", "https://docs.example.local/a");
  await expect(link).not.toHaveAttribute("target");
  await expect(page.getByTestId("note-link")).toHaveCount(1);
  await link.click({ modifiers: ["Control"] });
  expect((await opened(page)).at(-1)).toBe("https://docs.example.local/a");
  await page.keyboard.press("Escape");
  await saved(page);

  // 다른 주에 다녀와도 그대로, 집계에 카드 줄
  await page.keyboard.press("Escape");
  await page.keyboard.press("Alt+ArrowLeft");
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("week-title")).toContainText("2026-W44");
  await expect(page.getByTestId("note-link").getByTestId("link-title")).toHaveText("가상 배포 절차 문서");
  await page.keyboard.press("Alt+KeyS");
  await expect(page.getByTestId("summary-auto")).toContainText(`- (링크) 가상 배포 절차 문서 — ${URL1}`);
});

test("[링크 넣기] 대화상자: 잘못된 주소는 안내, 제목을 비우면 주소에서 · 카드 끌어 옮기기·삭제·되돌리기", async ({
  page,
}) => {
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("week-title")).toContainText("2026-W44");
  await page.getByTestId("note-dock").getByRole("button", { name: "링크 넣기" }).click();
  const dlg = page.getByTestId("link-dialog");
  await dlg.getByRole("textbox", { name: "주소", exact: true }).fill("file:///C:/가상/a.exe");
  await dlg.getByRole("button", { name: "넣기", exact: true }).click();
  await expect(dlg.getByRole("alert")).toContainText("http:// 또는 https://");
  await dlg
    .getByRole("textbox", { name: "주소", exact: true })
    .fill("https://docs.example.local/guide/start");
  await dlg.getByRole("button", { name: "넣기", exact: true }).click();
  await expect(dlg).toHaveCount(0);
  const card = page.getByTestId("note-link");
  await expect(card.getByTestId("link-title")).toHaveText("guide/start");

  // 카드 몸통을 끌면 이동
  const before = await card.evaluate((el) => parseFloat((el as HTMLElement).style.left));
  const b = (await card.boundingBox())!;
  await page.mouse.move(b.x + 30, b.y + 30);
  await page.mouse.down();
  await page.mouse.move(b.x + 30 + 80, b.y + 30, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(() => card.evaluate((el) => parseFloat((el as HTMLElement).style.left)))
    .toBe(before + 80);

  // 선택 상태 Delete → 토스트 되돌리기
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("note-link")).toHaveCount(0);
  await page.getByRole("status").getByRole("button", { name: "되돌리기" }).click();
  await expect(page.getByTestId("note-link")).toHaveCount(1);
});
