import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';

function command(executable, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, options);
    let output = '';
    let diagnostic = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { diagnostic += chunk; });
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`${executable} timed out`)); }, 35_000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => {
      clearTimeout(timer);
      const safe = (output + diagnostic).split(options.env.TEAM_CANVAS_TEST_TOKEN).join('[redacted]').replace(/Bearer\s+[^\s"}]+/g, 'Bearer [redacted]').slice(0, 2000);
      code === 0 ? resolve(output) : reject(new Error(`${executable} exited ${code}: ${safe}`));
    });
  });
}

/** Exercise real MCP client runtimes without sending prompts to any model provider. */
export async function verifyMcpClients({ base, token, boardId }) {
  const directory = await mkdtemp(join(tmpdir(), 'team-canvas-mcp-clients-'));
  const env = { ...process.env, TEAM_CANVAS_TEST_TOKEN: token };
  const reports = [];
  try {
    const configuration = `{team_canvas={url=${JSON.stringify(`${base}/mcp`)},bearer_token_env_var="TEAM_CANVAS_TEST_TOKEN"}}`;
    const child = spawn('codex', ['app-server', '-c', `mcp_servers=${configuration}`, '-c', 'features.apps=false'], { cwd: directory, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let sequence = 0;
    const pending = new Map();
    child.stderr.on('data', () => {});
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      let packet;
      try { packet = JSON.parse(line); } catch { return; }
      if (packet.id !== undefined && pending.has(packet.id)) {
        const { resolve, reject, timer } = pending.get(packet.id); pending.delete(packet.id); clearTimeout(timer);
        packet.error ? reject(new Error(`Codex RPC error: ${packet.error.message}`)) : resolve(packet.result);
      }
    });
    const rpc = (method, params) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Codex ${method} timed out`)); }, 30_000);
      pending.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
    try {
      await rpc('initialize', { clientInfo: { name: 'team_canvas_mcp_test', version: '1.0.0' }, capabilities: { experimentalApi: true } });
      child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
      const started = await rpc('thread/start', { cwd: directory, ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only' });
      const threadId = started.thread.id;
      const status = await rpc('mcpServerStatus/list', { threadId, serverName: 'team_canvas' });
      const server = status.data.find(item => item.name === 'team_canvas');
      assert.ok(server, 'Codex must discover the Team Canvas server');
      assert.ok(Object.keys(server.tools).some(name => name.endsWith('inspect_canvas')), 'Codex must discover inspection tools');
      const inspected = await rpc('mcpServer/tool/call', { threadId, server: 'team_canvas', tool: 'inspect_canvas', arguments: { boardId } });
      assert.equal(inspected.isError, false);
      const proposed = await rpc('mcpServer/tool/call', { threadId, server: 'team_canvas', tool: 'propose_changes', arguments: { boardId,
        message: 'Codex client integration proposal', actions: [{ type: 'create_note', text: 'Created through Codex MCP' }] } });
      assert.equal(proposed.isError, false);
      reports.push({ client: 'Codex', version: (await command('codex', ['--version'], { cwd: directory, env })).trim(), tools: Object.keys(server.tools).length, inspected: true, proposed: true });
    } finally {
      for (const { timer } of pending.values()) clearTimeout(timer);
      child.kill('SIGTERM'); lines.close();
    }

    const openCodeEnv = { ...env, OPENCODE_TEST_HOME: join(directory, 'opencode-home'), OPENCODE_CLI_CONFIG_CONTENT: JSON.stringify({ service: { disabled: true } }), XDG_CONFIG_HOME: join(directory, 'config'), XDG_DATA_HOME: join(directory, 'data'), XDG_CACHE_HOME: join(directory, 'cache') };
    await mkdir(openCodeEnv.OPENCODE_TEST_HOME);
    const reservation = createServer();
    await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    const openCode = spawn('opencode', ['serve', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: directory, env: openCodeEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let startupDiagnostic = '';
    openCode.stdout.on('data', chunk => { startupDiagnostic += chunk; }); openCode.stderr.on('data', chunk => { startupDiagnostic += chunk; });
    const local = `http://127.0.0.1:${port}`;
    const localHeaders = () => {
      const password = startupDiagnostic.match(/server password\s+(\S+)/)?.[1];
      return password ? { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` } : {};
    };
    try {
      let started = false;
      for (let attempt = 0; attempt < 80; attempt++) {
        try { if ((await fetch(`${local}/openapi.json`, { headers: localHeaders() })).ok) { started = true; break; } } catch {}
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      const safeStartup = startupDiagnostic.split(token).join('[redacted]').replace(/Bearer\s+[^\s"}]+/g, 'Bearer [redacted]').replace(/server password\s+\S+/g, 'server password [redacted]').slice(0, 1800);
      assert.ok(started, `OpenCode private runtime must start: ${safeStartup}`);
      const connected = await fetch(`${local}/api/experimental/mcp/team_canvas`, { method: 'PUT', headers: { ...localHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ config: {
        type: 'remote', url: `${base}/mcp`, oauth: false, headers: { Authorization: `Bearer ${token}` },
      } }) });
      assert.ok(connected.ok, `OpenCode MCP add returned ${connected.status}`);
      let status;
      for (let attempt = 0; attempt < 80; attempt++) {
        status = await (await fetch(`${local}/api/mcp`, { headers: localHeaders() })).json();
        if (!JSON.stringify(status).includes('"pending"')) break;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      assert.match(JSON.stringify(status), /team_canvas/);
      const safeStatus = JSON.stringify(status).split(token).join('[redacted]').replace(/Bearer\s+[^\s"}]+/g, 'Bearer [redacted]');
      assert.match(safeStatus, /"connected"/i, `OpenCode must complete authenticated MCP discovery: ${safeStatus.slice(0, 2500)}`);
      reports.push({ client: 'OpenCode', version: (await command('opencode', ['--version'], { cwd: directory, env: openCodeEnv })).trim(), connected: true });
    } finally { openCode.kill('SIGTERM'); }

    const claudeDirectory = join(directory, 'claude'); await mkdir(claudeDirectory);
    const claudeEnv = { ...env, CLAUDE_CONFIG_DIR: claudeDirectory, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };
    await command('claude', ['mcp', 'add-json', '--scope', 'user', 'team_canvas', JSON.stringify({ type: 'http', url: `${base}/mcp`, headers: { Authorization: 'Bearer ${TEAM_CANVAS_TEST_TOKEN}' } })], { cwd: directory, env: claudeEnv });
    const claudeStatus = await command('claude', ['mcp', 'list'], { cwd: directory, env: claudeEnv });
    assert.match(claudeStatus, /team_canvas/);
    assert.match(claudeStatus, /connected/i, 'Claude Code must complete MCP discovery');
    reports.push({ client: 'Claude Code', version: (await command('claude', ['--version'], { cwd: directory, env: claudeEnv })).trim(), connected: true });
    return reports;
  } finally { await rm(directory, { recursive: true, force: true }); }
}
