import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173';
const executablePath = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: [
    'journey.spec.ts',
    'submit.spec.ts',
    'accessibility.spec.ts',
    'app-lifecycle.spec.ts',
    'share.spec.ts',
  ],
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    ...devices['iPhone 13'],
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  projects: [{ name: 'webkit', use: { browserName: 'webkit' } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'SLIME_DISABLE_HMR=1 npm run dev',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
      },
});
