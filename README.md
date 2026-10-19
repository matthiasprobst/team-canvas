# Team Canvas

A shared canvas for feature refinement, architecture discussions, and retrospectives. Draw together, collect ideas privately in poker rounds, and reveal contributions only when everyone is ready.

React, TypeScript, Tailwind, Excalidraw, Kotlin/Quarkus, PostgreSQL, and Keycloak. The application interface is English.

## Features

- A personal dashboard with **All canvases**, **My canvases**, and **Shared with me**, plus search by canvas name or tags and sorting. Owners can add up to 20 tags per canvas; suggestions come from tags on their own canvases, and template copies keep their source tags.
- Create canvases, rename those you own, and share invitation links. Recipients sign in and explicitly accept invitations.
- Mark canvases you own as private templates, or make them public for all signed-in users. Owners can edit templates from the Templates page; starting a template opens an independent canvas copied from its shared drawings and images, so changes affect future copies only.
- Delete canvases you own from the dashboard’s actions menu. Confirmation permanently removes all contents and invitations for everyone, including active poker rounds; connected viewers are notified.
- Persistent account membership across browsers/devices; independent sessions in multiple tabs.
- Collaborative shapes, text, sticky notes, images, presence, and shared cursors.
- Private poker contributions, server-enforced readiness, and automatic all-ready publication.
- Canvas switching with pending-change protection and draft export.

The backend supports **one active instance per database** and **ten simultaneous connections per canvas**, including multiple tabs. Bots, archive, and revision history are not implemented.

## Quick start

Install Docker with the Compose plugin. From the repository root:

```sh
test -f .env || cp .env.example .env
openssl rand -hex 24
# Put the generated password into .env as DB_PASSWORD, then:
docker compose up --build -d --wait --wait-timeout 300
```

Open **http://localhost:8088** and choose **Login with SSO**. The browser signs in through the separate development Keycloak URL at **http://localhost:8180/auth**. Compose includes a development realm with these example accounts:

| Username | Default development password |
| --- | --- |
| `alice` | `alice-dev-only` |
| `bob` | `bob-dev-only` |

Use separate browser profiles, private windows, or devices to test the two accounts. Create a canvas, choose **Share → Create invitation link**, and open that link in the other browser. After sign-in, choose **Accept invitation**. The canvas then appears in that user’s dashboard.

Configure passwords through `DEV_ALICE_PASSWORD` and `DEV_BOB_PASSWORD` before the first start. The development admin console is at **http://localhost:8180/auth/admin/**, with `dev-admin` and `DEV_ADMIN_PASSWORD` (default `admin-dev-only`). Configure the public Keycloak address with `KEYCLOAK_PUBLIC_URL` and its host port/bind address with `KEYCLOAK_HTTP_PORT` and `KEYCLOAK_BIND`. These accounts and the bundled development identity provider are **not a company deployment configuration**.

Application data persists in `pgdata`; Keycloak data persists in `keycloakdata`. `docker compose down` retains both. **`docker compose down -v` deletes both volumes and all their data.** Passwords and realm settings are imported only on the first start. Editing `.env` does not update existing PostgreSQL or Keycloak passwords; update those through their administration tools.

## Try it with someone on the same WLAN

Before the first start, set the following in `.env`, using the host computer’s actual WLAN IP:

```dotenv
HTTP_BIND=0.0.0.0
HTTP_PORT=8088
PUBLIC_ORIGIN=http://192.168.1.42:8088
KEYCLOAK_BIND=0.0.0.0
KEYCLOAK_HTTP_PORT=8180
KEYCLOAK_PUBLIC_URL=http://192.168.1.42:8180/auth
```

Set your own development account passwords, allow inbound TCP ports `8088` and `8180` on the private network, then run the Compose command above. **Everyone must use the exact `PUBLIC_ORIGIN` URL for Team Canvas and the exact `KEYCLOAK_PUBLIC_URL` host for Keycloak**, including the host. An invitation created at `localhost` cannot work on another person’s computer.

`PUBLIC_ORIGIN` configures the app callback, post-logout URL, and allowed request origin. `KEYCLOAK_PUBLIC_URL` configures Keycloak’s browser URL and OIDC issuer. Backend token/JWKS calls use the internal Compose service address; browser redirects never use that address. Do not add trailing slashes to either setting.

If Keycloak was already initialized, update the `team-canvas` client in its admin console when the app origin changes: **Valid redirect URIs** to `<PUBLIC_ORIGIN>/api/login`, **Valid post logout redirect URIs** to `<PUBLIC_ORIGIN>/login`, and **Web origins** to `<PUBLIC_ORIGIN>`. Restart Compose after changing `.env`. The issuer is now based on `KEYCLOAK_PUBLIC_URL`; changing it creates a distinct account namespace. Existing database and Keycloak data are retained, but users may see an empty account until their identity is migrated. Keep the Keycloak URL stable once users have created canvases.

This development setup explicitly permits HTTP cookies and Keycloak HTTP sign-in. Use only on a trusted network without router port forwarding. Company deployments require HTTPS. If devices cannot connect, check the host firewall and WLAN client/guest isolation.

## Poker rounds

1. The owner chooses **Start poker**. Connected users form a fixed roster; multiple tabs for one account count as one participant.
2. Existing public elements are locked. Each participant sees only their own new elements and images. Cursors are hidden.
3. **Ready** first waits for pending edits to be acknowledged, then locks that participant’s draft.
4. The server publishes all remaining contributions together only when **every roster member is ready**. There is no early-reveal action.
5. Switching canvases, disconnecting, or signing out does not remove a participant or mark them ready. Reopening restores their saved private draft. Late arrivals join the next round.
6. The owner can **Cancel round**, deleting private contributions without revealing them.

Navigation waits for acknowledgements or asks you to export/discard unsaved changes. A browser crash can still lose unacknowledged work held only in memory. An interrupted private draft is never automatically replayed into another round or canvas.

Owners can revoke invitation links without removing existing members, or additionally remove all shared members. A new invitation does not invalidate earlier links. Revoking a member during poker preserves the frozen roster; the owner can cancel the round if that member cannot return.

## Development and checks

Use JDK 21, Maven 3.9+, Node.js 22+, and PostgreSQL 17. The full Compose stack is the simplest way to exercise the real sign-in flow. Frontend development against that stack:

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

## Company deployment

Use company-managed Keycloak and the [Kubernetes deployment guide](deploy/kubernetes/README.md). All data APIs, assets, and WebSocket upgrades require sign-in. There is no supported guest-mode bypass. OIDC tokens remain in server-managed HttpOnly cookies; app accounts use verified issuer/subject identity and board sessions are also bound to the Keycloak login session.

The application does not seed sample canvases. Published application images contain no canvas data or demo accounts; Alice and Bob belong to the development Keycloak realm only. Use a separate production database and company identity provider, without copying development/test volumes or importing the development realm.

Run one backend replica with `Recreate` updates. The database ownership guard rejects overlapping backends; horizontal backend scaling is not supported. Define database backup, restore, monitoring, and retention procedures before admitting company data.

The dashboard migration retains old scene rows but does not claim legacy guest canvases. Create new account-owned canvases after upgrading. Read the [upgrade notes](docs/upgrading.md) before using an existing database.

## Project structure

| Path | Purpose |
| --- | --- |
| [frontend/](frontend/) | Dashboard, routing, Excalidraw editor, synchronization |
| [backend/](backend/) | Accounts, access control, APIs, persistence, migrations |
| [tests/](tests/) | Synchronization, authenticated protocol and browser tests |
| [deploy/](deploy/) | Development Keycloak, Caddy, Kubernetes templates |
| [docs/](docs/) | Architecture, operating limits, upgrade notes |
| [.features/](.features/) | Feature tickets and validation evidence |

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
| Access expired or revoked | Export unsaved work if needed, then rejoin/sign in. Membership survives ordinary session expiry; revoked members need a new invitation. |
| Build downloads fail | Check DNS, network access, and build proxy settings. |

## Contributing

Include reproduction steps, expected behavior, relevant checks, and screenshots for UI changes. Changes to synchronization or poker must cover privacy, permissions, reconnects, and multiple sessions. See [architecture and protocol](docs/architecture.md).

Never commit `.env`, access tokens, invitation secrets, or real deployment credentials.

## License

[MIT](LICENSE). Third-party libraries, images, and fonts retain their own licenses and notices.
