import { defineConfig, devices } from "@playwright/test";

// 브라우저 모드(sql.js + 가상 샘플)로 E2E를 돌린다.
// - chromium: WebView2(회사 PC 실앱)와 같은 엔진 계열 — 기준
// - webkit: Safari 엔진. 화면 코드의 엔진 차이(특히 한글 조합 중 키 처리)를 미리 잡는 보험(Mac 지원 아님, i-m1-plan S5)
// 로컬 환경에 미리 설치된 Chromium이 있으면 PW_CHROMIUM_PATH로 지정할 수 있다.
// WebKit을 받을 수 없는 환경(클라우드 세션 등)에서는 `npm run e2e:chromium`. CI는 두 엔진 모두 돌린다.
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:1420",
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
