// Cabinet E2E(features-1102-spec F5): 레일·Alt+4로 열기, 업무별 묶음·[전체·폴더·링크] 거르기, 폴더 창(이동·열기·숨김),
// 링크 끌어 놓기 등록(브라우저가 준 제목·고치기), 폴더 끌어 놓기(파일은 거부), 제목 고치기(F2)·등록 해제·되돌리기, 보드 🗂 표시, 검색.
// 브라우저 모드는 폴더 창을 앱 안 창으로, 파일 열기는 __wjb.cabinetCalls로 확인(실제로 열지 않음). 가상 샘플·가상 경로만.
import { expect, test, type Page } from "@playwright/test";

const calls = (page: Page) =>
  page.evaluate(() =>
    (globalThis as unknown as { __wjb: { cabinetCalls(): string[] } }).__wjb.cabinetCalls(),
  );

async function open(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?today=2026-10-22&sample=showcase");
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
}

/** 브라우저에서 끌어 놓기 흉내: DataTransfer에 글 자료·파일 이름을 넣어 drop 이벤트를 보낸다 */
async function drop(page: Page, testId: string, data: Record<string, string>, files: string[] = []) {
  await page.getByTestId(testId).evaluate(
    (el, { data, files }) => {
      const dt = new DataTransfer();
      for (const [k, v] of Object.entries(data)) dt.setData(k, v);
      for (const f of files) dt.items.add(new File([""], f));
      el.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
      el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    },
    { data, files },
  );
}

test("Alt+4로 열기 → 업무별 묶음·거르기 → 폴더 창 이동·파일 열기 → 레일로 닫기", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Alt+4");
  const cab = page.getByTestId("cabinet");
  await expect(cab).toBeVisible();
  await expect(page.getByTestId("cabinet-group-title")).toHaveText("차세대 정산 시스템 구축");
  await expect(page.getByTestId("cabinet-filter-all")).toHaveText(/전체 5/);
  await expect(page.getByTestId("cabinet-filter-folder")).toHaveText(/폴더 3/);
  await page.getByTestId("cabinet-filter-link").click();
  await expect(page.getByTestId("cabinet-row")).toHaveCount(2);
  await expect(page.getByTestId("cabinet-row").first()).toHaveAttribute("data-kind", "link");
  // 링크를 누르면 기본 브라우저(브라우저 모드는 기록만)
  await page.getByTestId("cabinet-row").first().click();
  expect(
    await page.evaluate(() =>
      (globalThis as unknown as { __wjb: { openedUrls(): string[] } }).__wjb.openedUrls(),
    ),
  ).toContain("https://wiki.example.com/settlement/batch-design");

  await page.getByTestId("cabinet-group-cat-sec").click();
  await page.getByTestId("cabinet-filter-all").click();
  await expect(page.getByTestId("cabinet-row-title")).toHaveText(["계정 점검표", "보안 점검 가이드"]);

  // 폴더 창: 두 번 누르기 → 하위 폴더 들어가기 → 위로·뒤로 → 파일 열기
  await page.getByTestId("cabinet-group-cat-settle").click();
  await page.getByTestId("cabinet-row").filter({ hasText: "배치 테스트 자료" }).dblclick();
  const win = page.getByTestId("folder-window");
  await expect(win).toBeVisible();
  await expect(page.getByTestId("cabinet-row").filter({ hasText: "배치 테스트 자료" })).toContainText("열림");
  await expect(win.getByTestId("folder-row")).toHaveCount(2);
  await win.locator('[data-testid="folder-row"][data-name="2026-10 이관"]').dblclick();
  await expect(win.getByTestId("folder-crumbs")).toContainText("2026-10 이관");
  // 폴더 먼저, 이름순 — 숨김 파일(.임시)은 기본 숨김
  await expect(win.getByTestId("folder-row")).toHaveCount(5);
  await expect(win.getByTestId("folder-row").first()).toHaveAttribute("data-name", "샘플 데이터");
  await win.getByRole("button", { name: "숨김 파일 1개 보기" }).click();
  await expect(win.getByTestId("folder-row")).toHaveCount(6);
  await win.locator('[data-testid="folder-row"][data-name="검증표.xlsx"]').dblclick();
  await expect.poll(() => calls(page)).toContain("open /demo/업무/정산/테스트/2026-10 이관/검증표.xlsx");
  await win.getByTestId("folder-up").click();
  await expect(win.getByTestId("folder-row")).toHaveCount(2);
  await win.getByTestId("folder-back").click();
  await expect(win.getByTestId("folder-crumbs")).toContainText("2026-10 이관");
  await win.getByTestId("folder-reveal").click();
  await expect.poll(() => calls(page)).toContain("reveal /demo/업무/정산/테스트/2026-10 이관");
  await win.getByTestId("folder-close").click();
  await expect(win).toHaveCount(0);

  await page.getByTestId("rail-cabinet").click();
  await expect(cab).toHaveCount(0);
});

test("링크 끌어 놓기 → 브라우저가 준 제목(고치기) → Enter 등록 → 검색에 Cabinet · 링크", async ({ page }) => {
  await open(page);
  await page.getByTestId("rail-cabinet").click();
  await drop(page, "cabinet-drop", {
    "text/uri-list": "https://wiki.example.com/settlement/batch-ops",
    "text/html":
      '<a href="https://wiki.example.com/settlement/batch-ops">정산 배치 운영 가이드 - 사내 위키</a>',
  });
  const dlg = page.getByTestId("cabinet-link-dialog");
  await expect(dlg).toContainText("끌어 놓은 링크");
  await expect(dlg).toContainText("브라우저가 함께 준 페이지 제목");
  await expect(page.getByTestId("cabinet-link-title")).toHaveValue("정산 배치 운영 가이드 - 사내 위키");
  await expect(page.getByTestId("cabinet-link-chips")).toContainText("차세대 정산 시스템 구축");
  await page.getByTestId("cabinet-link-title").fill("배치 운영 가이드");
  await page.getByTestId("cabinet-link-title").press("Enter");
  await expect(dlg).toHaveCount(0);
  await expect(page.getByTestId("cabinet-filter-link")).toHaveText(/링크 3/);
  await expect(page.getByTestId("cabinet-row-title")).toContainText(["배치 운영 가이드"]);

  // 제목이 없는 링크(주소만) → 주소로 만든 이름, http/https가 아니면 거부
  await drop(page, "cabinet-drop", { "text/uri-list": "https://monitor.example.local/batch/history" });
  await expect(page.getByTestId("cabinet-link-title")).toHaveValue("monitor.example.local › history");
  await page.getByTestId("cabinet-link-title").press("Escape");
  await expect(dlg).toHaveCount(0);
  await drop(page, "cabinet-drop", { "text/plain": "file:///C:/Windows" });
  await expect(page.getByText("http·https 링크만 등록할 수 있습니다")).toBeVisible();

  await page.keyboard.press("Control+Shift+F");
  await page.keyboard.type("운영 가이드");
  await page.keyboard.press("Enter");
  const hit = page.getByTestId("search-cabinet-hit");
  await expect(hit).toHaveCount(1);
  await expect(hit).toContainText("Cabinet · 링크");
  await page.getByTestId("cabinet-close").click();
  await hit.click();
  await expect(page.getByTestId("cabinet")).toBeVisible();
  await expect(
    page.locator('[data-testid="cabinet-row"]').filter({ hasText: "배치 운영 가이드" }),
  ).toBeVisible();
});

test("폴더 끌어 놓기(파일은 거부) → F2 제목 고치기 → 연결 고치기 → 등록 해제·되돌리기", async ({ page }) => {
  await open(page);
  await page.getByTestId("rail-cabinet").click();
  await drop(page, "cabinet-drop", {}, ["검증표.xlsx"]);
  await expect(page.getByText("폴더만 등록할 수 있습니다 (파일은 등록하지 않음)")).toBeVisible();
  await drop(page, "cabinet-drop", {}, ["2026-10 이관"]);
  await expect(page.getByText("Cabinet에 1개 등록했습니다")).toBeVisible();
  const row = page.getByTestId("cabinet-row").filter({ hasText: "2026-10 이관" });
  await expect(row).toContainText("/demo/업무/정산/테스트/2026-10 이관");

  await row.focus();
  await page.keyboard.press("F2");
  await page.getByTestId("cabinet-rename").fill("10월 이관 자료");
  await page.keyboard.press("Enter");
  const renamed = page.getByTestId("cabinet-row").filter({ hasText: "10월 이관 자료" });
  await expect(renamed).toBeVisible();

  // 연결 고치기: 협력사 보안 점검에도 연결 → 그 묶음에도 보인다
  await renamed.getByTestId("cabinet-row-more").click();
  await page.getByTestId("cabinet-menu-links").click();
  await page.getByTestId("cabinet-link-cat-cat-sec").check();
  await page.getByTestId("cabinet-links-save").click();
  await page.getByTestId("cabinet-group-cat-sec").click();
  await expect(page.getByTestId("cabinet-row-title")).toContainText(["10월 이관 자료"]);

  await page
    .getByTestId("cabinet-row")
    .filter({ hasText: "10월 이관 자료" })
    .getByTestId("cabinet-row-more")
    .click();
  await page.getByTestId("cabinet-menu-remove").click();
  await expect(page.getByText("‘10월 이관 자료’ 등록을 해제했습니다 (폴더·파일은 그대로)")).toBeVisible();
  await expect(page.getByTestId("cabinet-row").filter({ hasText: "10월 이관 자료" })).toHaveCount(0);
  await page.getByRole("button", { name: "되돌리기" }).click();
  await expect(page.getByTestId("cabinet-row").filter({ hasText: "10월 이관 자료" })).toBeVisible();
});

test("보드: 연결된 항목 옆 🗂(여럿이면 Cabinet에서 강조) · 업무 머리 ⋯ › Cabinet 열기", async ({ page }) => {
  await open(page);
  const review = page.locator('[data-item-id="it-review"]');
  await expect(review.getByTestId("cabinet-badge")).toBeVisible();
  await review.getByTestId("cabinet-badge").click();
  await expect(page.getByTestId("cabinet")).toBeVisible();
  await expect(page.getByTestId("cabinet-group-title")).toHaveText("차세대 정산 시스템 구축");
  await page.getByTestId("cabinet-close").click();

  // 하나만 연결된 항목(계정 관리 미흡)은 그 폴더 창을 바로
  await page.locator('[data-item-id="it-acct"]').getByTestId("cabinet-badge").click();
  await expect(page.getByTestId("folder-window")).toContainText("계정 점검표.xlsx");
  await page.getByTestId("folder-close").click();

  await page.getByRole("button", { name: /협력사 보안 점검 메뉴/ }).click();
  await page.getByTestId("category-cabinet").click();
  await expect(page.getByTestId("cabinet-group-title")).toHaveText("협력사 보안 점검");
});
