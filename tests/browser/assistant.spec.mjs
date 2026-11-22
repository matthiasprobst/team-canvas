import { test, expect } from '../../frontend/node_modules/playwright/test.mjs';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { api, base, login } from './helpers.mjs';
import { verifyMcpClients } from '../mcpClients.mjs';

// Run against the isolated deployment using tests/fixtures/assistant-provider.mjs.
test.skip(process.env.ASSISTANT_TEST_PROVIDER !== 'fixture', 'Requires the isolated deterministic HTTP AI provider');

function scene(page) {
  const elements = new Map();
  let board;
  page.on('websocket', socket => socket.on('framereceived', event => {
    const packet = JSON.parse(String(event.payload));
    if (packet.type === 'snapshot') { elements.clear(); packet.data.elements.forEach(element => elements.set(element.id, element)); board = packet.data.board; }
    if (packet.type === 'patch') packet.elements.forEach(element => elements.set(element.id, element));
  }));
  return { live: () => [...elements.values()].filter(element => !element.isDeleted), board: () => board };
}

async function ask(page, message) {
  await page.getByLabel('Ask about your canvas', { exact: true }).fill(message);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Thinking…', { exact: true })).toBeHidden();
}

async function addLatest(page) {
  const pending = page.getByRole('article', { name: 'Canvas proposal' }).filter({ has: page.getByRole('button', { name: 'Add to canvas', exact: true }) }).last();
  await expect(pending).toBeVisible();
  const id = await pending.getAttribute('data-proposal-id');
  const proposal = page.locator(`[data-proposal-id="${id}"]`);
  await proposal.getByRole('button', { name: 'Add to canvas', exact: true }).click();
  await expect(proposal.getByText('Added to canvas', { exact: true })).toBeVisible();
}

async function oauthToken(context) {
  const issuer = process.env.ASSISTANT_TEST_ISSUER ?? 'http://localhost:18181/auth/realms/team-canvas';
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(20).toString('hex');
  let capture;
  const received = new Promise(resolve => { capture = resolve; });
  const server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/plain' }).end('OAuth test complete.');
    capture(new URL(request.url, 'http://localhost'));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const redirect = `http://127.0.0.1:${server.address().port}/callback`;
  const page = await context.newPage();
  try {
    const params = new URLSearchParams({ client_id: 'team-canvas-mcp', redirect_uri: redirect, response_type: 'code', scope: 'openid profile canvas:read canvas:propose', state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
    await page.goto(`${issuer}/protocol/openid-connect/auth?${params}`);
    await expect(page).toHaveURL(new RegExp(`127\\.0\\.0\\.1:${server.address().port}/callback`));
    const callback = await received;
    expect(callback.searchParams.get('state')).toBe(state);
    const response = await context.request.post(`${issuer}/protocol/openid-connect/token`, { form: { grant_type: 'authorization_code', client_id: 'team-canvas-mcp', code: callback.searchParams.get('code'), redirect_uri: redirect, code_verifier: verifier } });
    expect(response.status()).toBe(200);
    const result = await response.json();
    const claims = JSON.parse(Buffer.from(result.access_token.split('.')[1], 'base64url'));
    expect([claims.aud].flat()).toContain(`${base}/mcp`);
    expect(claims.scope).toContain('canvas:read');
    return result.access_token;
  } finally { await page.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

async function mcp(context, token, method, params = {}, id = 1) {
  const response = await context.request.post(`${base}/mcp`, { data: { jsonrpc: '2.0', id, method, params }, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' } });
  expect(response.status()).toBe(200);
  return (await response.json()).result;
}

test('chat answers questions and creates editable notes, shapes, text and connections across sessions', async ({ browser }, testInfo) => {
  const alice = await browser.newContext({ baseURL: base });
  const bob = await browser.newContext({ baseURL: base });
  let board;
  try {
    const a = await alice.newPage(), b = await bob.newPage();
    const errors = [];
    const consoleProblems = [];
    a.on('pageerror', error => errors.push(error.message));
    b.on('pageerror', error => errors.push(error.message));
    for (const page of [a, b]) page.on('console', message => { if (['error', 'warning'].includes(message.type())) consoleProblems.push(message.text()); });
    await login(a, 'alice'); await login(b, 'bob');
    expect((await api(alice, '/api/me', undefined, 'GET')).admin).toBe(true);
    expect((await api(bob, '/api/me', undefined, 'GET')).admin).toBe(false);
    // The SSO entry deliberately probes /api/me before authentication (HTTP 499).
    consoleProblems.length = 0;
    board = await api(alice, '/api/boards', { name: `Assistant verification ${Date.now()}` });
    const invitation = await api(alice, `/api/boards/${board.id}/invitations`, {});
    await api(bob, `/api/boards/${board.id}/join`, { inviteKey: invitation.inviteKey });
    const remote = scene(b);
    await a.goto(`/b/${board.id}`); await b.goto(`/b/${board.id}`);
    await expect(a).toHaveTitle('Team Canvas');
    await expect(a).toHaveURL(new RegExp(`/b/${board.id}$`));
    await expect(a.getByRole('button', { name: 'Sticky note' })).toBeEnabled();
    await a.getByRole('button', { name: 'Open AI assistant', exact: true }).click();
    await expect(a.getByLabel('AI assistant', { exact: true })).toBeVisible();
    await ask(a, 'How many notes are on this page?');
    await expect(a.getByRole('log').getByText(/0 notes, 0 shapes/)).toBeVisible();
    await ask(a, 'Create three notes: Research, Design, Build');
    await addLatest(a);
    await expect.poll(() => remote.live().filter(element => element.customData?.teamCanvasKind === 'note').length).toBe(3);
    expect(remote.live().filter(element => element.type === 'text').map(element => element.text).sort()).toEqual(['Build', 'Design', 'Research']);
    await a.getByRole('button', { name: /^Undo/ }).click();
    await expect.poll(() => remote.live().filter(element => element.customData?.teamCanvasKind === 'note').length).toBe(0);
    await a.getByRole('button', { name: /^Redo/ }).click();
    await expect.poll(() => remote.live().filter(element => element.customData?.teamCanvasKind === 'note').length).toBe(3);
    for (const note of remote.live().filter(element => element.customData?.teamCanvasKind === 'note')) {
      const label = remote.live().find(element => element.containerId === note.id);
      expect(note.boundElements).toContainEqual({ type: 'text', id: label.id });
      expect(label.id).toBe(`${note.id}_text`);
    }
    await ask(a, 'How many elements are on this page?');
    await expect(a.getByRole('log').getByText(/3 objects: 3 notes.*6 drawing elements/)).toBeVisible();
    await ask(a, 'What is written in the notes?');
    await expect(a.getByRole('log').getByText(/The notes say:.*Research/)).toBeVisible();
    await expect(a.getByRole('button', { name: 'Research', exact: true })).toBeVisible();
    await a.screenshot({ path: testInfo.outputPath('assistant-questions-and-notes-desktop.png') });
    await a.getByRole('button', { name: 'Research', exact: true }).click();
    await a.getByLabel('Assistant context', { exact: true }).selectOption('selection');
    await ask(a, 'How many notes are selected?');
    await expect(a.getByRole('log').getByText(/1 objects: 1 notes/)).toBeVisible();
    await a.getByLabel('Assistant context', { exact: true }).selectOption('page');
    await ask(a, 'Create a blue ellipse labelled API'); await addLatest(a);
    await expect.poll(() => remote.live().filter(element => element.type === 'ellipse').length).toBe(1);
    await ask(a, 'Create a heading: Sprint retrospective'); await addLatest(a);
    await expect.poll(() => remote.live().some(element => element.text === 'Sprint retrospective' && element.containerId === null)).toBe(true);
    await ask(a, 'Which notes should be connected?'); await addLatest(a);
    await expect.poll(() => remote.live().filter(element => element.type === 'arrow').length).toBe(1);
    const arrow = remote.live().find(element => element.type === 'arrow');
    expect(arrow.startBinding.elementId).toBeTruthy(); expect(arrow.endBinding.elementId).toBeTruthy();
    expect(remote.live().find(element => element.containerId === arrow.startBinding.elementId).text).toBe('Research');
    expect(remote.live().find(element => element.containerId === arrow.endBinding.elementId).text).toBe('Design');
    expect(remote.live().find(element => element.containerId === arrow.id).text).toBe('informs');
    await ask(a, 'Refine the research note'); await addLatest(a);
    await expect.poll(() => remote.live().some(element => element.originalText === 'Research user needs')).toBe(true);
    expect(remote.live().find(element => element.originalText === 'Research user needs').containerId).toBe(arrow.startBinding.elementId);
    await a.screenshot({ path: testInfo.outputPath('assistant-desktop.png') });
    await expect(a.locator('vite-error-overlay')).toHaveCount(0);
    await a.setViewportSize({ width: 390, height: 844 });
    const bounds = await a.getByLabel('AI assistant', { exact: true }).boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    await a.screenshot({ path: testInfo.outputPath('assistant-mobile.png') });
    await a.setViewportSize({ width: 1440, height: 1000 });
    expect(consoleProblems).toEqual([]);
    await ask(a, 'provider failure');
    await expect(a.getByRole('alert').filter({ hasText: 'AI service could not complete' })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    if (board) await alice.request.delete(`${base}/api/boards/${board.id}`, { headers: { Origin: base } });
    await alice.close(); await bob.close();
  }
});

test('OAuth MCP can read saved content and propose objects with the browser closed', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: base });
  let board;
  try {
    const page = await context.newPage(); await login(page, 'alice');
    board = await api(context, '/api/boards', { name: `MCP verification ${Date.now()}` });
    const discovery = await context.request.get(`${base}/.well-known/oauth-protected-resource/mcp`);
    expect(discovery.status()).toBe(200); expect((await discovery.json()).resource).toBe(`${base}/mcp`);
    const anonymous = await browser.newContext();
    const challenge = await anonymous.request.post(`${base}/mcp`, { data: { jsonrpc: '2.0', id: 1, method: 'initialize' } });
    expect(challenge.status()).toBe(401);
    expect(challenge.headers()['www-authenticate']).toContain('/.well-known/oauth-protected-resource/mcp');
    await anonymous.close();
    const token = await oauthToken(context);
    const initialized = await mcp(context, token, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'assistant-integration-test', version: '1' } });
    expect(initialized.capabilities.tools).toBeTruthy();
    const listed = await mcp(context, token, 'tools/list');
    expect(listed.tools.map(tool => tool.name)).toContain('get_connected_notes');
    const read = await mcp(context, token, 'tools/call', { name: 'inspect_canvas', arguments: { boardId: board.id } });
    expect(read.isError).toBe(false);
    const canvas = read.structuredContent.result;
    const proposed = await mcp(context, token, 'tools/call', { name: 'propose_changes', arguments: { boardId: board.id, pageId: canvas.board.pageId, epoch: canvas.board.epoch,
      message: 'External assistant proposes a feature and its acceptance criterion.', actions: [
        { type: 'create_note', id: 'feature', text: 'Password reset' }, { type: 'create_note', id: 'criterion', text: 'Send reset email' },
        { type: 'connect', sourceId: 'feature', targetId: 'criterion', text: 'acceptance criterion' },
      ] } });
    expect(proposed.isError).toBe(false);
    await page.goto(`/b/${board.id}`);
    const state = scene(page);
    await page.getByRole('button', { name: 'Open AI assistant', exact: true }).click();
    await expect(page.getByRole('article', { name: 'Canvas proposal' })).toBeVisible();
    await addLatest(page);
    const status = await mcp(context, token, 'tools/call', { name: 'list_proposals', arguments: { boardId: board.id } });
    expect(status.structuredContent.result[0].status).toBe('applied');
    const saved = await mcp(context, token, 'tools/call', { name: 'inspect_canvas', arguments: { boardId: board.id } });
    expect(saved.structuredContent.result.counts.notes).toBe(2);
    expect(saved.structuredContent.result.counts.connections).toBe(1);
    const feature = saved.structuredContent.result.objects.find(object => object.text === 'Password reset');
    const linked = await mcp(context, token, 'tools/call', { name: 'get_connected_notes', arguments: { boardId: board.id, id: feature.id } });
    expect(linked.structuredContent.result.relatedObjects[0].text).toBe('Send reset email');
    const before = saved.structuredContent.result.counts.rawElements;
    await page.reload();
    await page.getByRole('button', { name: 'Open AI assistant', exact: true }).click();
    await expect(page.getByText('Added to canvas', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add to canvas', exact: true })).toHaveCount(0);
    const again = await mcp(context, token, 'tools/call', { name: 'inspect_canvas', arguments: { boardId: board.id } });
    expect(again.structuredContent.result.counts.rawElements).toBe(before);
    expect(state).toBeTruthy();
  } finally {
    if (board) await context.request.delete(`${base}/api/boards/${board.id}`, { headers: { Origin: base } });
    await context.close();
  }
});

test('Codex, OpenCode and Claude Code connect to the authenticated MCP server', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ baseURL: base });
  let board;
  try {
    const page = await context.newPage(); await login(page, 'alice');
    board = await api(context, '/api/boards', { name: `MCP client verification ${Date.now()}` });
    const token = await oauthToken(context);
    const reports = await verifyMcpClients({ base, token, boardId: board.id });
    const reportPath = testInfo.outputPath('mcp-client-compatibility.json');
    await writeFile(reportPath, JSON.stringify(reports, null, 2));
    await testInfo.attach('mcp-client-compatibility', { path: reportPath, contentType: 'application/json' });
    expect(reports.map(report => report.client)).toEqual(['Codex', 'OpenCode', 'Claude Code']);
    const proposals = await mcp(context, token, 'tools/call', { name: 'list_proposals', arguments: { boardId: board.id } });
    expect(proposals.structuredContent.result.some(proposal => proposal.message === 'Codex client integration proposal')).toBe(true);
  } finally {
    if (board) await context.request.delete(`${base}/api/boards/${board.id}`, { headers: { Origin: base } });
    await context.close();
  }
});

test('chat-created poker notes stay private and external MCP sees shared content only', async ({ browser }) => {
  const alice = await browser.newContext({ baseURL: base }), bob = await browser.newContext({ baseURL: base });
  let board;
  try {
    const a = await alice.newPage(), b = await bob.newPage();
    await login(a, 'alice'); await login(b, 'bob');
    board = await api(alice, '/api/boards', { name: `Assistant privacy ${Date.now()}` });
    const invitation = await api(alice, `/api/boards/${board.id}/invitations`, {});
    await api(bob, `/api/boards/${board.id}/join`, { inviteKey: invitation.inviteKey });
    const token = await oauthToken(alice);
    const remote = scene(b);
    await a.goto(`/b/${board.id}`); await b.goto(`/b/${board.id}`);
    await expect(a.getByRole('button', { name: 'Start poker', exact: true })).toBeEnabled();
    await a.getByRole('button', { name: 'Start poker', exact: true }).click();
    await expect(a.getByRole('button', { name: 'Stop poker and reveal', exact: true })).toBeEnabled();
    await a.getByRole('button', { name: 'Open AI assistant', exact: true }).click();
    await ask(a, 'Create three private notes'); await addLatest(a);
    await ask(a, 'How many notes are here?');
    await expect(a.getByRole('log').getByText(/3 objects: 3 notes/)).toBeVisible();
    expect(remote.live()).toHaveLength(0);
    const hidden = await mcp(alice, token, 'tools/call', { name: 'inspect_canvas', arguments: { boardId: board.id } });
    expect(hidden.structuredContent.result.counts.objects).toBe(0);
    const blocked = await mcp(alice, token, 'tools/call', { name: 'propose_changes', arguments: { boardId: board.id, message: 'External write during poker', actions: [{ type: 'create_note', text: 'Must be rejected' }] } });
    expect(blocked.isError).toBe(true);
    await b.getByRole('button', { name: 'Stop poker and reveal', exact: true }).click();
    await b.getByRole('dialog', { name: 'Stop poker and reveal?' }).getByRole('button', { name: 'Reveal saved contributions' }).click();
    await expect.poll(() => remote.live().filter(element => element.customData?.teamCanvasKind === 'note').length).toBe(3);
    await a.getByRole('button', { name: 'Open AI assistant', exact: true }).click();
    await expect(a.getByRole('log')).toBeEmpty();
    const revealed = await mcp(alice, token, 'tools/call', { name: 'inspect_canvas', arguments: { boardId: board.id } });
    expect(revealed.structuredContent.result.counts.notes).toBe(3);
    const proposals = await mcp(alice, token, 'tools/call', { name: 'list_proposals', arguments: { boardId: board.id } });
    expect(proposals.structuredContent.result).toEqual([]);
  } finally {
    if (board) await alice.request.delete(`${base}/api/boards/${board.id}`, { headers: { Origin: base } });
    await alice.close(); await bob.close();
  }
});

test('MCP creates connected Markdown ticket proposals and chat refines their source', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: base });
  let board;
  try {
    const page = await context.newPage();
    await login(page, 'alice');
    board = await api(context, '/api/boards', { name: `Markdown MCP ${Date.now()}` });
    const token = await oauthToken(context);
    const proposal = await mcp(context, token, 'tools/call', { name: 'propose_changes', arguments: {
      boardId: board.id, message: 'Add a ticket and its acceptance criterion.', actions: [
        { type: 'create_markdown', id: 'ticket', text: '# CANVAS-42\n\n## Acceptance criteria\n- [ ] Verify permissions' },
        { type: 'create_note', id: 'criterion', text: 'Check access' },
        { type: 'connect', sourceId: 'ticket', targetId: 'criterion', text: 'requires' },
      ],
    } });
    expect(proposal.isError).toBe(false);
    await page.goto(`/b/${board.id}`);
    await page.getByRole('button', { name: 'Open AI assistant', exact: true }).click();
    await addLatest(page);
    await expect(page.getByRole('article', { name: 'Markdown note', exact: true }).getByRole('heading', { name: 'CANVAS-42', exact: true })).toBeVisible();
    const inspected = await mcp(context, token, 'tools/call', { name: 'inspect_canvas', arguments: { boardId: board.id } });
    const canvas = inspected.structuredContent.result;
    expect(canvas.counts.notes).toBe(2);
    expect(canvas.counts.connections).toBe(1);
    const ticket = canvas.objects.find(object => object.format === 'markdown');
    expect(ticket.text).toContain('- [ ] Verify permissions');
    const connected = await mcp(context, token, 'tools/call', { name: 'get_connected_notes', arguments: { boardId: board.id, id: ticket.id } });
    expect(connected.structuredContent.result.relatedObjects[0].text).toBe('Check access');
    await ask(page, 'Refine this markdown ticket');
    await addLatest(page);
    await expect(page.getByRole('article', { name: 'Markdown note', exact: true }).getByRole('heading', { name: 'Refined ticket', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Refined ticket', exact: true })).toBeVisible();
  } finally {
    if (board) await api(context, `/api/boards/${board.id}`, undefined, 'DELETE', 204);
    await context.close();
  }
});
