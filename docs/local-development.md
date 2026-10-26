# Local development and checks

[Back to the README](../README.md) · [User guide](user-guide.md)

Run the commands below from the repository root unless stated otherwise. The bundled Compose stack is for disposable development and test data. For retained company data, start with the [operator handover](operator-handover.md).

## Start the local stack

Install Docker with the Compose plugin. The bundled Compose setup is for development. Migration validation fails safely without resetting the schema. Use the [operator handover](operator-handover.md) before admitting retained company data. From the repository root:

```sh
test -f .env || cp .env.example .env
openssl rand -hex 24
# Put the generated password into .env as DB_PASSWORD, then:
docker compose build
docker compose up -d --wait db keycloak
docker compose run --rm --no-deps backend migrate
docker compose up -d --wait --wait-timeout 300
```

For subsequent development starts, `docker compose up --build -d --wait --wait-timeout 300` also applies pending migrations automatically, validating existing migration checksums first. An incompatible migration history still stops startup; existing volumes are never reset. Company deployments continue to use the separate migration procedure in the operator handover.

Open **http://localhost:8088** and choose **Login with SSO**. The browser signs in through the separate development Keycloak URL at **http://localhost:8180/auth**. Compose includes a development realm with these example accounts:

| Username | Default development password |
| --- | --- |
| `alice` | `alice-dev-only` |
| `bob` | `bob-dev-only` |

Use separate browser profiles, private windows, or devices to test the two accounts. Create a canvas, choose **Share → Create invitation link**, and open that link in the other browser. After sign-in, choose **Accept invitation**. The canvas then appears in that user’s dashboard.

Configure passwords through `DEV_ALICE_PASSWORD` and `DEV_BOB_PASSWORD` before the first start. The development admin console is at **http://localhost:8180/auth/admin/**, with `dev-admin` and `DEV_ADMIN_PASSWORD` (default `admin-dev-only`). Configure the public Keycloak address with `KEYCLOAK_PUBLIC_URL` and its host port/bind address with `KEYCLOAK_HTTP_PORT` and `KEYCLOAK_BIND`. These accounts and the bundled development identity provider are **not a company deployment configuration**.

Application data persists in `pgdata`; Keycloak data persists in `keycloakdata`. `docker compose down` retains both. **`docker compose down -v` deletes both volumes and all their data.** Passwords and realm settings are imported only on the first start. Editing `.env` does not update existing PostgreSQL or Keycloak passwords; update those through their administration tools.

## Try it on the same WLAN

Before the first start, set the following in `.env`, using the host computer’s actual WLAN IP:

```dotenv
HTTP_BIND=0.0.0.0
HTTP_PORT=8088
PUBLIC_ORIGIN=http://192.168.1.42:8088
KEYCLOAK_BIND=0.0.0.0
KEYCLOAK_HTTP_PORT=8180
KEYCLOAK_PUBLIC_URL=http://192.168.1.42:8180/auth
```

Set your own development account passwords, allow inbound TCP ports `8088` and `8180` on the private network, then follow [Start the local stack](#start-the-local-stack). **Everyone must use the exact `PUBLIC_ORIGIN` URL for Team Canvas and the exact `KEYCLOAK_PUBLIC_URL` host for Keycloak**, including the host. An invitation created at `localhost` cannot work on another person’s computer.

`PUBLIC_ORIGIN` configures the app callback, post-logout URL, and allowed request origin. `KEYCLOAK_PUBLIC_URL` configures Keycloak’s browser URL and OIDC issuer. Backend token/JWKS calls use the internal Compose service address; browser redirects never use that address. Do not add trailing slashes to either setting.

If Keycloak was already initialized, update the `team-canvas` client in its admin console when the app origin changes: **Valid redirect URIs** to `<PUBLIC_ORIGIN>/api/login`, **Valid post logout redirect URIs** to `<PUBLIC_ORIGIN>/login`, and **Web origins** to `<PUBLIC_ORIGIN>`. Restart Compose after changing `.env`. The issuer is now based on `KEYCLOAK_PUBLIC_URL`; changing it creates a distinct account namespace. Existing database and Keycloak data are retained, but users may see an empty account until their identity is migrated. Keep the Keycloak URL stable once users have created canvases.

This development setup explicitly permits HTTP cookies and Keycloak HTTP sign-in. Use only on a trusted network without router port forwarding. Company deployments require HTTPS. If devices cannot connect, check the host firewall and WLAN client/guest isolation.

## Development and checks

Use JDK 21, Maven 3.9+, Node.js 24 with npm 11.19.1, and PostgreSQL 17. The full Compose stack is the simplest way to exercise the real sign-in flow. Frontend development against that stack:

```sh
npm ci --prefix frontend
TEAM_CANVAS_DEV_PROXY=http://localhost:8088 npm run dev --prefix frontend
```

Vite serves on `5173`. For authenticated Vite development, configure the development Keycloak client’s exact callback/post-logout URLs for `http://localhost:5173`, set `PUBLIC_ORIGIN=http://localhost:5173`, and restart the backend. Keycloak remains directly available at `KEYCLOAK_PUBLIC_URL`; Vite proxies only `/api` and `/ws` to the Compose frontend at `8088`. Do not run two backends against the same database.

For a host-run backend, export `DB_USER`, `DB_PASSWORD`, `JDBC_URL`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, and a client/session secret, then run `mvn quarkus:dev` from `backend/`. Maven does not load `.env`. Its issuer and OIDC endpoints must be reachable from the host. See the [OIDC configuration reference](https://quarkus.io/guides/security-oidc-expanded-configuration/).

```sh
npm run test:sync --prefix frontend
npm run build --prefix frontend
(cd backend && mvn test)

# Isolated test schema in a disposable PostgreSQL database:
(cd backend && TEAM_CANVAS_TEST_JDBC_URL=jdbc:postgresql://localhost:5432/board mvn test)

# A separate disposable stack, with its own ports and data volumes:
HTTP_PORT=8089 DB_PORT=5433 KEYCLOAK_HTTP_PORT=8181 \
  PUBLIC_ORIGIN=http://localhost:8089 KEYCLOAK_PUBLIC_URL=http://localhost:8181/auth \
  docker compose -p team-canvas-e2e up --build -d --wait --wait-timeout 300
node frontend/node_modules/playwright/cli.js install chromium
BASE_URL=http://localhost:8089 node tests/smoke.mjs
BASE_URL=http://localhost:8089 npm run test:e2e --prefix frontend
# Discard only the isolated test stack and its data:
docker compose -p team-canvas-e2e down -v
```

Export the test database credentials and any changed `DEV_ALICE_PASSWORD`/`DEV_BOB_PASSWORD` before running tests. Browser and smoke tests require an explicit `BASE_URL` and refuse to default to the working app. They create canvases and exercise both demo accounts, so point them only at a disposable test deployment and discard its volumes afterward. Screenshots and failure traces go to ignored `test-results/`; traces may contain session data and must be treated as sensitive.

CI runs frontend checks, backend tests with PostgreSQL, container builds, authenticated protocol/browser journeys, and vulnerability scans. WLAN routing and company identity/ingress settings still need validation in their target environment.

## Troubleshooting

```sh
docker compose config --quiet
docker compose ps -a
docker compose logs --tail=100 backend db frontend keycloak
```

| Symptom | Check |
| --- | --- |
| Docker socket permission denied | Ensure your user can access the Docker daemon. |
| `Set DB_PASSWORD in .env` | Create `.env` and set the database password. |
| Address already in use | Change the port and keep `PUBLIC_ORIGIN` consistent. |
| Login redirect or issuer mismatch | Keep the app callback URLs aligned with `PUBLIC_ORIGIN`, the OIDC issuer aligned with `KEYCLOAK_PUBLIC_URL`, and saved Keycloak client URLs aligned with the app origin. |
| Password changes do not take effect | Existing database/realm state is retained; update credentials administratively. |
| Another backend owns the database | Stop that backend before starting this one. |
| Access expired or revoked | Export unsaved work if needed, then rejoin/sign in. Membership survives ordinary session expiry; removed members must have access restored by the canvas owner, even if they have a new invitation. |
| Build downloads fail | Check DNS, network access, and build proxy settings. |

## Connection limit

The default is 30 simultaneous connections per canvas, including multiple tabs. Set `TEAM_CANVAS_MAX_CONNECTIONS_PER_CANVAS` in `.env` to an integer from 1 to 200, then recreate the backend with `docker compose up -d`. This deployment-wide setting applies to every canvas; the server-wide limit remains 200 connections and each account can open at most 20. Run only one backend per database.
