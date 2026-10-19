import { test, expect } from '../../frontend/node_modules/playwright/test.mjs';
import { api, base, login } from './helpers.mjs';

test('owner confirms deletion, members cannot delete, and open viewers are notified', async ({ browser }, testInfo) => {
  const alice = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 1000 } });
  const bob = await browser.newContext({ baseURL: base });
  let board;
  try {
    const a = await alice.newPage(); const b = await bob.newPage();
    await login(a, 'alice'); await login(b, 'bob');
    const title = `Delete verification ${Date.now()}`;
    board = await api(alice, '/api/boards', { name: title });
    const invitation = await api(alice, `/api/boards/${board.id}/invitations`, {});
    await api(bob, `/api/boards/${board.id}/join`, { inviteKey: invitation.inviteKey });
    await b.reload();
    await expect(b.getByRole('link', { name: title, exact: true })).toBeVisible();
    await expect(b.getByLabel(`Actions for ${title}`, { exact: true })).toHaveCount(0);
    await api(bob, `/api/boards/${board.id}`, undefined, 'DELETE', 404);
    const badOrigin = await alice.request.delete(`${base}/api/boards/${board.id}`, { headers: { Origin: 'https://attacker.test' } });
    expect(badOrigin.status()).toBe(403);
    const observer = await alice.newPage();
    await observer.goto(`${base}/b/${board.id}`);
    await b.goto(`${base}/b/${board.id}`);
    await expect(observer.getByRole('button', { name: 'Start poker' })).toBeEnabled();
    await expect(b.getByText('2/10', { exact: true })).toBeVisible();
    await observer.getByRole('button', { name: 'Start poker' }).click();
    await expect(b.getByText('Poker round', { exact: false }).first()).toBeVisible();
    await b.getByRole('button', { name: 'Sticky note' }).click();
    await expect(b.getByText('● Saved', { exact: true })).toBeVisible();
    await a.reload();
    const openDelete = async () => {
      await a.getByLabel(`Actions for ${title}`, { exact: true }).click();
      await a.getByRole('button', { name: 'Delete', exact: true }).click();
    };
    await openDelete();
    const dialog = a.getByRole('dialog', { name: 'Delete canvas?' });
    await expect(dialog).toContainText(title);
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(a.getByRole('link', { name: title, exact: true })).toBeVisible();
    // An unsuccessful request keeps the confirmation open and leaves the canvas intact.
    await a.route(`**/api/boards/${board.id}`, route => route.fulfill({ status: 503, json: { message: 'Please try again.' } }), { times: 1 });
    await openDelete();
    await dialog.getByRole('button', { name: 'Delete canvas', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Please try again.');
    await a.screenshot({ path: testInfo.outputPath('delete-confirmation-desktop.png') });
    await a.setViewportSize({ width: 390, height: 844 });
    const bounds = await dialog.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    await a.screenshot({ path: testInfo.outputPath('delete-confirmation-mobile.png') });
    await dialog.getByRole('button', { name: 'Delete canvas', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(a.getByRole('status').filter({ hasText: 'Canvas deleted.' })).toBeVisible();
    await expect(a.getByRole('link', { name: title, exact: true })).toHaveCount(0);
    for (const viewer of [observer, b]) {
      await expect(viewer.getByRole('alert')).toHaveText('This canvas was deleted by its owner.');
      await expect(viewer.getByRole('button', { name: 'Sticky note' })).toBeDisabled();
      await expect(viewer.getByRole('button', { name: 'Rejoin', exact: true })).toHaveCount(0);
      await viewer.getByRole('link', { name: 'Canvases', exact: false }).click();
      await expect(viewer.getByRole('heading', { name: 'All canvases', exact: true })).toBeVisible();
      await expect(viewer.getByRole('link', { name: title, exact: true })).toHaveCount(0);
    }
    await api(alice, `/api/boards/${board.id}/join`, {}, 'POST', 404);
    await api(bob, `/api/boards/${board.id}/invitations/preview`, { inviteKey: invitation.inviteKey }, 'POST', 404);
  } finally {
    if (board) await alice.request.delete(`${base}/api/boards/${board.id}`, { headers: { Origin: base } });
    await alice.close(); await bob.close();
  }
});
