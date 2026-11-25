import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { normalizeElement, elementFingerprint } = require('../.test-build/syncCore.js');
const { MARKDOWN_LINK } = require('../.test-build/markdownCore.js');

const note = { id: 'ticket', type: 'embeddable', link: MARKDOWN_LINK, customData: { teamCanvasKind: 'markdown', markdown: '# Ticket\n- [ ] Test', html: '<script>bad()</script>' } };
assert.deepEqual(normalizeElement(note).customData, { teamCanvasKind: 'markdown', markdown: '# Ticket\n- [ ] Test' });
assert.equal(normalizeElement(note).link, MARKDOWN_LINK);
assert.notEqual(elementFingerprint(note), elementFingerprint({ ...note, customData: { ...note.customData, markdown: '# Changed' } }));
assert.equal(normalizeElement({ id: 'shape', type: 'rectangle', link: 'https://external.example' }).link, undefined);
