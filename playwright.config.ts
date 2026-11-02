import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test/ui', timeout: 30000, fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:4173', browserName: 'chromium', channel: process.env.CI ? undefined : 'chrome', viewport: { width: 1500, height: 900 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npm run preview', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
});
