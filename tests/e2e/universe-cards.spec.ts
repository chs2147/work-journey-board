// Universe UV3 지식 카드 · UV4 근거 묶음(universe-spec 5-2·5-3). 가상 샘플만.
import { expect, test, type Page } from "@playwright/test";

const TODAY = "2026-10-22";
const FIRST = "테스트 데이터 이관 스크립트 작성 착수"; // 오늘 정산 칸 첫 항목(시작 커서)
type Log = { path: string; size: number; text?: string }[];

async function open(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?today=${TODAY}&sample=showcase`);
  await expect(page.locator(":focus")).toHaveValue(FIRST);
}

async function makeCard(page: Page, title: string, extraSource = "배치 현행") {
  await page.getByTestId("u-make-card").click();
  const ed = page.getByTestId("u-card-editor");
  await expect(ed).toBeVisible();
  await ed.getByTestId("u-card-title").fill(title);
  await ed.getByTestId("u-card-summary").fill("가상 요약: 3회 재시도 후 알림");
  await ed.getByTestId("u-card-conditions").fill("가상 조건: 야간 배치");
  if (extraSource) {
    await ed.getByTestId("u-card-source-search").fill(extraSource);
    await ed.getByTestId("u-card-source-candidate").first().click();
  }
  await ed.getByTestId("u-card-save").click();
  await expect(ed).toHaveCount(0);
}

test("지식 카드: [지식 카드로 정리] → 유형·제목·요약·조건·출처 → 상세(출처 일치)·지도 마름모·보드 ◆·검색", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.press("Alt+Digit5");
  await expect(page.getByTestId("universe-view")).toBeVisible();
  {
    await page.getByTestId("u-static").click();
    for (const id of ["u-toggle-filter", "u-toggle-detail"]) {
      const toggle = page.getByTestId(id);
      if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
    }
  }
  await makeCard(page, "가상: 이관 재시도 해결법");
  const detail = page.getByTestId("universe-detail");
  await expect(detail.getByTestId("u-detail-title")).toHaveText("가상: 이관 재시도 해결법");
  await expect(detail.getByTestId("u-card-status")).toHaveText("초안");
  const srcs = detail.getByTestId("u-card-source");
  await expect(srcs).toHaveCount(2);
  await expect(srcs.first()).toHaveAttribute("data-state", "ok");
  await expect(page.getByTestId("universe-map").locator('[data-kind="card"]')).toHaveCount(1);
  // 검토함 → 상태 배지
  await detail.getByTestId("u-card-review").click();
  await expect(detail.getByTestId("u-card-status")).toHaveText("검토함");
  // 보드 ◆: 누르면 Universe에서 그 카드
  await page.keyboard.press("Alt+Digit5");
  await expect(page.getByTestId("universe-view")).toHaveCount(0);

  const badge = page.getByTestId("card-badge");
  await expect(badge).toHaveCount(1); // 이 주 보드에 보이는 출처 항목(다른 출처 10/12는 지난주)
  await page.keyboard.press("Alt+Digit5");
  await expect(page.getByTestId("universe-view")).toBeVisible();
  {
    await page.getByTestId("u-static").click();
    for (const id of ["u-toggle-filter", "u-toggle-detail"]) {
      const toggle = page.getByTestId(id);
      if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
    }
  }
  await page.keyboard.press("Alt+Digit5");
  await expect(page.getByTestId("universe-view")).toHaveCount(0);

  await badge.first().click();
  await expect(page.getByTestId("u-detail-title")).toHaveText("가상: 이관 재시도 해결법");
  // 통합 검색 결과에 카드 묶음
  await page.keyboard.press("Alt+Digit5");
  await expect(page.getByTestId("universe-view")).toHaveCount(0);

  await page.keyboard.press("Control+Shift+KeyF");
  await page.keyboard.type("재시도 해결법");
  await page.keyboard.press("Enter");
  const hit = page.getByTestId("search-card-hit");
  await expect(hit).toHaveCount(1);
  await expect(hit).toContainText("해결법 · 검토함");
  await hit.click();
  await expect(page.getByTestId("u-detail-title")).toHaveText("가상: 이관 재시도 해결법");
});

test("원문을 고치면 출처가 '내용 변경' — 당시 발췌와 지금 원문 비교 → [다시 확인] → 일치, 카드는 자동으로 바뀌지 않음", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.press("Alt+Digit5");
  await expect(page.getByTestId("universe-view")).toBeVisible();
  {
    await page.getByTestId("u-static").click();
    for (const id of ["u-toggle-filter", "u-toggle-detail"]) {
      const toggle = page.getByTestId(id);
      if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
    }
  }
  await makeCard(page, "가상: 비교 카드", "");
  // 원문 고치기(다른 창에서 고친 것과 같게 일지에서 직접) → 카드를 다시 고르면 근거 상태를 다시 읽는다
  await page.evaluate(async () => {
    const w = globalThis as unknown as { __wjbApp: { touchEntry(t: string): Promise<void> } };
    await w.__wjbApp.touchEntry("테스트 데이터 이관 스크립트 작성 착수");
  });
  await page.keyboard.press("Alt+Digit5");
  await expect(page.getByTestId("universe-view")).toHaveCount(0);

  await page.getByTestId("card-badge").first().click();
  const src = page.getByTestId("u-card-source").first();
  await expect(src).toHaveAttribute("data-state", "changed");
  await src.getByTestId("u-card-compare").click();
  const diff = src.getByTestId("u-card-diff");
  await expect(diff).toContainText(FIRST);
  await expect(diff).toContainText(`${FIRST} (가상 고침)`);
  await src.getByTestId("u-card-recheck").click();
  await expect(page.getByTestId("u-card-source").first()).toHaveAttribute("data-state", "ok");
});

test("작성 중 임시본: 닫았다 다시 [지식 카드로 정리] → [이어 쓰기]로 복구 · 지우기 → 되돌리기", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.press("Alt+Digit5");
  await expect(page.getByTestId("universe-view")).toBeVisible();
  {
    await page.getByTestId("u-static").click();
    for (const id of ["u-toggle-filter", "u-toggle-detail"]) {
      const toggle = page.getByTestId(id);
      if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
    }
  }
  await page.getByTestId("u-make-card").click();
  await page.getByTestId("u-card-title").fill("가상: 쓰다 만 카드");
  await page.waitForTimeout(1100); // 임시본 저장(0.8초 뒤)
  await page.getByTestId("u-card-cancel").click();
  await page.getByTestId("u-make-card").click();
  await expect(page.getByTestId("u-card-draft-prompt")).toBeVisible();
  await page.getByTestId("u-card-draft-resume").click();
  await expect(page.getByTestId("u-card-title")).toHaveValue("가상: 쓰다 만 카드");
  await page.getByTestId("u-card-save").click();
  await expect(page.getByTestId("u-detail-title")).toHaveText("가상: 쓰다 만 카드");
  // 다시 열면 임시본은 없다
  await page.getByTestId("u-card-delete").click();
  await expect(page.getByTestId("universe-map").locator('[data-kind="card"]')).toHaveCount(0);
  await page
    .getByRole("status")
    .filter({ hasText: "지식 카드를 지웠습니다" })
    .getByRole("button", { name: "되돌리기" })
    .last()
    .click();
  await expect(page.getByTestId("universe-map").locator('[data-kind="card"]')).toHaveCount(1);
});

test("근거 묶음: Universe·보드 메뉴에서 담기 → 레일 숫자 → 서랍(질문·순서·빼기·미리보기) → 복사·Markdown 저장", async ({
  page,
}) => {
  await open(page);
  // 보드 항목 메뉴에서 담기
  const itemId = await page
    .locator(":focus")
    .evaluate((el) => el.closest("[data-item-id]")?.getAttribute("data-item-id") ?? "");
  const row = page.locator(`[data-item-index][data-item-id="${itemId}"]`);
  await row.hover();
  await row.getByTestId("drag-row").click();
  await page.getByRole("menuitem", { name: "근거에 담기" }).click();
  await expect(page.getByTestId("pack-badge")).toHaveText("1");
  await row.locator("textarea").first().click(); // 커서를 그 항목에 두고 Universe(그 항목이 가운데)
  await page.keyboard.press("Alt+Digit5");
  await expect(page.getByTestId("universe-view")).toBeVisible();
  {
    await page.getByTestId("u-static").click();
    for (const id of ["u-toggle-filter", "u-toggle-detail"]) {
      const toggle = page.getByTestId(id);
      if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
    }
  }
  await page.getByTestId("u-pack-add").click(); // 같은 항목 → 이미 담김
  await expect(page.getByRole("status").filter({ hasText: "이미 근거 묶음에 담겨 있습니다" })).toBeVisible();
  await page
    .getByTestId("universe-map")
    .locator('[data-testid="u-node"][data-kind="cabinet"]')
    .first()
    .click();
  await page.getByTestId("u-pack-add").click();
  await expect(page.getByTestId("pack-badge")).toHaveText("2");
  await page.getByTestId("pack-toggle").click();
  const drawer = page.getByTestId("pack-drawer");
  await expect(drawer.getByTestId("pack-item")).toHaveCount(2);
  const preview = drawer.getByTestId("pack-preview");
  await expect(preview).toContainText("## 지시");
  await expect(preview).toContainText(`### S1 · 업무 항목`);
  await expect(preview).toContainText("Cabinet 경로·링크 주소는 뺐습니다.");
  // 질문 없이 복사 → 안내
  await drawer.getByTestId("pack-copy").click();
  await expect(drawer.getByTestId("pack-notice")).toHaveText("질문을 먼저 적어 주세요");
  await drawer.getByTestId("pack-question").fill("가상: 이관은 어떻게 했나?");
  await drawer.getByTestId("pack-copy").click();
  await expect(page.getByRole("status").filter({ hasText: "근거 묶음을 복사했습니다" })).toBeVisible();
  const copied = await page.evaluate(() =>
    (globalThis as unknown as { __wjb: { clipboard(): string } }).__wjb.clipboard(),
  );
  expect(copied).toContain("## 질문\n가상: 이관은 어떻게 했나?");
  expect(copied).toContain(`### S1 · 업무 항목 · 차세대 정산 시스템 구축 · ${TODAY}\n${FIRST}`);
  expect(copied).toBe(await preview.textContent());
  // 빼기 → 하나
  await drawer.getByTestId("pack-remove").last().click();
  await expect(drawer.getByTestId("pack-item")).toHaveCount(1);
  // Markdown 저장(브라우저 모드: 경로 입력)
  page.once("dialog", (d) => void d.accept("/demo/WorkJourney/exports/근거묶음_가상.md"));
  await drawer.getByTestId("pack-save").click();
  await expect(page.getByRole("status").filter({ hasText: "근거묶음_가상.md에 저장했습니다" })).toBeVisible();
  const log = await page.evaluate(() =>
    (globalThis as unknown as { __wjb: { exportLog(): Log } }).__wjb.exportLog(),
  );
  expect(log.at(-1)!.path).toBe("/demo/WorkJourney/exports/근거묶음_가상.md");
});

test("근거 묶음: 복사 직전 원문이 바뀌었으면 미리보기를 새로 만들고 다시 확인받는다", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Alt+Digit5");
  await expect(page.getByTestId("universe-view")).toBeVisible();
  {
    await page.getByTestId("u-static").click();
    for (const id of ["u-toggle-filter", "u-toggle-detail"]) {
      const toggle = page.getByTestId(id);
      if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
    }
  }
  await page.getByTestId("u-pack-add").click();
  // Universe를 닫고 보드에서 원문을 고친 뒤 다시 와서(지도는 다시 읽지 않은 채) 바로 복사
  await page.getByTestId("pack-toggle").click();
  await page.getByTestId("pack-question").fill("가상 질문");
  const before = await page.getByTestId("pack-preview").textContent();
  await page.evaluate(async () => {
    // 지도가 들고 있는 원문과 다르게 — 일지의 원문만 바꾼다(다른 창에서 고친 것과 같은 상황)
    const w = globalThis as unknown as { __wjbApp: { touchEntry(t: string): Promise<void> } };
    await w.__wjbApp.touchEntry("테스트 데이터 이관 스크립트 작성 착수");
  });
  await page.getByTestId("pack-copy").click();
  await expect(page.getByTestId("pack-notice")).toContainText("그사이 원문이 바뀌어");
  const after = await page.getByTestId("pack-preview").textContent();
  expect(after).not.toBe(before);
  expect(after).toContain("(가상 고침)");
  await page.getByTestId("pack-copy").click();
  await expect(page.getByRole("status").filter({ hasText: "근거 묶음을 복사했습니다" })).toBeVisible();
});
