import { defineConfig, devices } from '@playwright/test';

const PORT = 8499;
const bin = process.env.EVALBENCH_BIN ?? 'evalbench';

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    colorScheme: 'dark',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } }],
  webServer: {
    command: `rm -rf .e2e-data && ${bin} serve --host 127.0.0.1 --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    env: { EVALBENCH_DATA: '.e2e-data', EVALBENCH_DEMO: '1', EVALBENCH_AUTH: 'off', EVALBENCH_SANDBOX: 'local' },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
