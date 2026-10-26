// 프로덕션 빌드를 실앱 CSP(+ Tauri처럼 nonce) 아래에서 띄워, 화면 전체·메모 편집기·메모 이미지·기존 일지 가져오기·엑셀 내보내기가 CSP를 어기지 않는지.
// (vite.config.ts preview 헤더 = src-tauri/tauri.conf.json의 CSP + 가짜 nonce → 'unsafe-inline'이 무시되는 실앱과 같은 조건)
import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      (window as unknown as { __csp: string[] }).__csp.push(
        `${e.violatedDirective} ${e.blockedURI} ${e.sample}`,
      ),
    );
  });
});

/**
 * 키를 누르고, 편집기(ProseMirror)가 바뀐 선택(있음/없음)을 읽을 때까지 기다린다.
 * 편집기는 selectionchange 이벤트로 선택을 읽는데, 부하가 걸린 헤드리스 브라우저에서는 이 이벤트가 다음 키보다 늦게 올 수 있다
 * (예: → 로 선택을 접은 직후 Enter가 먼저 처리되면 선택된 글이 지워진다). TipTap은 편집기 DOM에 `editor`를 달아 둔다.
 */
async function pressAndSync(page: Page, key: string, selected: boolean) {
  await page.keyboard.press(key);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const ed = (
          document.activeElement as { editor?: { state: { selection: { empty: boolean } } } } | null
        )?.editor;
        return ed ? !ed.state.selection.empty : null;
      }),
    )
    .toBe(selected);
}

const violations = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);

test("보드·주간 메모 편집기(서식 전부)·엑셀 내보내기 — CSP 위반 0, 메모 글에 style 속성 없음", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (r) => {
    if (
      !r.url().startsWith("http://localhost:4173/") &&
      !r.url().startsWith("data:") &&
      !r.url().startsWith("blob:")
    )
      external.push(r.url());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?today=2026-10-22");
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");

  // 요일 머리 ⋯ 메뉴(자리는 CSSOM으로) → 연차 표시, 빈 칸의 직전 기록 가져오기(improve-1026-spec 1·3절)
  await page.getByTestId("day-2026-10-21").hover();
  await page.getByTestId("day-menu-2026-10-21").click();
  await page.getByRole("menuitemradio", { name: "연차(종일)" }).click();
  await expect(page.getByTestId("day-2026-10-21").getByTestId("day-mark")).toHaveText("연차");
  await page.getByTestId("cell-사내 데이터 대시보드-2026-10-22").getByTestId("pull-previous").click();
  await expect(page.getByTestId("cell-사내 데이터 대시보드-2026-10-22").locator("textarea")).toHaveCount(1);

  // 업무 태그 팝오버(자리는 CSSOM) → 새 태그 · 태그 필터 → 안내 띠 → 해제(improve-1026-spec 4~6절)
  await page.getByRole("button", { name: "차세대 정산 시스템 구축 메뉴" }).click();
  await page.getByRole("menuitem", { name: "태그…" }).click();
  await page.keyboard.type("가상태그");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await page.getByTestId("tag-filter").click();
  await page.getByRole("menuitemcheckbox", { name: /#가상태그/ }).click();
  await expect(page.getByTestId("tag-filter-banner")).toBeVisible();
  await page.getByRole("menuitem", { name: "필터 해제" }).click();

  // 메모 줌(판을 CSS scale로 — CSSOM) · 오늘 뷰 전환 후 다시 주간 뷰(improve-1026-spec 8·11절)
  await page.getByTestId("note-zoom").selectOption("0.5");
  await page.keyboard.press("Alt+KeyV");
  await expect(page.getByTestId("today-view")).toBeVisible();
  await page.getByTestId("view-week").click();
  await page.getByTestId("note-zoom").selectOption("1");

  // 기록 속 링크 보기·메모 링크 카드(improve-1026-spec 9·10절) — 링크를 눌러도 앱 창이 다른 곳으로 가지 않는다
  await page.getByTestId("cell-협력사 보안 점검-2026-10-22").locator("textarea").first().click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" https://wiki.example.local/csp");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("cell-협력사 보안 점검-2026-10-22").getByTestId("item-view")).toBeVisible();
  await page.getByTestId("note-dock").getByRole("button", { name: "링크 넣기" }).click();
  await page
    .getByTestId("link-dialog")
    .getByRole("textbox", { name: "주소", exact: true })
    .fill("https://wiki.example.local/a");
  await page.getByTestId("link-dialog").getByRole("button", { name: "넣기", exact: true }).click();
  await expect(page.getByTestId("note-link")).toHaveCount(1);

  // 메모: 새 상자 → 제목·크기·색·형광펜·굵게·체크 목록
  const canvas = page.getByTestId("note-canvas");
  const c = (await canvas.boundingBox())!;
  await page.mouse.click(c.x + 600, c.y + 80);
  // 새 상자의 편집기는 다음 프레임에 커서를 받는다 — 받은 뒤에 친다(note.spec newBoxInW44와 같음)
  await expect(page.locator(":focus")).toHaveClass(/note-prose/);
  await page.keyboard.type("가상 회의 정리");
  await page.keyboard.press("Control+Alt+Digit1");
  await page.keyboard.press("Enter");
  await page.keyboard.type("크게 쓴 글");
  await pressAndSync(page, "Shift+Home", true);
  const prose = page.locator(".note-prose").last();
  const toolbar = page.getByTestId("note-toolbar");
  // 서식마다 적용을 기다린다(선택 영역 반영 전에 다음 서식을 누르면 앞 서식이 덮일 수 있다)
  await toolbar.getByLabel("글자 크기").selectOption("xl");
  await expect(prose.locator(".note-fs-xl")).toHaveCount(1);
  await toolbar.getByLabel("글자색").selectOption("blue");
  await expect(prose.locator(".note-c-blue")).toHaveCount(1);
  await toolbar.getByRole("button", { name: "형광펜" }).click();
  await expect(prose.locator("mark.note-hl")).toHaveCount(1);
  await toolbar.getByRole("button", { name: "굵게 (Ctrl+B)" }).click();
  await expect(prose.locator("strong")).toHaveCount(1);
  await pressAndSync(page, "ArrowRight", false); // 선택 접기(글 끝으로)
  await page.keyboard.press("Enter");
  await page.keyboard.press("Control+Shift+Digit9");
  await page.keyboard.type("할 일");

  await expect(prose.locator("h1")).toHaveText("가상 회의 정리");
  await expect(
    prose.locator(".note-fs-xl.note-c-blue, .note-c-blue .note-fs-xl, .note-fs-xl .note-c-blue"),
  ).toHaveCount(1);
  await expect(prose.locator("mark.note-hl")).toHaveCount(1);
  await expect(prose.locator('ul[data-type="taskList"] li')).toHaveCount(1);
  // 우리 서식(크기·색·형광펜)은 클래스로만 — style 속성을 쓰지 않는다(실앱 CSP에서 막히는 방식).
  // (편집기가 CSSOM으로 넣는 스타일은 CSP 대상이 아니어서 아래 위반 0으로 확인한다)
  expect(
    await page
      .locator(
        ".note-prose span[data-size][style], .note-prose span[data-color][style], .note-prose mark[style]",
      )
      .count(),
  ).toBe(0);
  await expect(prose.locator('ul[data-type="taskList"] input[type="checkbox"]')).toHaveAccessibleName(
    "할 일 체크: 할 일",
  );

  // 메모 이미지(N2): 파일에서 넣기 → canvas로 줄여 WebP → data: 주소로 표시(blob: 주소는 실앱 CSP에서 막힘)
  await page.keyboard.press("Escape");
  const b64 = await page.evaluate(() => {
    const cv = document.createElement("canvas");
    [cv.width, cv.height] = [2000, 1000];
    const ctx = cv.getContext("2d")!;
    ctx.fillStyle = "#2a78d6";
    ctx.fillRect(100, 100, 800, 600);
    return cv.toDataURL("image/png").split(",")[1]!;
  });
  await page
    .getByTestId("note-image-input")
    .setInputFiles({ name: "virtual.png", mimeType: "image/png", buffer: Buffer.from(b64, "base64") });
  const img = page.getByTestId("note-image").locator("img");
  await expect(img).toHaveAttribute("src", /^data:image\/(webp|png);base64,/);
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(1600);

  // 기존 일지 가져오기(M3-S0): 양식 엑셀 만들기(ExcelJS) + 표 붙여넣기 → 미리보기 → 가져오기
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "설정" }).click();
  await page.getByRole("button", { name: "기존 일지 가져오기…" }).click();
  const wizard = page.getByTestId("import-wizard");
  page.once("dialog", (d) => void d.accept(d.defaultValue()));
  const templateDl = page.waitForEvent("download");
  await wizard.getByRole("button", { name: "양식 엑셀 받기" }).click();
  await templateDl;
  await wizard.getByRole("button", { name: "다음" }).click();
  await wizard
    .getByRole("textbox", { name: "표 붙여넣기" })
    .fill("주 시작일\t날짜\t요일\t업무\t세부\t내용\n2026-09-07\t\t화\t가상 업무\t\t가상 기록");
  await wizard.getByRole("button", { name: "붙여 넣은 표 읽기" }).click();
  await wizard.getByRole("button", { name: "가져오기" }).click();
  await expect(page.getByTestId("import-result")).toContainText("기록 1개(1주)");
  await wizard.getByRole("button", { name: "닫기" }).click();

  // 엑셀 내보내기(ExcelJS 지연 로딩 포함)
  await page.keyboard.press("Escape");
  await page.keyboard.press("Alt+KeyE");
  page.once("dialog", (d) => void d.accept(d.defaultValue()));
  const download = page.waitForEvent("download");
  await page.getByTestId("export-dialog").getByRole("button", { name: "저장 위치 선택…" }).click();
  await download;

  expect(await violations(page)).toEqual([]);
  expect(external).toEqual([]);
});

test("인사이트(경과 지도·타임라인·검색·연결 메모·월 단위) — CSP 위반 0", async ({ page }) => {
  await page.goto("/?today=2026-10-22&sample=insights");
  await expect(page.locator(":focus")).toHaveValue("테스트 데이터 이관 스크립트 작성 착수");
  await page.keyboard.press("Alt+Digit3");
  await expect(page.getByTestId("journey-map")).toBeVisible();
  await expect(page.getByTestId("timeline-week").first()).toBeVisible();
  await page.getByTestId("insight-period").selectOption("all");
  await page.getByTestId("month-folded").first().click();
  await page.getByTestId("insight-search").fill("배포");
  await page.getByTestId("memo-chip").first().click();
  await expect(page.getByTestId("memo-box")).toBeVisible();
  await page.getByTestId("journey-map").getByRole("button", { name: "월", exact: true }).click();
  await page.getByTestId("journey-map").getByRole("button", { name: "표로 보기" }).click();
  await expect(page.getByTestId("journey-map").locator("table")).toBeVisible();
  expect(await violations(page)).toEqual([]);
});
