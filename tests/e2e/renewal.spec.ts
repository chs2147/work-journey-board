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
