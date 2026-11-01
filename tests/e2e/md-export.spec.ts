// 메모 보드 마크다운 내보내기 E2E(features-1102-spec F4): 메뉴로 열기·미리보기·옵션·기간·복사·저장(.md + _images 이미지).
// 브라우저 모드는 저장 대화상자 대신 경로 입력(prompt), 쓰기는 내려받기 + __wjb.exportLog로 확인. 가상 샘플만.
import { expect, test, type Page } from "@playwright/test";

type Log = { path: string; size: number; text?: string }[];
const exportLog = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as { __wjb: { exportLog(): Log } }).__wjb.exportLog());

test("열기 → 미리보기(연결·이미지·관계선) → 옵션 끄기 → 최근 4주·기간 지정 → 복사 → 저장(.md + 이미지 폴더)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?today=2026-10-22&sample=showcase");
  await expect(page.getByTestId("week-title")).toContainText("2026-W43");
  await page.getByTestId("snapshot-button").click();
  await page.getByRole("menuitem", { name: "마크다운으로 내보내기…" }).click();
  const dlg = page.getByTestId("md-export");
  const preview = page.getByTestId("md-preview");
  await expect(preview).toContainText("# 2026-W43 이번 주 메모 (10/19~10/25)");
  await expect(preview).toContainText("## 야간 배치 02~04시 확정");
  await expect(preview).toContainText(
    "> 연결: 차세대 정산 시스템 구축 · 10/20(화) · 배치 스케줄러 설계안 작성",
  );
  await expect(preview).toContainText(
    "![정산 배치 흐름 v2(리뷰 반영)](메모보드_2026-W43_images/box-flow.png)",
  );
  await expect(preview).toContainText("### 관계선");
  await expect(dlg).toContainText("메모보드_2026-W43_images\\ (이미지 1장)");

  await dlg.getByLabel("관계선 목록").uncheck();
  await dlg.getByLabel("연결된 업무 항목 표시(> 연결: …)").uncheck();
  await dlg.getByLabel("넣지 않음(제목·설명만)").check();
  await expect(preview).not.toContainText("### 관계선");
  await expect(preview).not.toContainText("> 연결");
  await expect(preview).not.toContainText("![");
  await dlg.getByLabel("이미지 파일을 함께 저장(옆 폴더)").check();
  await dlg.getByLabel("연결된 업무 항목 표시(> 연결: …)").check();

  await dlg.getByRole("button", { name: "최근 4주" }).click();
  await expect(dlg).toContainText("메모보드_2026-W40~W43.md");
  await dlg.getByRole("button", { name: "기간 지정" }).click();
  await dlg.getByLabel("시작 날짜").fill("2026-10-30");
  await dlg.getByLabel("끝 날짜").fill("2026-10-01");
  await expect(dlg).toContainText("기간을 확인하세요");
  await expect(page.getByTestId("md-export-save")).toBeDisabled();
  await dlg.getByRole("button", { name: /^이번 주/ }).click();

  await dlg.getByRole("button", { name: "클립보드로 복사" }).click();
  const clip = await page.evaluate(() =>
    (globalThis as unknown as { __wjb: { clipboard(): string | null } }).__wjb.clipboard(),
  );
  expect(clip).toContain("## 야간 배치 02~04시 확정");
  expect(clip).not.toContain("!["); // 복사는 이미지 빼고

  page.once("dialog", (d) => void d.accept("/demo/WorkJourney/exports/가상_메모보드.md"));
  await page.getByTestId("md-export-save").click();
  await expect(dlg).toHaveCount(0);
  await expect(page.getByText("가상_메모보드.md과 이미지 1장을 저장했습니다")).toBeVisible();
  const log = await exportLog(page);
  expect(log.map((l) => l.path)).toEqual([
    "/demo/WorkJourney/exports/가상_메모보드_images/box-flow.png",
    "/demo/WorkJourney/exports/가상_메모보드.md",
  ]);
  expect(log[0]!.size).toBeGreaterThan(1000);
  expect(log[1]!.text).toContain("![정산 배치 흐름 v2(리뷰 반영)](가상_메모보드_images/box-flow.png)");
});

test("확장자가 .md가 아니면 저장하지 않는다", async ({ page }) => {
  await page.goto("/?today=2026-10-22&sample=showcase");
  await page.getByTestId("snapshot-button").click();
  await page.getByRole("menuitem", { name: "마크다운으로 내보내기…" }).click();
  page.once("dialog", (d) => void d.accept("/demo/WorkJourney/exports/잘못.txt"));
  await page.getByTestId("md-export-save").click();
  await expect(page.getByText("마크다운(.md) 파일로만 저장할 수 있습니다")).toBeVisible();
  expect(await exportLog(page)).toEqual([]);
});
