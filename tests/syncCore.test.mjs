import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { indexById, mergeById, changedElements, restoreLockedPublic } = require('../.test-build/syncCore.js');

const box = (id, x = 0) => ({ id, type: 'rectangle', x, y: 0, width: 10, height: 10 });

test('two independent edits do not replace the whole scene', () => {
  const a = [box('first'), box('second')];
  const merged = mergeById(a, [box('second', 9)]);
  assert.deepEqual(merged, [box('first'), box('second', 9)]);
});

test('delta includes only locally edited elements', () => {
  const prev = new Map([['a', JSON.stringify(box('a'))], ['b', JSON.stringify(box('b'))]]);
  assert.deepEqual(changedElements([box('a'), box('b', 2)], prev), [box('b', 2)]);
});

test('poker restores changes to public objects without discarding private notes', () => {
  const published = indexById([box('public', 1)]);
  const result = restoreLockedPublic([box('public', 99), box('private', 4)], published);
  assert.equal(result.reverted, true);
  assert.deepEqual(result.elements, [box('public', 1), box('private', 4)]);
});

test('deletion tombstones replace matching IDs', () => {
  const deleted = { ...box('a'), isDeleted: true };
  assert.deepEqual(mergeById([box('a'), box('b')], [deleted]), [deleted, box('b')]);
});

test('layer order follows fractional indices when merging a reorder', () => {
  const lower = { ...box('a'), index: 'a0' };
  const upper = { ...box('b'), index: 'a1' };
  assert.deepEqual(mergeById([lower, upper], [{ ...lower, index: 'a2' }]).map(el => el.id), ['b', 'a']);
});
