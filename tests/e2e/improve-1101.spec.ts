// 릴리스 후 개선 8건 E2E(improve-1101-spec): 진단 여백 · 패널 폭 · 데일리 뷰(이름·날짜 띠·메모 크게 보기) · 가져오기 숫자 칸 ·
// 메모 글 링크 ↗ · 정보·오픈소스 라이선스 · 새 판 안내 띠. 브라우저 모드, 오늘 = 2026-10-22(목), 가상 샘플(?sample=showcase)만.
import { expect, test, type Page } from "@playwright/test";
import { openSettings } from "./settings-helper";

const openedUrls = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as { __wjb: { openedUrls(): string[] } }).__wjb.openedUrls());

async function open(page: Page, extra = "") {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/?today=2026-10-22&sample=showcase${extra}`);
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
}

test("#1 진단 정보: 카드 안 좌우·아래 여백이 다른 행과 같다", async ({ page }) => {
  await open(page);
  await openSettings(page, "update");
  await page.getByTestId("diagnostics").getByText("진단 정보 보기").click();
  await expect(page.getByTestId("diag-list")).toBeVisible();
  const pad = await page
    .getByTestId("diagnostics")
    .locator("details")
    .evaluate((el) => {
      const s = getComputedStyle(el);
      return { l: parseFloat(s.paddingLeft), b: parseFloat(s.paddingBottom) };
    });
  expect(pad.l).toBeGreaterThanOrEqual(16);
  expect(pad.b).toBeGreaterThanOrEqual(16);
});

test("#2 패널 폭: 중요 업무·주간 요약 가장자리 끌기·키보드·두 번 누르면 기본 폭, 닫았다 열어도 유지", async ({
  page,
}) => {
  await open(page);
  const panel = page.getByTestId("important-panel");
  await expect(panel).toBeVisible();
  const width = async () => (await panel.boundingBox())!.width;
  expect(Math.round(await width())).toBe(264);
  const h = page.getByTestId("important-resizer");
  const b = (await h.boundingBox())!;
  await page.mouse.move(b.x + 4, b.y + 200);
  await page.mouse.down();
  await page.mouse.move(b.x + 104, b.y + 200, { steps: 6 });
  await page.mouse.up();
  expect(Math.round(await width())).toBe(364);
  // 최대 520
  await page.mouse.move(b.x + 104, b.y + 200);
  await page.mouse.down();
  await page.mouse.move(b.x + 600, b.y + 200, { steps: 6 });
  await page.mouse.up();
  expect(Math.round(await width())).toBe(520);
  await h.focus();
  await page.keyboard.press("ArrowLeft");
  expect(Math.round(await width())).toBe(510);
  await expect(h).toHaveAttribute("aria-valuenow", "510");
  // 닫았다 열어도 그 폭
  await page.getByTestId("rail-important").click();
  await expect(panel).toHaveCount(0);
  await page.getByTestId("rail-important").click();
  expect(Math.round(await width())).toBe(510);
  await h.dblclick();
  expect(Math.round(await width())).toBe(264);

  // 주간 요약(오른쪽 패널) — 왼쪽 가장자리를 왼쪽으로 끌면 넓어짐
  await page
    .getByRole("button", { name: /주간 요약/ })
    .first()
    .click();
  const sp = page.getByTestId("summary-panel");
  await expect(sp).toBeVisible();
  expect(Math.round((await sp.boundingBox())!.width)).toBe(360);
  const sh = (await page.getByTestId("summary-resizer").boundingBox())!;
  await page.mouse.move(sh.x + 4, sh.y + 200);
  await page.mouse.down();
  await page.mouse.move(sh.x - 76, sh.y + 200, { steps: 6 });
  await page.mouse.up();
  expect(Math.round((await sp.boundingBox())!.width)).toBe(440);
});

test("#3·#4 데일리 뷰: 이름·날짜 이동(‹ 날짜 › 한 줄·하루씩·주 넘김·[오늘])·메모 크게 보기(Esc로 돌아옴)", async ({
  page,
}) => {
  await open(page);
  await expect(page.getByTestId("view-today")).toHaveAttribute("title", "데일리 뷰 · 10/22(목) (Alt+V)");
  await page.getByTestId("view-today").click();
  const date = page.getByTestId("today-date");
  await expect(date).toHaveText("10/22(목)");
  const strip = page.getByTestId("day-nav");
  // 날짜 하나·요일까지 한 줄(줄바꿈 없음)
  const box = (await date.boundingBox())!;
  expect(box.height).toBeLessThan(36); // 두 줄이면 50px 넘음
  const head = strip.locator("xpath=..");
  await expect(head.getByRole("button", { name: "오늘", exact: true })).toHaveCount(0); // 오늘이면 [오늘] 표시만
  await strip.getByRole("button", { name: "다음 날 (Alt+→)" }).click();
  await expect(date).toHaveText("10/23(금)");
  await expect(head.getByRole("button", { name: "오늘", exact: true })).toBeVisible();
  for (const want of ["10/22(목)", "10/21(수)", "10/20(화)", "10/19(월)", "10/18(일)"]) {
    await strip.getByRole("button", { name: "이전 날 (Alt+←)" }).click();
    await expect(date).toHaveText(want);
  }
  await head.getByRole("button", { name: "오늘", exact: true }).click();
  await expect(date).toHaveText("10/22(목)");

  // 메모 크게 보기 → 카드·날짜 띠 숨김, Esc로 돌아옴
  const dock = page.getByTestId("note-dock");
  await dock.getByRole("button", { name: "크게 보기" }).click();
  await expect(page.getByTestId("today-date")).toBeHidden();
  await expect(strip).toBeHidden();
  const w = (await dock.boundingBox())!.width;
  expect(w).toBeGreaterThan(1200); // 레일·중요 업무 패널을 뺀 데일리 뷰 전체
  await dock.getByRole("button", { name: "카드와 함께 보기" }).click();
  await expect(page.getByTestId("today-date")).toBeVisible();
  // Esc로도 돌아온다
  await dock.getByRole("button", { name: "크게 보기" }).click();
  await expect(strip).toBeHidden();
  await page.keyboard.press("Escape"); // [크게 보기] 단추에 포커스 — 주간 뷰와 같이 Esc로 돌아온다
  await expect(page.getByTestId("today-date")).toBeVisible();
});

test("#5 가져오기 미리보기: 가져올 항목·지금 기록이 표 숫자로(동그라미 아님)", async ({ page }) => {
  await open(page);
  await openSettings(page, "import");
  await page.getByRole("button", { name: "기존 일지 가져오기…" }).click();
  const wz = page.getByTestId("import-wizard");
  await wz.getByRole("button", { name: "다음" }).click();
  await wz
    .getByRole("textbox", { name: "표 붙여넣기" })
    .fill(
      [
        "주 시작일\t날짜\t요일\t업무\t세부\t내용",
        "2026-10-19\t2026-10-19\t월\t사내 데이터 대시보드\t\t가상 항목",
      ].join("\n"),
    );
  await wz.getByRole("button", { name: "붙여 넣은 표 읽기" }).click();
  const row = page.getByTestId("import-weeks").locator('tbody tr[data-week="2026-W43"]');
  const cells = row.locator("td");
  await expect(cells.nth(1)).toHaveText("1");
  await expect(cells.nth(2)).toHaveText("15 +메모");
  const r = await cells.nth(1).evaluate((el) => getComputedStyle(el).borderRadius);
  expect(r).toBe("0px");
  const h = (await row.boundingBox())!.height;
  expect(h).toBeLessThan(48); // 한 줄 높이(예전엔 숫자가 동그라미로 세로로 쌓였다)
});

test("#6 메모 글 링크: 끝에 ↗, 누르면 기본 브라우저(앱 안에서 열지 않음), 문서에는 저장되지 않음", async ({
  page,
}) => {
  await open(page);
  const icon = page.locator(".note-link-open").first();
  await expect(icon).toBeVisible();
  await expect(icon).toHaveAttribute(
    "title",
    "기본 브라우저에서 열기 — https://wiki.example.com/settlement/meeting-1020",
  );
  await icon.click();
  expect(await openedUrls(page)).toEqual(["https://wiki.example.com/settlement/meeting-1020"]);
  await expect(page).toHaveURL(/localhost/);
  // 장식일 뿐 — 상자 글에 ↗ 글자가 들어가지 않는다(자동 집계로 확인)
  await page
    .getByRole("button", { name: /주간 요약/ })
    .first()
    .click();
  await expect(page.getByTestId("summary-panel")).toContainText("회의록: 10/20 배치 협의");
  await expect(page.getByTestId("summary-panel")).not.toContainText("↗");
});

test("#7 정보·오픈소스 라이선스: 버전·소개 사이트·릴리스 노트(OS 브라우저), 글꼴 2종 라이선스 전문 창, 라이브러리 표", async ({
  page,
}) => {
  await open(page);
  await openSettings(page, "update");
  const about = page.getByTestId("about-card");
  await expect(about).toContainText("버전 ");
  await about.getByRole("button", { name: /소개 사이트/ }).click();
  await about.getByRole("button", { name: /이 판의 릴리스 노트/ }).click();
  const urls = await openedUrls(page);
  expect(urls[0]).toBe("https://chs2147.github.io/work-journey-board/");
  expect(urls[1]).toMatch(
    /^https:\/\/github\.com\/chs2147\/work-journey-board\/releases\/tag\/v\d+\.\d+\.\d+/,
  );
  const oss = page.getByTestId("licenses");
  await expect(oss).toContainText("Pretendard");
  await expect(oss).toContainText("© 2021 Kil Hyung-jin");
  await expect(oss).toContainText("고운돋움 (Gowun Dodum)");
  await expect(oss).toContainText("© 2021 The Gowun Dodum Project Authors");
  await expect(oss.locator("table tr")).toHaveCount(16);
  for (const library of [
    "Three.js",
    "mdast-util-from-markdown",
    "mdast-util-gfm",
    "micromark-extension-gfm",
    "htmlparser2",
    "pdf-lib",
    "@pdf-lib/fontkit",
    "Tiptap Table",
  ]) {
    await expect(oss.getByRole("rowheader", { name: library, exact: true })).toBeVisible();
  }
  await oss.getByRole("button", { name: "고운돋움 (Gowun Dodum) 라이선스 전문" }).click();
  const dlg = page.getByRole("dialog", { name: "고운돋움 (Gowun Dodum) 라이선스 전문" });
  await expect(dlg).toContainText("SIL OPEN FONT LICENSE");
  await expect(dlg).toContainText("The Gowun Dodum Project Authors");
  await dlg.getByRole("button", { name: "닫기" }).click();
  await expect(dlg).toHaveCount(0);
});

test("#8 새 판 안내 띠: 강조색 바탕·지금 판·자동 백업 안내", async ({ page }) => {
  await open(page, "&update=9.9.0");
  const banner = page.getByTestId("update-banner");
  await expect(banner).toContainText("새 판 9.9.0이(가) 있습니다");
  await expect(banner).toContainText("설치 전에 일지를 자동으로 백업합니다");
  const { bg, accent } = await banner.evaluate((el) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--accent)";
    el.appendChild(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    return { bg: getComputedStyle(el).backgroundColor, accent };
  });
  expect(bg).toBe(accent);
});
