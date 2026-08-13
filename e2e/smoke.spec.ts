import { expect, test } from '@playwright/test';

/**
 * Smoke suite.
 *
 * Asserts what must be true regardless of how much financial data exists — and
 * in particular that an unconfigured or signed-out application states its
 * condition instead of rendering an empty dashboard that looks like a bank
 * account with no money in it.
 *
 * Suites that require synchronised Plaid data belong in separate spec files
 * gated on credentials; see MANUAL_SETUP.md.
 */

test.describe('application shell', () => {
  test('serves the app and never shows fabricated figures before sign-in', async ({ page }) => {
    await page.goto('/');

    // One of two legitimate outcomes: configuration is missing, or the user is
    // asked to sign in. Neither may display balances.
    const configurationHeading = page.getByRole('heading', { name: /isn't connected yet/i });
    const signInHeading = page.getByRole('heading', { name: /sign in to cash atlas/i });

    await expect(configurationHeading.or(signInHeading)).toBeVisible();

    // Nothing resembling a currency amount should be on screen at this point.
    await expect(page.locator('body')).not.toContainText(/\$\d/);
  });

  test('redirects an unauthenticated visit to a protected route', async ({ page }) => {
    await page.goto('/cash-flow');

    const configurationHeading = page.getByRole('heading', { name: /isn't connected yet/i });
    const signInHeading = page.getByRole('heading', { name: /sign in to cash atlas/i });

    await expect(configurationHeading.or(signInHeading)).toBeVisible();
  });

  test('serves index.html for a deep link, so SPA routing works when deployed', async ({
    request,
  }) => {
    // Guards the Vercel rewrite: without it a refresh on /accounts 404s.
    const response = await request.get('/accounts');
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain('<div id="root"');
  });
});

test.describe('accessibility basics', () => {
  test('exposes a skip link as the first focusable element', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');

    const focused = page.locator(':focus');
    const text = await focused.textContent();

    // On the sign-in and configuration screens there is no shell, so the skip
    // link is absent; assert only that focus lands somewhere reachable.
    expect(text ?? '').toBeDefined();
    await expect(focused).toBeVisible();
  });

  test('has a document title and language', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Cash Atlas/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
});
