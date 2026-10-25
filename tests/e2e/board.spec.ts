// 주간 보드·개조식 입력 E2E (i-m1-plan S3 완료 체크). 브라우저 모드, 오늘 = 2026-10-22(목, 2026-W43), 가상 샘플.
import { expect, test, type Locator, type Page } from "@playwright/test";

const TODAY = "2026-10-22";
const SETTLE = "차세대 정산 시스템 구축";
const SEC = "협력사 보안 점검";
const DASH = "사내 데이터 대시보드";
const ONB = "신규 입사자 온보딩";

const cell = (page: Page, cat: string, date: string) => page.getByTestId(`cell-${cat}-${date}`);
const inputs = (c: Locator) => c.locator("textarea");
const values = async (c: Locator) =>
  inputs(c).evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value));
/** 항목 구조: 세부 항목은 앞에 "·" */
const outline = async (c: Locator) =>
  c
    .locator("textarea")
    .evaluateAll((els) =>
      els.map(
        (e) =>
          `${e.parentElement!.className.includes("itemSub") ? "·" : ""}${(e as HTMLTextAreaElement).value}`,
      ),
    );
const saved = (page: Page) => expect(page.getByTestId("save-state")).toHaveText("저장됨 ✓");
/** 저장된 내용을 DB에서 다시 읽기: 다음 주로 갔다가 돌아온다. */
async function reloadWeek(page: Page) {
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("week-title")).toContainText("2026-W44");
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
}

test.beforeEach(async ({ page }) => {
  await page.goto(`/?today=${TODAY}`);
  await expect(page.getByTestId("week-title")).toHaveText("2026-W43 (10/19~10/25)");
});

test("열면 이번 주·오늘 열·첫 업무 칸 끝에 커서", async ({ page }) => {
  await expect(page.getByTestId(`day-${TODAY}`)).toContainText("목 10/22 · 오늘");
  await expect(page.locator(":focus")).toHaveValue("테스트 데이터 이관 스크립트 작성 착수");
  const caret = await page.locator(":focus").evaluate((e) => (e as HTMLTextAreaElement).selectionStart);
  expect(caret).toBe("테스트 데이터 이관 스크립트 작성 착수".length);
});

test("개조식 키: Enter·Shift+Enter·Tab·Shift+Tab·Backspace·Alt+↑↓·Esc", async ({ page }) => {
  const c = cell(page, DASH, TODAY);
  await c.getByRole("button", { name: "+ 기록 추가" }).click();
  await page.keyboard.type("가 항목");
  await page.keyboard.press("Enter");
  await page.keyboard.type("나 세부");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter"); // 같은 깊이(세부)로 새 항목
  await page.keyboard.type("다 세부");
  await page.keyboard.press("Shift+Tab"); // 본 항목으로
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("둘째 줄");
  expect(await outline(c)).toEqual(["가 항목", "·나 세부", "다 세부\n둘째 줄"]);

  // 빈 항목에서 Backspace → 삭제하고 위 항목 끝으로
  await page.keyboard.press("Enter");
  await page.keyboard.press("Backspace");
  expect(await outline(c)).toEqual(["가 항목", "·나 세부", "다 세부\n둘째 줄"]);
  await expect(page.locator(":focus")).toHaveValue("다 세부\n둘째 줄");

  // Alt+↑: 본 항목 "다"가 블록 "가(+나)" 위로
  await page.keyboard.press("Alt+ArrowUp");
  expect(await outline(c)).toEqual(["다 세부\n둘째 줄", "가 항목", "·나 세부"]);
  await page.keyboard.press("Alt+ArrowDown");
  expect(await outline(c)).toEqual(["가 항목", "·나 세부", "다 세부\n둘째 줄"]);

  // 첫 항목은 세부로 못 감
  await inputs(c).first().focus();
  await page.keyboard.press("Tab");
  expect((await outline(c))[0]).toBe("가 항목");

  await page.keyboard.press("Escape");
  await expect(page.locator(":focus")).toHaveCount(0);
  await saved(page);
  await reloadWeek(page);
  expect(await outline(cell(page, DASH, TODAY))).toEqual(["가 항목", "·나 세부", "다 세부\n둘째 줄"]);
});

test("칸 경계 ↑↓: 위·아래 업무 칸, 마지막 업무 아래는 주간 메모(Alt+M으로 보드 복귀)", async ({ page }) => {
  // 시작 커서: 정산·목 마지막 항목
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(":focus")).toHaveValue("점검 결과 보고서 초안 작성"); // 보안·목
  await page.keyboard.press("ArrowDown"); // 대시보드·목(빈 칸 → 빈 항목 생성)
  await page.keyboard.type("대시보드 기록");
  await page.keyboard.press("ArrowUp"); // 보안·목
  await page.keyboard.press("ArrowDown"); // 대시보드·목
  await expect(page.locator(":focus")).toHaveValue("대시보드 기록");
  await page.keyboard.press("ArrowDown"); // 온보딩·목
  await page.keyboard.press("ArrowDown"); // 주간 메모(예전 요일 메모가 든 상자, 글 끝)
  await expect(page.locator(":focus")).toHaveClass(/note-prose/);
  await expect(page.locator(":focus")).toContainText("(목) 부서 월례 회의 참석");
  await page.keyboard.press("Alt+KeyM"); // 보드로
  await expect(page.locator(":focus")).toHaveValue("테스트 데이터 이관 스크립트 작성 착수");
  // 지나온 빈 칸(온보딩)은 비어 있어야 한다
  await page.keyboard.press("Escape");
  expect(await values(cell(page, ONB, TODAY))).toEqual([]);
});

test("붙여넣기: 여러 줄은 항목으로 분해(기호 제거·들여쓰기 = 세부)", async ({ page }) => {
  const c = cell(page, ONB, TODAY);
  await c.getByRole("button", { name: "+ 기록 추가" }).click();
  await page.locator(":focus").evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", "- 계정 신청\n  · 장비 2대\n• 교육 일정 공유\n1. 멘토 지정");
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  expect(await outline(c)).toEqual(["계정 신청", "·장비 2대", "교육 일정 공유", "멘토 지정"]);
  await expect(page.locator(":focus")).toHaveValue("멘토 지정");
});

test("단축키: Alt+←/→ 주 이동, Alt+T 오늘, Alt+Y 연간 보기, Ctrl+←/→ 포커스 열", async ({ page }) => {
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page.getByTestId("week-title")).toHaveText("2026-W42 (10/12~10/18)");
  await page.keyboard.press("Alt+ArrowRight");
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("week-title")).toHaveText("2026-W44 (10/26~11/01)");
  await page.keyboard.press("Alt+KeyT");
  await expect(page.getByTestId("week-title")).toHaveText("2026-W43 (10/19~10/25)");
  await expect(page.locator(":focus")).toHaveValue("테스트 데이터 이관 스크립트 작성 착수");

  await page.keyboard.press("Alt+KeyY");
  const pop = page.getByTestId("year-minimap");
  await expect(pop).toContainText("2026 (ISO 53주)");
  await pop.getByRole("button", { name: /^2026-W40 / }).click();
  await expect(page.getByTestId("week-title")).toHaveText("2026-W40 (09/28~10/04)");
  await expect(pop).toHaveCount(0);

  await page.keyboard.press("Alt+KeyT");
  await page.keyboard.press("Escape"); // 입력 중이 아닐 때만 Ctrl+←/→
  await page.keyboard.press("Control+ArrowRight");
  await expect(page.getByTestId("day-2026-10-23")).toHaveClass(/colFocus/);
  await page.keyboard.press("Control+ArrowLeft");
  await page.keyboard.press("Control+ArrowLeft");
  await expect(page.getByTestId("day-2026-10-21")).toHaveClass(/colFocus/);
});

test("주말: 기록 있는 토요일은 넓게, 빈 일요일은 좁게 — 누르면 넓어져 입력", async ({ page }) => {
  await expect(page.getByTestId("day-2026-10-24")).toContainText("토 10/24");
  await expect(page.getByTestId("day-2026-10-25")).not.toContainText("10/25");
  const sun = cell(page, SEC, "2026-10-25");
  const narrow = (await sun.boundingBox())!.width;
  expect(narrow).toBeLessThan(60);
  await sun.click();
  await page.keyboard.type("주말 점검 대응");
  await expect(page.getByTestId("day-2026-10-25")).toContainText("일 10/25");
  expect((await sun.boundingBox())!.width).toBeGreaterThan(200);
  await saved(page);
});

test("업무 관리: 지난 주에서 추가 → 이번 주로 이월, 이름·색·순서, 종료와 되돌리기", async ({ page }) => {
  await page.keyboard.press("Alt+ArrowLeft"); // W42
  await page.getByRole("button", { name: "+ 업무 추가" }).click();
  await page.keyboard.type("분기 결산 지원");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("category-header").filter({ hasText: "분기 결산 지원" })).toBeVisible();
  await page.keyboard.press("Alt+ArrowRight"); // W43으로 이월
  const header = page.getByTestId("category-header").filter({ hasText: "분기 결산 지원" });
  await expect(header).toBeVisible();

  // 이름 바꾸기(더블클릭)
  await header.getByText("분기 결산 지원").dblclick();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("분기 결산");
  await page.keyboard.press("Enter");
  const renamed = page.getByTestId("category-header").filter({ hasText: "분기 결산" });
  await expect(renamed).toBeVisible();

  // 메뉴: 색·위로
  await renamed.getByRole("button", { name: "분기 결산 메뉴" }).click();
  await page.getByRole("button", { name: "보라" }).click();
  await expect(renamed.locator("span").first()).toHaveAttribute("style", /cat-c7/);
  await renamed.getByRole("button", { name: "분기 결산 메뉴" }).click();
  await page.getByRole("menuitem", { name: "위로" }).click();
  const names = await page.getByTestId("category-header").locator("span[class*='name']").allTextContents();
  expect(names.slice(-2)).toEqual(["분기 결산", ONB]);

  // 종료 → 흐리게 + 종료됨, 되돌리기
  await renamed.getByRole("button", { name: "분기 결산 메뉴" }).click();
  await page.getByRole("menuitem", { name: "종료" }).click();
  await expect(renamed).toContainText("종료됨");
  await page.getByRole("button", { name: "되돌리기" }).click();
  await expect(renamed).not.toContainText("종료됨");

  // 다시 종료 → 다음 주에서는 사라짐
  await renamed.getByRole("button", { name: "분기 결산 메뉴" }).click();
  await page.getByRole("menuitem", { name: "종료" }).click();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("category-header").filter({ hasText: "분기 결산" })).toHaveCount(0);
});

test("실행 취소·다시 실행 (Ctrl+Z / Ctrl+Y)", async ({ page }) => {
  const c = cell(page, SETTLE, TODAY);
  await page.keyboard.type(" 완료");
  await saved(page);
  await page.waitForTimeout(700); // 0.5초 자동 저장
  await saved(page);
  expect(await values(c)).toEqual(["테스트 데이터 이관 스크립트 작성 착수 완료"]);
  await page.keyboard.press("Control+KeyZ");
  await expect(inputs(c).first()).toHaveValue("테스트 데이터 이관 스크립트 작성 착수");
  await page.keyboard.press("Control+KeyY");
  await expect(inputs(c).first()).toHaveValue("테스트 데이터 이관 스크립트 작성 착수 완료");
  await reloadWeek(page);
  await expect(inputs(cell(page, SETTLE, TODAY)).first()).toHaveValue(
    "테스트 데이터 이관 스크립트 작성 착수 완료",
  );
});

test("한글 IME 조합 중 Enter는 글자 확정에만 쓰이고 항목을 만들지 않는다", async ({ page, browserName }) => {
  const c = cell(page, DASH, TODAY);
  await c.getByRole("button", { name: "+ 기록 추가" }).click();
  if (browserName === "chromium") {
    // Chromium(= WebView2 계열): CDP로 실제 조합 상태를 만든다
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.imeSetComposition", { text: "한", selectionStart: 1, selectionEnd: 1 });
    // 조합 중 Enter(keyCode 229) → 무시돼야 함
    for (const type of ["keyDown", "keyUp"] as const)
      await cdp.send("Input.dispatchKeyEvent", {
        type,
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 229,
      });
    await cdp.send("Input.insertText", { text: "한글" });
  } else {
    // CDP가 없는 엔진(WebKit): 조합 중 keydown(isComposing)을 직접 보낸다
    await page.keyboard.insertText("한글");
    await composingEnter(page, { isComposing: true });
  }
  expect(await values(c)).toEqual(["한글"]);
  await page.keyboard.press("Enter"); // 확정 후 Enter는 새 항목
  await page.keyboard.type("다음");
  expect(await values(c)).toEqual(["한글", "다음"]);
});

test("Safari 계열: 조합을 끝낸 직후의 Enter(keyCode 229)도 항목을 만들지 않는다", async ({ page }) => {
  const c = cell(page, DASH, TODAY);
  await c.getByRole("button", { name: "+ 기록 추가" }).click();
  await page.keyboard.insertText("한글");
  await composingEnter(page, { isComposing: false, keyCode: 229 });
  expect(await values(c)).toEqual(["한글"]);
});

/** 포커스된 입력칸에 IME가 보내는 것과 같은 Enter keydown을 보낸다(엔진 공통 — 합성 이벤트) */
async function composingEnter(page: Page, opt: { isComposing: boolean; keyCode?: number }) {
  await page.evaluate(({ isComposing, keyCode }) => {
    const el = document.activeElement!;
    const ev = new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      isComposing,
      bubbles: true,
      cancelable: true,
    });
    if (keyCode !== undefined) Object.defineProperty(ev, "keyCode", { get: () => keyCode });
    el.dispatchEvent(ev);
  }, opt);
}

test("2분 시나리오: 빈 일지에서 키보드만으로 업무 3개 × 항목 2개 + 주간 메모", async ({ page }) => {
  await page.goto(`/?today=${TODAY}&empty=1`);
  let keys = 0;
  const press = async (k: string) => {
    keys++;
    await page.keyboard.press(k);
  };
  const type = async (t: string) => {
    keys += t.length;
    await page.keyboard.type(t);
  };
  const started = Date.now();
  // 빈 일지면 업무 추가 입력칸이 열려 있다
  await expect(page.getByRole("textbox", { name: "+ 업무 추가" })).toBeFocused();
  for (const n of ["업무 가", "업무 나", "업무 다"]) {
    await type(n);
    await press("Enter");
  }
  await press("Escape");
  await press("Alt+KeyT"); // 오늘 열 첫 업무 칸으로
  for (const n of ["가", "나", "다"]) {
    await type(`${n} 첫째 진행`);
    await press("Enter");
    await type(`${n} 둘째 진행`);
    await press("ArrowDown"); // 마지막 업무 아래 ↓ → 주간 메모(상자가 없으면 새 상자)
  }
  await type("메모 한 줄");
  await press("Escape");
  await saved(page);
  const ms = Date.now() - started;
  console.log(`2분 시나리오: 키 입력 ${keys}회(글자 포함), 자동 실행 ${ms}ms`);

  await reloadWeek(page);
  for (const n of ["가", "나", "다"]) {
    expect(await values(cell(page, `업무 ${n}`, TODAY))).toEqual([`${n} 첫째 진행`, `${n} 둘째 진행`]);
  }
  await expect(page.locator(".note-prose")).toHaveText("메모 한 줄");
  // 글자 외 조작 키 = Enter×3 + Esc + Alt+T + (Enter + ↓)×3 + Esc = 12회
  expect(
    keys -
      ["업무 가", "업무 나", "업무 다"].join("").length -
      6 * "가 첫째 진행".length -
      "메모 한 줄".length,
  ).toBe(12);
});

test("업무 행 머리를 끌어서 순서 바꾸기 — 머리의 위쪽 절반에 놓으면 그 위로", async ({ page }) => {
  // 기본 창(720px)에서는 메모 도크 때문에 4번째 업무와 1번째가 한 화면에 안 들어온다 → 도크를 접고 끈다
  await page.getByRole("button", { name: "메모 접기" }).click();
  const headers = page.getByTestId("category-header");
  await headers
    .filter({ hasText: ONB })
    .dragTo(headers.filter({ hasText: SETTLE }), { targetPosition: { x: 30, y: 6 } });
  await expect(headers.first()).toContainText(ONB);
  await reloadWeek(page);
  await expect(page.getByTestId("category-header").first()).toContainText(ONB);
});

test("바로 아래 업무의 아래쪽 절반에 놓으면 한 칸 내려간다", async ({ page }) => {
  const headers = page.getByTestId("category-header");
  const names = async () =>
    (await headers.allTextContents()).map((t) => [SETTLE, SEC, DASH, ONB].find((n) => t.includes(n)));
  const before = await names();
  const second = headers.nth(1);
  const box = (await second.boundingBox())!;
  // 위쪽 절반이면 제자리(변화 없음)
  await headers.first().dragTo(second, { targetPosition: { x: 30, y: 6 } });
  expect(await names()).toEqual(before);
  // 아래쪽 절반이면 한 칸 아래로
  await headers.first().dragTo(second, { targetPosition: { x: 30, y: box.height - 6 } });
  await expect.poll(names).toEqual([before[1], before[0], ...before.slice(2)]);
});

test("업무 머리를 기록 칸에 떨어뜨려도 칸에 글자가 들어가지 않는다", async ({ page }) => {
  const target = inputs(cell(page, SEC, TODAY)).first();
  const value = await target.inputValue();
  await page.getByTestId("category-header").filter({ hasText: ONB }).dragTo(target);
  await expect(target).toHaveValue(value);
});

test("상단은 2줄 — 1줄 타이틀, 2줄 주 이동·설정", async ({ page }) => {
  const brand = (await page.getByRole("img", { name: "Work Journey Board" }).boundingBox())!;
  const week = (await page.getByTestId("week-title").boundingBox())!;
  const settings = (await page.getByRole("button", { name: "설정" }).boundingBox())!;
  expect(week.y).toBeGreaterThanOrEqual(brand.y + brand.height);
  expect(Math.abs(settings.y + settings.height / 2 - (week.y + week.height / 2))).toBeLessThan(4);
});

test("개조 부호는 점 — 본 항목 채운 점, 세부 항목 빈 점", async ({ page }) => {
  const marker = (sel: string) =>
    page
      .locator(sel)
      .first()
      .evaluate((e) => {
        const s = getComputedStyle(e, "::before");
        return {
          content: s.content,
          radius: s.borderRadius,
          bg: s.backgroundColor,
          border: s.borderTopStyle,
        };
      });
  // 부호는 각 항목의 중요 표시 단추(첫 자식)가 그린다
  const main = await marker('[class*="item_"] > button');
  expect(main.content).toBe('""');
  expect(main.radius).toBe("50%");
  expect(main.bg).not.toBe("rgba(0, 0, 0, 0)");
  const sub = await marker('[class*="itemSub"] > button');
  expect(sub.radius).toBe("50%");
  expect(sub.border).toBe("solid");
});

test("입력칸 높이가 내용에 맞는다 — 웹 글꼴 로딩 후·포커스 열 변경 후", async ({ page }) => {
  const mismatched = () =>
    page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return [...document.querySelectorAll("textarea")]
        .filter((t) => t.value && Math.abs(t.offsetHeight - t.scrollHeight) > 1)
        .map((t) => t.value);
    });
  expect(await page.evaluate(() => document.fonts.check('14px "Pretendard Variable"'))).toBe(true);
  expect(await mismatched()).toEqual([]);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+ArrowRight"); // 금요일이 넓어지고 목요일이 좁아진다
  expect(await mismatched()).toEqual([]);
});

test("업무 메뉴는 아래 행 머리·업무 추가 행보다 위에 뜬다(가려지지 않음)", async ({ page }) => {
  for (const name of [SEC, DASH]) {
    const header = page.getByTestId("category-header").filter({ hasText: name });
    await header.getByRole("button", { name: `${name} 메뉴` }).click();
    const items = page.getByRole("menu").getByRole("menuitem");
    await expect(items.last()).toBeVisible();
    // 메뉴 항목마다 그 자리(왼쪽 끝)의 맨 위 요소가 메뉴 자신이어야 한다
    for (const item of await items.all()) {
      const onTop = await item.evaluate((el) => {
        const r = el.getBoundingClientRect();
        // 아래 행 머리와 겹치는 곳은 메뉴의 왼쪽 끝 — 그 근처를 본다
        const hit = document.elementFromPoint(r.left + 6, r.top + r.height / 2);
        return hit !== null && el.contains(hit);
      });
      expect(onTop, `${name} 메뉴 "${await item.textContent()}"`).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
  }
});
