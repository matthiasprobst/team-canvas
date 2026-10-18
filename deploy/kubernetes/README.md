# Company deployment

This is a configurable deployment template, not a connection to an existing cluster. It requires PostgreSQL 17, an OIDC provider, an ingress controller with WebSocket support, and a network-policy-capable CNI.

1. Build and scan both images. Set immutable image tags or digests in `app.yaml`.
2. Replace `team-canvas.example.internal` and the ingress class/TLS secret for your cluster.
3. Register an OIDC **web application** with redirect URI `https://team-canvas.example.internal/api/login`. Set its issuer URL, client ID, client secret and a persistent random session-encryption secret (at least 32 characters). The application uses the validated `sub` as identity. Configure your IdP to restrict access to the appropriate company users/groups.
4. Provision the `team-canvas` Secret through your secret manager. `secret.example.yaml` lists the required keys and contains placeholders only. Never apply it with placeholder values or commit real secrets. The database user should have access only to this application's database/schema, with the schema privileges needed by Flyway; never use a PostgreSQL superuser. Provide trusted CA certificates for JDBC `sslmode=verify-full` and your IdP where required by the company PKI.
5. Replace `TRUSTED_PROXIES` with the actual frontend pod network range. The backend NetworkPolicy accepts traffic only from frontend pods in the same namespace. The frontend proxy overwrites client forwarding headers; restrict ingress to the frontend using your cluster's ingress-controller policy. Do not expose the backend or `/q/*` through an external Service/Ingress.
6. Render and review `kubectl kustomize deploy/kubernetes`, then deploy through your normal pipeline. Frontend and backend protocol versions must be updated together. Do not add an HPA or a second backend replica. `Recreate` deliberately accepts downtime during an upgrade; the database lease also rejects overlapping instances.
7. Configure the ingress WebSocket timeout to exceed the 15-second client heartbeat. Verify forwarded HTTPS URLs and secure OIDC cookies through the actual ingress. Test session expiry, rejected origins, invitations, revocation and a full multi-user poker round before admitting company data.

The application exposes internal startup/liveness/readiness probes. A readiness failure can indicate lost database ownership; the process fails closed and should be restarted after database connectivity is restored. Set alerts for readiness failures, database storage/pool usage, repeated denied commands and unexpected socket errors. Logs must never include tokens, IdP cookies or drawing contents.

Before upgrading, back up PostgreSQL and verify the restore procedure in a disposable environment. Flyway applies forward migrations at startup. Rolling an image back does not reverse a database migration. Board and asset retention is an operator responsibility; define and enforce the company's retention policy before routine use.

For stronger separation, run migrations through your existing database migration pipeline and disable `quarkus.flyway.migrate-at-start` on the runtime deployment after a successful migration. Grant the runtime role only the table/sequence privileges it needs, and use a separate schema-owner role for migrations. The writer lease uses a **dedicated PostgreSQL session**: use a direct connection or session pooling, never transaction-mode PgBouncer.

This template has CPU/memory limits, no service-account token, non-root users, read-only root filesystems and dropped Linux capabilities. It intentionally leaves company-specific ingress class, egress destinations, IdP details, CA mounts, secret-manager integration, storage retention and backup policies to the cluster configuration.
