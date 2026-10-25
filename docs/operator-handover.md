# Company handover and platform choice

The deliverable is the application source, container build definitions, automated tests and operating instructions. The receiving company chooses the hosting location, platform, staging topology, identity infrastructure and operational responsibilities. No company account or Kubernetes cluster is required to develop or qualify the code locally. Helm is an optional reference deployment, not a hosting mandate.

## Responsibility boundary

| Delivered with the code | Decided and implemented by the company |
| --- | --- |
| Backend/frontend images and documented runtime contract | VM, container service, Kubernetes or another compatible runtime; network location and data residency |
| Authorization, quotas, private contribution handling and lifecycle controls | Keycloak client, user access, administrators, MFA/session policy and offboarding process |
| Local disposable Compose environment and automated qualification | Independently operated staging environment and production configuration |
| Health/metrics endpoints, migration and recovery commands | Process supervision, TLS/CA trust, monitoring, alerts, backups, secret storage and retention |
| Release evidence and documented limits | Risk acceptance, required service level, capacity, measured recovery objectives and production approval |

## Runtime contract on any platform

- Run exactly one backend per database. Use stop/start updates; do not overlap backend versions. Transaction-mode PgBouncer is unsupported because ownership uses a session advisory lock.
- Provide PostgreSQL 17 with durable storage and separate migration/runtime roles. The runtime role needs DML and sequence access to all application tables, including new tables introduced by upgrades. It must not own the schema or alter Flyway history.
- Provide a company-managed Keycloak client with authorization-code flow and PKCE, exact application callback/post-logout URLs, profile claims and deliberately assigned `team-canvas-admin` client roles. Other IdPs have not been qualified.
- Serve the UI and `/api/*` and `/ws/*` under one HTTPS origin. The optional production proxy example is [the Helm Caddyfile](../deploy/helm/team-canvas/files/Caddyfile); it assumes an HTTPS-only upstream ingress and explicitly forwards the HTTPS scheme to the backend. Adapt its upstream address, listen port and routing to the chosen runtime, and prevent direct public HTTP access to that internal proxy. The image's default `deploy/Caddyfile` is for development HTTP, not a production TLS/proxy configuration. Set WebSocket timeouts above 45 seconds; keep `/q/*` private.
- Store secrets outside source control and database backups: persistent session encryption key, identity-blocking key ring, DB credentials and OIDC client secret. Keep independent current offboarding exports. Never use the development realm/accounts or development secrets with company data.
- Supervise the backend: remove traffic when `/q/health/ready` fails and restart the process when `/q/health/live` stays failed. Kubernetes implements this through probes. Docker Compose health status alone does **not** restart an unhealthy process; another runtime must supply equivalent supervision.
- Scrape internal `/q/metrics`, configure actual alerts and test their delivery. Restrict connections according to the chosen platform's network controls; the optional Helm policies illustrate the required boundaries.
- Accept or revise the supported service envelope: one backend, planned maintenance, 200 sockets overall, 20 per account, and a configurable per-canvas limit defaulting to 30, including extra tabs. Qualify the chosen canvas limit on the company's infrastructure; historical ten-client workshop results do not establish thirty-client capacity. Object-level last-writer-wins and no revision history are product limits.

## Production configuration

These variables describe the backend regardless of the hosting platform. Inject them using the company's configuration/secret mechanism; do not copy the development Compose overrides.

| Setting | Required value |
| --- | --- |
| `TEAM_CANVAS_PRODUCTION` | `true` (enables startup validation) |
| `TEAM_CANVAS_MIGRATE_AT_START` | `false`; run the image's `migrate` command separately with the backend stopped |
| `TEAM_CANVAS_MAX_CONNECTIONS_PER_CANVAS` | Integer from 1 to 200; defaults to 30 active connections per canvas, including tabs. Apply by restarting the backend; global/account limits remain 200/20. |
| `JDBC_URL`, `DB_USER`, `DB_PASSWORD` | Runtime-role connection; verify server certificate/hostname (`sslmode=verify-full`) |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | HTTPS company Keycloak issuer and confidential application client |
| `OIDC_SESSION_SECRET` | Persistent cryptographically random secret, at least 32 characters |
| `IDENTITY_BLOCKING_SECRET` | Independent persistent random secret, at least 32 characters; retain prior keys during rotation |
| `TEAM_CANVAS_IDENTITY_BLOCKING_PREVIOUS_SECRETS` | Previous blocking keys when rotating; protect like the current key |
| `TEAM_CANVAS_ALLOWED_ORIGINS` | Exact public HTTPS origin(s), without trailing slash |
| `TRUSTED_PROXIES` | Only the actual reverse-proxy addresses/CIDRs |
| `QUARKUS_OIDC_AUTHENTICATION_COOKIE_FORCE_SECURE` | `true` (also the application default) |

Use matching backend/frontend versions and immutable image references. The image entrypoints support normal application startup, `migrate`, and `maintenance export-blocklist|prepare-restore FILE`. See the [operations runbook](operations-runbook.md) for prerequisites and protected mounts. A plain image rollback does not reverse a database migration.

## Local qualification and company staging acceptance

Start with the README's **separate disposable test stack**, then run frontend/backend checks, protocol/browser tests, [dump/restore rehearsal](operations-runbook.md#disposable-recovery-rehearsal), and capacity/workshop load profiles. This tests code and reference container behavior; it does not select a company hosting platform.

The company can implement staging independently using this runtime contract or the optional [Helm reference](../deploy/helm/README.md). Before production, its operators should exercise real TLS/proxy settings, two-user persistence and poker privacy, membership removal, app and IdP offboarding, expired-session recovery, process restart after writer loss, populated upgrades, backup restore and alert delivery. Record actual RPO/RTO and latency on the chosen infrastructure. Keep the acceptance evidence with the final image identities using the [release checklist](production-readiness.md).

These infrastructure checks belong to the company's acceptance and do not require the code author to operate or provision staging.
