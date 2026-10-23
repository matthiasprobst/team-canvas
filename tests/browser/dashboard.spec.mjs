import { test, expect } from '../../frontend/node_modules/playwright/test.mjs';
import { api, base, login } from './helpers.mjs';

test('two users create, share, rename, switch, complete poker and sign out', async ({ browser }, testInfo) => {
  const alice = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 1000 } });
  const bob = await browser.newContext({ baseURL: base });
  const a = await alice.newPage(); const b = await bob.newPage();
  try {
    await login(a, 'alice');
    await a.goto(base + '/login');
    await expect(a.getByRole('heading', { name: 'All canvases', exact: true })).toBeVisible();
    const title = `Workshop ${Date.now()}`;
    await a.getByRole('button', { name: 'New canvas', exact: true }).first().click();
    await a.getByLabel('Canvas name', { exact: true }).fill(title);
    await a.getByRole('button', { name: 'Create canvas', exact: true }).click();
    await expect(a.getByRole('button', { name: 'Start poker' })).toBeEnabled();
    const boardPath = new URL(a.url()).pathname;
    await a.getByRole('button', { name: 'Share', exact: true }).click();
    await a.getByRole('button', { name: 'Create invitation link' }).click();
    const invitation = await a.getByLabel('Invitation link', { exact: true }).inputValue();
    await a.getByRole('button', { name: 'Close dialog' }).click();
    // Follow a fragment invitation before login, then complete the standard code flow.
    await b.goto(invitation);
    await b.getByRole('button', { name: 'Login with SSO', exact: true }).click();
    expect(new URL(b.url()).search).not.toContain('invite');
    await b.locator('#username').fill('bob');
    await b.locator('#password').fill(process.env.DEV_BOB_PASSWORD ?? 'bob-dev-only');
    await b.locator('#kc-login').click();
    await expect(b.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await b.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(b.getByRole('button', { name: 'Sticky note' })).toBeEnabled();
    await a.getByRole('button', { name: 'Start poker' }).click();
    await expect(b.getByText('Poker round', { exact: false })).toBeVisible();
    await b.getByRole('button', { name: 'Sticky note' }).click();
    await expect(b.getByText('Saved', { exact: true })).toBeVisible();
    await b.getByRole('link', { name: 'Canvases', exact: false }).click();
    await b.getByRole('link', { name: 'Shared with me', exact: true }).click();
    await b.getByRole('link', { name: title, exact: true }).click();
    await expect(b.getByRole('button', { name: 'Stop poker and reveal', exact: true })).toBeEnabled();
    await expect(a.getByText('Poker round', { exact: false })).toBeVisible();
    b.once('dialog', dialog => dialog.accept());
    await b.getByRole('button', { name: 'Stop poker and reveal', exact: true }).click();
    await expect(a.getByRole('button', { name: 'Start poker' })).toBeVisible();
    await a.getByRole('link', { name: 'Canvases', exact: false }).click();
    await a.getByLabel('Search canvases or tags', { exact: true }).fill(title);
    await a.getByLabel(`Actions for ${title}`, { exact: true }).click();
    await a.getByRole('button', { name: 'Rename', exact: true }).click();
    await a.getByLabel('Canvas name', { exact: true }).fill(`${title} updated`);
    await a.getByRole('button', { name: 'Rename canvas', exact: true }).click();
    await expect(b.locator('.canvas-heading strong')).toHaveText(`${title} updated`);
    await a.screenshot({ path: testInfo.outputPath('dashboard-desktop.png'), fullPage: true });
    await a.setViewportSize({ width: 390, height: 844 });
    await a.getByRole('button', { name: 'Toggle navigation' }).click();
    await expect(a.getByRole('link', { name: 'My canvases' })).toBeVisible();
    await a.getByRole('link', { name: 'My canvases' }).click();
    expect(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await a.screenshot({ path: testInfo.outputPath('dashboard-mobile.png'), fullPage: true });
    const other = await api(alice, '/api/boards', { name: 'Switch target' });
    await b.getByRole('link', { name: 'Canvases', exact: false }).click();
    await a.goto(base + boardPath);
    await a.getByRole('button', { name: 'Switch canvas' }).click();
    await a.getByLabel('Search canvases or tags', { exact: true }).fill('Switch target');
    await a.getByRole('link', { name: 'Switch target', exact: false }).first().click();
    await expect(a).toHaveURL(base + `/b/${other.id}`);
    await a.getByRole('link', { name: 'Sign out', exact: true }).click();
    await expect(a.getByRole('button', { name: 'Login with SSO', exact: true })).toBeVisible();
    await b.reload();
    await expect(b.getByRole('link', { name: `${title} updated`, exact: true })).toBeVisible();
  } finally { await alice.close(); await bob.close(); }
});

test('anonymous access and untrusted origins fail closed', async ({ browser, request }) => {
  const anonymous = await request.get(base + '/api/me', { headers: { 'X-Requested-With': 'JavaScript' }, maxRedirects: 0 });
  expect([401, 499]).toContain(anonymous.status());
  const context = await browser.newContext();
  try {
    const page = await context.newPage(); await login(page, 'alice');
    const response = await context.request.post(base + '/api/boards', { data: { name: 'Rejected' }, headers: { Origin: 'https://attacker.test' } });
    expect(response.status()).toBe(403);
  } finally { await context.close(); }
});
