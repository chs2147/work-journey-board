import { defineConfig, devices } from "@playwright/test";

// 메모리·주 전환 측정(optimize-1031-plan O1) — `npm run perf:mem`. 브라우저 모드 + 가상 1년치 일지(?sample=year[-img]).
// 프로세스 메모리(RSS)는 리눅스 `ps`로 읽는다(CI·클라우드 세션). 다른 OS에서는 JS 메모리·전환 시간·조회 수만 본다.
// 한 번에 한 테스트만(프로세스 메모리를 합산하므로).
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "tests/perf",
  workers: 1,
  timeout: 30 * 60_000,
  reporter: "list",
  use: {
    baseURL: "http://localhost:1420",
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        launchOptions: { executablePath },
      },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
