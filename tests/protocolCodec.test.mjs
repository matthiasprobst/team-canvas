import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseServerEvent } = require('../.test-build/protocolCodec.js');

test('protocol decoder rejects missing revisions and malformed nested data', () => {
  assert.throws(() => parseServerEvent(JSON.stringify({ type: 'ack', commandId: 'a' })));
  assert.throws(() => parseServerEvent(JSON.stringify({ type: 'patch', commandId: 'a', revision: 1, actorId: 'p', scope: 'public', elements: [null], fileIds: [] })));
  assert.throws(() => parseServerEvent(JSON.stringify({ type: 'round', board: {}, round: null })));
  assert.throws(() => parseServerEvent('null'));
});

test('protocol decoder accepts acknowledgements and heartbeat responses', () => {
  assert.deepEqual(parseServerEvent('{"type":"ack","commandId":"a","revision":42}'), { type: 'ack', commandId: 'a', revision: 42 });
  assert.deepEqual(parseServerEvent('{"type":"pong"}'), { type: 'pong' });
});

test('metadata events only accept a bounded canvas name', () => {
  assert.deepEqual(parseServerEvent('{"type":"metadata","name":"Renamed"}'), { type: 'metadata', name: 'Renamed' });
  assert.throws(() => parseServerEvent('{"type":"metadata","name":""}'));
  assert.throws(() => parseServerEvent(JSON.stringify({ type: 'metadata', name: 'x'.repeat(121) })));
});

import { protocolEvents, snapshot } from './fixtures.mjs';

test('all shared protocol fixtures pass the production decoder', () => {
  for (const event of protocolEvents) assert.deepEqual(parseServerEvent(JSON.stringify(event)), event);
  for (const poker of [false, true]) {
    assert.deepEqual(parseServerEvent(JSON.stringify({ type: 'snapshot', data: snapshot(poker) })).data, snapshot(poker));
  }
});
