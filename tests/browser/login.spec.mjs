import { test, expect } from '../../frontend/node_modules/playwright/test.mjs';
import { base } from './helpers.mjs';

test('signed-out users see the SSO entry and signed-in users visiting login reach the dashboard', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(base);
    const loginButton = page.getByRole('button', { name: 'Login with SSO', exact: true });
    await expect(loginButton).toBeVisible();

    await loginButton.click();
    await page.locator('#username').fill('alice');
    await page.locator('#password').fill(process.env.DEV_ALICE_PASSWORD ?? 'alice-dev-only');
    await page.locator('#kc-login').click();
    await expect(page.getByRole('heading', { name: 'All canvases', exact: true })).toBeVisible();

    await page.goto(base + '/login');
    await expect(page.getByRole('heading', { name: 'All canvases', exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});
