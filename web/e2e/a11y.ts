import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** Run axe against the page as it is now (WCAG 2.1 A and AA, contrast included) and list anything it finds. */
export async function expectAccessible(page: Page, where: string) {
  // Cards are dealt with a short animation; reduced motion lands them before axe measures their colours.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForLoadState('networkidle');
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const report = violations.flatMap((v) =>
    v.nodes.map((n) => `${v.id}: ${n.target.join(' ')}\n    ${n.failureSummary?.split('\n').slice(1).join(' ').trim()}`),
  );
  expect(report, `${where}: ${report.length} accessibility problems`).toEqual([]);
}
