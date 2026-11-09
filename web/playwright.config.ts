import { defineConfig, devices } from '@playwright/test';

const PORT = 8499; // demo workspace, sign-in off
const AUTH_PORT = 8498; // a fresh install with sign-in on
const LEGACY_PORT = 8497; // an install with a password and no username yet
const bin = process.env.EVALBENCH_BIN ?? 'evalbench';
const desktop = { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } };

function server(port: number, dir: string, env: Record<string, string>) {
  return {
    command: `rm -rf ${dir} && ${bin} serve --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}/api/health`,
    env: { EVALBENCH_DATA: dir, EVALBENCH_DEMO: '1', EVALBENCH_SANDBOX: 'local', ...env },
    reuseExistingServer: false,
    timeout: 60_000,
  };
}

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    colorScheme: 'dark',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: 'desktop', testIgnore: 'auth.spec.ts', use: { ...desktop, baseURL: `http://127.0.0.1:${PORT}` } },
    { name: 'sign-in', testMatch: 'auth.spec.ts', use: { ...desktop, baseURL: `http://127.0.0.1:${AUTH_PORT}` } },
  ],
  webServer: [
    server(PORT, '.e2e-data', { EVALBENCH_AUTH: 'off' }),
    server(AUTH_PORT, '.e2e-auth', {}),
    server(LEGACY_PORT, '.e2e-legacy', { EVALBENCH_PASSWORD: 'e2e-old-password' }),
  ],
});
