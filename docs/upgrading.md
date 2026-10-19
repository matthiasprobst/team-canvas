# Upgrade notes

[Back to the README](../README.md)

Back up PostgreSQL and verify recovery before upgrading. Flyway applies forward migrations at startup; rolling back an image does not reverse a database migration. Frontend and backend must be upgraded together.

## Authenticated dashboard release

`V3__accounts_and_canvas_membership.sql` adds accounts, ownership, durable membership, per-login revocation, independent board sessions, invitations, and per-user last-opened timestamps. Existing boards, participants, scenes, and assets remain in place. No startup code resets or deletes application data.

This early-development release does **not** migrate guest identities or let old host keys claim ownership. Legacy canvases without an account owner are excluded from dashboards and cannot be opened through the new authentication path. Export any needed legacy canvases using the previous version before upgrading, then create new account-owned canvases. Do not treat this as a production migration of historical accounts.

Sign-in is now required everywhere. Remove `TEAM_CANVAS_AUTH_REQUIRED`, `TEAM_CANVAS_HTTP_POLICY`, and all `COLLAB_*` authentication/origin settings; they are no longer supported. Use `TEAM_CANVAS_ALLOWED_ORIGINS`, company Keycloak settings, and the session secret described in the deployment guide. The old `/api/session`, client-supplied name/host-key join contract, and invitation rotation API are replaced by `/api/me`, membership-based joins, and explicit invitation creation/revocation.

Compose now starts Keycloak, with a separate persistent `keycloakdata` volume. Copy new development settings from `.env.example` into your existing `.env` without replacing database credentials. The development realm is imported only if it does not exist. Later password, client-secret, callback, or logout-URL changes require updating the existing realm through Keycloak administration as well as application configuration.

Choose a stable `KEYCLOAK_PUBLIC_URL`: `(issuer, subject)` identifies each account. Compose now uses this separate Keycloak address as the development issuer; changing it creates a separate local account namespace. Existing account and board data is retained, but a new issuer will provision different accounts unless identities are migrated. Normal restarts at the same issuer preserve memberships; old sign-in cookies may require reauthentication when identity-provider configuration changes. `PUBLIC_ORIGIN` controls the app callback and web origin, not the issuer.

`docker compose down` preserves state. `docker compose down -v` destroys both application and identity-provider data and must be a deliberate developer action against disposable data. It is never an upgrade step.

## Repository/deployment naming

Project artifacts use `team-canvas` and Kotlin package `dev.teamcanvas`. Renaming a checkout directory can change the default Compose project name and select different volumes. Record the existing name with `docker compose ls`; set `COMPOSE_PROJECT_NAME` to preserve that project's volumes.

Kubernetes templates use `team-canvas` image paths, labels, Secrets, and ConfigMaps. Update related references together; Deployment selectors are immutable. Stop the old backend before starting a replacement against the same database. Keep exactly one backend and use `Recreate` updates. Metrics use `team.canvas.*` / Prometheus `team_canvas_*`.
