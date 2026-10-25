import { test, expect } from '../../frontend/node_modules/playwright/test.mjs';
import { api, base, login } from './helpers.mjs';

test('owner lists, removes and restores members across their tabs without affecting others', async ({ browser }) => {
  const alice = await browser.newContext({ baseURL: base });
  const bob = await browser.newContext({ baseURL: base });
  const carol = await browser.newContext({ baseURL: base });
  let board;
  try {
    const a = await alice.newPage(); const b = await bob.newPage(); const c = await carol.newPage();
    const errors = [];
    a.on('pageerror', error => errors.push(error.message));
    await login(a, 'alice'); await login(b, 'bob'); await login(c, 'carol');
    // An anonymous /api/me receives 499 during the normal SSO entry flow.
    // Track console health for the authenticated member-management flow.
    a.on('console', message => {
      if (['warning', 'error'].includes(message.type())) errors.push(message.text());
    });
    const bobName = (await api(bob, '/api/me', undefined, 'GET')).displayName;
    const carolName = (await api(carol, '/api/me', undefined, 'GET')).displayName;
    const title = `Member management ${Date.now()}`;
    board = await api(alice, '/api/boards', { name: title });
    await a.reload();
    await a.getByLabel(`Actions for ${title}`, { exact: true }).click();
    await a.getByRole('button', { name: 'Share', exact: true }).click();
    const sharing = a.getByRole('dialog', { name: `Share ${title}`, exact: true });
    await expect(sharing.getByText('No one else has joined yet.')).toBeVisible();
    await sharing.getByRole('button', { name: 'Invitation links', exact: true }).click();
    await sharing.getByRole('button', { name: 'Create invitation link', exact: true }).click();
    const invitation = await sharing.getByLabel('Invitation link', { exact: true }).inputValue();
    const key = new URLSearchParams(new URL(invitation).hash.slice(1)).get('invite');
    await sharing.getByRole('button', { name: 'Members', exact: true }).click();
    const oldSession = await api(bob, `/api/boards/${board.id}/join`, { inviteKey: key });
    const secondTab = await bob.newPage();
    for (const page of [b, secondTab]) {
      await page.goto(`${base}/b/${board.id}`);
      await expect(page.getByRole('button', { name: 'Sticky note' })).toBeEnabled();
    }
    // The open dialog polls durable memberships, including people who are offline.
    await expect(sharing.getByRole('button', { name: `Remove access for ${bobName}`, exact: true })).toBeEnabled({ timeout: 20_000 });
    await api(carol, `/api/boards/${board.id}/join`, { inviteKey: key });
    await c.goto(`${base}/b/${board.id}`);
    await expect(c.getByRole('button', { name: 'Sticky note' })).toBeEnabled();
    await sharing.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(sharing.getByRole('button', { name: `Remove access for ${carolName}`, exact: true })).toBeEnabled();
    const members = (await api(alice, `/api/boards/${board.id}/members`, undefined, 'GET')).items;
    expect(members).toHaveLength(3);
    expect(members[0].role).toBe('owner');
    const bobMember = members.find(member => member.displayName === bobName);
    const carolMember = members.find(member => member.displayName === carolName);
    await api(bob, `/api/boards/${board.id}/members`, undefined, 'GET', 404);
    await api(bob, `/api/boards/${board.id}/members/${carolMember.id}`, { revoked: true }, 'PATCH', 404);
    await api(alice, `/api/boards/${board.id}/members/${members[0].id}`, { revoked: true }, 'PATCH', 400);
    await api(alice, `/api/boards/${board.id}/members/${bobMember.id}`, {}, 'PATCH', 400);
    await a.screenshot({ path: '/tmp/canvas-members-desktop.png' });

    const ownerCanvas = await alice.newPage();
    await ownerCanvas.goto(`${base}/b/${board.id}`);
    await ownerCanvas.getByRole('button', { name: 'Start poker' }).click();
    await expect(b.getByText('Poker round', { exact: false }).first()).toBeVisible();
    await b.getByRole('button', { name: 'Sticky note' }).click();
    await expect(b.getByText('Saved', { exact: true })).toBeVisible();
    // Cancelling removal makes no change.
    await sharing.getByRole('button', { name: `Remove access for ${bobName}`, exact: true }).click();
    await a.getByRole('dialog', { name: 'Remove member access?' }).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(b.getByRole('button', { name: 'Sticky note' })).toBeEnabled();
    await sharing.getByRole('button', { name: `Remove access for ${bobName}`, exact: true }).click();
    await a.getByRole('dialog', { name: 'Remove member access?' }).getByRole('button', { name: 'Remove access', exact: true }).click();
    await expect(sharing.getByRole('button', { name: `Restore access for ${bobName}`, exact: true })).toBeEnabled();
    for (const page of [b, secondTab]) {
      await expect(page.getByRole('alert')).toHaveText('Your access to this canvas was removed by its owner.');
      await expect(page.getByRole('button', { name: 'Sticky note' })).toBeDisabled();
    }
    await expect(c.getByRole('button', { name: 'Sticky note' })).toBeEnabled();
    await expect(ownerCanvas.getByRole('button', { name: 'Sticky note' })).toBeEnabled();
    await api(bob, `/api/boards/${board.id}/join`, { inviteKey: key }, 'POST', 404);
    const freshKey = (await api(alice, `/api/boards/${board.id}/invitations`, {})).inviteKey;
    await api(bob, `/api/boards/${board.id}/join`, { inviteKey: freshKey }, 'POST', 404);
    expect((await api(bob, '/api/boards?filter=shared', undefined, 'GET')).items.some(item => item.id === board.id)).toBe(false);
    await a.setViewportSize({ width: 390, height: 844 });
    const bounds = await sharing.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    expect(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const restore = sharing.getByRole('button', { name: `Restore access for ${bobName}`, exact: true });
    await restore.scrollIntoViewIfNeeded();
    await a.screenshot({ path: '/tmp/canvas-members-mobile.png' });
    await restore.focus();
    await a.keyboard.press('Enter');
    await a.getByRole('dialog', { name: 'Restore member access?' }).getByRole('button', { name: 'Restore access', exact: true }).click();
    await expect(sharing.getByRole('button', { name: `Remove access for ${bobName}`, exact: true })).toBeEnabled();
    const oldTokenResponse = await bob.request.get(`${base}/api/boards/${board.id}/assets/missing`, { headers: { 'X-Board-Token': oldSession.token, 'X-Requested-With': 'JavaScript' } });
    expect(oldTokenResponse.status()).toBe(401);
    const newSession = await api(bob, `/api/boards/${board.id}/join`, {});
    expect(newSession.participantId).toBe(bobMember.id);
    expect(newSession.token).not.toBe(oldSession.token);
    expect((await api(bob, '/api/boards?filter=shared', undefined, 'GET')).items.some(item => item.id === board.id)).toBe(true);
    await b.reload();
    await expect(b.getByRole('button', { name: 'Sticky note' })).toBeEnabled();
    await ownerCanvas.getByRole('button', { name: 'Stop poker and reveal' }).click();
    await ownerCanvas.getByRole('dialog', { name: 'Stop poker and reveal?' }).getByRole('button', { name: 'Reveal saved contributions' }).click();
    await expect(c.getByRole('button', { name: 'Start poker' })).toBeVisible();
    await sharing.getByRole('button', { name: 'Close dialog' }).click();
    await ownerCanvas.getByRole('button', { name: 'Share', exact: true }).click();
    await expect(ownerCanvas.getByRole('dialog').getByRole('button', { name: `Remove access for ${bobName}`, exact: true })).toBeEnabled();
    expect(errors).toEqual([]);
  } finally {
    if (board) await alice.request.delete(`${base}/api/boards/${board.id}`, { headers: { Origin: base } });
    await alice.close(); await bob.close(); await carol.close();
  }
});
