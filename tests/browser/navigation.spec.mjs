import { snapshot, canvas } from '../fixtures.mjs';
import { test, expect } from '../../frontend/node_modules/playwright/test.mjs';

// UI-only transport failure tests. Real Keycloak and authorization are covered by
// dashboard.spec.mjs and smoke.mjs; no test-only authentication path exists in the app.
const id = '00000000-0000-4000-8000-000000000001';
async function fixture(page) {
  const account = { id: 'account', displayName: 'Navigation test' };
  const packets = [];
  let socket;
  let closed = false;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const json = path === '/api/me' ? account : path.endsWith('/join') ? { id, participantId: 'member', role: 'host', token: 'test' } :
      { items: [canvas()], nextCursor: null };
    await route.fulfill({ json });
  });
  await page.routeWebSocket('**/ws/boards/*', ws => {
    socket = ws;
    ws.onClose(() => { closed = true; });
    ws.onMessage(raw => {
      const packet = JSON.parse(String(raw));
      if (packet.type === 'hello') {
        const state = snapshot();
        state.board.name = 'Navigation canvas';
        state.participantId = 'member';
        ws.send(JSON.stringify({ type: 'snapshot', data: state }));
      }
      else if (packet.type === 'patch') packets.push(packet);
      else if (packet.type === 'ping') ws.send('{"type":"pong"}');
    });
  });
  await page.goto(`/b/${id}`);
  await expect(page.getByRole('button', { name: 'Sticky note' })).toBeEnabled();
  return { packets, get socket() { return socket; }, get closed() { return closed; } };
}

test('navigation waits for an acknowledgement and closes the old socket', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('button', { name: 'Sticky note' }).click();
  await expect(page.getByText('Saving', { exact: true })).toBeVisible();
  await expect.poll(() => state.packets.length).toBe(1);
  await page.getByRole('link', { name: 'Canvases', exact: false }).click();
  await expect(page.getByRole('dialog', { name: 'Leave this canvas?' })).toBeVisible();
  const patch = state.packets[0];
  state.socket.send(JSON.stringify({ type: 'patch', commandId: patch.commandId, revision: 1, actorId: 'member', scope: 'public', elements: patch.elements, fileIds: [] }));
  state.socket.send(JSON.stringify({ type: 'ack', commandId: patch.commandId, revision: 1 }));
  await expect(page.getByRole('heading', { name: 'All canvases' })).toBeVisible();
  await expect.poll(() => state.closed).toBe(true);
});

test('offline navigation requires keeping, exporting, or explicitly discarding a draft', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('button', { name: 'Sticky note' }).click();
  await expect(page.getByText('Saving', { exact: true })).toBeVisible();
  await expect.poll(() => state.packets.length).toBe(1);
  state.socket.close({ code: 1008, reason: 'Test interruption' });
  await expect(page.getByText('Offline', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Canvases', exact: false }).click();
  await page.getByRole('button', { name: 'Stay here' }).click();
  await expect(page).toHaveURL(new RegExp(`/b/${id}$`));
  await page.getByRole('link', { name: 'Canvases', exact: false }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export draft and leave' }).click();
  expect((await downloadPromise).suggestedFilename()).toBe('team-canvas-draft.excalidraw');
  await expect(page.getByRole('heading', { name: 'All canvases' })).toBeVisible();
});
