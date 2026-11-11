import { expect, type Page, test } from '@playwright/test';

// A phone: every screen fits its width, and every section can be reached.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

const fits = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

test('on a phone the sections sit in a row of their own, the current one in view', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main' });
  const box = (await nav.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(389);
  for (const name of ['Verdict', 'Judge', 'Runs', 'Suites']) {
    await expect(nav.getByRole('link', { name: new RegExp(`^${name}`) })).toBeInViewport();
  }
  await fits(page);
  // The row scrolls sideways when it has to, and the page you are on is scrolled into view.
  await page.goto('/models');
  await expect(nav.getByRole('link', { name: 'Models' })).toBeInViewport({ ratio: 1 });
  // Data and settings sit beside the name, out of the row.
  await expect(page.getByRole('link', { name: 'Data', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('link', { name: 'Settings', exact: true })).toBeInViewport({ ratio: 1 });
});

test('on a phone nothing runs off the side', async ({ page }) => {
  const paths = [
    '/',
    '/verdict/core-battery',
    '/runs',
    '/runs/6',
    '/runs/9',
    '/runs/9/tasks/j03-two-problems',
    '/suites',
    '/suites/core-battery',
    '/suites/support-triage',
    '/rate',
    '/models',
    '/data',
    '/settings',
  ];
  for (const path of paths) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await fits(page);
  }
  // Every verdict of a run is on screen, without scrolling the table sideways: four models or five.
  for (const run of [6, 9]) {
    await page.goto(`/runs/${run}`);
    const last = page.locator('tbody button').last();
    await last.scrollIntoViewIfNeeded();
    const b = (await last.boundingBox())!;
    expect(b.x + b.width).toBeLessThanOrEqual(390);
  }
});

test('on a phone the command on the home page folds instead of running off its block', async ({ page }) => {
  await page.goto('/');
  const block = page.locator('pre', { hasText: 'evalbench run' });
  await block.scrollIntoViewIfNeeded();
  expect(await block.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  // Folding is only how it is drawn: what is copied is still one line per flag.
  expect(await block.evaluate((el) => (el as HTMLElement).innerText)).toContain('--model openai-compatible:qwen3-8b@http://localhost:1234/v1 \\');
});

test('on a phone the new run dialog fits, Start button included', async ({ page }) => {
  await page.goto('/runs');
  await page.getByRole('button', { name: 'New run' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const b = (await dialog.boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(390);
  await expect(dialog.getByRole('button', { name: /^Start/ })).toBeInViewport({ ratio: 1 });
});

test('a run, suite or task that does not exist says so and offers the way back', async ({ page }) => {
  await page.goto('/runs/999');
  await expect(page.getByText('No such run')).toBeVisible();
  await page.getByRole('link', { name: 'All runs' }).click();
  await expect(page).toHaveURL(/\/runs$/);
  await page.goto('/suites/nope');
  await expect(page.getByText('No such suite')).toBeVisible();
  await page.goto('/runs/6/tasks/nope');
  await expect(page.getByText('No such task in this run')).toBeVisible();
});
