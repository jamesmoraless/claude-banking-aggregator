import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration.
 *
 * These specs run against a real dev server with real Supabase configuration.
 * They are deliberately NOT run in the default `pnpm verify` sequence, because
 * they need credentials that only exist once MANUAL_SETUP.md has been followed.
 *
 * The smoke suite asserts behaviour that must hold whatever the account state:
 * routes render, the shell is navigable, and an unconfigured or signed-out app
 * says so rather than showing an empty dashboard.
 */
const PORT = 4173;
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // The specification requires the app to remain usable on mobile, so the
    // smoke suite runs at a phone viewport too.
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],

  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `pnpm build && pnpm preview --port ${PORT} --strictPort`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
