import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  timeout: 180_000,
  expect: { timeout: 15000 },
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { trace: 'retain-on-failure', actionTimeout: 15000, navigationTimeout: 20000 },
  globalSetup: './tests/browser/setup.ts',
  webServer: {
    command: 'node tests/fixture/server.mjs',
    url: 'http://127.0.0.1:4178',
    reuseExistingServer: false,
  },
});
