import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { assistantHistory } = require('../.test-build/assistantHistory.js');
const proposals = [
  { status: 'applied', message: 'Create Research', actions: [{ type: 'create_note', id: 'research', text: 'Research' }] },
  { status: 'pending', message: 'Proposed Design', actions: [{ type: 'create_note', id: 'design', text: 'Design' }] },
  { status: 'dismissed', message: 'Dismissed secret', actions: [] },
];
const restored = assistantHistory([], '', proposals, true, true);
assert.equal(restored.length, 1);
assert.match(restored[0].content, /Saved proposal activity/);
assert.match(restored[0].content, /APPLIED.*Create Research/);
assert.match(restored[0].content, /PENDING.*Proposed Design/);
assert.ok(!restored[0].content.includes('Dismissed secret'));
assert.deepEqual(assistantHistory([], '', proposals, false, true), []);
const messages = Array.from({ length: 30 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `Turn ${index}` }));
assert.equal(assistantHistory(messages, '', proposals, true, true).length, 25);
assert.equal(assistantHistory(messages, '', proposals, true, false).length, 12);
const memory = assistantHistory([{ role: 'assistant', content: 'Summary' }, ...messages], 'Summary', proposals, true, false);
assert.equal(memory[0].content, 'Summary');
assert.equal(memory.filter(turn => turn.content === 'Summary').length, 1);
assert.ok(!memory.some(turn => turn.content.includes('Saved proposal activity')));
assert.ok(assistantHistory([], '', [{ status: 'pending', message: 'x'.repeat(20000), actions: Array.from({ length: 20 }, () => ({ type: 'create_note', id: 'n', text: 'y'.repeat(10000) })) }], true, true)[0].content.length <= 8000);
