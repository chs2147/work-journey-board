import { expect, test, type Page } from "@playwright/test";

// Universe UV1(universe-spec 4·7절): 초점 지도 · 은하 · 목록 · 필터 · 상세 · 시간 막대 · 원본 열기 · 여러 공간 읽기 전용
const TODAY = "2026-10-22";
const FIRST = "테스트 데이터 이관 스크립트 작성 착수"; // 오늘 정산 칸 첫 항목(시작 커서)

async function open(page: Page, extra = "") {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?today=${TODAY}&sample=showcase${extra}`);
  await expect(page.locator(":focus")).toHaveValue(FIRST);
}

test("Alt+5: 커서가 있는 항목이 가운데 — 상세에 원문·연결 이유, 보드 단축키는 쉬고 Alt+5로 보드로", async ({
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
  const view = page.getByTestId("universe-view");
  await expect(view).toBeVisible();
  await expect(page.getByTestId("rail-universe")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("universe-title")).toContainText("Universe");
  await expect(page.getByTestId("week-title")).toHaveCount(0);
  const detail = page.getByTestId("universe-detail");
  await expect(detail.getByTestId("u-detail-title")).toHaveText(FIRST);
  await expect(detail.getByTestId("u-original")).toContainText(FIRST);
  await expect(detail.getByTestId("u-connections")).toContainText("차세대 정산 시스템 구축");
  // 초점 지도: 가운데 항목 + 업무 + 같은 업무의 가까운 기록
  const nodes = page.getByTestId("universe-map").getByTestId("u-node");
  expect(await nodes.count()).toBeGreaterThan(3);
  await expect(nodes.filter({ hasText: "차세대 정산 시스템 구축" })).toHaveCount(1);
  await page.keyboard.press("Alt+Digit5");

  await expect(view).toHaveCount(0);
  await expect(page.getByTestId("week-title")).toBeVisible();
});

test("별을 누르면 상세가 바뀌고, 두 번 누르면 그 별이 가운데 · [원본 열기] = 보드의 그 칸 그 항목", async ({
  page,
}) => {
  await open(page);
  await page.getByTestId("rail-universe").click();
  await page.getByTestId("u-static").click();
  await page.getByTestId("u-toggle-detail").click();
  const map = page.getByTestId("universe-map");
  const other = map
    .locator('[data-testid="u-node"][data-kind="entry"]')
    .filter({ hasNotText: FIRST })
    .first();
  const title = (await other.locator("title").textContent())!.replace(/^업무 항목 · /, "");
  await other.click();
  await expect(page.getByTestId("u-detail-title")).toHaveText(title);
  await other.dblclick();
  await expect(map).toContainText(`초점: ${title.slice(0, 10)}`);
  await page.getByTestId("u-open").click();
  await expect(page.getByTestId("universe-view")).toHaveCount(0);
  await expect(page.locator(":focus")).toHaveValue(title);
});

test("업무 별 [원본 열기] = 경과 타임라인, 목록 보기에서 Enter = 원본", async ({ page }) => {
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
  await page.getByTestId("u-view-list").click();
  const rows = page.getByTestId("universe-list").getByTestId("u-row");
  expect(await rows.count()).toBeGreaterThan(10);
  const cat = rows
    .filter({ hasText: "협력사 보안 점검" })
    .filter({ has: page.locator("td", { hasText: /^\s*업무$/ }) });
  await cat.first().click();
  await expect(page.getByTestId("u-detail-title")).toHaveText("협력사 보안 점검");
  await page.getByTestId("u-open").click();
  await expect(page.getByTestId("insights-title")).toBeVisible();
  // 다시 Universe → 목록 줄에서 Enter
  await page.keyboard.press("Alt+Digit5");
  await expect(page.getByTestId("universe-view")).toBeVisible();
  {
    await page.getByTestId("u-static").click();
    for (const id of ["u-toggle-filter", "u-toggle-detail"]) {
      const toggle = page.getByTestId(id);
      if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
    }
  }
  const row = page.getByTestId("universe-list").getByTestId("u-row").filter({ hasText: FIRST }).first();
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(":focus")).toHaveValue(FIRST);
});

test("필터: 검색·종류 · 은하 보기(전체 연결망) · 시간 막대 년→월→주 확대·전체 기간", async ({ page }) => {
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
  await page.getByTestId("u-view-list").click();
  const rows = page.getByTestId("universe-list").getByTestId("u-row");
  const all = await rows.count();
  await page.getByTestId("u-search").fill("배치");
  await expect.poll(() => rows.count()).toBeLessThan(all);
  for (const t of await rows.allTextContents()) expect(t).toContain("배치");
  await page.getByTestId("u-search").fill("");
  await page.getByTestId("u-kind-entry").uncheck();
  await expect
    .poll(async () => (await rows.allTextContents()).some((t) => t.includes("업무 항목")))
    .toBe(false);
  await page.getByTestId("u-kind-entry").check();

  await page.getByTestId("u-view-map").click();
  await page.getByTestId("u-mode-galaxy").click();
  await expect(page.getByTestId("galaxy-canvas")).toBeVisible();
  await expect(page.getByTestId("universe-map")).toContainText(/전체 \d+개 · 연결 \d+개/);

  const bar = page.getByTestId("timebar");
  await expect(bar.getByTestId("tb-label")).toHaveText("2026년");
  await expect(bar.getByTestId("tb-bucket")).toHaveCount(12);
  await bar.getByTestId("tb-bucket").nth(9).click(); // 10월
  await expect(bar.getByTestId("tb-label")).toHaveText("2026년 10월");
  await expect(bar).toContainText("기간: 2026년 10월");
  await bar.getByTestId("tb-bucket").filter({ hasText: "W43" }).click();
  await expect(bar.getByTestId("tb-label")).toHaveText("2026-W43");
  await expect(bar.getByTestId("tb-bucket")).toHaveCount(7);
  await bar.getByTestId("tb-all").click();
  await expect(bar).not.toContainText("기간:");
});

test("여러 워크스페이스: 다른 공간을 켜면 읽기 전용으로 함께 · [그 공간에서 열기] = 전환 후 그 항목", async ({
  page,
}) => {
  await open(page, "&ws=2");
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
  const rows = page.getByTestId("universe-list").getByTestId("u-row");
  await expect(rows.filter({ hasText: "아침 달리기" })).toHaveCount(0);
  const toggles = page.getByTestId("u-ws-toggle");
  await expect(toggles.nth(0)).toBeDisabled(); // 지금 공간은 늘 포함
  await toggles.nth(1).check();
  const run = rows.filter({ hasText: "아침 달리기 5km" });
  await expect(run).toHaveCount(1);
  await expect(run).toContainText("개인");
  await run.click();
  await expect(page.getByTestId("universe-detail")).toContainText("개인 워크스페이스(읽기 전용)");
  await page.getByTestId("u-open").click();
  await expect(page).toHaveTitle("Work Journey Board — 개인");
  await expect(page.locator(":focus")).toHaveValue("아침 달리기 5km");
});

// ── UV2 직접 연결(universe-spec 5-1) ──
async function connect(page: Page, query: string, type: string, note = "") {
  await page.getByTestId("u-connect").click();
  const dlg = page.getByTestId("u-link-dialog");
  await expect(dlg).toBeVisible();
  await expect(dlg.getByTestId("u-link-search")).toBeFocused();
  await dlg.getByTestId("u-link-search").fill(query);
  await dlg.getByTestId("u-link-candidate").first().click();
  await dlg.getByTestId(`u-link-type-${type}`).check();
  if (note) await dlg.getByTestId("u-link-note").fill(note);
  await dlg.getByTestId("u-link-save").click();
}

test("직접 연결: [연결하기] → 대상 찾기·종류·설명 → 굵은 화살표와 문구, 같은 연결은 거부, Ctrl+Z/Ctrl+Y", async ({
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
  await connect(page, "배치 현행", "follow-up", "가상: 다음 작업");
  await expect(page.getByTestId("u-link-dialog")).toHaveCount(0);
  const phrase = page.getByTestId("u-rel-phrase");
  await expect(phrase).toHaveCount(1);
  await expect(phrase).toContainText(`「${FIRST.slice(0, 23)}`);
  await expect(phrase).toContainText("다음에");
  await expect(phrase).toContainText("가상: 다음 작업");
  await expect(page.getByTestId("u-rel-line")).toHaveAttribute("data-rel", "follow-up");
  await expect(page.getByRole("status").filter({ hasText: "직접 연결을 저장했습니다" })).toBeVisible();

  // 같은 끝·종류·방향은 한 번만
  await connect(page, "배치 현행", "follow-up");
  await expect(page.getByTestId("u-link-error")).toHaveText("같은 종류·방향의 연결이 이미 있습니다");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("u-link-dialog")).toHaveCount(0);

  // 실행 취소·다시 하기(Universe 안 = 직접 연결 작업만)
  await page.getByTestId("universe-map").click({ position: { x: 10, y: 10 } });
  await page.keyboard.press("Control+KeyZ");
  await expect(page.getByTestId("u-rel-line")).toHaveCount(0);
  await page.keyboard.press("Control+KeyY");
  await expect(page.getByTestId("u-rel-line")).toHaveCount(1);
  expect(
    await page.evaluate(() =>
      (globalThis as never as { __wjbApp: { relationCount(): Promise<number> } }).__wjbApp.relationCount(),
    ),
  ).toBe(1);
});

test("직접 연결 고치기(종류·방향·설명)·끊기 — 다시 열어도 그대로, 끊어도 원문은 그대로", async ({ page }) => {
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
  await connect(page, "배치 현행", "related");
  await expect(page.getByTestId("u-rel-phrase")).toContainText("관련");
  await page.getByTestId("u-rel-edit").click();
  const dlg = page.getByTestId("u-link-dialog");
  await expect(dlg.getByTestId("u-link-chosen")).toContainText("배치 현행");
  await dlg.getByTestId("u-link-type-supports").check();
  await dlg.getByLabel("방향 바꾸기").check();
  await dlg.getByTestId("u-link-note").fill("가상 근거");
  await dlg.getByTestId("u-link-save").click();
  const phrase = page.getByTestId("u-rel-phrase");
  await expect(phrase).toContainText("배치 현행");
  await expect(phrase).toContainText(`의 근거 — 가상 근거`);
  await expect(phrase).toHaveText(/^「정산 배치 현행/); // 방향을 바꿔 대상이 앞

  // 보드로 갔다가 다시 열어도 그대로
  await page.keyboard.press("Alt+Digit5");

  await expect(page.getByTestId("universe-view")).toHaveCount(0);
  await page.keyboard.press("Alt+Digit5");
  await expect(page.getByTestId("universe-view")).toBeVisible();
  {
    await page.getByTestId("u-static").click();
    for (const id of ["u-toggle-filter", "u-toggle-detail"]) {
      const toggle = page.getByTestId(id);
      if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
    }
  }
  await expect(page.getByTestId("u-rel-phrase")).toContainText("가상 근거");

  await page.getByTestId("u-rel-remove").click();
  await expect(page.getByTestId("u-rel-phrase")).toHaveCount(0);
  await expect(page.getByTestId("u-original")).toContainText(FIRST);
});
