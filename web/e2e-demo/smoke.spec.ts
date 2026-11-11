import { expect, type Page, test } from '@playwright/test';

// What a visitor to the static demo can reach. Paths are relative to the site's base (/evalbench/).
const ROUTES: { path: string; shows: RegExp }[] = [
  { path: '', shows: /Use Orion Mini/ },
  { path: 'verdict/support-triage', shows: /22 of 24 right/ },
  { path: 'verdict/core-battery', shows: /Use Atlas 70B/ },
  // Links to the old scoreboard still land on the answer.
  { path: 'scoreboard', shows: /Use Orion Mini/ },
  { path: 'scoreboard/core-battery', shows: /Use Atlas 70B/ },
  { path: 'rate', shows: /Answer A/ },
  { path: 'rate?run=6', shows: /Answer A/ },
  { path: 'rate?run=9', shows: /Answer A/ },
  { path: 'runs', shows: /before launch/ },
  { path: 'runs/6', shows: /Core battery/ },
  { path: 'runs/9', shows: /Support ticket triage/ },
  { path: 'runs/6/tasks/c04-summary', shows: /Exactly two sentences/ },
  { path: 'runs/9/tasks/j03-two-problems', shows: /Urgency is high/ },
  { path: 'suites', shows: /Support ticket triage/ },
  { path: 'suites/core-battery', shows: /Tasks · 20/ },
  { path: 'suites/support-triage', shows: /Tasks · 24/ },
  { path: 'models', shows: /nimbus-pro/ },
  { path: 'data', shows: /Preference pairs/ },
  { path: 'settings', shows: /Justification minimum/ },
  { path: 'runs/999', shows: /No such run/ },
  { path: 'no/such/page', shows: /No such page/ },
];

/**
 * Everything that would tell a visitor the demo is broken: an error in the console, an exception,
 * a request that failed or was refused. One thing is expected and let through: the host answers a
 * deep link with 404.html, so that document (and Chrome's console line about it) carries a 404.
 */
function watch(page: Page) {
  const problems: string[] = [];
  const deepLink = (url: string) => url === page.url() || url === page.mainFrame().url();
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/status of 404/.test(m.text()) && deepLink(m.location().url)) return;
    problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`exception: ${e.message}`));
  page.on('requestfailed', (r) => {
    // Leaving a page drops what it was still fetching (the YAML editor loads on its own): not a fault.
    if (r.failure()?.errorText === 'net::ERR_ABORTED') return;
    problems.push(`failed: ${r.method()} ${r.url()} (${r.failure()?.errorText})`);
  });
  page.on('response', (r) => {
    if (r.status() < 400) return;
    if (r.status() === 404 && r.request().isNavigationRequest() && r.request().frame() === page.mainFrame()) return;
    problems.push(`${r.status()}: ${r.url()}`);
  });
  page.on('request', (r) => {
    // The demo answers its own requests: nothing may go looking for a server.
    if (new URL(r.url()).pathname.includes('/api/')) problems.push(`asked a server: ${r.url()}`);
  });
  return problems;
}

const fits = async (page: Page) => {
  const { content, width } = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, width: window.innerWidth }));
  expect(content, 'the page is wider than the screen').toBeLessThanOrEqual(width);
};

const settled = async (page: Page) => {
  await expect(page.locator('.animate-spin')).toHaveCount(0);
  await expect(
    page
      .getByRole('heading', { level: 1 })
      .or(page.getByText(/^No such /))
      .first(),
  ).toBeVisible();
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('evalbench:rater')) localStorage.setItem('evalbench:rater', 'visitor');
  });
});

test('every screen loads from a deep link, with nothing wrong and nothing running off the side', async ({ page }) => {
  const problems = watch(page);
  for (const { path, shows } of ROUTES) {
    await page.goto(path);
    await settled(page);
    await expect(page.getByText(shows).first(), path).toBeVisible();
    await fits(page);
    // One quiet notice on every screen: sample data, nothing saved, where the source is.
    const notice = page.getByRole('complementary', { name: 'About this demo' });
    await expect(notice, path).toBeInViewport({ ratio: 1 });
    await expect(notice).toContainText('Sample data');
    await expect(notice).toContainText('Nothing is saved');
    await expect(notice.getByRole('link', { name: 'Source on GitHub' })).toHaveAttribute('href', 'https://github.com/gallowforge/evalbench');
    expect(problems, path).toEqual([]);
  }
});

test('the theme follows the device, and the page is painted in it', async ({ page, colorScheme }) => {
  await page.goto('');
  await settled(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme ?? 'light');
  const [r, g, b] = await page.evaluate(() => getComputedStyle(document.body).backgroundColor.match(/\d+/g)!.map(Number));
  if (colorScheme === 'dark') expect(r + g + b).toBeLessThan(150);
  else expect(r + g + b).toBeGreaterThan(600);
});

test('the site opens at its root, moves between sections under its base path and survives a reload', async ({ page }) => {
  const problems = watch(page);
  const root = await page.goto('');
  expect(root!.status()).toBe(200);
  expect(new URL(page.url()).pathname).toBe('/evalbench/');
  await settled(page);
  const nav = page.getByRole('navigation', { name: 'Main' });
  for (const [name, path] of [
    ['Runs', '/evalbench/runs'],
    ['Judge', '/evalbench/rate'],
    ['Suites', '/evalbench/suites'],
    ['Models', '/evalbench/models'],
    ['Verdict', '/evalbench/'],
  ]) {
    await nav.getByRole('link', { name: new RegExp(`^${name}`) }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await settled(page);
    await expect(nav.getByRole('link', { name: new RegExp(`^${name}`) })).toHaveAttribute('aria-current', 'page');
  }
  // Data and settings sit beside the name, out of the row of sections.
  await page.getByRole('link', { name: 'Data', exact: true }).click();
  await expect(page).toHaveURL(/\/evalbench\/data$/);
  await settled(page);
  await page.goto('runs');
  await page
    .getByRole('link', { name: /vega 8b re-quantised/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/evalbench\/runs\/6$/);
  await expect(page.locator('tbody button')).toHaveCount(80);
  await page.reload();
  await expect(page).toHaveURL(/\/evalbench\/runs\/6$/);
  await expect(page.locator('tbody button')).toHaveCount(80);
  await page.getByRole('link', { name: /Two-sentence summary/ }).click();
  await expect(page).toHaveURL(/\/evalbench\/runs\/6\/tasks\/c04-summary$/);
  await page.reload();
  await expect(page.locator('article')).toHaveCount(4);
  await page.goBack();
  await expect(page).toHaveURL(/\/evalbench\/runs\/6$/);
  expect(problems).toEqual([]);
});

test('the answer follows the bar, and each job has its own', async ({ page }) => {
  const problems = watch(page);
  await page.goto('');
  await settled(page);
  const answer = page.getByRole('heading', { level: 1 });
  await expect(answer).toContainText('Use Orion Mini');
  const bar = page.getByRole('slider');
  await bar.fill('95');
  await expect(answer).toContainText('Use Nimbus Pro');
  await fits(page);
  await bar.fill('80');
  await expect(answer).toContainText('Use Atlas 70B');
  await page.getByRole('button', { name: 'Back to 90%' }).click();
  await expect(answer).toContainText('Use Orion Mini');
  await page.getByRole('link', { name: 'Core battery' }).first().click();
  await expect(page).toHaveURL(/\/evalbench\/verdict\/core-battery$/);
  await expect(answer).toContainText('Use Atlas 70B');
  await page.getByRole('slider').fill('95');
  await expect(answer).toContainText('No model is good enough yet');
  await fits(page);
  expect(problems).toEqual([]);
});

test('a new run replays the recorded answers, finishes, and is gone after a reload', async ({ page }) => {
  test.setTimeout(90_000);
  const problems = watch(page);
  await page.goto('runs');
  await page.getByRole('button', { name: 'New run' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await fits(page);
  await dialog.getByRole('button', { name: 'Select all' }).click();
  await dialog.getByRole('button', { name: /^Start/ }).click();
  // The dialog offers the job that was run last, support triage: 24 examples for each of 5 models.
  await expect(page).toHaveURL(/\/evalbench\/runs\/10$/);
  // It is seen working, not just done: answers arrive while the run is still going.
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
  await expect(page.getByText(/^(Queued|Running)$/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByText('Done', { exact: true }).first()).toBeVisible();
  await expect(page.locator('tbody button')).toHaveCount(120);
  await fits(page);
  await page.goto('runs');
  await settled(page);
  await expect(page.getByRole('link', { name: /#10/ })).toHaveCount(0);
  await page.goto('runs/10');
  await expect(page.getByText('No such run')).toBeVisible();
  expect(problems).toEqual([]);
});

test('a rating is kept for the visit and forgotten on reload', async ({ page }) => {
  const problems = watch(page);
  await page.goto('rate?run=6');
  await expect(page.getByText('Answer A', { exact: true })).toBeVisible();
  const progress = page.getByText(/of \d+ judged/);
  const before = Number((await progress.textContent())!.match(/(\d+) of/)![1]);
  for (const [side, score] of [
    ['A', 5],
    ['B', 3],
  ]) {
    for (const line of await page.getByRole('button', { name: new RegExp(`, answer ${side}: ${score},`) }).all()) await line.click();
  }
  await page.getByRole('button', { name: 'Verdict: A, clearly' }).click();
  await page.getByPlaceholder(/Point at the parts/).fill('A is correct and shows each step; B makes an error and skips the check.');
  await page.getByRole('button', { name: 'Submit verdict' }).click();
  await expect(progress).toHaveText(new RegExp(`${before + 1} of`));
  // Moving inside the app keeps it; the count and the newest rating on the data page show it.
  await page.getByRole('link', { name: 'Data', exact: true }).click();
  await expect(page.getByText('240 rows')).toBeVisible();
  await expect(page.getByText(/skips the check/).first()).toBeVisible();
  // A reload starts the visit over, as the notice says.
  await page.reload();
  await expect(page.getByText('239 rows')).toBeVisible();
  await expect(page.getByText(/skips the check/)).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('downloads are built in the page and carry the server’s file names', async ({ page }) => {
  const problems = watch(page);
  await page.goto('data');
  const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download' }).first().click()]);
  expect(csv.suggestedFilename()).toBe('evalbench-ratings.csv');
  await page.goto('suites/core-battery');
  const [yaml] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'YAML' }).click()]);
  expect(yaml.suggestedFilename()).toBe('core-battery.yaml');
  await page.goto('runs/6');
  const [results] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Results' }).click()]);
  expect(results.suggestedFilename()).toBe('evalbench-results-run6.jsonl');
  expect(new URL(page.url()).pathname).toBe('/evalbench/runs/6');
  expect(problems).toEqual([]);
});

test('what needs the server says so in a sentence instead of failing', async ({ page }) => {
  const problems = watch(page);
  const readOnly = 'Suites are read-only in this demo: checking and grading one needs the server.';

  // Editing a suite: the form works, the change cannot be saved, and the bar says why.
  await page.goto('suites/core-battery');
  await page.getByRole('button', { name: /Primes in brackets/ }).click();
  await page.getByLabel('Title').fill('First five primes');
  await expect(page.getByText(readOnly)).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await fits(page);
  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByText(readOnly)).toHaveCount(0);

  await page.goto('suites');
  await page.getByRole('button', { name: 'New suite' }).click();
  await expect(page.getByRole('dialog').getByText(readOnly)).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Create suite' })).toBeDisabled();

  // Testing a connection answers at once: there is no model to reach from a static page.
  await page.goto('models');
  await page.getByRole('button', { name: /^Test/ }).first().click();
  await expect(page.getByText(/cannot reach a model/).first()).toBeVisible();

  await page.goto('settings');
  await expect(page.getByText('not needed: the demo has no accounts')).toBeVisible();
  await expect(page.getByText('not used here: the demo shows recorded check results')).toBeVisible();
  await expect(page.getByText('not needed here: the demo replays recorded answers').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Demo loaded' })).toBeDisabled();
  expect(problems).toEqual([]);
});
