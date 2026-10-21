# Company deployment with Helm

This chart uses existing company PostgreSQL, Keycloak, HTTPS ingress, CNI network policies and Secrets. It creates no database, IdP, or secret values. Supply every required company setting from `team-canvas/values.yaml`; values schema requires immutable image digests and positive quotas. Never commit actual secrets.

```sh
helm lint deploy/helm/team-canvas -f company-values.yaml
helm template team-canvas deploy/helm/team-canvas -f company-values.yaml > rendered.yaml
```

Runtime Secret: JDBC_URL (with sslmode=verify-full), DB_USER, DB_PASSWORD, OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_SESSION_SECRET (32+ random characters), and IDENTITY_BLOCKING_SECRET (32+ random characters). Migration Secret: JDBC_URL, DB_USER and DB_PASSWORD for the schema owner. Mount company CA certificates as required by your environment. The runtime role has DML privileges only.

Limits default to 10 pages and 20 owned canvases. Set `limits.maxPagesPerCanvas` and `limits.maxOwnedCanvasesPerUser` to override; templates count as owned. Changes restart the backend through Helm's deployment update. Existing data is preserved when limits are lowered.

For upgrades, put ingress in maintenance mode, stop the backend, back up the database, then render only `templates/migration-job.yaml` with `--set runMigration=true` and apply that Job. Wait for success before deploying the matching frontend/backend with the default `runMigration=false`. The migration command takes the same database writer lock and refuses to run beside an active backend. Never run a migration as an automatic pre-upgrade hook against a running backend. Reopen ingress only after readiness and real SSO/two-user checks.

Keep exactly one backend (Recreate); health/metrics are internal. Restrict frontend ingress to your ingress controller. Set trusted proxy CIDRs narrowly. Validate DNS and egress policies for actual managed-service IP ranges. Configure ingress HTTPS redirect, TLS and WebSocket timeouts longer than 45 seconds. The chart's Caddy proxy assumes HTTPS ingress.

Initial-development schema can be recreated only with an explicit reset of disposable data. Startup never cleans a mismatched schema. Historical migrations are not a supported production upgrade path yet. See the operations runbook for recovery and release qualification.
