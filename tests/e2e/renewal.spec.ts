// 디자인 리뉴얼 v1 R1 E2E(docs/renewal/design-renewal-v1.md): 시그니처 테마 — 설정에서 고르면 따뜻한 베이지 + 고운돋움,
// 라이트·다크는 Pretendard 그대로(3절 A안), 로고 색은 바뀌지 않음, 다시 켜도 유지. 가상 샘플만.
import { expect, test, type Page } from "@playwright/test";
import { openSettings } from "./settings-helper";

const look = (page: Page) =>
  page.evaluate(() => {
    const b = getComputedStyle(document.body);
    const j = document.querySelector(".wm-j");
    return {
      theme: document.documentElement.dataset.theme,
      bg: b.backgroundColor,
      color: b.color,
      font: b.fontFamily,
      journey: j ? getComputedStyle(j).fill : null,
    };
  });

test("시그니처: 베이지 바탕·고운돋움, 로고는 그대로 · 라이트로 돌리면 Pretendard · 다시 켜도 유지", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?today=2026-10-22");
  await expect(page.getByTestId("category-header")).toHaveCount(4);
  const light = await look(page);
  expect(light.font).toContain("Pretendard");

  await openSettings(page, "screen");
  const group = page.getByRole("radiogroup", { name: "테마" });
  await expect(group.getByRole("radio")).toHaveCount(4);
  await group.getByRole("radio", { name: "시그니처", exact: true }).check();
  const sig = await look(page);
  expect(sig.theme).toBe("signature");
  expect(sig.bg).toBe("rgb(237, 230, 220)"); // #ede6dc
  expect(sig.color).toBe("rgb(66, 60, 52)"); // #423c34
  expect(sig.font).toContain("Gowun Dodum");
  expect(sig.journey).toBe(light.journey); // 워드마크 Journey 색 = 라이트와 같음
  // 번들한 글꼴 파일이 실제로 읽힘(외부 호출 없이 — CSP 프로젝트에서도 같은 검사)
  await expect.poll(() => page.evaluate(() => document.fonts.check('14px "Gowun Dodum"'))).toBe(true);

  await page.reload();
  await expect(page.getByTestId("category-header")).toHaveCount(4);
  expect((await look(page)).theme).toBe("signature");

  await openSettings(page, "screen");
  await page.getByRole("radio", { name: "라이트", exact: true }).check();
  expect((await look(page)).font).toContain("Pretendard");
});

test("R2·R3 표현: 시그니처만 오늘 머리 = 작은 표식·단추 테두리 없음, 라이트·다크는 지금 그대로", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const style = () =>
    page.evaluate(() => {
      const head = document.querySelector("[class*='colToday']")!;
      const badge = head.querySelector("[class*='todayBadge']")!;
      const btn = [...document.querySelectorAll("button")].find((b) => b.textContent === "주간 요약")!;
      return {
        headBg: getComputedStyle(head).backgroundColor,
        badgeBg: getComputedStyle(badge).backgroundColor,
        btnBorder: getComputedStyle(btn).borderTopColor,
      };
    });
  for (const [theme, expected] of [
    ["light", { headBg: "rgb(24, 95, 165)", badgeBg: "rgb(255, 255, 255)", btnBorder: "rgb(180, 178, 169)" }],
    ["dark", { headBg: "rgb(109, 167, 236)", badgeBg: "rgb(11, 11, 11)", btnBorder: "rgb(85, 85, 79)" }],
    [
      "signature",
      { headBg: "rgb(243, 237, 227)", badgeBg: "rgb(232, 217, 195)", btnBorder: "rgba(0, 0, 0, 0)" },
    ],
  ] as const) {
    await page.addInitScript((t) => localStorage.setItem("wjb.theme", t), theme);
    await page.goto("/?today=2026-10-22");
    await expect(page.getByTestId("category-header")).toHaveCount(4);
    expect(await style(), theme).toEqual(expected);
  }
});
