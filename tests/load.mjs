/** Explicitly target a disposable deployment; provision load01..load10 in its development IdP first. */
import assert from 'node:assert/strict';
import { chromium } from '../frontend/node_modules/playwright/index.mjs';
import { api, base, login } from './browser/helpers.mjs';

const duration = Number(process.env.LOAD_SECONDS ?? 60);
assert(Number.isInteger(duration) && duration >= 10 && duration <= 300);
const browser = await chromium.launch(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {});
const users = [], boards = [];
try {
  for (let i = 1; i <= 10; i++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    users.push({ context, page });
    await login(page, `load${String(i).padStart(2, '0')}`);
    console.log(`Authenticated disposable load account ${i}`);
    for (let j = 0; j < 2; j++) {
      const board = await api(context, '/api/boards', { name: `Disposable load ${i}/${j}` });
      boards.push({ ...board, owner: context, invitation: await api(context, `/api/boards/${board.id}/invitations`, {}) });
    }
  }
  for (const [index, user] of users.entries()) {
    const sessions = [];
    for (const board of boards) {
      const session = await api(user.context, `/api/boards/${board.id}/join`, { inviteKey: board.invitation.inviteKey });
      sessions.push({ id: board.id, token: session.token });
    }
    await user.page.evaluate(async ({ sessions, index }) => {
      window.load = { clients: [], pending: new Map(), latencies: [], errors: [], closed: 0, sent: 0 };
      for (const session of sessions) {
        await new Promise((resolve, reject) => {
          const address = new URL(`/ws/boards/${session.id}`, location.href);
          address.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
          const socket = new WebSocket(address);
          const client = { socket, state: null, index };
          const timer = setTimeout(() => reject(Error('Snapshot timeout')), 10000);
          socket.onopen = () => socket.send(JSON.stringify({ type: 'hello', token: session.token, protocolVersion: 2 }));
          socket.onclose = () => window.load.closed++;
          socket.onmessage = event => {
            const packet = JSON.parse(event.data);
            if (packet.type === 'snapshot') { client.state = packet.data.board; clearTimeout(timer); resolve(); }
            if (packet.type === 'error') window.load.errors.push(packet);
            if (packet.type === 'ack' && window.load.pending.has(packet.commandId)) {
              window.load.latencies.push(performance.now() - window.load.pending.get(packet.commandId));
              window.load.pending.delete(packet.commandId);
            }
          };
          window.load.clients.push(client);
        });
      }
    }, { sessions, index });
  }
  console.log('Connected 200 authenticated sockets across 20 canvases and 10 accounts.');
  const overflowSession = await api(users[0].context, `/api/boards/${boards[0].id}/join`, {});
  const overflow = await users[0].page.evaluate(({ id, token }) => new Promise((resolve, reject) => {
    const url = new URL(`/ws/boards/${id}`, location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url);
    const timer = setTimeout(() => { ws.close(); reject(Error('Overflow was not rejected')); }, 10000);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', token, protocolVersion: 2 }));
    ws.onclose = event => { clearTimeout(timer); resolve(event.code); };
  }), { id: boards[0].id, token: overflowSession.token });
  assert.equal(overflow, 1013);
  for (let elapsed = 0; elapsed < duration; elapsed += 5) {
    await Promise.all(users.map(({ page }) => page.evaluate(() => {
      for (const client of window.load.clients) {
        const commandId = crypto.randomUUID();
        const state = client.state;
        window.load.pending.set(commandId, performance.now()); window.load.sent++;
        client.socket.send(JSON.stringify({ type: 'patch', commandId, epoch: state.epoch, roundId: state.roundId, pageId: state.pageId,
          elements: [{ id: `load-${client.index}`, type: 'rectangle', x: Math.random() * 100, y: 0, width: 100, height: 100, isDeleted: false }], files: {} }));
      }
    })));
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  const results = await Promise.all(users.map(({ page }) => page.evaluate(() => ({ latencies: window.load.latencies, pending: window.load.pending.size, errors: window.load.errors, closed: window.load.closed, sent: window.load.sent }))));
  const latencies = results.flatMap(result => result.latencies).sort((a, b) => a - b);
  const report = { durationSeconds: duration, connections: 200, canvases: 20, acknowledged: latencies.length,
    sent: results.reduce((sum, result) => sum + result.sent, 0), p95Ms: latencies[Math.floor(latencies.length * .95)], maxMs: latencies.at(-1), overflowCode: overflow };
  console.log(JSON.stringify(report, null, 2));
  assert(results.every(result => !result.pending && !result.errors.length && !result.closed), JSON.stringify(results.map(({ latencies, ...rest }) => rest)));
  assert.equal(report.acknowledged, report.sent);
  assert(report.p95Ms < 1000, 'Local qualification target: acknowledgement p95 below one second');
} finally {
  await Promise.all(users.map(({ page }) => page.evaluate(() => window.load?.clients.forEach(client => client.socket.close())).catch(() => {})));
  for (const board of boards) {
    try { await api(board.owner, `/api/boards/${board.id}`, undefined, 'DELETE', 204); }
    catch (error) { console.error(`Cleanup failed for disposable canvas ${board.id}: ${error.message}`); }
  }
  await Promise.all(users.map(({ context }) => context.close()));
  await browser.close();
}
