# Operations runbook

Status: planned procedures; commands and environment evidence must be completed under TC-012–TC-025 before company data is admitted.

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
