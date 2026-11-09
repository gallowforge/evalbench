import { expect, type Page, test } from '@playwright/test';
import { expectAccessible } from './a11y';

const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme);
const saved = (page: Page) => page.evaluate(() => localStorage.getItem('evalbench:theme'));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('evalbench:rater', 'e2e'));
});

test('the theme follows the device until you pick one, and the pick is remembered', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect.poll(() => theme(page)).toBe('dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(() => theme(page)).toBe('light'); // follows a live change of the device setting
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => theme(page)).toBe('dark');

  const menu = page.getByRole('button', { name: /^Theme:/ });
  await expect(menu).toHaveAttribute('aria-label', 'Theme: System, dark now');
  await menu.click();
  await page.getByRole('menuitemradio', { name: 'Light', exact: true }).click();
  await expect.poll(() => theme(page)).toBe('light'); // beats the device
  expect(await saved(page)).toBe('light');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f3f0e8');

  await page.reload();
  await expect.poll(() => theme(page)).toBe('light'); // still light before React even starts
  await page.goto('/settings');
  await expect(page.getByRole('button', { name: 'Light', pressed: true })).toBeVisible();
  await page.getByRole('button', { name: 'Dark', pressed: false }).click();
  await expect.poll(() => theme(page)).toBe('dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(() => theme(page)).toBe('dark'); // a fixed choice ignores the device
  await page.getByRole('button', { name: 'System', pressed: false }).click();
  await expect.poll(() => theme(page)).toBe('light');
  expect(await saved(page)).toBeNull();
});

test('the theme menu works from the keyboard', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const menu = page.getByRole('button', { name: /^Theme:/ });
  await menu.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitemradio', { name: /System/ })).toBeFocused(); // opens on the current choice
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('menuitemradio', { name: 'Dark', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => theme(page)).toBe('dark');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(menu).toBeFocused();
  await page.keyboard.press('ArrowDown'); // the arrow keys open it too
  await expect(page.getByRole('menuitemradio', { name: 'Dark', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(menu).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab'); // Tab closes it and carries on from the button
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Settings' })).toBeFocused();
});

for (const mode of ['dark', 'light'] as const) {
  test(`every screen passes axe in the ${mode} theme`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ colorScheme: mode });
    const pages: [string, string][] = [
      ['/', 'overview'],
      ['/rate?run=6', 'judging'],
      ['/scoreboard', 'scoreboard'],
      ['/runs', 'runs'],
      ['/runs/6', 'run'],
      ['/runs/6/tasks/c04-summary', 'answers side by side'],
      ['/suites', 'suites'],
      ['/suites/core-battery', 'suite'],
      ['/models', 'models'],
      ['/data', 'data'],
      ['/settings', 'settings'],
    ];
    for (const [path, name] of pages) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      expect(await theme(page)).toBe(mode);
      await expectAccessible(page, `${name} (${mode})`);
    }

    // The judge's marks: scores picked, a problem ticked, the verdict ringed in red.
    await page.goto('/rate?run=6');
    await page
      .getByRole('button', { name: /answer A: 4/ })
      .first()
      .click();
    await page
      .getByRole('button', { name: /answer B: 2/ })
      .first()
      .click();
    await page.getByRole('button', { name: 'Factual or logic error' }).nth(1).click();
    await page.getByRole('button', { name: 'Verdict: A', exact: true }).click();
    await expectAccessible(page, `judging, marked (${mode})`);

    // The theme menu, open.
    await page.getByRole('button', { name: /^Theme:/ }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await expectAccessible(page, `theme menu (${mode})`);
  });
}

test('the reveal at the end of a queue passes axe in both themes', async ({ page, request }) => {
  // Finish run 1's queue for one judge through the API, then open the page that turns the cards over.
  const rater = 'e2e-reveal';
  for (let n = 0; n < 100; n++) {
    const next = await (await request.get(`/api/rate/next?run=1&rater=${rater}`)).json();
    if (next.done) break;
    const res = await request.post('/api/ratings', {
      data: {
        rater,
        run_id: 1,
        result_a: next.a.result_id,
        result_b: next.b.result_id,
        preference: (n % 7) - 3,
        justification: 'The chosen answer is correct and follows every constraint.',
      },
    });
    expect(res.ok()).toBe(true);
  }
  await page.addInitScript((r) => localStorage.setItem('evalbench:rater', r), rater);
  for (const colorScheme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto('/rate?run=1');
    await expect(page.getByRole('heading', { name: 'The labels, revealed.' })).toBeVisible();
    await expectAccessible(page, `the reveal (${colorScheme})`);
  }
});
