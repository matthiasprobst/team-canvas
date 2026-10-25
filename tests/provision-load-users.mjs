/** Test-only fixture provisioning. Never import these accounts into a company IdP. */
import assert from 'node:assert/strict';

assert.equal(process.env.LOAD_PROVISION_CONFIRM, 'disposable', 'Set LOAD_PROVISION_CONFIRM=disposable for a disposable development Keycloak.');
const address = process.env.TEST_KEYCLOAK_URL;
assert(address, 'Set TEST_KEYCLOAK_URL explicitly, e.g. http://localhost:8181/auth');
const root = new URL(address);
assert(['http:', 'https:'].includes(root.protocol) && !root.username && !root.password && !root.search && !root.hash);
const base = address.replace(/\/$/, '');
const response = await fetch(`${base}/realms/master/protocol/openid-connect/token`, {
  method: 'POST', signal: AbortSignal.timeout(15000),
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli',
    username: process.env.DEV_ADMIN_USERNAME ?? 'dev-admin', password: process.env.DEV_ADMIN_PASSWORD ?? 'admin-dev-only' }),
});
assert.equal(response.status, 200, 'Disposable IdP admin login failed');
const token = (await response.json()).access_token;
async function admin(path, options = {}) {
  return fetch(`${base}/admin/realms/team-canvas${path}`, { ...options, signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
}
const realmResponse = await admin('');
assert.equal(realmResponse.status, 200);
const realm = await realmResponse.json();
assert.equal(realm.displayName, 'Team Canvas development', 'Refusing to provision outside the development realm');
assert.equal(realm.sslRequired, 'none', 'Refusing to provision a non-development realm');
let created = 0;
for (let i = 1; i <= 10; i++) {
  const username = `load${String(i).padStart(2, '0')}`;
  const existing = await admin(`/users?username=${username}&exact=true`);
  assert.equal(existing.status, 200);
  if ((await existing.json()).length) continue; // Never overwrite an existing account or password.
  const result = await admin('/users', { method: 'POST', body: JSON.stringify({ username, enabled: true,
    emailVerified: true, email: `${username}@example.test`, firstName: username, lastName: 'Load fixture',
    credentials: [{ type: 'password', value: process.env[`DEV_${username.toUpperCase()}_PASSWORD`] ?? `${username}-dev-only`, temporary: false }],
  }) });
  assert.equal(result.status, 201, `Could not create disposable fixture ${username}`);
  created++;
}
console.log(`Disposable load fixture ready: ${created} accounts created; existing accounts were preserved.`);
