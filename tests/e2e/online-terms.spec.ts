// G-8(docs/v2-design/104) 개인정보 안내 · 이용 안내 — 첫 로그인 전 동의 한 번, 설정 › 계정에서 다시 보기.
// 브라우저 모드 가짜 서버(외부 요청 없음). 동의는 이 기기 설정(config.json onlineTerms)에만.
import { expect, test } from "@playwright/test";
import { CONTACT } from "../../src/shared/onlineTerms";

const EMAIL = "virtual@example.invalid";
const external = (requests: string[]) =>
  requests.filter((u) => !/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u) && !u.startsWith("data:"));

test("첫 로그인: 동의 전에는 [인증번호 받기] 잠김 → 안내 대화상자(두 탭·Esc·닫기) → 동의하면 받기, 다음부터는 묻지 않음", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto("/?profile=connected-preview");
  await page.getByTestId("preview-email-input").fill(EMAIL);
  const send = page.getByRole("button", { name: "인증번호 받기" });
  const agree = page.getByTestId("terms-agree");
  await expect(agree).toBeVisible();
  await expect(agree).not.toBeChecked();
  await expect(send).toBeDisabled();
  // 동의 줄이 있는 동안은 "다시 보기" 줄을 따로 두지 않는다
  await expect(page.getByTestId("terms-state")).toHaveCount(0);

  // 개인정보 안내 → 이용 안내 탭 → Esc로 닫기(뒤 화면은 그대로)
  await page.getByTestId("terms-open-privacy").click();
  const dialog = page.getByTestId("terms-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { level: 2 })).toHaveText(
    "개인정보 안내 — Work Journey Board 온라인 기능",
  );
  await expect(dialog.getByText("Supabase(일본 도쿄 지역)", { exact: false })).toBeVisible();
  await expect(dialog.getByTestId("terms-tab-privacy")).toHaveAttribute("aria-selected", "true");
  await dialog.getByTestId("terms-tab-terms").click();
  await expect(dialog.getByRole("heading", { level: 2 })).toHaveText("온라인 기능 이용 안내");
  await expect(
    dialog.getByText("그림 100MB · 온라인 워크스페이스 3개 · 기록 30MB", { exact: false }),
  ).toBeVisible();
  // 문의 이메일(출시 판) — 자리 표시가 남지 않는다
  await expect(dialog.getByText(CONTACT as string, { exact: true })).toBeVisible();
  await expect(dialog.getByText("[문의 이메일]")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("preview-email-input")).toHaveValue(EMAIL);

  await page.getByTestId("terms-open-terms").click();
  await expect(page.getByTestId("terms-tab-terms")).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("terms-close").click();
  await expect(page.getByTestId("terms-dialog")).toHaveCount(0);

  // 동의 → 받기 → 로그인
  await agree.check();
  await expect(send).toBeEnabled();
  await send.click();
  await page.getByTestId("preview-code-input").fill("12345678");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page.getByTestId("preview-email")).toHaveText(EMAIL);
  // 로그인 뒤: 다시 보기 줄 = 동의한 날
  await expect(page.getByTestId("terms-state")).toHaveText(/^동의함 · /);
  await page.getByTestId("terms-open-privacy").click();
  await expect(page.getByTestId("terms-dialog")).toBeVisible();
  await page.getByTestId("terms-close").click();

  // 로그아웃 → 다시 로그인할 때는 묻지 않음
  await page.getByTestId("preview-sign-out").click();
  await page.getByTestId("preview-email-input").fill(EMAIL);
  await expect(page.getByTestId("terms-agree")).toHaveCount(0);
  await expect(page.getByTestId("terms-state")).toHaveText(/^동의함 · /);
  await expect(send).toBeEnabled();

  expect(external(requests)).toEqual([]);
});

test("DEV 통합 앱 설정 › 계정: 로그인 전 동의 줄, 안내 대화상자 Esc는 설정 화면을 닫지 않음", async ({
  page,
}) => {
  await page.goto("/?profile=local-dev&fresh=1");
  await page.getByTestId("dev-opt-sample").check();
  await page.getByTestId("dev-start").click();
  await expect(page.getByTestId("rail-settings")).toBeEnabled();
  await page.getByTestId("workspace-button").click();
  await page.getByTestId("workspace-menu").getByTestId("online-sign-in").click();
  await expect(page.getByTestId("settings-cat-account")).toBeVisible();
  await expect(page.getByTestId("terms-agree")).toBeVisible();
  await page.getByTestId("terms-open-terms").click();
  await expect(page.getByTestId("terms-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("terms-dialog")).toHaveCount(0);
  await expect(page.getByTestId("settings-cat-account")).toBeVisible();
  await expect(page.getByTestId("terms-agree")).toBeVisible();
});
