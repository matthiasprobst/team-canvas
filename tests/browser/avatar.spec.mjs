import { test, expect } from '../../frontend/node_modules/playwright/test.mjs';

const id = '00000000-0000-4000-8000-000000000001';
const account = { id: 'account-1', displayName: 'Ada Lovelace', avatarVersion: 0, hasAvatar: false };
function collectErrors(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

test('profile avatar can be uploaded and removed with initials fallback', async ({ page }) => {
  const errors = collectErrors(page);
  let version = 0;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lnsAAAAASUVORK5CYII=', 'base64');
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/me' && route.request().method() === 'GET') {
      await route.fulfill({ json: { ...account, avatarVersion: version, hasAvatar: version === 1 } });
    } else if (url.pathname === '/api/me/avatar' && route.request().method() === 'PUT') {
      version++; await route.fulfill({ status: 204 });
    } else if (url.pathname === '/api/me/avatar' && route.request().method() === 'DELETE') {
      version++; await route.fulfill({ status: 204 });
    } else if (url.pathname === '/api/users/account-1/avatar') {
      await route.fulfill({ status: 200, contentType: 'image/png', body: png });
    } else {
      await route.fulfill({ json: { items: [], nextCursor: null } });
    }
  });

  await page.goto('/');
  await expect(page).toHaveTitle('Team Canvas');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'All canvases' })).toBeVisible();
  await expect(page.locator('.avatar-view')).toContainText('AL');
  await page.locator('input[type=file]').setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: 'Change avatar' }).click();
  await expect(page.locator('.avatar-view img')).toBeVisible();
  await expect.poll(() => page.locator('.avatar-view img').evaluate(image => image.naturalWidth)).toBe(1);
  await page.screenshot({ path: '/tmp/team-canvas-avatar-profile.png' });
  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(page.locator('.avatar-view')).toContainText('AL');
  await expect(page.locator('.avatar-view img')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await expect(page.getByRole('button', { name: 'Change avatar' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('canvas avatars can be placed, moved, removed, and receive remote state updates', async ({ page }) => {
  const errors = collectErrors(page);
  const sent = [];
  let socket;
  let markers = [];
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/me') await route.fulfill({ json: account });
    else if (path.endsWith('/join')) await route.fulfill({ json: { id, participantId: 'member-1', role: 'host', token: 'test' } });
    else await route.fulfill({ json: { items: [], nextCursor: null } });
  });
  await page.routeWebSocket('**/ws/boards/*', ws => {
    socket = ws;
    ws.onMessage(raw => {
      const packet = JSON.parse(String(raw));
      if (packet.type === 'hello') ws.send(JSON.stringify({ type: 'snapshot', data: {
        board: { id, name: 'Avatar canvas', mode: 'standard', roundId: null, epoch: 0, revision: 0 },
        round: null, elements: [], publicIds: [], fileIds: [], participantId: 'member-1', role: 'host', avatars: [],
      } }));
      if (packet.type.startsWith('avatar_')) {
        sent.push(packet);
        if (packet.type === 'avatar_place') markers.push({ id: 'marker-1', userId: account.id, name: account.displayName, avatarVersion: 0, hasAvatar: false, x: packet.x, y: packet.y });
        if (packet.type === 'avatar_move') markers = markers.map(marker => marker.id === packet.id ? { ...marker, x: packet.x, y: packet.y } : marker);
        if (packet.type === 'avatar_remove') markers = markers.filter(marker => marker.id !== packet.id);
        ws.send(JSON.stringify({ type: 'avatar_state', avatars: markers }));
      }
      if (packet.type === 'ping') ws.send('{"type":"pong"}');
    });
  });

  await page.goto('/b/' + id);
  await expect(page).toHaveTitle('Team Canvas');
  await expect(page.getByRole('button', { name: 'Place my avatar' })).toBeEnabled();
  await page.getByRole('button', { name: 'Place my avatar' }).click();
  await page.locator('.avatar-place-catcher').click({ position: { x: 280, y: 260 } });
  const marker = page.getByRole('button', { name: "Ada Lovelace's avatar; drag to move" });
  await expect(marker).toBeVisible();
  await expect.poll(() => sent.filter(packet => packet.type === 'avatar_place').length).toBe(1);
  await page.screenshot({ path: '/tmp/team-canvas-avatar-canvas.png' });
  const bounds = await marker.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 50, bounds.y + bounds.height / 2 + 30);
  await page.mouse.up();
  await expect.poll(() => sent.filter(packet => packet.type === 'avatar_move').length).toBe(1);
  await page.getByRole('button', { name: "Remove Ada Lovelace's avatar marker" }).click();
  await expect(marker).toHaveCount(0);
  await expect.poll(() => sent.filter(packet => packet.type === 'avatar_remove').length).toBe(1);
  expect(socket).toBeTruthy();
  expect(errors).toEqual([]);
});

test('avatar markers stay hidden during poker rounds', async ({ page }) => {
  const errors = collectErrors(page);
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/me') await route.fulfill({ json: account });
    else if (path.endsWith('/join')) await route.fulfill({ json: { id, participantId: 'member-1', role: 'host', token: 'test' } });
    else await route.fulfill({ json: { items: [], nextCursor: null } });
  });
  await page.routeWebSocket('**/ws/boards/*', ws => ws.onMessage(raw => {
    if (JSON.parse(String(raw)).type === 'hello') ws.send(JSON.stringify({ type: 'snapshot', data: {
      board: { id, name: 'Poker canvas', mode: 'poker', roundId: 'round-1', epoch: 1, revision: 0 },
      round: { id: 'round-1', done: false, included: true, draftRevision: 0, members: [{ id: 'member-1', name: account.displayName, done: false }] },
      elements: [], publicIds: [], fileIds: [], participantId: 'member-1', role: 'host', avatars: [],
    } }));
  }));
  await page.goto('/b/' + id);
  await expect(page).toHaveTitle('Team Canvas');
  await expect(page.getByRole('button', { name: 'Place my avatar' })).toHaveCount(0);
  await expect(page.locator('.avatar-layer')).toHaveCount(0);
  expect(errors).toEqual([]);
});
