import { defineConfig } from '@playwright/test';

// The static demo (npm run build:demo), served the way GitHub Pages serves it: under /evalbench/,
// with 404.html for deep links. Every screen is loaded in both themes, wide and phone.
const PORT = 8496;
const BASE = `http://127.0.0.1:${PORT}/evalbench/`;
const wide = { width: 1280, height: 900 };
const phone = { width: 390, height: 844 };

export default defineConfig({
  testDir: 'e2e-demo',
  timeout: 45_000,
  fullyParallel: true,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: BASE,
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: 'wide-dark', use: { viewport: wide, colorScheme: 'dark' } },
    { name: 'wide-light', use: { viewport: wide, colorScheme: 'light' } },
    { name: 'phone-dark', use: { viewport: phone, colorScheme: 'dark', hasTouch: true } },
    { name: 'phone-light', use: { viewport: phone, colorScheme: 'light', hasTouch: true } },
  ],
  webServer: {
    command: 'node scripts/serve-demo.mjs',
    url: BASE,
    env: { PORT: String(PORT), BASE_PATH: '/evalbench' },
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
