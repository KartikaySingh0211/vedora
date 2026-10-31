import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E configuration for Vedora Main Dashboard.
 * Supports both standalone mock/isolated execution and live backend integration.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 45000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    extraHTTPHeaders: {
      'x-playwright-auth': 'test-runner',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // If no dev server is running, optionally spin up Next.js server
  webServer: process.env.NO_SERVER
    ? undefined
    : {
        command: 'npx next start -p 3001',
        url: 'http://127.0.0.1:3001/embed/test',
        reuseExistingServer: true,
        timeout: 60000,
        env: {
          PLAYWRIGHT_TEST: '1',
        },
      },
});
