import { test, expect } from '../../frontend/node_modules/playwright/test.mjs';
import { api, base, login } from './helpers.mjs';

test('owner cleanup preserves shared work and updates every connected session', async ({ browser }) => {
  const alice = await browser.newContext({ baseURL: base });
  const bob = await browser.newContext({ baseURL: base });
  let board;
  try {
    const a = await alice.newPage(), b = await bob.newPage();
    await login(a, 'alice'); await login(b, 'bob');
    board = await api(alice, '/api/boards', { name: `Storage verification ${Date.now()}` });
    const invitation = await api(alice, `/api/boards/${board.id}/invitations`, {});
    await api(bob, `/api/boards/${board.id}/join`, { inviteKey: invitation.inviteKey });
    const writer = await api(alice, `/api/boards/${board.id}/join`, {});
    await a.goto(`${base}/b/${board.id}`);
    await a.evaluate(async ({ id, token }) => {
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`${location.origin.replace('http', 'ws')}/ws/boards/${id}`);
        const timeout = setTimeout(() => { ws.close(); reject(new Error('Write timed out')); }, 10000);
        ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', token, protocolVersion: 2 }));
        let context, phase = 0;
        const element = id => ({ id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10 });
        ws.onmessage = event => {
          const packet = JSON.parse(event.data);
          if (packet.type === 'snapshot' && phase === 0) {
            context = packet.data.board; phase = 1;
            ws.send(JSON.stringify({ type: 'patch', commandId: crypto.randomUUID(), epoch: context.epoch, roundId: null, pageId: context.pageId, elements: [element('kept'), element('removed')], files: {} }));
          } else if (packet.type === 'ack' && phase === 1) {
            phase = 2;
            ws.send(JSON.stringify({ type: 'patch', commandId: crypto.randomUUID(), epoch: context.epoch, roundId: null, pageId: context.pageId, elements: [{ ...element('removed'), isDeleted: true }], files: {} }));
          } else if (packet.type === 'ack' && phase === 2) { clearTimeout(timeout); ws.close(); resolve(); }
          else if (packet.type === 'error') { clearTimeout(timeout); ws.close(); reject(new Error(packet.message)); }
        };
      });
    }, { id: board.id, token: writer.token });
    const states = [];
    b.on('websocket', ws => ws.on('framereceived', ({ payload }) => {
      const packet = JSON.parse(String(payload)); if (packet.type === 'snapshot') states.push(packet.data);
    }));
    await b.goto(`${base}/b/${board.id}`);
    await expect(b.getByRole('button', { name: 'Sticky note' })).toBeEnabled();
    expect(states.at(-1).elements.filter(element => !element.isDeleted).map(element => element.id)).toEqual(['kept']);
    const oldEpoch = states.at(-1).board.epoch;
    await api(bob, `/api/boards/${board.id}/storage`, undefined, 'GET', 404);
    await api(bob, `/api/boards/${board.id}/storage/compact`, {}, 'POST', 404);
    await a.locator('.canvas-action-menu summary').click();
    await a.getByRole('button', { name: 'Storage', exact: true }).click();
    const storage = a.getByRole('dialog', { name: 'Canvas storage' });
    await storage.getByRole('button', { name: 'Clean up storage' }).click();
    await a.getByRole('dialog', { name: 'Clean up deleted content?' }).getByRole('button', { name: 'Clean up', exact: true }).click();
    await expect(storage.getByRole('status')).toContainText('Storage cleaned up.');
    await expect.poll(() => states.at(-1)?.board.epoch).toBe(oldEpoch + 1);
    expect(states.at(-1).elements.map(element => element.id)).toEqual(['kept']);
    expect((await api(alice, `/api/boards/${board.id}/storage`, undefined, 'GET')).deletedElements).toBe(0);
    expect((await api(alice, `/api/boards/${board.id}/access-history`, undefined, 'GET'))[0].action).toBe('storage_cleaned');
    await a.screenshot({ path: '/tmp/optimized-storage.png' });
    await storage.getByRole('button', { name: 'Close dialog' }).click();
    await expect(b.getByRole('button', { name: 'Sticky note' })).toBeEnabled();
  } finally {
    if (board) await alice.request.delete(`${base}/api/boards/${board.id}`, { headers: { Origin: base } });
    await alice.close(); await bob.close();
  }
});
