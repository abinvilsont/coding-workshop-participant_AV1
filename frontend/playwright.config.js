import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the running app (./bin/start-dev.sh):
 *   frontend  http://localhost:3000   (E2E_BASE_URL)
 *   API       http://localhost:3001   (E2E_API_URL, via the dev proxy -> Lambda -> PostgreSQL)
 *
 * They use the seeded accounts and clean up everything they create
 * (tagged "[e2e]" / "e2e." / "E2E"), before and after the run.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1, // one shared database
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  globalSetup: './e2e/global-setup.js',
  globalTeardown: './e2e/global-teardown.js',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    channel: 'chrome', // system Google Chrome - no browser download needed
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: 'chrome' }, testIgnore: /responsive\.spec\.js/ },
    { name: 'phone', use: { ...devices['Pixel 7'], channel: 'chrome' }, testMatch: /responsive\.spec\.js/ },
    // Layout checks at the sizes in between: tablet portrait (768) and landscape / small laptop (1024)
    { name: 'tablet', use: { ...devices['iPad Mini'], browserName: 'chromium', channel: 'chrome' }, testMatch: /responsive\.spec\.js/ },
    { name: 'tablet-landscape', use: { ...devices['iPad Mini landscape'], browserName: 'chromium', channel: 'chrome' }, testMatch: /responsive\.spec\.js/ },
    { name: 'small-phone', use: { viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true, channel: 'chrome' }, testMatch: /responsive\.spec\.js/ },
  ],
});
