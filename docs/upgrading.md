# Upgrade notes

[Back to the README](../README.md)

Back up PostgreSQL before upgrading and verify recovery in a disposable environment. Flyway applies forward migrations at startup; rolling back an image does not reverse a database migration. Upgrade frontend and backend together because protocol versions must match.

## Renaming an existing installation to Team Canvas

Project metadata now uses `team-canvas`, Kotlin sources use `dev.teamcanvas`, the Maven artifact is `dev.teamcanvas:team-canvas-backend`, and the frontend package is `team-canvas-frontend`. Existing board IDs, access keys, and database migrations are preserved.

| Current setting | Supported legacy fallback |
| --- | --- |
| `TEAM_CANVAS_AUTH_REQUIRED` | `COLLAB_AUTH_REQUIRED` |
| `TEAM_CANVAS_HTTP_POLICY` | `COLLAB_HTTP_POLICY` |
| `TEAM_CANVAS_ALLOWED_ORIGINS` | `COLLAB_ALLOWED_ORIGINS` |

Current environment variable names take precedence. Direct application properties are `team-canvas.auth-required` and `team-canvas.allowed-origins`. PostgreSQL integration tests use `TEAM_CANVAS_TEST_JDBC_URL`; the old test variable is no longer used. Update metric dashboards from `collab.*` to `team.canvas.*` (Prometheus: `team_canvas_*`).

Renaming the checkout directory can change the default Compose project name and therefore select a different database volume. Before renaming it, record the existing project name with `docker compose ls`. Set `COMPOSE_PROJECT_NAME` to that value in `.env` afterward to keep using the existing database. Do not remove volumes containing needed boards.

Kubernetes templates now use `team-canvas` for image paths, labels, Secrets, ConfigMaps, and Ingress resources. Update these references together; Deployment selectors are immutable. Stop the old backend before starting the replacement against the same database. Existing database usernames and OIDC client IDs can remain unchanged: supply their actual values in the Secrets.

## Existing board access

Old links containing only a board ID do not admit new guests. The host can generate a current invitation link. When introducing OIDC to a previously unowned board, the host key is required to bind the company identity as its owner.

Explicit local guest mode ignores company principals so HTTP joins and WebSocket connections use the same identity policy. After upgrading from a version that bound local guests to an anonymous principal, use **Erneut beitreten** with a current host key or invitation to obtain a new guest-mode token.
