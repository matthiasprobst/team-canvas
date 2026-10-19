# Dashboard implementation validation

Date: 2026-10-18

The implementation for TC-001–TC-009 is present, including the development identity provider, account/session model, dashboard and invitations, and guarded canvas switching. Release validation in TC-010 remains pending. Tickets stay **In progress** until the runtime acceptance checks below can be completed; unchecked acceptance criteria are not claimed as passed.

## Passing checks

| Check | Result |
| --- | --- |
| `npm run build --prefix frontend` | TypeScript and Vite production build pass. Editor/Excalidraw code and CSS are separate lazy chunks. Vite still warns about large editor/vendor chunks. |
| `npm run test:sync --prefix frontend` and direct execution of the three test modules | 23 cases pass: 15 session, 5 reconciliation, 3 protocol-decoder tests. Includes metadata renames preserving private pending edits. |
| Kotlin 2.4.10 compilation, JDK 21, cached dependency jars, JUnit console | Production and test sources compile; 23 unit tests pass. Twelve PostgreSQL integration tests are discovered and skipped without a reachable JDBC test database. This is not a substitute for the Maven/Quarkus package build. |
| PostgreSQL 17.11 single-user validation | V1–V3 apply to an empty temporary schema. Session-lock and dashboard cursor queries execute. Upgrading a V2 schema containing a legacy board, participant, and element preserves the element and leaves legacy ownership unclaimed. Temporary schemas were removed. |
| `docker compose config --quiet` | Passes, including Keycloak health check, persistent volume, explicit public/internal endpoint configuration, and authenticated backend settings. |
| Realm JSON / package-lock consistency / `git diff --check` | Pass. |
| Playwright test discovery and `node --check tests/smoke.mjs` | Four browser tests and the authenticated protocol script parse. Browser test discovery used an available cached Playwright installation because registry downloads were blocked. |

No application database or Docker volume was reset. No deployment or commit was performed.

## Environment blockers and their limits

- Docker daemon access: `permission denied ... /var/run/docker.sock`. Containers, Keycloak import/login/logout, Caddy runtime validation, and full protocol smoke could not be run here.
- PostgreSQL server startup: `could not create IPv4 socket ... Operation not permitted`. Single-user SQL checks work, but JDBC concurrency, row-lock races, and the twelve integration tests require a normal server.
- `mvn -B -Dmaven.repo.local=/tmp/team-canvas-m2 test`: dependency resolution failed against Maven Central. Direct Kotlin/JUnit validation was used as a limited fallback; Quarkus augmentation is unverified.
- Playwright launch: Chromium exited with `SIGTRAP`, reporting `setsockopt: Operation not permitted`, before opening a page. There are no rendered-dashboard screenshots or completed keyboard/mobile/visual checks from this run.
- Installing the newly pinned browser tooling from npm also failed with `EAI_AGAIN`. The lockfile includes its exact dependency versions and resolved registry URLs; a clean `npm ci` and browser installation still need an unrestricted runner. Existing frontend dependencies were available for the production build.
- WLAN reachability, the company's Keycloak claims/policies, HTTPS ingress, and external provider logout behavior require their actual environments. Immediate Keycloak back-channel logout is not implemented; external logout is bounded by token/session expiry. App logout explicitly revokes the current login's board sessions.

## Remaining release checks

In a Docker/network-enabled environment, using disposable development data:

```sh
npm ci --prefix frontend
node frontend/node_modules/playwright/cli.js install --with-deps chromium
docker compose up --build -d --wait --wait-timeout 300
npm run test:sync --prefix frontend
npm run build --prefix frontend
# Export DB_USER and DB_PASSWORD for the disposable test database first.
(cd backend && TEAM_CANVAS_TEST_JDBC_URL=jdbc:postgresql://localhost:5432/board mvn verify)
node tests/smoke.mjs
npm run test:e2e --prefix frontend
```

The protocol script signs in as both demo users through Keycloak and exercises public synchronization, idempotency, private elements/images, frozen readiness after reconnect, stale-round rejection, and the ten-connection limit. Browser tests cover the dashboard/invitation/rename/switch/poker/logout journey plus rejected origins and pending/offline navigation. The navigation failure tests mock transport only; production has no test authentication bypass.

Inspect the generated desktop/mobile screenshots against `assets/dashboard-concept.png`. Manually check keyboard/focus behavior, reduced motion, long names, search/pagination, room-full recovery, multiple tabs with one identity, logout on one device while another remains signed in, and both direct and proxied HTTPS access. Run the same real two-user journey with a configured WLAN `PUBLIC_ORIGIN`. Finish the CI image/dependency scans before release.

Browser traces can contain credentials/session data: keep artifacts private and use only disposable demo accounts for this suite.
