// 디자인 개선 v5 Y1 E2E(improve-1027v5-spec 1·2·4절): 레일 맨 아래 ⚙ → 보드 자리 설정 화면(분류 5개) ·
// 들어가기/나가기 단축키 · 테마(시스템/라이트/다크, 이 PC 설정) · 저장됨 알약. 가상 샘플만.
import { expect, test, type Page } from "@playwright/test";
import { openSettings, settingsView } from "./settings-helper";

const TODAY = "2026-10-22";
const q = (extra = "") => `/?today=${TODAY}${extra}`;
const bodyBg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme);
const LIGHT_BG = "rgb(250, 249, 245)";
const DARK_BG = "rgb(26, 26, 25)";

async function open(page: Page, extra = "") {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(q(extra));
  await expect(page.getByTestId("category-header")).toHaveCount(4);
}

test("레일 ⚙ → 보드 자리에 설정 화면 · 상단 바는 [← 주간 보드로] + 설정 · Esc로 보드(입력 칸으로)", async ({
  page,
}) => {
  await open(page);
  const start = page.locator(":focus");
  await expect(start).toHaveValue("테스트 데이터 이관 스크립트 작성 착수");
  await openSettings(page);
  await expect(page.getByTestId("rail-settings")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("rail-board")).not.toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("settings-title")).toContainText("설정");
  await expect(page.getByTestId("settings-back")).toHaveText("← 주간 보드로");
  await expect(page.getByTestId("week-title")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "주간 요약" })).toHaveCount(0);
  await expect(page.getByTestId("category-header").first()).toBeHidden();
  // 처음 열면 화면 분류, 탭에 포커스
  await expect(page.locator("#settings-tab-screen")).toBeFocused();
  await expect(page.getByTestId("settings-cat-screen")).toContainText("테마");
  // ↓ ↓ → 가져오기, End → 업데이트·정보, Home → 화면
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("#settings-tab-import")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#settings-tab-import")).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByTestId("update-settings")).toBeVisible();
  await page.keyboard.press("Home");
  await expect(page.getByTestId("theme-settings")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(settingsView(page)).toHaveCount(0);
  await expect(page.getByTestId("category-header")).toHaveCount(4);
  await expect(page.locator(":focus")).toHaveValue("테스트 데이터 이관 스크립트 작성 착수");
});

test("Ctrl+, 열고 닫기 · 설정에서 Alt+3 → 인사이트, 인사이트에서 연 설정은 [← 인사이트로] · ★는 보드로 + 패널", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.press("Control+Comma");
  await expect(settingsView(page)).toBeVisible();
  await page.keyboard.press("Control+Comma");
  await expect(settingsView(page)).toHaveCount(0);

  await page.keyboard.press("Control+Comma");
  await page.keyboard.press("Alt+3");
  await expect(settingsView(page)).toHaveCount(0);
  await expect(page.getByTestId("insights-title")).toBeVisible();
  await openSettings(page);
  await expect(page.getByTestId("insights-title")).toHaveCount(0);
  await expect(page.getByTestId("settings-back")).toHaveText("← 인사이트로");
  await page.getByTestId("settings-back").click();
  await expect(page.getByTestId("insights-title")).toBeVisible();

  await page.getByTestId("rail-board").click();
  await openSettings(page);
  await page.getByTestId("rail-important").click();
  await expect(settingsView(page)).toHaveCount(0);
  await expect(page.getByTestId("important-panel")).toBeVisible();
});

test("글 입력 칸에서 Esc는 고치던 글을 되돌리고 설정에 남는다 — 한 번 더 Esc면 보드로", async ({ page }) => {
  await open(page);
  // 태그 하나를 만들어 둔다(설정 › 업무 관리 › 태그 이름 칸)
  await page.getByRole("button", { name: "차세대 정산 시스템 구축 메뉴" }).click();
  await page.getByRole("menuitem", { name: "태그…" }).click();
  const pop = page.getByTestId("tag-popover");
  await expect(pop.getByRole("textbox")).toBeFocused();
  await page.keyboard.type("가상태그");
  await page.keyboard.press("Enter");
  await expect(pop.getByRole("menuitemcheckbox", { name: /^#가상태그/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.keyboard.press("Control+KeyA");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Escape");
  await expect(pop).toHaveCount(0);
  await openSettings(page, "work");
  const name = page.getByRole("textbox", { name: "태그 이름: 가상태그" });
  await name.fill("고치는중");
  await page.keyboard.press("Escape");
  await expect(settingsView(page)).toBeVisible();
  await expect(name).toHaveValue("가상태그");
  await page.keyboard.press("Escape");
  await expect(settingsView(page)).toHaveCount(0);
});

test("테마: 다크·라이트로 고정하면 바로 바뀌고 다시 켜도 유지 · 시스템 설정은 윈도우 값을 따름", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await open(page);
  expect(await theme(page)).toBe("light");
  expect(await bodyBg(page)).toBe(LIGHT_BG);
  await openSettings(page, "screen");
  const group = page.getByRole("radiogroup", { name: "테마" });
  await expect(group.getByRole("radio", { name: "시스템 설정" })).toBeChecked();
  await expect(group).toContainText("지금: 라이트");

  await group.getByRole("radio", { name: "다크", exact: true }).check();
  expect(await theme(page)).toBe("dark");
  expect(await bodyBg(page)).toBe(DARK_BG);
  // 다시 켜도(페이지를 다시 읽어도) 그려지기 전부터 다크 — public/theme-early.js
  await page.reload();
  await expect(page.getByTestId("category-header")).toHaveCount(4);
  expect(await theme(page)).toBe("dark");

  await openSettings(page, "screen");
  await page.getByRole("radio", { name: "라이트", exact: true }).check();
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await theme(page)).toBe("light"); // 윈도우가 다크여도 라이트

  await page.getByRole("radio", { name: "시스템 설정" }).check();
  expect(await theme(page)).toBe("dark");
  await expect(page.getByRole("radiogroup", { name: "테마" })).toContainText("지금: 다크");
  await page.emulateMedia({ colorScheme: "light" }); // 윈도우 앱 모드가 바뀌면 바로 따라감
  await expect.poll(() => theme(page)).toBe("light");
});

test("이 PC 설정(config.json)에 적힌 테마가 정본 — 사본과 달라도 config 값으로", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await open(page, "&theme=dark");
  await expect.poll(() => theme(page)).toBe("dark");
  await openSettings(page, "screen");
  await expect(page.getByRole("radio", { name: "다크", exact: true })).toBeChecked();
});

test("저장 표시: 저장됨은 초록 알약(테두리·체크) · 입력 직후에도 깜빡이지 않음", async ({ page }) => {
  await open(page);
  const pill = page.getByTestId("save-state");
  await expect(pill).toHaveText("저장됨");
  await expect(pill).toHaveAttribute("data-state", "saved");
  const look = await pill.evaluate((el) => {
    const s = getComputedStyle(el);
    return { color: s.color, border: s.borderTopColor, radius: s.borderTopLeftRadius };
  });
  expect(look.color).toBe("rgb(15, 110, 86)"); // --ok
  expect(look.border).toBe("rgb(140, 199, 178)"); // --save-ok-line
  expect(parseFloat(look.radius)).toBeGreaterThan(10);
  await expect(pill.locator("svg")).toHaveCount(1);
  await expect(pill).toHaveAttribute("title", /모든 변경이 일지 파일에 저장되었습니다/);

  await page.keyboard.type(" 가상 추가");
  await expect(page.locator('[data-testid="save-state"][data-idle="true"]')).toHaveText("저장됨");
  await expect(pill).toHaveAttribute("title", /마지막 저장 \d\d:\d\d/);
});
