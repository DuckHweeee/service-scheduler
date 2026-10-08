import { defineConfig, devices } from '@playwright/test';

/**
 * Browser: Playwright's bundled Chromium by default. Set `PW_CHROME_PATH` to launch another Chrome/Chromium
 * executable instead (e.g. `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` on macOS 12, where the
 * bundled build cannot be installed).
 *
 * The whole stack (Postgres, API, Vite) is started on free ports by `e2e/support/global-setup.ts`, which publishes
 * the web URL in `E2E_WEB_URL`; the `test` fixture in `e2e/support/test.ts` turns it into `baseURL`.
 */
const executablePath = process.env.PW_CHROME_PATH || undefined;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/support/global-setup.ts',
  // One shared database: specs run in file order, one at a time.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    ...devices['Desktop Chrome'],
    launchOptions: executablePath ? { executablePath } : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
