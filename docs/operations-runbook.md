# Operations runbook

Status: implementation and tests are tracked in TC-012–TC-025. Target-company ingress, backup infrastructure and cluster settings still require environment verification.

## Supported deployment

Company Kubernetes, external PostgreSQL 17, Keycloak, HTTPS/WebSocket ingress and a network-policy-capable CNI. One Recreate backend, no HPA. Helm is the target packaging. Standard toolchain: JDK 21, Maven 3.9+, Node 24. Use secret-manager references and immutable application image digests. Restrict database and identity traffic, trust only actual proxies, keep /q endpoints private, and verify CA chains.

## Upgrade

Announce maintenance; finish or explicitly cancel legacy poker; stop backend; confirm no writer; take/verify backup; run forward migration with migration role; start matching frontend/backend images with runtime role; check readiness, Keycloak login and two-user persistence/poker; reopen ingress. On failure stay stopped. Never run Flyway clean or assume image rollback undoes a migration.

## Recovery

Planning targets: 24h RPO, 4h RTO, encrypted backups retained 30 days, security events 90 days. Verify these against measured restore exercises. Restore in isolation, invalidate sessions and invitation secrets, reapply current offboarding restrictions, and scrub any restored legacy authorship before reopening. Restore data includes images, pages, templates, memberships, and private capability-based drafts. Browser-held secrets are not database backups. Preserve current identity-blocking keys outside restored database state.

## Offboarding

Disable company Keycloak access/revoke sessions; choose deactivate, anonymize or delete in the app admin screen. Preview effects. Anonymize retains all owned canvases under a fresh non-login placeholder; delete removes all owned canvases, even shared ones. Reassign retained canvases explicitly where necessary. Do not read or expose private drafts during maintenance. Never claim old backups/logs are instantly erased.

## Monitoring and cleanup

Alert on readiness/writer loss, pool exhaustion, storage growth, auth/rejection spikes, slow readers/reconnect storms, backup failures and overdue restore tests. Metrics have bounded labels without board/user identities. Clean expired sessions/invites/receipts in bounded batches; preserve security-blocking data. Record metadata-only administrative events. External Keycloak revocation target is five minutes plus clock tolerance; local deactivation is immediate. Test the actual ingress and token settings.

## Offboarding recovery state

After each anonymization/deletion, use **Download offboarding recovery file** on the admin screen and retain the current file in company-managed storage independent of database snapshots. It contains keyed fingerprints, key identifiers and the decision (anonymize/delete), without original account IDs or replacement-owner mappings. Treat it as sensitive operational data. Preserve every referenced blocking key in the external key ring. The original Keycloak account must also be disabled.

Standalone image commands (mount a protected backup directory writable by UID 1001 and provide JDBC credentials and the original blocking key ring):

```sh
# Read-only export is allowed while the application runs; refuses to overwrite an existing file.
docker compose run --rm backend maintenance export-blocklist /backups/offboarding.json
# Only after restoring a matching-schema backup, with application traffic blocked and backend stopped:
docker compose run --rm backend maintenance prepare-restore /backups/offboarding.json
```

`prepare-restore` acquires the writer lock, validates every referenced key before mutation, reapplies anonymous/deleted-account decisions to restored identity rows and owned canvases, and invalidates sessions and invitations in one transaction. It does not reopen the service. Missing keys, missing export, invalid input or another active writer stop preparation. Do not restore service without the latest independently retained offboarding state. Users must complete a fresh SSO login afterward.

## Database roles

Provision a dedicated database/schema owner for migration and a DML-only application role. After migrating, grant the runtime role schema USAGE, SELECT/INSERT/UPDATE/DELETE on application tables, and USAGE/SELECT on application sequences. Give SELECT only on `flyway_schema_history` and revoke its INSERT/UPDATE/DELETE privileges. Do not grant schema CREATE or ownership. Verify these privileges using the actual company role; tests also exercise a non-owner runtime role locally.

## Bounded background maintenance

Every five minutes the active writer removes up to 500 expired board sessions, 500 expired/revoked invitations and 500 command receipts older than two days. No private drafts, user canvases, identity blocks, or revoked login ledger entries are automatically deleted. Metrics and operational monitoring must account for that retained metadata. No scheduler service is required.

## Identity role configuration

Map administration only from `resource_access/<OIDC_CLIENT_ID>/roles` in the verified access token. The backend explicitly uses `quarkus.oidc.roles.source=accesstoken`; do not trust client-supplied flags or broad realm roles. See the [Quarkus OIDC role configuration](https://quarkus.io/version/3.27/guides/security-oidc-configuration-properties-reference/). Configure the `team-canvas-admin` client role deliberately; the local Alice assignment is development-only.
