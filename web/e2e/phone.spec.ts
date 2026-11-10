import { expect, type Page, test } from '@playwright/test';

// A phone: every screen fits its width, and every section can be reached.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

const fits = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

test('on a phone the sections sit in a row of their own, the current one in view', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main' });
  const box = (await nav.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(389);
  for (const name of ['Overview', 'Judge', 'Scoreboard', 'Runs']) {
    await expect(nav.getByRole('link', { name: new RegExp(`^${name}`) })).toBeInViewport();
  }
  await fits(page);
  // The rest scroll sideways, and the page you are on is scrolled into view.
  await page.goto('/data');
  await expect(nav.getByRole('link', { name: 'Data' })).toBeInViewport({ ratio: 1 });
});

test('on a phone nothing runs off the side', async ({ page }) => {
  for (const path of ['/', '/scoreboard', '/runs/6', '/suites/core-battery', '/rate', '/models', '/data']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await fits(page);
  }
  // Every verdict of a run is on screen, without scrolling the table sideways.
  await page.goto('/runs/6');
  const last = page.locator('tbody button').last();
  await last.scrollIntoViewIfNeeded();
  const b = (await last.boundingBox())!;
  expect(b.x + b.width).toBeLessThanOrEqual(390);
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
