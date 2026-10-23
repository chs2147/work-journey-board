import { defineConfig, devices } from "@playwright/test";

// 브라우저 모드(sql.js + 가상 샘플)로 E2E를 돌린다. WebView2와 같은 Chromium 계열.
// 로컬 환경에 미리 설치된 Chromium이 있으면 PW_CHROMIUM_PATH로 지정할 수 있다.
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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
