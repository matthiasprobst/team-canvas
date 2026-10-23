import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { SyncSession } = require('../.test-build/syncSession.js');
const box = (id, x = 0) => ({ id, type: 'rectangle', x, y: 0, width: 10, height: 10 });
import { snapshot as protocolSnapshot } from './fixtures.mjs';
const snapshot = (poker = false) => {
  const state = protocolSnapshot(poker);
  state.board.id = 'board';
  state.board.roundId = poker ? 'round' : null;
  state.elements = [box('public')];
  state.publicIds = ['public'];
  state.participantId = 'me';
  if (poker) {
    state.round.id = 'round';
  }
  return state;
};
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

test('stop waits for this browser pending edits to be acknowledged', () => {
  const { session, sent } = client(true);
  session.localChange([box('public'), box('private', 42)], {});
  session.control('stop_round');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'patch');
  accepted(session, sent[0], 4, 'private');
  assert.equal(sent.length, 2);
  assert.equal(sent[1].type, 'stop_round');
  assert.equal(sent[1].roundId, 'round');
});

test('round metadata preserves the local draft', () => {
  const { session } = client(true);
  session.localChange([box('public'), box('private', 42)], {});
  const state = snapshot(true);
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
  assert.equal(session.view().snapshot.round.id, "round");
  accepted(session, sent[0], 1, 'private');
  assert.equal(session.view().unsaved, false);
});

test('duplicate control acknowledgement followed by a snapshot completes a retried no-op page selection', () => {
  const { session, sent } = client();
  const state = snapshot();
  session.selectPage(state.board.pageId);
  const command = sent[0];
  session.disconnected();
  state.board.revision = 1;
  session.receive({ type: 'snapshot', data: state });
  assert.deepEqual(sent[1], command);
  session.receive({ type: 'ack', commandId: command.commandId, revision: 1 });
  assert.equal(session.view().busy, true);
  session.receive({ type: 'snapshot', data: state });
  assert.equal(session.view().busy, false);
  assert.equal(session.view().unsaved, false);
  session.localChange([box('public', 8)], {});
  session.flush();
  assert.equal(sent.at(-1).type, 'patch');
});

test('page selection waits for pending edits and a page transition preserves unconfirmed edits as recovery', () => {
  const { session, sent } = client();
  session.localChange([box('public', 9)], {});
  session.selectPage('next-page');
  assert.equal(sent[0].type, 'patch');
  accepted(session, sent[0], 1);
  assert.equal(sent[1].type, 'select_page');
  const next = snapshot();
  next.board.pageId = 'next-page';
  next.board.epoch = 1;
  next.board.revision = 2;
  next.elements = [];
  session.receive({ type: 'ack', commandId: sent[1].commandId, revision: 2 });
  session.receive({ type: 'snapshot', data: next });
  assert.equal(session.view().busy, false);
  assert.deepEqual(session.view().elements, []);

  const other = client();
  other.session.localChange([box('public', 12)], {});
  other.session.receive({ type: 'snapshot', data: next });
  other.session.flush();
  assert.equal(other.sent.length, 0);
  assert.equal(other.session.view().recovery[0].x, 12);
});

test('page actions are blocked during poker and retrying a completed transition does not replay drafts', () => {
  const { session, sent } = client(true);
  session.createPage(true, true);
  session.selectPage('other-page');
  assert.equal(sent.length, 0);
  session.control('stop_round');
  const command = sent[0];
  session.disconnected();
  const state = snapshot();
  state.board.epoch = 2;
  state.board.revision = 3;
  session.receive({ type: 'snapshot', data: state });
  session.receive({ type: 'ack', commandId: command.commandId, revision: 3 });
  assert.equal(session.view().busy, false);
  assert.equal(session.view().unsaved, false);
  assert.equal(sent.length, 1);
});
