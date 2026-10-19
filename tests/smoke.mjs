/** Authenticated protocol regression against the full development Compose stack. */
import { chromium } from "../frontend/node_modules/playwright/index.mjs";
import { base, login } from "./browser/helpers.mjs";
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

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
    this.page = page; this.key = randomUUID();
    this.closed = new Promise(resolve => { this.resolveClosed = resolve; });
    page.once('websocket', socket => {
      socket.on('close', () => this.resolveClosed());
      socket.on('framereceived', event => {
      const packet = JSON.parse(String(event.payload));

      if (packet.type === 'snapshot') this.state = packet.data;
      if (packet.type === 'round' && this.state) Object.assign(this.state, { board: packet.board, round: packet.round });
      if (packet.type === 'patch' && this.state) {
        this.state.board.revision = packet.revision;
        if (packet.scope === 'private' && packet.actorId === this.state.participantId) this.state.round.draftRevision = packet.revision;
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
      socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'hello', token })));
    }, { id, token, key: this.key });
  }
  async send(packet) { await this.ready; await this.page.evaluate(({ key, packet }) => window.smokeSockets[key].send(JSON.stringify(packet)), { key: this.key, packet }); }
  command(type, fields = {}) {
    const packet = { type, commandId: randomUUID(), epoch: this.state.board.epoch, roundId: this.state.board.roundId, ...fields };
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
const asset = (board, id, token, context = alice) => context.request.get(`${base}/api/boards/${board.id}/assets/${id}`, { headers: { "X-Board-Token": token, "X-Requested-With": "JavaScript" } });
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

  const start = a.command('start_round'); await a.ack(start);
  await Promise.all([a.next(packet => packet.type === 'snapshot' && packet.data.board.epoch === 1),
    b.next(packet => packet.type === 'snapshot' && packet.data.board.epoch === 1)]);
  const early = a.command('reveal'); await a.error(early, 'invalid_message');
  const badEdit = b.command('patch', { elements: [shape('public', 999)], files: {} }); await b.error(badEdit, 'forbidden');
  const image = { id: 'private-file', mimeType: 'image/png', created: 1,
    dataURL: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+Skg5VwAAAABJRU5ErkJggg==' };
  const privatePatch = b.command('patch', { elements: [shape('private'), { ...shape('private-image'), type: 'image', fileId: image.id }], files: { [image.id]: image } });
  const saved = await b.ack(privatePatch);
  assert.equal((await asset(board, image.id, host.token)).status(), 404);
  assert.equal((await asset(board, image.id, guest.token, bob)).status(), 200);
  assert.equal(a.events.some(packet => packet.type === 'patch' && packet.commandId === privatePatch.commandId), false);
  const staleReady = b.command('done', { draftRevision: 0 }); await b.error(staleReady, 'unsaved_draft');
  console.log('✓ Private elements and separately fetched images remain author-only');

  const ready = b.command('done', { draftRevision: saved.revision }); await b.ack(ready);
  await a.next(packet => packet.type === 'round' && packet.round.members.some(member => member.id === guest.participantId && member.done));
  assert.equal(a.state.board.mode, 'poker');
  const locked = b.command('patch', { elements: [shape('blocked')], files: {} }); await b.error(locked, 'locked');
  // Disconnecting does not silently remove an unready participant from the persisted roster.
  await a.close();
  const rejoined = await connect(board, host);
  assert.equal(rejoined.state.round.members.length, 2);
  const last = rejoined.command('done', { draftRevision: rejoined.state.round.draftRevision }); await rejoined.ack(last);
  const revealed = await b.next(packet => packet.type === 'snapshot' && packet.data.board.epoch === 2);
  assert.equal(revealed.data.elements.some(element => element.id === 'private'), true);
  assert.equal((await asset(board, image.id, host.token)).status(), 200);
  assert.equal('files' in revealed.data, false);
  // Check stale context with a correlated command instead of consuming an arbitrary snapshot.
  const stale = { ...privatePatch, commandId: randomUUID() }; b.send(stale); await b.error(stale, 'stale_round');
  console.log('✓ Automatic reveal requires all ready; stale round commands are rejected');

  // Reconnect can briefly overlap the old closing socket; wait for its close handshake above.
  for (let i = 0; i < 8; i++) {
    const who = await request(`/api/boards/${board.id}/join`, {});
    await connect(board, who);
  }
  const overflow = await request(`/api/boards/${board.id}/join`, {});
  const extra = new Client(board.id, overflow.token); clients.push(extra);
  await extra.next(packet => packet.type === 'error' && packet.code === 'room_full');
  console.log('✓ Ten authenticated connections enforced');
} finally { await Promise.allSettled(clients.map(client => client.close())); await browser.close(); }
