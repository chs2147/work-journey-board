// 온라인 로그인 공용 도우미 — G-8(docs/v2-design/104): 처음 [인증번호 받기] 전에 안내 동의 한 번.
import { expect, type Page } from "@playwright/test";

/** 이메일을 넣은 뒤 [인증번호 받기] — 동의 줄이 있으면 먼저 동의(동의 상태를 읽는 동안은 단추가 잠겨 있다) */
export async function requestCode(page: Page) {
  const agree = page.getByTestId("terms-agree");
  const send = page.getByRole("button", { name: "인증번호 받기" });
  await expect
    .poll(async () => (await agree.isVisible()) || (await send.isEnabled()), { timeout: 10_000 })
    .toBe(true);
  if (await agree.isVisible()) await agree.check();
  await send.click();
}
