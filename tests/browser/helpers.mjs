import { expect } from '../../frontend/node_modules/playwright/test.mjs';
import { base } from '../testTarget.mjs';
export { base };
export async function login(page, username) {
  await page.goto(base);
  await page.getByRole('button', { name: 'Login with SSO', exact: true }).click();
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(process.env[`DEV_${username.toUpperCase()}_PASSWORD`] ?? `${username}-dev-only`);
  await page.locator('#kc-login').click();
  await expect(page.getByRole('heading', { name: 'All canvases', exact: true })).toBeVisible();
}
export async function api(context, path, data, method = 'POST', expected = 200) {
  const response = await context.request.fetch(base + path, { method, data, headers: { Origin: base, 'X-Requested-With': 'JavaScript' } });
  expect(response.status(), `Unexpected status for ${method} ${path}`).toBe(expected);
  if (response.status() === 204) return undefined;
  const text = await response.text();
  try { return JSON.parse(text); } catch { return text; }
}
