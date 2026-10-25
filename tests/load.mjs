/** Disposable deployment only; provision load01..load10 in its development IdP first.
 * Capacity: 200 sockets/20 canvases, one write per socket every five seconds.
 * Workshop: ten writers on one seeded scene/image, 110ms target cadence with ACK backpressure.
 * LOAD_INTERVAL_MS can model a slower workshop soak; daily quotas are never bypassed.
 * These are protocol/asset loads, not rendered-editor performance measurements.
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { chromium } from '../frontend/node_modules/playwright/index.mjs';
import { api, base, login } from './browser/helpers.mjs';

const duration = Number(process.env.LOAD_SECONDS ?? 60);
assert(Number.isInteger(duration) && duration >= 10 && duration <= 14400);
const profile = process.env.LOAD_PROFILE ?? 'capacity';
assert(['capacity', 'workshop'].includes(profile), 'LOAD_PROFILE must be capacity or workshop');
const intervalMs = Number(process.env.LOAD_INTERVAL_MS ?? (profile === 'workshop' ? 110 : 5000));
assert(Number.isInteger(intervalMs) && intervalMs >= 110 && intervalMs <= 60000);
const canvasCount = profile === 'workshop' ? 1 : 20;
const seedElements = profile === 'workshop' ? Number(process.env.LOAD_SCENE_ELEMENTS ?? 500) : 0;
assert(Number.isInteger(seedElements) && seedElements >= 0 && seedElements <= 3900);
const targetMs = Number(process.env.LOAD_P95_MS ?? 1000);
assert(Number.isFinite(targetMs) && targetMs > 0 && targetMs <= 30000);
// A fixed histogram keeps four-hour runs bounded even with a faster capacity cadence.
// Rounded-up millisecond buckets make the reported p95 conservative at the target boundary.
const latencyBucketLimitMs = 60000;
const browser = await chromium.launch(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {});
const users = [], boards = [];
try {
  for (let i = 1; i <= 10; i++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    users.push({ context, page });
    await login(page, `load${String(i).padStart(2, '0')}`);
    console.log(`Authenticated disposable load account ${i}`);
    for (let j = 0; j < (profile === 'workshop' ? (i === 1 ? 1 : 0) : 2); j++) {
      const board = await api(context, '/api/boards', { name: `Disposable load ${i}/${j}` });
      boards.push({ ...board, owner: context, invitation: await api(context, `/api/boards/${board.id}/invitations`, {}) });
    }
  }
  for (const [index, user] of users.entries()) {
    const sessions = [];
    for (const board of boards) {
      const session = await api(user.context, `/api/boards/${board.id}/join`, { inviteKey: board.invitation.inviteKey });
      sessions.push({ id: board.id, token: session.token });
    }
    await user.page.evaluate(async ({ sessions, index, maxReconnects, latencyBucketLimitMs }) => {
      const load = window.load = { clients: [], pending: new Map(), acknowledged: 0,
        latencyHistogram: new Uint32Array(latencyBucketLimitMs + 2), maxLatencyMs: 0, errors: [], failureCount: 0, closed: 0,
        sent: 0, backpressure: 0, offlineTicks: 0, reconnects: 0, refreshes: 0, retries: 0,
        assetDownloads: 0, assetJobs: new Set(), recoveryDowntimeMs: 0, stopped: false };
      const fail = (client, message) => {
        load.failureCount++;
        if (load.errors.length < 20) load.errors.push({ canvas: client.id, message });
      };
      const downloadAssets = (client, ids) => {
        for (const id of ids) {
          if (client.assets.has(id)) continue;
          client.assets.add(id);
          const job = fetch(`/api/boards/${client.id}/assets/${encodeURIComponent(id)}`, {
            headers: { 'X-Board-Token': client.token, 'X-Requested-With': 'JavaScript' }, cache: 'no-store',
            signal: AbortSignal.timeout(15000),
          }).then(async response => {
            if (!response.ok) throw Error(`Image download HTTP ${response.status}`);
            const image = await response.json();
            if (image.id !== id || !image.dataURL?.startsWith('data:image/')) throw Error('Invalid image response');
            load.assetDownloads++;
          }).catch(error => fail(client, error.message)).finally(() => load.assetJobs.delete(job));
          load.assetJobs.add(job);
        }
      };
      load.connect = client => new Promise((resolve, reject) => {
        const address = new URL(`/ws/boards/${client.id}`, location.href);
        address.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const socket = new WebSocket(address);
        client.socket = socket;
        let settled = false;
        let expiry = false;
        const timer = setTimeout(() => { reject(Error('Snapshot timeout')); socket.close(); }, 10000);
        socket.onopen = () => socket.send(JSON.stringify({ type: 'hello', token: client.token, protocolVersion: 2 }));
        socket.onclose = event => {
          clearTimeout(timer);
          if (client.socket !== socket) return;
          client.ready = false;
          client.offlineSince ??= performance.now();
          if (!settled) reject(Error(`Socket closed before snapshot (${event.code})`));
          if (load.stopped) return;
          const expired = expiry || (event.code === 1008 && ['login_expired', 'Login expired'].includes(event.reason));
          if (expired) {
            // All 20 sockets of an identity can expire together. One recovery owns
            // its cookie refresh; each socket reconnects once that refresh completes.
            if (!client.recovering) void load.recover(client);
          } else if (!client.recovering) {
            load.closed++;
            fail(client, `Unexpected socket closure (${event.code})`);
          }
        };
        socket.onmessage = event => {
          if (client.socket !== socket || load.stopped) return;
          let packet;
          try { packet = JSON.parse(event.data); }
          catch {
            fail(client, 'Invalid server JSON');
            socket.close(1002, 'Invalid server JSON');
            return;
          }
          if (packet.type === 'snapshot') {
            client.state = packet.data.board;
            client.ready = true;
            if (client.offlineSince !== undefined) {
              load.recoveryDowntimeMs += performance.now() - client.offlineSince;
              delete client.offlineSince;
            }
            settled = true;
            clearTimeout(timer);
            downloadAssets(client, packet.data.fileIds);
            // Retry an uncertain outcome with the original command ID, as the app
            // does after its authoritative reconnect snapshot.
            if (client.inFlight) {
              const flight = load.pending.get(client.inFlight);
              socket.send(JSON.stringify(flight.command));
              flight.lastDispatch = performance.now();
              load.retries++;
            }
            resolve();
          }
          if (packet.type === 'round') client.state = packet.board;
          if (packet.type === 'patch') downloadAssets(client, packet.fileIds);
          if (packet.type === 'error') {
            if (packet.code === 'login_expired') expiry = true;
            else fail(client, `Command error: ${packet.code}`);
          }
          if (packet.type === 'ack' && load.pending.has(packet.commandId)) {
            const flight = load.pending.get(packet.commandId);
            if (flight.sentAt !== null) {
              const latency = performance.now() - flight.sentAt;
              load.latencyHistogram[Math.min(latencyBucketLimitMs + 1, Math.ceil(latency))]++;
              load.maxLatencyMs = Math.max(load.maxLatencyMs, latency);
              load.acknowledged++;
            }
            load.pending.delete(packet.commandId);
            if (client.inFlight === packet.commandId) client.inFlight = null;
          }
        };
      });
      load.recover = async client => {
        client.recovering = true;
        if (++client.reconnects > maxReconnects) {
          fail(client, 'Session reconnect budget exceeded');
          client.recovering = false;
          return;
        }
        try {
          // Match checkCompanySession(): refresh only the server-managed company
          // session. Never extend token lifetimes or mint replacement identities.
          load.refresh ??= fetch('/api/me', { cache: 'no-store', headers: { 'X-Requested-With': 'JavaScript' },
            signal: AbortSignal.timeout(15000) }).then(response => {
            if (!response.ok) throw Error(`Company session refresh HTTP ${response.status}`);
            load.refreshes++;
          }).finally(() => { load.refresh = null; });
          await load.refresh;
          for (let attempt = 0; attempt < 3; attempt++) {
            await new Promise(resolve => setTimeout(resolve, [300, 1000, 3000][attempt]));
            if (load.stopped) return;
            try {
              await load.connect(client);
              load.reconnects++;
              return;
            } catch (error) {
              if (attempt === 2) throw error;
            }
          }
        } catch (error) { fail(client, `Session recovery failed: ${error.message}`); }
        finally { client.recovering = false; }
      };
      for (const session of sessions) {
        const client = { ...session, socket: null, ready: false, state: null, index,
          inFlight: null, recovering: false, reconnects: 0, assets: new Set() };
        load.clients.push(client);
        await load.connect(client);
      }
    }, { sessions, index, maxReconnects: Math.ceil(duration / 30) + 2, latencyBucketLimitMs });
  }

  const connections = canvasCount * users.length;
  console.log(`Connected ${connections} authenticated sockets across ${canvasCount} canvases; profile=${profile}.`);
  const overflowSession = await api(users[0].context, `/api/boards/${boards[0].id}/join`, {});
  const overflow = await users[0].page.evaluate(({ id, token }) => new Promise((resolve, reject) => {
    const url = new URL(`/ws/boards/${id}`, location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url);
    const timer = setTimeout(() => { ws.close(); reject(Error('Overflow was not rejected')); }, 10000);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', token, protocolVersion: 2 }));
    ws.onclose = event => { clearTimeout(timer); resolve(event.code); };
  }), { id: boards[0].id, token: overflowSession.token });
  assert.equal(overflow, profile === 'workshop' ? 1008 : 1013);
  // Populate a representative scene and image before measuring a shared workshop.
  if (profile === 'workshop') {
    await users[0].page.evaluate(async count => {
      const client = window.load.clients[0];
      async function patch(elements, files = {}) {
        const commandId = crypto.randomUUID();
        const command = { type: 'patch', commandId, epoch: client.state.epoch, roundId: client.state.roundId,
          pageId: client.state.pageId, elements, files };
        client.inFlight = commandId;
        window.load.pending.set(commandId, { sentAt: null, lastDispatch: performance.now(), command });
        client.socket.send(JSON.stringify(command));
        const end = performance.now() + 15000;
        while (window.load.pending.has(commandId)) {
          if (window.load.errors.length || performance.now() > end) throw Error('Scene seed failed');
          await new Promise(resolve => setTimeout(resolve, 25));
        }
      }
      for (let offset = 0; offset < count; offset += 100) {
        await patch(Array.from({ length: Math.min(100, count - offset) }, (_, n) => ({ id: `seed-${offset + n}`, type: 'rectangle',
          x: (offset + n) % 100 * 20, y: Math.floor((offset + n) / 100) * 20, width: 10, height: 10, isDeleted: false })));
      }
      const image = { id: 'load-image', mimeType: 'image/png', created: 1,
        dataURL: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+Skg5VwAAAABJRU5ErkJggg==' };
      await patch([{ id: 'load-image-element', type: 'image', fileId: image.id, x: 0, y: 0, width: 100, height: 100, isDeleted: false }], { [image.id]: image });
    }, seedElements);
  }
  const phases = [];
  const measurementStart = performance.now();
  let phaseStart = measurementStart;
  let previousSamples = 0;
  let workloadFailed = false;
  while (performance.now() - measurementStart < duration * 1000) {
    const states = await Promise.all(users.map(({ page }) => page.evaluate(() => {
      const load = window.load;
      for (const client of load.clients) {
        if (!client.ready) { load.offlineTicks++; continue; }
        // Model one in-flight batch and the real client's 15-second ACK retry.
        if (client.inFlight) {
          load.backpressure++;
          const flight = load.pending.get(client.inFlight);
          if (performance.now() - flight.lastDispatch >= 15000) {
            if ((flight.retries ?? 0) >= 3) {
              load.failureCount++;
              if (load.errors.length < 20) load.errors.push({ canvas: client.id, message: 'Acknowledgement retry budget exceeded' });
              continue;
            }
            client.socket.send(JSON.stringify(flight.command));
            flight.lastDispatch = performance.now();
            flight.retries = (flight.retries ?? 0) + 1;
            load.retries++;
          }
          continue;
        }
        const commandId = crypto.randomUUID();
        const state = client.state;
        const command = { type: 'patch', commandId, epoch: state.epoch, roundId: state.roundId, pageId: state.pageId,
          elements: [{ id: `load-${client.index}`, type: 'rectangle', x: Math.random() * 100, y: 0, width: 100, height: 100, isDeleted: false }], files: {} };
        client.inFlight = commandId;
        load.pending.set(commandId, { sentAt: performance.now(), lastDispatch: performance.now(), command });
        load.sent++;
        client.socket.send(JSON.stringify(command));
      }
      return { errors: load.errors, closed: load.closed };
    })));
    if (states.some(state => state.errors.length || state.closed)) { workloadFailed = true; break; }
    if (performance.now() - phaseStart >= 30000) {
      const counts = await Promise.all(users.map(({ page }) => page.evaluate(() => ({ acknowledged: window.load.acknowledged,
        reconnects: window.load.reconnects, offlineTicks: window.load.offlineTicks }))));
      const acknowledged = counts.reduce((sum, item) => sum + item.acknowledged, 0);
      const phase = { elapsedSeconds: (performance.now() - measurementStart) / 1000,
        durationSeconds: (performance.now() - phaseStart) / 1000, acknowledged: acknowledged - previousSamples, reconnects: counts.reduce((sum, item) => sum + item.reconnects, 0),
        offlineTicks: counts.reduce((sum, item) => sum + item.offlineTicks, 0) };
      phases.push(phase); console.log(JSON.stringify({ phase }));
      previousSamples = acknowledged; phaseStart = performance.now();
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  const actualDurationSeconds = (performance.now() - measurementStart) / 1000;
  // Drain pending commands and bounded session/image recovery before evaluating.
  const drainDeadline = performance.now() + 30000;
  while (!workloadFailed && performance.now() < drainDeadline && (await Promise.all(users.map(({ page }) => page.evaluate(() =>
    window.load.pending.size + window.load.assetJobs.size + window.load.clients.filter(client => client.recovering || !client.ready).length)))).some(Boolean)) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const results = await Promise.all(users.map(({ page }) => page.evaluate(() => ({ acknowledged: window.load.acknowledged,
    latencyHistogram: Array.from(window.load.latencyHistogram), maxLatencyMs: window.load.maxLatencyMs,
    pending: window.load.pending.size, errors: window.load.errors, failureCount: window.load.failureCount, closed: window.load.closed, sent: window.load.sent,
    backpressure: window.load.backpressure, offlineTicks: window.load.offlineTicks, reconnects: window.load.reconnects,
    refreshes: window.load.refreshes, retries: window.load.retries, assetDownloads: window.load.assetDownloads,
    recoveryDowntimeMs: window.load.recoveryDowntimeMs,
    unfinishedAssets: window.load.assetJobs.size, offline: window.load.clients.filter(client => !client.ready || client.recovering).length }))));
  const acknowledged = results.reduce((sum, result) => sum + result.acknowledged, 0);
  const maxMs = Math.max(...results.map(result => result.maxLatencyMs));
  const histogram = new Float64Array(latencyBucketLimitMs + 2);
  for (const result of results) result.latencyHistogram.forEach((count, bucket) => { histogram[bucket] += count; });
  let p95Ms;
  let cumulative = 0;
  for (let bucket = 0; bucket < histogram.length; bucket++) {
    cumulative += histogram[bucket];
    if (cumulative > Math.floor(acknowledged * .95)) {
      p95Ms = bucket > latencyBucketLimitMs ? maxMs : bucket;
      break;
    }
  }
  phases.push({ elapsedSeconds: actualDurationSeconds, durationSeconds: actualDurationSeconds - (phaseStart - measurementStart) / 1000,
    acknowledged: acknowledged - previousSamples, final: true });
  const report = { profile, targetOrigin: new URL(base).origin, durationSeconds: duration, actualDurationSeconds, intervalMs, sceneElements: seedElements,
    targetP95Ms: targetMs, workloadFailed,
    failureCount: results.reduce((sum, result) => sum + result.failureCount, 0),
    failures: results.flatMap(({ errors }) => errors),
    recoveryDowntimeMs: results.reduce((sum, result) => sum + result.recoveryDowntimeMs, 0),
    connections, canvases: canvasCount, acknowledged, phases, latencyResolutionMs: 1,
    writesPerSecond: acknowledged / actualDurationSeconds,
    reconnects: results.reduce((sum, result) => sum + result.reconnects, 0),
    sessionRefreshes: results.reduce((sum, result) => sum + result.refreshes, 0),
    commandRetries: results.reduce((sum, result) => sum + result.retries, 0),
    offlineTicks: results.reduce((sum, result) => sum + result.offlineTicks, 0),
    assetDownloads: results.reduce((sum, result) => sum + result.assetDownloads, 0),
    backpressure: results.reduce((sum, result) => sum + result.backpressure, 0),
    sent: results.reduce((sum, result) => sum + result.sent, 0), p95Ms, maxMs, overflowCode: overflow };
  console.log(JSON.stringify(report, null, 2));
  if (process.env.LOAD_REPORT) writeFileSync(process.env.LOAD_REPORT, JSON.stringify(report, null, 2), { mode: 0o600 });
  assert(results.every(result => !result.pending && !result.errors.length && !result.closed && !result.offline && !result.unfinishedAssets), JSON.stringify(results.map(({ latencyHistogram, ...rest }) => rest)));
  assert.equal(report.acknowledged, report.sent);
  if (profile === 'workshop') assert.equal(report.assetDownloads, 10, 'Every workshop participant must download the seeded image');
  assert(report.p95Ms < targetMs, `Qualification target: acknowledgement p95 below ${targetMs} ms`);
} finally {
  await Promise.all(users.map(({ page }) => page.evaluate(() => { if (window.load) { window.load.stopped = true; window.load.clients.forEach(client => client.socket.close()); } }).catch(() => {})));
  for (const board of boards) {
    try { await api(board.owner, '/api/me', undefined, 'GET'); await api(board.owner, `/api/boards/${board.id}`, undefined, 'DELETE', 204); }
    catch {
      console.error(`Cleanup failed for disposable canvas ${board.id}; inspect the isolated deployment.`);
      process.exitCode = 1;
    }
  }
  const cleanup = await Promise.allSettled(users.map(({ context }) => context.close()));
  if (cleanup.some(result => result.status === 'rejected')) process.exitCode = 1;
  await browser.close();
}
