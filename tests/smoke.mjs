/** Authenticated protocol regression against the full development Compose stack. */
import { chromium } from "../frontend/node_modules/playwright/index.mjs";
import { base, login } from "./browser/helpers.mjs";
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';

const browser = await chromium.launch(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {});
const alice = await browser.newContext();
const bob = await browser.newContext();
const aPage = await alice.newPage();
const bPage = await bob.newPage();
async function request(path, payload, expected = 200, context = alice) {
  const response = await context.request.post(base + path, { headers: { Origin: base, 'X-Requested-With': 'JavaScript' }, data: payload });
  const data = response.status() === 204 ? null : await response.json();
  assert.equal(response.status(), expected, JSON.stringify(data));
  return data;
}
class Client {
  constructor(id, token, page = aPage) {
    this.events = []; this.waiters = []; this.state = null;
    this.page = page; this.key = randomUUID(); this.capability = randomBytes(32).toString("base64url");
    this.closed = new Promise(resolve => { this.resolveClosed = resolve; });
    page.once('websocket', socket => {
      socket.on('close', () => this.resolveClosed());
      socket.on('framereceived', event => {
      const packet = JSON.parse(String(event.payload));

      if (packet.type === 'snapshot') this.state = packet.data;
      if (packet.type === 'round' && this.state) Object.assign(this.state, { board: packet.board, round: packet.round });
      if (packet.type === 'patch' && this.state) {
        this.state.board.revision = packet.revision;
      }
      const waiter = this.waiters.find(item => item.predicate(packet));
      if (waiter) { this.waiters.splice(this.waiters.indexOf(waiter), 1); clearTimeout(waiter.timer); waiter.resolve(packet); }
      else this.events.push(packet);
      });
    });
    this.ready = page.evaluate(({ id, token, key }) => {
      window.smokeSockets ??= {};
      const url = new URL(`/ws/boards/${id}`, location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(url); window.smokeSockets[key] = socket;
      socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'hello', token, protocolVersion: 2 })));
    }, { id, token, key: this.key });
  }
  async send(packet) { await this.ready; await this.page.evaluate(({ key, packet }) => window.smokeSockets[key].send(JSON.stringify(packet)), { key: this.key, packet }); }
  command(type, fields = {}) {
    const packet = { type, commandId: randomUUID(), epoch: this.state.board.epoch, roundId: this.state.board.roundId, pageId: this.state.board.pageId, ...fields };
    this.send(packet); return packet;
  }
  next(predicate, timeout = 7000) {
    const index = this.events.findIndex(predicate);
    if (index !== -1) return Promise.resolve(this.events.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, timer: setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(new Error('Timed out; queued=' + JSON.stringify(this.events.map(packet => [packet.type, packet.code]))));
      }, timeout) };
      this.waiters.push(waiter);
    });
  }
  ack(command) { return this.next(packet => packet.type === 'ack' && packet.commandId === command.commandId); }
  error(command, code) { return this.next(packet => packet.type === 'error' && packet.commandId === command.commandId && packet.code === code); }
  async draft() {
    await this.send({ type: 'draft', roundId: this.state.board.roundId, capability: this.capability });
    await this.next(packet => packet.type === 'snapshot');
  }
  async close() {
    await this.ready;
    await this.page.evaluate(key => { const socket = window.smokeSockets[key]; if (socket.readyState !== WebSocket.CLOSED) socket.close(); }, this.key);
    await this.closed;
  }
}
const shape = (id, x = 0) => ({ id, type: 'rectangle', x, y: 0, width: 100, height: 100, isDeleted: false });
const clients = [];
const connect = async (board, who, page = aPage) => {
  const client = new Client(board.id, who.token, page); clients.push(client);
  await client.next(packet => packet.type === 'snapshot'); return client;
};
const asset = (board, id, token, context = alice, capability = null) => context.request.get(`${base}/api/boards/${board.id}/assets/${id}`, { headers: { "X-Board-Token": token, "X-Requested-With": "JavaScript", ...(capability ? { "X-Draft-Capability": capability } : {}) } });
try {
  await login(aPage, "alice"); await login(bPage, "bob");
  const board = await request('/api/boards', { name: 'Protocol regression' });
  await request(`/api/boards/${board.id}/join`, {}, 404, bob);
  const invitation = await request(`/api/boards/${board.id}/invitations`, {});
  const host = await request(`/api/boards/${board.id}/join`, {});
  const guest = await request(`/api/boards/${board.id}/join`, { inviteKey: invitation.inviteKey }, 200, bob);
  const a = await connect(board, host), b = await connect(board, guest, bPage);
  const patch = a.command('patch', { elements: [shape('public')], files: {} });
  await a.ack(patch);
  await b.next(packet => packet.type === 'patch' && packet.commandId === patch.commandId);
  a.send(patch); await a.ack(patch);
  console.log('✓ Public patches echo to sender and retries are idempotent');

  const noOp = a.command('select_page', { targetPageId: a.state.board.pageId });
  await a.ack(noOp);
  await a.next(packet => packet.type === 'round');
  await a.send(noOp);
  await a.ack(noOp);
  const refreshed = await a.next(packet => packet.type === 'snapshot');
  assert.equal(refreshed.data.board.pageId, noOp.targetPageId);
  console.log('✓ Duplicate page commands complete with an authorized snapshot');

  const start = a.command('start_round'); await a.ack(start);
  await Promise.all([a.next(packet => packet.type === 'snapshot' && packet.data.board.epoch === 1),
    b.next(packet => packet.type === 'snapshot' && packet.data.board.epoch === 1)]);
  await a.draft(); await b.draft();
  const early = a.command('reveal'); await a.error(early, 'invalid_message');
  const badEdit = b.command('patch', { elements: [shape('public', 999)], files: {} }); await b.error(badEdit, 'forbidden');
  const image = { id: 'private-file', mimeType: 'image/png', created: 1,
    dataURL: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+Skg5VwAAAABJRU5ErkJggg==' };
  const privatePatch = b.command('patch', { elements: [shape('private'), { ...shape('private-image'), type: 'image', fileId: image.id }], files: { [image.id]: image } });
  const saved = await b.ack(privatePatch);
  assert.equal((await asset(board, image.id, host.token)).status(), 404);
  assert.equal((await asset(board, image.id, guest.token, bob, b.capability)).status(), 200);
  assert.equal(a.events.some(packet => packet.type === 'patch' && packet.commandId === privatePatch.commandId), false);
  console.log('✓ Private elements and images require an unlinked capability');
  await a.close();
  const stop = b.command('stop_round'); await b.ack(stop);
  const revealed = await b.next(packet => packet.type === 'snapshot' && packet.data.board.epoch === 2);
  assert.equal(revealed.data.elements.some(element => element.id === 'private'), true);
  assert.equal((await asset(board, image.id, host.token)).status(), 200);
  assert.equal('files' in revealed.data, false);
  const stale = { ...privatePatch, commandId: randomUUID() }; b.send(stale); await b.error(stale, 'stale_round');
  const rejoined = await connect(board, host);
  assert.equal(rejoined.state.board.mode, 'standard');
  console.log('✓ A member reveals saved work after the owner leaves; stale private writes are rejected');

  const originalPage = b.state.board.pageId;
  const copy = b.command('create_page', { copyCurrent: true, includePoker: true });
  await b.ack(copy);
  const copiedPage = await b.next(packet => packet.type === 'snapshot' && packet.data.board.pageId !== originalPage);
  assert.equal(copiedPage.data.pages.length, 2);
  assert.equal(copiedPage.data.elements.length, 3);
  assert.equal(copiedPage.data.pokerCreatedIds.length, 2);
  assert.equal((await asset(board, copiedPage.data.fileIds[0], guest.token, bob)).status(), 200);
  const select = b.command('select_page', { targetPageId: originalPage });
  await b.ack(select);
  await b.next(packet => packet.type === 'snapshot' && packet.data.board.pageId === originalPage);
  console.log('✓ Pages copy images and poker provenance independently and select globally');

  // Reconnect can briefly overlap the old closing socket; wait for its close handshake above.
  const presence = await rejoined.next(packet => packet.type === 'presence');
  const maximum = presence.maxConnections;
  assert(Number.isInteger(maximum) && maximum >= 2 && maximum <= 38,
    'This two-account smoke fixture requires a configured canvas limit between 2 and 38');
  for (let i = 0; i < maximum - 2; i++) {
    const context = i % 2 ? bob : alice;
    const page = i % 2 ? bPage : aPage;
    const who = await request(`/api/boards/${board.id}/join`, {}, 200, context);
    await connect(board, who, page);
  }
  const overflow = await request(`/api/boards/${board.id}/join`, {});
  const extra = new Client(board.id, overflow.token); clients.push(extra);
  const full = await extra.next(packet => packet.type === 'error' && packet.code === 'room_full');
  assert(full.message.includes(`${maximum} active connections`));
  await extra.close();
  await clients[clients.length - 2].close();
  const returned = await connect(board, overflow);
  const occupied = await returned.next(packet => packet.type === 'presence');
  assert.equal(occupied.connections, maximum);
  assert.equal(occupied.maxConnections, maximum);
  console.log(`✓ Configured limit of ${maximum} authenticated connections enforced`);
} finally { await Promise.allSettled(clients.map(client => client.close())); await browser.close(); }
