# Operations runbook

Status: implementation and tests are tracked in TC-012–TC-025. The company chooses and operates staging/production; environment-specific settings require its acceptance. See the [platform-independent handover](operator-handover.md).

## Supported deployment

The application requires PostgreSQL 17, Keycloak, HTTPS/WebSocket proxying and exactly one supervised backend. The company chooses the runtime and hosting location. Helm supplies an optional Kubernetes reference (Recreate, no HPA, network-policy-capable CNI); the bundled Compose stack is disposable development configuration. Other platforms must provide the same security, health supervision and persistence contract. Standard toolchain: JDK 21, Maven 3.9+, Node 24. Use secret-manager references and immutable application image digests. Restrict database and identity traffic, trust only actual proxies, keep /q endpoints private, and verify CA chains.

## Upgrade

Announce maintenance; finish or explicitly cancel legacy poker; stop backend; confirm no writer; take/verify backup; run forward migration with migration role; start matching frontend/backend images with runtime role; check readiness, Keycloak login and two-user persistence/poker; reopen ingress. On failure stay stopped. Never run Flyway clean or assume image rollback undoes a migration.

## Recovery

Planning targets: 24h RPO, 4h RTO, encrypted backups retained 30 days, security events 90 days. Verify these against measured restore exercises. Restore in isolation, invalidate sessions and invitation secrets, reapply current offboarding restrictions, and scrub any restored legacy authorship before reopening. Restore data includes images, pages, templates, memberships, and private capability-based drafts. Browser-held secrets are not database backups. Preserve current identity-blocking keys outside restored database state.

## Offboarding

Disable company Keycloak access/revoke sessions; choose deactivate, anonymize or delete in the app admin screen. Preview effects. Anonymize retains all owned canvases under a fresh non-login placeholder; delete removes all owned canvases, even shared ones. Reassign retained canvases explicitly where necessary. Do not read or expose private drafts during maintenance. Never claim old backups/logs are instantly erased.

## Monitoring and cleanup

Alert on readiness/writer loss, pool exhaustion, storage growth, auth/rejection spikes, slow readers/reconnect storms, backup failures and overdue restore tests. Configure the company monitoring scraper and the Helm `monitoring` selectors together; see the [Helm metrics setup](../deploy/helm/README.md#internal-metrics). The chart does not install scrape or alert rules. Metrics have bounded labels without board/user identities. Clean expired sessions/invites/receipts in bounded batches; preserve security-blocking data. Record metadata-only administrative events. External Keycloak revocation target is five minutes plus clock tolerance; local deactivation is immediate. Test the actual ingress and token settings.

## Offboarding recovery state

After each anonymization/deletion, use **Download offboarding recovery file** on the admin screen and retain the current file in company-managed storage independent of database snapshots. It contains keyed fingerprints, key identifiers and the decision (anonymize/delete), without original account IDs or replacement-owner mappings. Treat it as sensitive operational data. Preserve every referenced blocking key in the external key ring. The original Keycloak account must also be disabled.

Standalone image commands need an existing application schema, JDBC credentials for the intended database, and the original blocking key ring. Use the company's Compose definition and protected environment file, not the bundled development configuration. Its `backend` service must use the intended immutable image and inject `JDBC_URL`, `DB_USER`, `DB_PASSWORD`, `IDENTITY_BLOCKING_SECRET` and any previous blocking keys; `--env-file` supplies Compose interpolation, not arbitrary variables inside the container. Set the bind-mount directory's ownership/permissions so UID 1001 can write the export and read the recovery file. Keep it outside the database backup location and use a new filename for every export.

```sh
# Substitute protected company-specific paths; the service injects the intended database/key settings.
# Read-only export is allowed while the application runs; refuses to overwrite an existing file.
docker compose --env-file /protected/company.env -f /protected/company-compose.yml \
  run --rm --no-deps --user 1001:1001 \
  --volume /protected/offboarding:/backups backend \
  maintenance export-blocklist /backups/offboarding-NEW.json
# Only after restoring a matching-schema backup, with application traffic blocked and backend stopped:
docker compose --env-file /protected/company.env -f /protected/company-compose.yml \
  run --rm --no-deps --user 1001:1001 \
  --volume /protected/offboarding:/backups:ro backend \
  maintenance prepare-restore /backups/offboarding-LATEST.json
```

`prepare-restore` acquires the writer lock, validates every referenced key before mutation, reapplies anonymous/deleted-account decisions to restored identity rows and owned canvases, and invalidates sessions and invitations in one transaction. It does not reopen the service. Missing keys, missing export, invalid input or another active writer stop preparation. Do not restore service without the latest independently retained offboarding state. Users must complete a fresh SSO login afterward.

`--no-deps` keeps these standalone commands independent of application/identity-provider startup; PostgreSQL must already be reachable. On other platforms, run the same image command as a one-off process with equivalent protected settings and mounts.

## Disposable recovery rehearsal

The automated rehearsal requires a separate disposable Compose project with a healthy PostgreSQL service, an already built backend image and a database role permitted to create/drop databases. It creates two randomly named databases; it never dumps, restores or drops the application's database. It invokes the actual image's migration/export/preparation commands and removes only its own databases and temporary export afterward. Match `RECOVERY_DB_USER` to the database user in the Compose environment if it differs from `board`.

```sh
RECOVERY_CONFIRM=disposable \
RECOVERY_COMPOSE_PROJECT=team-canvas-recovery \
RECOVERY_ENV_FILE=/protected/disposable-recovery.env \
node tests/recovery.mjs
```

The fixture includes retained/anonymized/deleted owners, a public template, pages, tags, public/private drawings and images, a private draft, sessions and an invitation. The test performs real `pg_dump`/`pg_restore`, rejects a missing blocking key without changing complete rows or access flags, then verifies recovery and repeated preparation. Timings describe this small synthetic fixture only. A passing run does not establish company-scale RPO/RTO, independent backup retention, a populated forward upgrade or recovery of browser-held capabilities. CI runs it in `team-canvas-ci-readiness` and retains `recovery-evidence.json`; the company recovery gate still requires a representative infrastructure exercise.

## Database roles

Provision a dedicated database/schema owner for migration and a DML-only application role. After migrating, grant the runtime role schema USAGE, SELECT/INSERT/UPDATE/DELETE on application tables, and USAGE/SELECT on application sequences. Give SELECT only on `flyway_schema_history` and revoke its INSERT/UPDATE/DELETE privileges. Do not grant schema CREATE or ownership. Verify these privileges using the actual company role; tests also exercise a non-owner runtime role locally.

## Bounded background maintenance

Every five minutes the active writer removes up to 500 expired board sessions, 500 expired/revoked invitations and 500 command receipts older than two days. No private drafts, user canvases, identity blocks, or revoked login ledger entries are automatically deleted. Metrics and operational monitoring must account for that retained metadata. No scheduler service is required.

The same batch deletes up to 500 admin audit events older than 90 days. The role-protected `/api/admin/audit` endpoint exposes only the latest 100 events within that window. Events contain action/result, timestamp and account/canvas references, without names, drawing content or replacement-owner mappings. Erasing an account clears its references in existing events; deleting a canvas clears its references. Successful changes are recorded transactionally; irreversible actions also record their committed access-revocation phase. Rejected service actions are recorded, but authentication/role-filter rejections are not covered by this application audit. Infrastructure access, backup retention and tamper-resistant external audit storage remain operator responsibilities.

## Identity role configuration

Map administration only from `resource_access/<OIDC_CLIENT_ID>/roles` in the verified access token. The backend explicitly uses `quarkus.oidc.roles.source=accesstoken`; do not trust client-supplied flags or broad realm roles. See the [Quarkus OIDC role configuration](https://quarkus.io/version/3.27/guides/security-oidc-configuration-properties-reference/). Configure the `team-canvas-admin` client role deliberately; the local Alice assignment is development-only.

## Release evidence and promotion

Use the [production-readiness gates](production-readiness.md) for release acceptance. The Verify workflow retains tested runtime image archives for 14 days, both runtime SBOMs, image identities, complete image scan reports and checksums. Reports include all severities, including residual MEDIUM/LOW/UNKNOWN findings; a separate conversion of those same JSON reports blocks HIGH/CRITICAL findings, including issues without fixes. `runtime-security-reports` retains generated reports even when that gate fails. Treat security artifacts as sensitive because secret findings may contain matched values.

The optional **Publish verified images** workflow accepts a successful Verify run from a push on the default branch, downloads and checks that evidence, rescans the same images and pushes them without rebuilding. It retains current full-severity reports in `publication-security-reports`, also when the publication gate fails, and includes them alongside verification reports in successful `published-image-identities`. Configure required reviewers on the `production-release` environment before using it. Publication creates no deployment and does not approve outstanding company gates. Copy the resulting immutable registry references into approved company configuration; retain the evidence in company release storage beyond temporary CI artifact retention.
