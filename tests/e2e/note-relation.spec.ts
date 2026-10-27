// 메모 관계선 E2E(note-relation-spec): 연결점 끌어 잇기 · 취소 · 같은 쌍 · 선 도구(방향·점선·이름표·해제) · 되돌리기 ·
// 상자 옮기면 따라옴 · 상자 삭제와 함께 · 키보드 L / Shift+L · ⋯ 목록 해제 · [관계선 보기] · 줌 · 주 이동 후에도 유지.
// 브라우저 모드, 오늘 = 2026-10-22(목), 빈 주 W44에서 상자 3개를 만들어 쓴다.
import { expect, test, type Locator, type Page } from "@playwright/test";

const boxes = (page: Page) => page.getByTestId("note-box");
const edges = (page: Page) => page.getByTestId("note-edge");
/** 알림(토스트) 묶음 */
const toasts = (page: Page) => page.locator('[role="status"][aria-live="polite"]');
const saved = (page: Page) => expect(page.getByTestId("save-state")).toHaveText("저장됨 ✓");

/** W44 메모 판에 글 상자 3개: A(왼쪽 위) · B(오른쪽 위, 같은 높이) · C(왼쪽 아래) */
async function setup(page: Page) {
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("week-title")).toContainText("2026-W44");
  await expect(page.getByTestId("note-empty")).toBeVisible();
  const c = (await page.getByTestId("note-canvas").boundingBox())!;
  for (const [x, y, text] of [
    [40, 30, "가상 원인 메모"],
    [460, 30, "가상 재설계 안"],
    [40, 200, "가상 테스트 범위"],
  ] as const) {
    await page.mouse.click(c.x + x, c.y + y);
    await expect(page.locator(":focus")).toHaveClass(/note-prose/);
    await page.keyboard.type(text);
    await page.keyboard.press("Escape");
  }
  await expect(boxes(page)).toHaveCount(3);
}

const boxByText = (page: Page, text: string) => boxes(page).filter({ hasText: text });

/** from 상자의 연결점(아래)을 끌어 to 상자 위에 놓는다 */
async function dragConnect(page: Page, from: Locator, to: Locator | { x: number; y: number }) {
  await from.hover();
  const k = (await from.locator('[data-testid="edge-knob"][data-side="bottom"]').boundingBox())!;
  const t = "hover" in to ? (await to.boundingBox())! : { ...to, width: 0, height: 0 };
  await page.mouse.move(k.x + k.width / 2, k.y + k.height / 2);
  await page.mouse.down();
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 8 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?today=2026-10-22");
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
  await setup(page);
});

test("연결점을 끌어 잇기 → 화살표 한쪽 선 + 선 도구 막대 · 빈 곳에 놓으면 취소 · 같은 쌍은 하나만", async ({
  page,
}) => {
  const a = boxByText(page, "가상 원인 메모");
  const b = boxByText(page, "가상 재설계 안");
  await dragConnect(page, a, b);
  await expect(edges(page)).toHaveCount(1);
  const e = edges(page).first();
  await expect(e).toHaveAttribute("data-dir", "one");
  await expect(e).toHaveAttribute("aria-label", "관계선: 가상 원인 메모 → 가상 재설계 안");
  await expect(page.getByTestId("edge-toolbar")).toBeVisible();
  await expect(e).toBeFocused();
  // 같은 높이라 곧은 가로선
  expect((await e.getAttribute("data-d"))!).toMatch(/^M[\d.]+ [\d.]+ L[\d.]+ [\d.]+$/);

  // 빈 곳에 놓으면 아무것도 생기지 않음
  const c = (await page.getByTestId("note-canvas").boundingBox())!;
  await dragConnect(page, a, { x: c.x + 900, y: c.y + 320 });
  await expect(edges(page)).toHaveCount(1);
  // 반대 방향으로 다시 → 새로 안 만들고 알림
  await dragConnect(page, b, a);
  await expect(edges(page)).toHaveCount(1);
  await expect(toasts(page)).toContainText("이미 이어져 있습니다");
  await saved(page);
});

test("선 도구: ↔ · 점선 · 이름표 · 방향 바꾸기 · 해제(Delete) → Ctrl+Z 복구", async ({ page }) => {
  await dragConnect(page, boxByText(page, "가상 원인 메모"), boxByText(page, "가상 테스트 범위"));
  const e = edges(page).first();
  const bar = page.getByTestId("edge-toolbar");
  await bar.getByRole("button", { name: "화살표 양쪽 (↔)" }).click();
  await expect(e).toHaveAttribute("data-dir", "both");
  await bar.getByRole("button", { name: "점선" }).click();
  await expect(e).toHaveAttribute("data-dash", "");
  await bar.getByRole("button", { name: /이름표/ }).click();
  await page.getByTestId("edge-label-input").fill("원인");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("note-edge-label")).toHaveText("원인");
  await expect(e).toBeFocused();
  await expect(e).toHaveAttribute("aria-label", "관계선: 가상 원인 메모 ↔ 가상 테스트 범위, 이름 원인");
  // 세로로 떨어져 있어 아래 → 위 순서. 방향 바꾸기는 출발·도착을 맞바꾼다
  await bar.getByRole("button", { name: "화살표 한쪽 (→)" }).click();
  await bar.getByRole("button", { name: "방향 바꾸기" }).click();
  await expect(e).toHaveAttribute("aria-label", "관계선: 가상 테스트 범위 → 가상 원인 메모, 이름 원인");

  await page.keyboard.press("Delete");
  await expect(edges(page)).toHaveCount(0);
  await expect(toasts(page)).toContainText("관계선을 해제했습니다");
  await page.keyboard.press("Control+z");
  await expect(edges(page)).toHaveCount(1);
  await expect(page.getByTestId("note-edge-label")).toHaveText("원인");
});

test("상자를 옮기면 선이 따라오고(둥근 꺾은선), 상자를 지우면 선도 함께 → 되돌리기 한 번에 둘 다", async ({
  page,
}) => {
  const a = boxByText(page, "가상 원인 메모");
  const b = boxByText(page, "가상 재설계 안");
  await dragConnect(page, a, b);
  const before = await edges(page).first().getAttribute("data-d");
  // B를 아래로 옮김 → 꺾은선(Q = 둥근 모서리)
  await b.hover();
  const g = (await b.getByRole("button", { name: "상자 위치 이동(끌기)" }).boundingBox())!;
  await page.mouse.move(g.x + 40, g.y + 6);
  await page.mouse.down();
  await page.mouse.move(g.x + 40, g.y + 186, { steps: 6 });
  await page.mouse.up();
  const after = await edges(page).first().getAttribute("data-d");
  expect(after).not.toBe(before);
  expect(after).toContain("Q");

  await a.click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("Delete");
  await expect(boxes(page)).toHaveCount(2);
  await expect(edges(page)).toHaveCount(0);
  await expect(toasts(page)).toContainText("메모 상자와 관계선 1개를 지웠습니다");
  await page.getByRole("button", { name: "되돌리기" }).click();
  await expect(boxes(page)).toHaveCount(3);
  await expect(edges(page)).toHaveCount(1);
});

test("키보드: 선택한 상자에서 L → 가까운 순 번호 · Tab · Enter로 잇기 / Esc 취소 · Shift+L로 선 차례 선택", async ({
  page,
}) => {
  const c = boxByText(page, "가상 테스트 범위");
  await c.click({ position: { x: 4, y: 4 } });
  await expect(c).toBeFocused();
  await page.keyboard.press("l");
  await expect(page.getByTestId("note-linking")).toContainText("잇는 중: 가상 테스트 범위 → 가상 원인 메모");
  await expect(page.getByTestId("note-link-badge")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("note-linking")).toHaveCount(0);
  await expect(c).toBeFocused();

  await page.keyboard.press("l");
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("note-linking")).toContainText("→ 가상 재설계 안");
  await page.keyboard.press("Enter");
  await expect(edges(page)).toHaveCount(1);
  await page.keyboard.press("Escape"); // 선 선택 → 원래 상자
  await expect(c).toBeFocused();
  await page.keyboard.press("l");
  await page.keyboard.press("Digit1");
  await page.keyboard.press("Enter");
  await expect(edges(page)).toHaveCount(2);

  await page.keyboard.press("Escape");
  await expect(c).toBeFocused();
  await page.keyboard.press("Shift+L");
  const first = await page.locator(":focus").getAttribute("data-edge-id");
  expect(first).toBeTruthy();
  await page.keyboard.press("Shift+L");
  const second = await page.locator(":focus").getAttribute("data-edge-id");
  expect(second).toBeTruthy();
  expect(second).not.toBe(first);
});

test("⋯ 메뉴: [관계선 잇기…]·관계선 목록 ✕·[관계선 모두 해제] · 마우스로 고르기", async ({ page }) => {
  const a = boxByText(page, "가상 원인 메모");
  await a.hover();
  await a.getByRole("button", { name: "상자 메뉴" }).click();
  await page.getByTestId("edge-start").click();
  await expect(page.getByTestId("note-linking")).toBeVisible();
  await boxByText(page, "가상 테스트 범위").click({ position: { x: 4, y: 4 } });
  await expect(edges(page)).toHaveCount(1);
  await dragConnect(page, a, boxByText(page, "가상 재설계 안"));
  await expect(edges(page)).toHaveCount(2);

  await a.hover();
  await a.getByRole("button", { name: "상자 메뉴" }).click();
  await expect(page.getByTestId("edge-menu-row")).toHaveCount(2);
  await expect(page.getByTestId("edge-menu-row").first()).toContainText("→");
  await page.getByTestId("edge-menu-remove").first().click();
  await expect(edges(page)).toHaveCount(1);
  await a.hover();
  await a.getByRole("button", { name: "상자 메뉴" }).click();
  await page.getByTestId("edge-remove-all").click();
  await expect(edges(page)).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(edges(page)).toHaveCount(1);
});

test("[관계선 보기] 끄면 선·연결점이 숨고 다시 켜면 그대로 · 줌 50%에서도 잇기 · 주를 오가도 유지", async ({
  page,
}) => {
  await dragConnect(page, boxByText(page, "가상 원인 메모"), boxByText(page, "가상 재설계 안"));
  const toggle = page.getByRole("button", { name: "관계선 보기" });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await expect(edges(page)).toHaveCount(0);
  await boxByText(page, "가상 원인 메모").hover();
  await expect(page.getByTestId("edge-knob")).toHaveCount(0);
  await toggle.click();
  await expect(edges(page)).toHaveCount(1);

  await page.getByTestId("note-zoom").selectOption("0.5");
  await dragConnect(page, boxByText(page, "가상 재설계 안"), boxByText(page, "가상 테스트 범위"));
  await expect(edges(page)).toHaveCount(2);
  await saved(page);

  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("week-title")).toContainText("2026-W44");
  await expect(edges(page)).toHaveCount(2);
});
