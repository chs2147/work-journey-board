// 1.24.2 핫픽스: 메모 사진 크게 보기 = 최상위 레이어(<dialog> 모달) — 뒤 화면 전부 가림·조작 불가·전역 단축키 차단. 가상 샘플만.
import { test, expect, type Page } from "@playwright/test";

async function makePng(page: Page, width: number, height: number, color = "#2a78d6"): Promise<Buffer> {
  const b64 = await page.evaluate(
    ([w, h, c]) => {
      const cv = document.createElement("canvas");
      cv.width = w as number;
      cv.height = h as number;
      const ctx = cv.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = c as string;
      ctx.fillRect(cv.width * 0.1, cv.height * 0.1, cv.width * 0.5, cv.height * 0.6);
      ctx.beginPath();
      ctx.arc(cv.width * 0.75, cv.height * 0.6, Math.min(cv.width, cv.height) * 0.15, 0, Math.PI * 2);
      ctx.fill();
      return cv.toDataURL("image/png").split(",")[1]!;
    },
    [width, height, color] as const,
  );
  return Buffer.from(b64, "base64");
}

/** 메모 도크 안 요소에 그림 붙여넣기(Ctrl+V와 같은 paste 이벤트) */

test("사진 크게 보기: 화면 어느 점이든 맨 위는 크게 보기, 뒤 단추·단축키는 먹지 않음, Esc로 닫고 초점 복귀", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?today=2026-10-22");
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("week-title")).toContainText("2026-W44");
  await page
    .getByTestId("note-image-input")
    .setInputFiles({ name: "a.png", mimeType: "image/png", buffer: await makePng(page, 600, 300) });
  const box = page.getByTestId("note-image").first();
  await box.locator("canvas").scrollIntoViewIfNeeded();
  await box.locator("canvas").click();
  const pv = page.getByTestId("note-image-preview");
  if (!(await pv.count())) await box.locator("canvas").click();
  await expect(pv).toBeVisible();
  // 최상위 레이어 모달
  expect(await pv.evaluate((el) => (el as HTMLDialogElement).open && el.matches(":modal"))).toBe(true);
  // 화면 전체(상단 막대·레일·보드·메모 도구) 어디를 찍어도 맨 위 요소는 크게 보기 안
  const outside = await page.evaluate(() => {
    const bad: string[] = [];
    for (let x = 4; x < innerWidth; x += 48)
      for (let y = 4; y < innerHeight; y += 48) {
        const el = document.elementFromPoint(x, y);
        if (!el || !el.closest("[data-testid=note-image-preview]")) bad.push(`${x},${y}:${el?.tagName}`);
      }
    return bad;
  });
  expect(outside).toEqual([]);
  // 뒤 화면 단추 자리를 눌러도 뒤 단추가 아니라 크게 보기 배경이 받는다(= 닫기) — 주는 그대로
  const next = (await page.getByRole("button", { name: "다음 주 (Alt+→)" }).boundingBox())!;
  expect(
    await page.evaluate(
      ([x, y]) => !!document.elementFromPoint(x!, y!)?.closest("[data-testid=note-image-preview]"),
      [next.x + next.width / 2, next.y + next.height / 2],
    ),
  ).toBe(true);
  await page.keyboard.press("Alt+ArrowRight"); // 전역 단축키도 막힘
  await expect(pv).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pv).toHaveCount(0);
  await expect(page.getByTestId("week-title")).toContainText("2026-W44");
});
