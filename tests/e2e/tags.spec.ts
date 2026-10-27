// 개선 U2 E2E(improve-1026-spec 4~6절): 업무 태그(여러 개) · 태그 필터 보기 · 설정 > 태그.
// 브라우저 모드, 오늘 = 2026-10-22(목, 2026-W43), 가상 샘플만(업무 4개).
import { expect, test, type Page } from "@playwright/test";
import { openSettings } from "./settings-helper";

const SETTLE = "차세대 정산 시스템 구축";
const SEC = "협력사 보안 점검";
const DASH = "사내 데이터 대시보드";
const header = (page: Page, name: string) => page.getByTestId("category-header").filter({ hasText: name });
const chips = (page: Page, name: string) => header(page, name).getByTestId("tag-chips").locator("button");
const shownNames = (page: Page) =>
  page.getByTestId("category-header").locator("span[class*='name']").allInnerTexts();

/** 업무 ⋯ 메뉴 → 태그… → 이름마다 입력 후 Enter(새로 만들기 또는 있는 태그 붙이기) → Esc */
async function tagWith(page: Page, name: string, ...tags: string[]) {
  await header(page, name)
    .getByRole("button", { name: `${name} 메뉴` })
    .click();
  await page.getByRole("menuitem", { name: "태그…" }).click();
  const pop = page.getByTestId("tag-popover");
  await expect(pop.getByRole("textbox")).toBeFocused();
  for (const t of tags) {
    await page.keyboard.type(t);
    await page.keyboard.press("Enter");
    const shown = new RegExp(`^#${t.replace(/^#/, "")}`, "i"); // 같은 이름(대소문자·# 무시)이면 그 태그
    await expect(pop.getByRole("menuitemcheckbox", { name: shown })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Control+KeyA");
    await page.keyboard.press("Backspace");
  }
  await page.keyboard.press("Escape");
  await expect(pop).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?today=2026-10-22");
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
});

test("업무 ⋯ → 태그…: 새로 만들기(Enter)·여러 개·회색 칩, 목록에서 ↓·Space로 떼기, Ctrl+Z로 되돌림", async ({
  page,
}) => {
  await tagWith(page, SETTLE, "프로젝트A", "개발");
  await expect(chips(page, SETTLE)).toHaveText(["#프로젝트A", "#개발", "+ 태그"]);

  // 다른 업무: 있는 태그는 목록에서 고른다(수 = 그 태그가 붙은 업무 수)
  await header(page, SEC).hover();
  await header(page, SEC)
    .getByRole("button", { name: `${SEC} 태그 붙이기` })
    .click();
  const pop = page.getByTestId("tag-popover");
  await expect(pop.getByRole("menuitemcheckbox", { name: /#개발/ })).toContainText("1");
  await page.keyboard.press("ArrowDown"); // 목록 첫 줄(#프로젝트A)
  await page.keyboard.press("ArrowDown"); // #개발
  await page.keyboard.press("Space");
  await expect(pop.getByRole("menuitemcheckbox", { name: /#개발/ })).toHaveAttribute("aria-checked", "true");
  await expect(pop.getByRole("menuitemcheckbox", { name: /#개발/ })).toContainText("2");
  await page.keyboard.press("Space"); // 다시 떼기
  await expect(pop.getByRole("menuitemcheckbox", { name: /#개발/ })).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Escape");
  await expect(chips(page, SEC)).toHaveText(["+ 태그"]);

  // 보드 실행 취소 = 마지막 붙이기/떼기
  await page.keyboard.press("Control+KeyZ");
  await expect(chips(page, SEC)).toHaveText(["#개발", "+ 태그"]);

  // 같은 이름(대소문자·# 무시)은 새로 만들지 않고 그 태그를 붙인다
  await tagWith(page, DASH, "#프로젝트a");
  await expect(chips(page, DASH)).toHaveText(["#프로젝트A", "+ 태그"]);

  // 4개 이상이면 칩 3개 + "+1"
  await tagWith(page, SETTLE, "회의", "보고");
  await expect(chips(page, SETTLE)).toHaveText(["#프로젝트A", "#개발", "#회의", "+1", "+ 태그"]);
});

test("태그 필터: 하나라도 포함(OR)·안내 띠·태그 없음·다른 주에도 유지, 거른 보기에서 만든 업무는 그 태그를 단다", async ({
  page,
}) => {
  await tagWith(page, SETTLE, "프로젝트A");
  await tagWith(page, DASH, "개발");
  const filter = page.getByTestId("tag-filter");
  await expect(filter).toHaveText("태그: 전체 ▾");

  await filter.click();
  await page.getByRole("menuitemcheckbox", { name: /#프로젝트A/ }).click();
  await expect(filter).toHaveText("태그: #프로젝트A ▾");
  expect(await shownNames(page)).toEqual([SETTLE]);
  await expect(page.getByTestId("tag-filter-banner")).toContainText(
    "태그 #프로젝트A로 거른 보기 · 업무 3개 숨김",
  );

  // 둘째 태그를 더 고르면 OR
  await page.getByRole("menuitemcheckbox", { name: /#개발/ }).click();
  await expect(filter).toHaveText("태그: #프로젝트A 외 1 ▾");
  expect(await shownNames(page)).toEqual([SETTLE, DASH]);
  await page.keyboard.press("Escape");

  // 키보드 이동은 보이는 업무만: 정산 오늘 칸에서 ↓ → 대시보드 오늘 칸
  await page.getByTestId(`cell-${SETTLE}-2026-10-22`).locator("textarea").first().click();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(":focus")).toHaveAttribute("aria-label", `${DASH} · 목 2026-10-22 기록`);

  // 주간 요약은 전체 업무 + 안내 한 줄
  await page.keyboard.press("Alt+KeyS");
  await expect(page.getByTestId("summary-filter-note")).toBeVisible();
  await expect(page.getByTestId("summary-auto")).toContainText(`■ ${SEC}`);
  await page.keyboard.press("Escape");

  // 다른 주에 다녀와도 유지
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("week-title")).toContainText("2026-W44");
  await expect(filter).toHaveText("태그: #프로젝트A 외 1 ▾");
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");

  // 거른 보기에서 새 업무 → 고른 태그가 달려 바로 보인다
  await page.getByRole("button", { name: "+ 업무 추가" }).click();
  await page.keyboard.type("가상 신규 과제");
  await page.keyboard.press("Enter");
  await expect(chips(page, "가상 신규 과제")).toHaveText(["#프로젝트A", "#개발", "+ 태그"]);

  // 태그 없음만
  await filter.click();
  await page.getByRole("menuitem", { name: "필터 해제" }).click();
  await expect(filter).toHaveText("태그: 전체 ▾");
  await expect(page.getByTestId("tag-filter-banner")).toHaveCount(0);
  await filter.click();
  await page.getByRole("menuitemcheckbox", { name: /태그 없음/ }).click();
  await page.keyboard.press("Escape");
  expect(await shownNames(page)).toEqual([SEC, "신규 입사자 온보딩"]);
  await page.getByTestId("tag-filter-banner").getByRole("button", { name: "필터 해제" }).click();
  await expect(page.getByTestId("category-header")).toHaveCount(5);
});

test("설정 > 태그: 이름 바꾸기·순서·지우기(확인) — 칩·필터에 바로 반영", async ({ page }) => {
  await tagWith(page, SETTLE, "프로젝트A", "개발");
  await page.getByTestId("tag-filter").click();
  await page.getByRole("menuitemcheckbox", { name: /#개발/ }).click();
  await page.keyboard.press("Escape");

  await openSettings(page, "work");
  const list = page.getByTestId("tag-settings");
  await expect(list.locator("li")).toHaveCount(2);
  const name = list.getByRole("textbox", { name: "태그 이름: 프로젝트A" });
  await name.fill("과제A");
  await name.press("Enter");
  await expect(list.getByRole("textbox", { name: "태그 이름: 과제A" })).toBeVisible();
  // 이미 있는 이름으로는 못 바꾼다(되돌림)
  const dev = list.getByRole("textbox", { name: "태그 이름: 개발" });
  await dev.fill("과제a");
  await dev.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "이미 있는 태그" })).toBeVisible();
  await expect(list.getByRole("textbox", { name: "태그 이름: 개발" })).toHaveValue("개발");

  await list.getByRole("button", { name: "위로: #개발" }).click();
  await expect
    .poll(() => list.locator("li input").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)))
    .toEqual(["개발", "과제A"]);

  page.once("dialog", (d) => {
    expect(d.message()).toContain("업무 1개에서 떨어집니다");
    void d.accept();
  });
  await list.locator("li").first().getByRole("button", { name: "삭제" }).click();
  await expect(list.locator("li")).toHaveCount(1);
  await page.keyboard.press("Escape");

  await expect(chips(page, SETTLE)).toHaveText(["#과제A", "+ 태그"]);
  // 지운 태그로 거르던 필터는 풀린다
  await expect(page.getByTestId("tag-filter")).toHaveText("태그: 전체 ▾");
  await expect(page.getByTestId("category-header")).toHaveCount(4);
});
