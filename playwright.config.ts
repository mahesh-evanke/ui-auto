import { defineConfig } from '@playwright/test';
import { loadConfig } from './src/core/config';

// Loads e2e/config/config.yaml -> process.env (real env vars always win).
loadConfig();

export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  fullyParallel: false,
  retries: Number(process.env.RETRY_ON_FAIL || 0),
  workers: process.env.MAX_INSTANCES ? Number(process.env.MAX_INSTANCES) : undefined,
  reporter: [
    ['html', { outputFolder: process.env.REPORT_FOLDER || 'reports/integrationTests', open: 'never' }],
    ['list'],
  ],
  use: {
    headless: process.env.HEADLESS !== 'false',
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
    video: process.env.RECORD_VIDEO === '1' ? 'on' : 'off',
    trace: 'retain-on-failure',
    actionTimeout: Number(process.env.CLICK_TIMEOUT_MS || 30000),
  },
});
