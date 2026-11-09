import { expect, type Page, test } from '@playwright/test';

const LEGACY = 'http://127.0.0.1:8497/';

/** Fill fields the way a password manager does: set each value and fire no input or key events. */
async function autofill(page: Page, values: Record<string, string>) {
  await page.evaluate((fields) => {
    for (const [name, value] of Object.entries(fields)) {
      const input = document.querySelector<HTMLInputElement>(`form input[name="${name}"]`);
      if (!input) throw new Error(`no field named ${name}`);
      input.value = value;
    }
  }, values);
}

const signedIn = (page: Page) => expect(page.getByRole('heading', { level: 1 })).toContainText('leads the core battery');

test.describe.configure({ mode: 'serial' });

test('first visit makes the owner account, filled without a single key event', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Make the owner account' })).toBeVisible();
  await expect(page.locator('form input[name="username"]')).toHaveAttribute('autocomplete', 'username');
  await expect(page.locator('form input[name="password"]')).toHaveAttribute('autocomplete', 'new-password');
  await expect(page.locator('form input[name="password-again"]')).toHaveAttribute('autocomplete', 'new-password');
  const create = page.getByRole('button', { name: 'Create account and continue' });
  await expect(create).toBeEnabled(); // never waits for typing

  await autofill(page, { username: 'alex42', password: 'correct horse', 'password-again': 'correct horse' });
  await create.click();
  await signedIn(page);
});

test('sign-in is a real form a password manager can fill', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.locator('form input[name="username"]')).toHaveAttribute('autocomplete', 'username');
  await expect(page.locator('form input[type="password"]')).toHaveAttribute('autocomplete', 'current-password');
  const signIn = page.getByRole('button', { name: 'Sign in' });

  // A wrong username reads exactly like a wrong password.
  await autofill(page, { username: 'someone', password: 'correct horse' });
  await signIn.click();
  await expect(page.getByText('wrong username or password')).toBeVisible();

  await autofill(page, { username: 'Alex42', password: 'correct horse' });
  await signIn.click();
  await signedIn(page);
});

test('an install from before usernames picks one once, after signing in', async ({ page }) => {
  await page.goto(LEGACY);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.locator('form input[name="username"]')).toHaveCount(0);
  await autofill(page, { password: 'e2e-old-password' });
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: 'Pick a username' })).toBeVisible();
  await expect(page.locator('form input[name="username"]')).toHaveAttribute('autocomplete', 'username');
  await expect(page.locator('form input[name="password"]')).toHaveAttribute('autocomplete', 'current-password');
  await autofill(page, { username: 'alex42', password: 'e2e-old-password' });
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await signedIn(page);

  await page.context().clearCookies();
  await page.goto(LEGACY);
  await expect(page.locator('form input[name="username"]')).toBeVisible();
  await autofill(page, { username: 'alex42', password: 'e2e-old-password' });
  await page.getByRole('button', { name: 'Sign in' }).click();
  await signedIn(page);
});
