import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { SyncSession } = require('../.test-build/syncSession.js');
const box = (id, x = 0) => ({ id, type: 'rectangle', x, y: 0, width: 10, height: 10 });
const snapshot = (poker = false) => ({
  board: { id: 'board', name: 'Test', mode: poker ? 'poker' : 'standard', roundId: poker ? 'round' : null, epoch: poker ? 1 : 0, revision: 0 },
  round: poker ? { id: 'round', done: false, included: true, draftRevision: 0, members: [{ id: 'me', name: 'Me', done: false }, { id: 'other', name: 'Other', done: false }] } : null,
  elements: [box('public')], publicIds: ['public'], fileIds: [], participantId: 'me', role: 'host',
});
function client(poker = false) {
  const sent = [];
  let n = 0;
  const session = new SyncSession(packet => { sent.push(structuredClone(packet)); return true; }, () => {}, () => `command-${++n}`);
  session.receive({ type: 'snapshot', data: snapshot(poker) });
  return { session, sent };
}
function accepted(session, command, revision, scope = 'public', actorId = 'me') {
  session.receive({ type: 'patch', commandId: command.commandId, revision, actorId, scope, elements: command.elements, fileIds: Object.keys(command.files) });
  session.receive({ type: 'ack', commandId: command.commandId, revision });
}

test('ready waits for every pending edit to be acknowledged', () => {
  const { session, sent } = client(true);
  session.localChange([box('public'), box('private', 42)], {});
  session.control('done');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'patch');
  accepted(session, sent[0], 4, 'private');
  assert.equal(sent.length, 2);
  assert.equal(sent[1].type, 'done');
  assert.equal(sent[1].draftRevision, 4);
  assert.equal(sent[1].roundId, 'round');
});

test('another participant becoming ready preserves the local draft', () => {
  const { session } = client(true);
  session.localChange([box('public'), box('private', 42)], {});
  const state = snapshot(true);
  state.round.members[1].done = true;
  state.board.revision = 1;
  session.receive({ type: 'round', board: state.board, round: state.round });
  assert.equal(session.view().elements.find(el => el.id === 'private').x, 42);
  assert.equal(session.view().unsaved, true);
});

test('concurrent edits converge on the final authoritative event including the sender', () => {
  const a = client(), b = client();
  a.session.localChange([box('public', 10)], {}); a.session.flush();
  b.session.localChange([box('public', 20)], {}); b.session.flush();
  const events = [
    { type: 'patch', commandId: a.sent[0].commandId, revision: 1, actorId: 'me', scope: 'public', elements: [box('public', 10)], fileIds: [] },
    { type: 'patch', commandId: 'remote-command', revision: 2, actorId: 'other', scope: 'public', elements: [box('public', 20)], fileIds: [] },
  ];
  a.session.receive(events[0]);
  a.session.receive({ type: 'ack', commandId: a.sent[0].commandId, revision: 1 });
  b.session.receive({ ...events[0], commandId: 'remote-command' });
  a.session.receive(events[1]);
  b.session.receive({ ...events[1], commandId: b.sent[0].commandId });
  b.session.receive({ type: 'ack', commandId: b.sent[0].commandId, revision: 2 });
  assert.equal(a.session.view().elements[0].x, 20);
  assert.equal(b.session.view().elements[0].x, 20);
  assert.equal(a.session.view().unsaved, false);
  assert.equal(b.session.view().unsaved, false);
});

test('an acknowledgement does not discard a newer local edit to the same element', () => {
  const { session, sent } = client();
  session.localChange([box('public', 1)], {}); session.flush();
  session.localChange([box('public', 2)], {});
  accepted(session, sent[0], 1);
  assert.equal(sent[1].elements[0].x, 2);
  assert.equal(session.view().elements[0].x, 2);
});

test('reconnect retries the identical command ID and keeps unsent edits', () => {
  const { session, sent } = client();
  session.localChange([box('public', 1)], {}); session.flush();
  session.localChange([box('public', 2)], {});
  session.disconnected();
  session.receive({ type: 'snapshot', data: snapshot() });
  assert.deepEqual(sent[1], sent[0]);
  assert.equal(session.view().elements[0].x, 2);
});

test('a duplicate receipt after reconnect reveals the canonical snapshot', () => {
  const { session, sent } = client();
  session.localChange([box('public', 1)], {}); session.flush();
  session.disconnected();
  const saved = snapshot(); saved.elements = [box('public', 2)]; saved.board.revision = 2;
  session.receive({ type: 'snapshot', data: saved });
  session.receive({ type: 'ack', commandId: sent[0].commandId, revision: 1 });
  assert.equal(session.view().elements[0].x, 2);
  assert.equal(session.view().unsaved, false);
});

test('stale private drafts are recoverable and are never submitted as public patches', () => {
  const { session, sent } = client(true);
  session.localChange([box('public'), box('private', 42)], {});
  const next = snapshot(); next.board.epoch = 2;
  session.receive({ type: 'snapshot', data: next });
  session.flush();
  assert.equal(sent.length, 0);
  assert.equal(session.view().elements.some(el => el.id === 'private'), false);
  assert.equal(session.view().recovery[0].id, 'private');
});

test('a snapshot in the same round does not erase an unsent draft', () => {
  const { session } = client(true);
  session.localChange([box('public'), box('private', 42)], {});
  session.receive({ type: 'snapshot', data: snapshot(true) });
  assert.equal(session.view().elements.find(el => el.id === 'private').x, 42);
});

test('public objects remain locked throughout poker', () => {
  const { session, sent } = client(true);
  session.localChange([box('public', 99), box('private')], {}); session.flush();
  assert.deepEqual(sent[0].elements.map(el => el.id), ['private']);
  assert.equal(session.view().elements.find(el => el.id === 'public').x, 0);
});

test('image uploads are split into one binary per command', () => {
  const { session, sent } = client();
  const files = Object.fromEntries(['a', 'b'].map(id => [id, { id, mimeType: 'image/png', dataURL: 'data:image/png;base64,abc=', created: 1 }]));
  const images = ['a', 'b'].map(id => ({ ...box(id), type: 'image', fileId: id }));
  session.localChange([box('public'), ...images], files); session.flush();
  assert.equal(Object.keys(sent[0].files).length, 1);
  accepted(session, sent[0], 1);
  assert.equal(Object.keys(sent[1].files).length, 1);
});

test('database property ordering and stripped editor metadata do not create phantom edits', () => {
  const { session, sent } = client();
  const reordered = Object.fromEntries(Object.entries(box('public')).reverse());
  reordered.link = null;
  reordered.customData = { ignored: true };
  session.localChange([reordered], {}); session.flush();
  assert.equal(sent.length, 0);
  assert.equal(session.view().unsaved, false);
});

test('unchanged callbacks do not trigger another editor update', () => {
  let updates = 0;
  const session = new SyncSession(() => true, () => updates++);
  session.receive({ type: 'snapshot', data: snapshot(true) });
  const before = updates;
  session.localChange([box('public')], {});
  assert.equal(updates, before);
});

test('temporary throttling retries the same command after backoff without losing the draft', () => {
  const sent = [];
  let now = 0;
  const session = new SyncSession(packet => { sent.push(packet); return true; }, () => {}, () => 'retry-id', () => now);
  session.receive({ type: 'snapshot', data: snapshot() });
  session.localChange([box('public', 7)], {}); session.flush();
  session.receive({ type: 'error', commandId: 'retry-id', code: 'rate_limit', message: 'Wait' });
  session.flush(); assert.equal(sent.length, 1);
  now = 1200; session.flush();
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], sent[1]);
  accepted(session, sent[0], 1);
  assert.equal(session.view().recovery.length, 0);
  assert.equal(session.view().elements[0].x, 7);
  assert.equal(session.view().error, '');
});

test('a missing acknowledgement retries safely while the socket remains connected', () => {
  const sent = [];
  let now = 0;
  const session = new SyncSession(packet => { sent.push(packet); return true; }, () => {}, () => 'ack-id', () => now);
  session.receive({ type: 'snapshot', data: snapshot() });
  session.localChange([box('public', 7)], {}); session.flush();
  now = 15_000; session.flush();
  assert.deepEqual(sent[1], sent[0]);
});

test('renaming during poker preserves unacknowledged edits and frozen readiness', () => {
  const { session, sent } = client(true);
  session.localChange([box('public'), box('private', 17)], {});
  session.flush();
  session.receive({ type: 'metadata', name: 'Renamed' });
  assert.equal(session.view().snapshot.board.name, 'Renamed');
  assert.equal(session.view().elements.find(element => element.id === 'private').x, 17);
  assert.equal(session.view().unsaved, true);
  assert.equal(session.view().snapshot.round.members.length, 2);
  accepted(session, sent[0], 1, 'private');
  assert.equal(session.view().unsaved, false);
});
