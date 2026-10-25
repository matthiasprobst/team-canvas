import { test, expect } from '../../frontend/node_modules/playwright/test.mjs';
import { api, base, login } from './helpers.mjs';

test('two-user drawing and private reveal use only the app and configured identity origin', async ({ browser }, testInfo) => {
  const appOrigin = new URL(base).origin;
  const identityOrigin = new URL(process.env.KEYCLOAK_PUBLIC_URL ?? 'http://localhost:8180/auth').origin;
  const allowed = new Set([appOrigin, identityOrigin]);
  const requests = new Map(), unexpected = new Set(), errors = [];
  const contexts = [];
  let board;
  async function context() {
    const result = await browser.newContext({ baseURL: base });
    contexts.push(result);
    await result.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (!['http:', 'https:'].includes(url.protocol)) return route.continue();
      const key = `${url.origin} ${route.request().resourceType()}`;
      requests.set(key, (requests.get(key) ?? 0) + 1);
      if (!allowed.has(url.origin)) { unexpected.add(url.origin); return route.abort(); }
      return route.continue();
    });
    await result.routeWebSocket('**/*', route => {
      const url = new URL(route.url());
      url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
      if (url.origin !== appOrigin) { unexpected.add(url.origin); route.close(); return; }
      requests.set(`${url.origin} websocket`, (requests.get(`${url.origin} websocket`) ?? 0) + 1);
      route.connectToServer();
    });
    result.on('page', page => page.on('pageerror', error => errors.push(error.name)));
    return result;
  }
  try {
    const alice = await context(), bob = await context();
    const a = await alice.newPage(), b = await bob.newPage();
    const response = await a.goto(base);
    expect(response.headers()['content-security-policy']).toContain("connect-src 'self'");
    await login(a, 'alice');
    await login(b, 'bob');
    board = await api(alice, '/api/boards', { name: `Network qualification ${Date.now()}` });
    const invitation = await api(alice, `/api/boards/${board.id}/invitations`, {});
    await api(bob, `/api/boards/${board.id}/join`, { inviteKey: invitation.inviteKey });
    await a.goto(`/b/${board.id}`);
    await b.goto(`/b/${board.id}`);
    await expect(a.getByRole('button', { name: 'Sticky note', exact: true })).toBeEnabled();
    await expect(b.getByText('2/10', { exact: true })).toBeVisible();
    await a.getByRole('button', { name: 'Sticky note', exact: true }).click();
    await expect(a.getByText('Saved', { exact: true })).toBeVisible();
    await a.getByRole('button', { name: 'Start poker', exact: true }).click();
    await expect(b.getByRole('button', { name: 'Stop poker and reveal', exact: true })).toBeEnabled();
    await b.getByRole('button', { name: 'Sticky note', exact: true }).click();
    await expect(b.getByText('Saved', { exact: true })).toBeVisible();
    await b.getByRole('button', { name: 'Stop poker and reveal', exact: true }).click();
    await b.getByRole('dialog', { name: 'Stop poker and reveal?' }).getByRole('button', { name: 'Reveal saved contributions' }).click();
    await expect(a.getByRole('button', { name: 'Start poker', exact: true })).toBeEnabled();
    expect(new URL(a.url()).origin).toBe(appOrigin);
    await a.screenshot({ path: testInfo.outputPath('network-qualified-editor.png') });
    expect(unexpected.size, 'Unexpected browser destinations (origins only)').toBe(0);
    expect(errors).toEqual([]);
    expect(requests.get(`${appOrigin} websocket`)).toBeGreaterThanOrEqual(2);
    await testInfo.attach('browser-destinations', { body: JSON.stringify({
      scope: 'Two-user login, fonts, drawing, private contribution and reveal; not every editor feature',
      requests: Object.fromEntries(requests), unexpectedOrigins: [...unexpected],
    }, null, 2), contentType: 'application/json' });
  } finally {
    if (board && contexts[0]) await api(contexts[0], `/api/boards/${board.id}`, undefined, 'DELETE', 204);
    await Promise.all(contexts.map(item => item.close()));
  }
});
