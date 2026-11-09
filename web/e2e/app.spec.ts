import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('evalbench:rater', 'e2e'));
});

test('overview shows the leaderboard and what changed', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('leads the core battery');
  for (const name of ['Nimbus Pro', 'Atlas 70B', 'Orion Mini', 'Vega 8B']) {
    await expect(page.getByText(name).first()).toBeVisible();
  }
  await expect(page.getByText(/answers graded by/)).toBeVisible();
  await expect(page.getByRole('heading', { name: /Since run #5/ })).toBeVisible();
});

test('a run shows the result matrix and opens answers side by side', async ({ page }) => {
  await page.goto('/runs/6');
  await expect(page.getByRole('heading', { name: /Core battery/ })).toBeVisible();
  await expect(page.locator('tbody button')).toHaveCount(80);
  await page.getByRole('link', { name: /Two-sentence summary/ }).click();
  await expect(page).toHaveURL(/\/runs\/6\/tasks\/c04-summary$/);
  await expect(page.locator('article')).toHaveCount(4);
  await expect(page.getByText('Exactly two sentences').first()).toBeVisible();
});

test('blind rating hides the models and records a full rating', async ({ page }) => {
  await page.goto('/rate?run=6');
  await expect(page.getByText('Answer A', { exact: true })).toBeVisible();
  const cards = await page.locator('article, section').allInnerTexts();
  for (const name of ['Nimbus', 'Atlas', 'Orion', 'Vega']) {
    expect(cards.join('\n')).not.toContain(name);
  }
  const progress = page.getByText(/of \d+ judged/);
  const before = Number((await progress.textContent())!.match(/(\d+) of/)![1]);
  const articles = page.locator('article');
  for (const i of [0, 1]) {
    const rows = articles
      .nth(i)
      .locator('footer > div')
      .filter({ has: page.locator('button') });
    const count = await rows.count();
    for (let r = 0; r < count; r++) {
      const buttons = rows.nth(r).getByRole('button');
      if ((await buttons.count()) === 5) await buttons.nth(i === 0 ? 4 : 2).click();
    }
  }
  await page.mouse.click(4, 500);
  await page.keyboard.press('2');
  await page.getByPlaceholder(/Point at the parts/).fill('A is correct and shows each step; B makes an error and skips the check.');
  await page.getByRole('button', { name: 'Submit verdict' }).click();
  await expect(progress).toHaveText(new RegExp(`${before + 1} of`));
});

test('a task can be edited in the form and saved back to YAML', async ({ page, request }) => {
  await page.goto('/suites/core-battery');
  await page.getByRole('button', { name: /Primes in brackets/ }).click();
  const title = page.getByLabel('Title');
  await title.fill('First five primes');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Unsaved changes')).toHaveCount(0);
  const yaml = await (await request.get('/api/suites/core-battery/yaml')).text();
  expect(yaml).toContain('title: First five primes');
  await page.getByRole('tab', { name: 'YAML' }).click();
  await expect(page.locator('.cm-content')).toContainText('id: core-battery');
});

test('exports are one click away', async ({ page, request }) => {
  await page.goto('/data');
  await expect(page.getByText('Preference pairs')).toBeVisible();
  const csv = await request.get('/api/export/ratings.csv');
  expect(csv.ok()).toBeTruthy();
  expect((await csv.text()).split('\n')[0]).toContain('justification');
  const pairs = await request.get('/api/export/preferences.jsonl');
  const first = JSON.parse((await pairs.text()).split('\n')[0]);
  expect(first.chosen).not.toEqual(first.rejected);
});
