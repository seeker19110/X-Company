import { defineConfig, devices } from "@playwright/test";

// E2E chạy trên bản build production (`next start`) với Postgres thật — xem scripts/e2e.sh.
// PW_CHROMIUM_PATH: dùng Chromium có sẵn khi phiên bản trình duyệt của Playwright chưa được cài (môi trường dev).
const executablePath = process.env.PW_CHROMIUM_PATH === "" ? undefined : process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:3100",
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    trace: "retain-on-failure",
    launchOptions: { executablePath },
  },
  projects: [
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } } },
    // Mobile: chỉ luồng chỉ đọc gắn @mobile (dữ liệu seed dùng chung, tránh hai dự án giành trạng thái).
    {
      name: "mobile-chrome",
      grep: /@mobile/,
      use: { ...devices["Pixel 7"], launchOptions: { executablePath } },
    },
  ],
  webServer: {
    command: "npx --no-install next start -p 3100",
    url: "http://localhost:3100/",
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
