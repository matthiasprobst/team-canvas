import { test, expect } from '../../frontend/node_modules/playwright/test.mjs';
import { canvas, snapshot } from '../fixtures.mjs';
const id = snapshot().board.id;

test('an invalid invitation retries existing membership without the expired key', async ({ page }) => {
  let previews = 0, joins = 0;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/preview')) { previews++; return route.fulfill({ status: 404, json: { message: 'Invitation expired.' } }); }
    if (path.endsWith('/join')) { joins++; expect(route.request().postDataJSON().inviteKey).toBeUndefined(); return route.fulfill({ status: 404, json: { message: 'Membership checked.' } }); }
    return route.fulfill({ json: path === '/api/me' ? { id: 'account', displayName: 'Owner' } : { items: [canvas()], nextCursor: null } });
  });
  await page.goto(`/b/${id}#invite=${'a'.repeat(43)}`);
  await expect(page.getByRole('alert')).toHaveText('Invitation expired.');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Membership checked.');
  expect(previews).toBe(1); expect(joins).toBe(1);
});

for (const detection of ['sweeper', 'message', 'network']) {
  test(`login expiry reconnects and preserves pending edits, detected by ${detection}`, async ({ page }) => {
    let socket, connections = 0, companyChecks = 0;
    const patches = [];
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/me') companyChecks++;
      await route.fulfill({ json: path.endsWith('/join') ? { id, participantId: 'member', role: 'host', token: 'test' } : path === '/api/me' ? { id: 'account', displayName: 'Owner' } : { items: [canvas()], nextCursor: null } });
    });
    await page.routeWebSocket('**/ws/boards/*', ws => {
      connections++; socket = ws;
      ws.onMessage(raw => {
        const packet = JSON.parse(String(raw));
        if (packet.type === 'hello') {
          ws.send(JSON.stringify({ type: 'snapshot', data: snapshot() }));
          ws.send(JSON.stringify({ type: 'presence', participants: [{ id: 'member', name: 'Owner', role: 'host' }], connections: 3, maxConnections: connections === 1 ? 47 : 19 }));
        } else if (packet.type === 'patch') patches.push(packet);
        else if (packet.type === 'ping') ws.send('{"type":"pong"}');
      });
    });
    await page.goto(`/b/${id}`);
    await page.getByRole('button', { name: 'Sticky note' }).click();
    await expect.poll(() => patches.length).toBe(1);
    await expect(page.locator('.sidebar')).toContainText('1 person · 3/47 connections');
    if (detection === 'message') socket.send(JSON.stringify({ type: 'error', commandId: null, code: 'login_expired', message: 'Sign-in session expired.' }));
    socket.close({ code: detection === 'network' ? 1006 : 1008, reason: detection === 'network' ? '' : 'login_expired' });
    await expect.poll(() => connections).toBe(2);
    await expect(page.locator('.sidebar')).toContainText('1 person · 3/19 connections');
    await expect.poll(() => patches.length).toBe(2);
    expect(patches[1].commandId).toBe(patches[0].commandId);
    expect(companyChecks).toBe(2);
    // An actual access removal must remain disconnected.
    socket.close({ code: 1008, reason: 'Access revoked' });
    await expect(page.getByRole('alert')).toHaveText('Your access to this canvas was removed by its owner.');
    await page.waitForTimeout(800);
    expect(connections).toBe(2);
  });
}

test('owner can clean storage while snapshots preserve live content', async ({ page }) => {
  let cleanups = 0, socket;
  const state = snapshot();
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/compact')) {
      cleanups++; state.board.epoch++; state.board.revision++;
      socket.send(JSON.stringify({ type: 'snapshot', data: state }));
    }
    await route.fulfill({ json: path.includes('/storage') ? { deletedElements: cleanups ? 0 : 4000, unusedImages: cleanups ? 0 : 10, sceneBytes: 100, imageBytes: 0, poker: false } : path.endsWith('/join') ? { id, participantId: 'member', role: 'host', token: 'test' } : { id: 'account', displayName: 'Owner' } });
  });
  await page.routeWebSocket('**/ws/boards/*', ws => { socket = ws; ws.onMessage(raw => { if (JSON.parse(String(raw)).type === 'hello') ws.send(JSON.stringify({ type: 'snapshot', data: state })); }); });
  await page.goto(`/b/${id}`);
  await expect(page.getByRole('button', { name: 'Sticky note' })).toBeEnabled();
  await page.locator('.canvas-action-menu summary').click();
  await page.getByRole('button', { name: 'Storage', exact: true }).click();
  const storage = page.getByRole('dialog', { name: 'Canvas storage' });
  await expect(storage.getByText('4000', { exact: true })).toBeVisible();
  await storage.getByRole('button', { name: 'Clean up storage' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Clean up deleted content?' });
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click(); expect(cleanups).toBe(0);
  await storage.getByRole('button', { name: 'Clean up storage' }).click();
  await confirmation.getByRole('button', { name: 'Clean up', exact: true }).click();
  await expect(storage.getByRole('status')).toContainText('Storage cleaned up.');
  await expect(storage.getByRole('button', { name: 'Clean up storage' })).toBeDisabled();
  expect(cleanups).toBe(1);
});
