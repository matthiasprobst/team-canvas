/** Real dump/restore rehearsal in two newly created databases, never the app database. */
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

assert.equal(process.env.RECOVERY_CONFIRM, 'disposable', 'Set RECOVERY_CONFIRM=disposable for an isolated test Compose project.');
const project = process.env.RECOVERY_COMPOSE_PROJECT;
assert(project && /^team-canvas-[a-z0-9-]+$/.test(project), 'Set RECOVERY_COMPOSE_PROJECT to the isolated test stack.');
const dbUser = process.env.RECOVERY_DB_USER ?? 'board';
assert(/^[a-z_][a-z0-9_]*$/.test(dbUser));
const compose = ['compose', ...(process.env.RECOVERY_ENV_FILE ? ['--env-file', resolve(process.env.RECOVERY_ENV_FILE)] : []), '-p', project];
const suffix = randomBytes(8).toString('hex');
const source = `recovery_source_${suffix}`, restored = `recovery_restored_${suffix}`;
const directory = mkdtempSync(join(tmpdir(), 'team-canvas-recovery-'));
const blockingKey = randomBytes(32).toString('hex');
const created = [];
const started = performance.now();
function docker(args, input, expected = 0) {
  const result = spawnSync('docker', [...compose, ...args], { input, maxBuffer: 128 * 1024 * 1024, timeout: 120_000 });
  if (result.error) throw result.error;
  if (expected === 0 && result.status !== 0) throw Error(`Recovery command failed (${args[0]}): ${result.stderr?.toString().slice(-4000)}`);
  if (expected !== 0) {
    assert.notEqual(result.status, 0, 'Unsafe maintenance unexpectedly succeeded');
    if (expected instanceof RegExp) assert.match(result.stderr.toString(), expected, 'Maintenance failed for an unexpected reason');
  }
  return result.stdout;
}
const sql = (database, statement) => docker(['exec', '-T', 'db', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', dbUser, '-d', database, '-At'], statement).toString().trim();
function backend(database, args, key = blockingKey, expected = 0) {
  return docker(['run', '--rm', '--no-deps', '--user', `${process.getuid()}:${process.getgid()}`,
    '-v', `${directory}:/recovery`, '-e', `JDBC_URL=jdbc:postgresql://db:5432/${database}`,
    '-e', `IDENTITY_BLOCKING_SECRET=${key}`, '-e', 'TEAM_CANVAS_IDENTITY_BLOCKING_PREVIOUS_SECRETS=', 'backend', ...args], undefined, expected);
}
const tables = ['app_users', 'boards', 'canvas_pages', 'canvas_tags', 'participants', 'board_sessions', 'login_sessions',
  'board_invitations', 'rounds', 'private_drafts', 'elements', 'assets', 'command_receipts', 'blocked_identities',
  'admin_audit_events', 'canvas_access_events'];
// These identifiers come only from the static schema list, never caller-supplied settings.
// One SQL statement also gives every table in a snapshot the same database view.
const inventory = database => JSON.parse(sql(database, `SELECT jsonb_build_object(${tables.map(table =>
  `'${table}',(SELECT count(*) FROM ${table})`).join(',')});`));
// Include complete rows: counts alone would miss accidental revocation or ownership changes.
const databaseState = database => JSON.parse(sql(database, `SELECT jsonb_build_object(${tables.map(table =>
  `'${table}',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM ${table} t)`).join(',')});`));
const ids = Object.fromEntries(['stay', 'anonymous', 'deleted', 'board', 'retainedBoard', 'deletedBoard', 'page', 'round', 'member'].map(name => [name, randomUUID()]));
const issuer = 'https://recovery.example.test';
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+Skg5VwAAAABJRU5ErkJggg==';
try {
  for (const name of [source, restored]) {
    docker(['exec', '-T', 'db', 'createdb', '-U', dbUser, name]);
    created.push(name);
  }
  backend(source, ['migrate']);
  sql(source, `BEGIN;
    INSERT INTO app_users(id,issuer,subject,display_name) VALUES
      ('${ids.stay}','${issuer}','stay','Recovery retained'),
      ('${ids.anonymous}','${issuer}','anonymous','Recovery anonymized'),
      ('${ids.deleted}','${issuer}','deleted','Recovery deleted');
    INSERT INTO boards(id,name,owner_user_id,template_visibility) VALUES
      ('${ids.board}','Recovery live template','${ids.stay}','public'),
      ('${ids.retainedBoard}','Recovery retain owned','${ids.anonymous}',NULL),
      ('${ids.deletedBoard}','Recovery delete owned','${ids.deleted}',NULL);
    INSERT INTO canvas_pages(id,board_id,position) VALUES('${ids.page}','${ids.board}',1);
    INSERT INTO canvas_tags(board_id,tag,normalized_tag) VALUES('${ids.board}','Recovery','recovery');
    INSERT INTO participants(id,board_id,user_id,name,role) VALUES('${ids.member}','${ids.board}','${ids.stay}','Recovery retained','host');
    INSERT INTO login_sessions(user_id,sid) VALUES('${ids.stay}','recovery-login');
    INSERT INTO board_sessions(token_hash,participant_id,user_id,sid) VALUES(repeat('a',64),'${ids.member}','${ids.stay}','recovery-login');
    INSERT INTO board_invitations(id,board_id,creator_id,secret_hash) VALUES(gen_random_uuid(),'${ids.board}','${ids.stay}',repeat('b',64));
    INSERT INTO rounds(id,board_id) VALUES('${ids.round}','${ids.board}');
    UPDATE boards SET mode='poker',current_round_id='${ids.round}' WHERE id='${ids.board}';
    INSERT INTO private_drafts(board_id,round_id,draft_hash) VALUES('${ids.board}','${ids.round}',repeat('c',64));
    INSERT INTO elements(board_id,id,page_id,body,scope,stored_bytes) VALUES
      ('${ids.board}','public','${ids.page}','{"id":"public","type":"rectangle","x":1,"y":2,"width":10,"height":20}','public',100);
    INSERT INTO elements(board_id,id,page_id,body,scope,draft_hash,round_id,stored_bytes) VALUES
      ('${ids.board}','private','${ids.page}','{"id":"private","type":"image","fileId":"private-image"}','private',repeat('c',64),'${ids.round}',100);
    INSERT INTO assets(board_id,id,page_id,body,scope,stored_bytes) VALUES
      ('${ids.board}','public-image','${ids.page}','{"id":"public-image","mimeType":"image/png","dataURL":"${image}"}','public',200);
    INSERT INTO assets(board_id,id,page_id,body,scope,draft_hash,round_id,stored_bytes) VALUES
      ('${ids.board}','private-image','${ids.page}','{"id":"private-image","mimeType":"image/png","dataURL":"${image}"}','private',repeat('c',64),'${ids.round}',200);
    INSERT INTO command_receipts(board_id,receipt_scope,command_id,revision) VALUES('${ids.board}','public',gen_random_uuid(),1);
    COMMIT;`);
  const before = inventory(source);
  const contentQuery = `SELECT id,md5(body::text) FROM assets ORDER BY id; SELECT id,md5(body::text),scope FROM elements ORDER BY id;`;
  const contentBefore = sql(source, contentQuery);
  const dumpStarted = performance.now();
  const dump = docker(['exec', '-T', 'db', 'pg_dump', '-U', dbUser, '-Fc', '--no-owner', '--no-acl', source]);
  const dumpMs = performance.now() - dumpStarted;
  // Current offboarding decisions are stored outside the older database snapshot.
  for (const [subject, action] of [['anonymous', 'anonymize'], ['deleted', 'delete']]) {
    const fingerprint = createHmac('sha256', blockingKey).update(`identity\n${issuer}\n${subject}`).digest('hex');
    const keyId = createHash('sha256').update(blockingKey).digest('hex').slice(0, 16);
    sql(source, `INSERT INTO blocked_identities(fingerprint,key_id,action) VALUES('${fingerprint}','${keyId}','${action}');`);
  }
  backend(source, ['maintenance', 'export-blocklist', '/recovery/offboarding.json']);
  const exported = JSON.parse(readFileSync(join(directory, 'offboarding.json'), 'utf8'));
  assert.equal(exported.records.length, 2);
  const restoreStarted = performance.now();
  docker(['exec', '-T', 'db', 'pg_restore', '-U', dbUser, '--exit-on-error', '--no-owner', '--no-acl', '-d', restored], dump);
  assert.deepEqual(inventory(restored), before, 'Dump/restore changed row counts');
  assert.equal(sql(restored, contentQuery), contentBefore, 'Dump/restore changed drawing or image contents');
  const beforeMissingKey = databaseState(restored);
  backend(restored, ['maintenance', 'prepare-restore', '/recovery/offboarding.json'], randomBytes(32).toString('hex'), /unavailable verification key/);
  assert.deepEqual(databaseState(restored), beforeMissingKey, 'Missing-key failure mutated restored rows, ownership or revocation flags');
  backend(restored, ['maintenance', 'prepare-restore', '/recovery/offboarding.json']);
  assert.equal(sql(restored, `SELECT count(*) FROM app_users WHERE id IN ('${ids.anonymous}','${ids.deleted}');`), '0');
  assert.equal(sql(restored, `SELECT count(*) FROM boards WHERE id='${ids.deletedBoard}';`), '0');
  assert.equal(sql(restored, `SELECT count(*) FROM boards b JOIN app_users u ON u.id=b.owner_user_id WHERE b.id='${ids.retainedBoard}' AND u.status='placeholder';`), '1');
  assert.equal(sql(restored, 'SELECT count(*) FROM board_sessions;'), '0');
  assert.equal(sql(restored, 'SELECT count(*) FROM login_sessions WHERE NOT revoked;'), '0');
  assert.equal(sql(restored, 'SELECT count(*) FROM board_invitations WHERE NOT revoked;'), '0');
  assert.equal(sql(restored, contentQuery), contentBefore, 'Restore preparation changed retained drawing/image contents');
  assert.equal(sql(restored, `SELECT count(*) FROM boards WHERE id='${ids.board}' AND owner_user_id='${ids.stay}' AND template_visibility='public' AND mode='poker' AND current_round_id='${ids.round}';`), '1');
  assert.equal(sql(restored, `SELECT count(*) FROM private_drafts WHERE board_id='${ids.board}' AND round_id='${ids.round}' AND draft_hash=repeat('c',64);`), '1');
  assert.equal(sql(restored, `SELECT count(*) FROM canvas_pages WHERE board_id='${ids.board}';`), '2');
  assert.equal(sql(restored, `SELECT count(*) FROM canvas_tags WHERE board_id='${ids.board}' AND normalized_tag='recovery';`), '1');
  const prepared = databaseState(restored);
  // Reapplying the same recovery state is safe and preserves already anonymized work.
  backend(restored, ['maintenance', 'prepare-restore', '/recovery/offboarding.json']);
  assert.deepEqual(databaseState(restored), prepared, 'Repeated restore preparation changed retained content or access state');
  assert.equal(sql(restored, contentQuery), contentBefore, 'Repeated preparation changed retained drawing/image contents');
  console.log(JSON.stringify({ check: 'dump-restore-offboarding', passed: true, dumpBytes: dump.length,
    dumpMs: Math.round(dumpMs), restoreAndPreparationMs: Math.round(performance.now() - restoreStarted),
    totalMs: Math.round(performance.now() - started), fixtureRows: before,
    scope: 'Disposable synthetic fixture; not a company-scale RPO/RTO measurement' }, null, 2));
} finally {
  for (const name of created.reverse()) docker(['exec', '-T', 'db', 'dropdb', '-U', dbUser, '--force', name]);
  rmSync(directory, { recursive: true, force: true });
}
