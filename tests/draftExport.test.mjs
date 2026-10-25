import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { draftDocument } = require('../.test-build/draftExport.js');

test('recovery exports contain their own images without unrelated scene files', () => {
  const view = {
    elements: [{ id: 'public', type: 'image', fileId: 'public-file' }],
    recovery: [{ id: 'private', type: 'image', fileId: 'private-file' }],
    files: { 'public-file': { id: 'public-file' }, 'private-file': { id: 'private-file' }, unused: { id: 'unused' } },
  };
  const recovered = draftDocument(view, true, 'https://canvas.test');
  assert.equal(recovered.type, 'excalidraw');
  assert.deepEqual(recovered.elements, view.recovery);
  assert.deepEqual(Object.keys(recovered.files), ['private-file']);
  const ordinary = draftDocument(view, false, 'https://canvas.test');
  assert.deepEqual(ordinary.elements, view.elements);
  assert.deepEqual(Object.keys(ordinary.files), ['public-file']);
});
