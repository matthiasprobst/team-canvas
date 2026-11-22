// Deterministic HTTP provider for isolated tests. Never configured by the application itself.
import { createServer } from 'node:http';

const port = Number(process.env.ASSISTANT_FIXTURE_PORT ?? 18182);
createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions' || request.method !== 'POST') { response.writeHead(404).end(); return; }
  let body = '';
  for await (const chunk of request) body += chunk;
  const { messages } = JSON.parse(body);
  if (messages[0].content.startsWith('Summarize this Team Canvas')) {
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Conversation summary: Keep the Research, Design and Build workflow. Research informs Design. Continue refining the existing notes.' } }] }));
    return;
  }
  const context = JSON.parse(messages[0].content.split('Current saved canvas: ')[1]);
  const last = messages.at(-1);
  const question = messages.findLast(message => message.role === 'user').content;
  const args = { boardId: context.board.id, pageId: context.board.pageId, epoch: context.board.epoch };
  let message;
  const tool = (name, values = {}) => ({ role: 'assistant', content: null, tool_calls: [{ id: 'fixture_call', type: 'function', function: { name, arguments: JSON.stringify({ ...args, ...values }) } }] });
  if (question.includes('provider failure')) { response.writeHead(503).end('test failure'); return; }
  if (last.role === 'tool') {
    const result = JSON.parse(last.content);
    message = { role: 'assistant', content: `The notes say: ${result.objects.map(object => object.text).join('; ')}.` };
  } else if (/how many|number of|count/i.test(question)) message = tool('count_objects');
  else if (/arrange|rearrange|tidy/i.test(question)) message = tool('propose_changes', { message: 'Arrange existing notes in a readable flow.', actions: [{ type: 'arrange_objects', ids: context.objects.filter(object => object.kind === 'note').map(object => object.id), layout: 'flow' }] });
  else if (/name.*connection|label.*connection/i.test(question)) message = tool('propose_changes', { message: 'Label the existing relationships.', actions: context.objects.filter(object => object.kind === 'connection').map(object => ({ type: 'label_connection', id: object.id, text: 'supports planning' })) });
  else if (/refine.*markdown/i.test(question)) message = tool('propose_changes', { message: 'Refine the ticket acceptance criteria.', actions: [{ type: 'update_text', id: context.objects.find(object => object.format === 'markdown').id, text: '# Refined ticket\n\n- [ ] Verify permissions\n- [x] Document requirements' }] });
  else if (/markdown|ticket/i.test(question)) message = tool('propose_changes', { message: 'Add a structured Markdown ticket.', actions: [{ type: 'create_markdown', id: 'ticket', text: '# CANVAS-42: Markdown notes\n\n## Acceptance criteria\n- [ ] Readable ticket\n- [x] Preserve source\n\n| Field | Value |\n| --- | --- |\n| Status | Ready |' }] });
  else if (/what.*written|read.*notes/i.test(question)) message = tool('read_objects', { ids: context.objects.filter(object => object.kind === 'note').map(object => object.id) });
  else if (/which.*connect|connect.*notes/i.test(question)) message = tool('propose_changes', { message: 'Connect Research to Design because research informs the design.', actions: [{ type: 'connect', sourceId: context.objects.find(object => object.kind === 'note' && object.text === 'Research').id, targetId: context.objects.find(object => object.kind === 'note' && object.text === 'Design').id, text: 'informs' }] });
  else if (/refine|rename/i.test(question)) message = tool('propose_changes', { message: 'Clarify the research task.', actions: [{ type: 'update_text', id: context.objects.find(object => object.kind === 'note' && object.text === 'Research').id, text: 'Research user needs' }] });
  else if (/ellipse/i.test(question)) message = tool('propose_changes', { message: 'Add a blue ellipse labelled API.', actions: [{ type: 'create_shape', shape: 'ellipse', text: 'API', color: '#a5d8ff' }] });
  else if (/heading/i.test(question)) message = tool('propose_changes', { message: 'Add the retrospective heading.', actions: [{ type: 'create_text', text: 'Sprint retrospective' }] });
  else message = tool('propose_changes', { message: 'Add three notes for your workflow.', actions: ['Research', 'Design', 'Build'].map((text, index) => ({ type: 'create_note', id: `note_${index}`, text })) });
  response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message }] }));
}).listen(port, '127.0.0.1', () => process.stdout.write(`Assistant test provider listening on ${port}\n`));
