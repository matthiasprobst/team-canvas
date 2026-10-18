# Team Canvas

A shared canvas for team workshops, feature refinement, architecture discussions, and retrospectives. Draw together in real time, then switch to private poker rounds to collect ideas independently and reveal them when everyone is ready.

Built with React, TypeScript, Excalidraw, Kotlin, Quarkus, and PostgreSQL. The current user interface is in German.

## Features

- Collaborate on shapes, text, notes, and images, with participant presence and shared cursors.
- Invite participants through a dedicated invitation link; the board ID alone does not grant access.
- Collect private contributions in poker rounds and reveal them automatically once every round participant is ready.
- Persist boards and uploaded images in PostgreSQL.
- Reconnect after interruptions, retry acknowledged commands safely, and export unsent drafts when the round has changed.
- Configure company sign-in through OIDC and deploy using the Kubernetes templates.

The backend currently supports **one active instance per database** and **ten simultaneous board connections**, including multiple browser tabs. Chat bots are a possible future extension and are not implemented.

## Quick start

Install Docker with the Compose plugin, then run these commands from the repository root:

```sh
# Create .env only if it does not already exist.
test -f .env || cp .env.example .env

# Generate a password and put it in .env as DB_PASSWORD.
openssl rand -hex 24

# After editing .env:
docker compose up --build -d
```

Open [http://localhost:8088](http://localhost:8088), create a board, and use **Link teilen** to copy its invitation link. Keep the host key private; the app stores it in the creating browser.

Compose runs in guest mode without company sign-in and binds to `127.0.0.1` by default. This configuration is intended for local development and trusted-network trials. See [company deployment](#company-deployment) for HTTPS and OIDC configuration.

Board data is stored in the `pgdata` Docker volume. `docker compose down` stops the stack while retaining that volume. **`docker compose down -v` deletes the database volume and its boards.** Changing `DB_PASSWORD` in `.env` does not change the password of an already initialized PostgreSQL database.

## Try it with someone on the same WLAN

1. Find the host computer's WLAN IP address, for example `192.168.1.42`.
2. Set `HTTP_BIND=0.0.0.0` in `.env` and keep `HTTP_PORT=8088`.
3. In `docker-compose.yml`, add the host's URL to `backend.environment.TEAM_CANVAS_ALLOWED_ORIGINS`. Keep the existing entries, separated by commas:

   ```yaml
   TEAM_CANVAS_ALLOWED_ORIGINS: http://localhost:${HTTP_PORT:-8088},http://127.0.0.1:${HTTP_PORT:-8088},http://localhost:5173,http://192.168.1.42:8088
   ```

4. Allow inbound TCP port `8088` in the host firewall for the private network, then run `docker compose up --build -d` again.
5. On **both computers**, open `http://192.168.1.42:8088`, using the actual host IP. Create the board from this address and share its invitation link. Links created through `localhost` point to the recipient's own computer.

The allowed origin must match the browser URL exactly, including scheme and port. This setup uses unencrypted HTTP; use it on a trusted WLAN without router port forwarding. If the computers cannot reach each other, check whether the WLAN uses guest-network or client isolation.

## How poker rounds work

1. The host starts a round. Everyone connected at that moment, including the host, joins the round's fixed participant roster.
2. Existing shared elements are locked. Each participant sees only their own new contributions, including images. Cursors are hidden.
3. **Fertig** waits for the server to acknowledge pending changes, then locks that participant's draft.
4. When **every roster member is ready**, the server publishes all remaining contributions together. The host cannot reveal a round early. Deleted private elements and unused private images are removed before publication.
5. Disconnecting does not remove someone from the roster. Participants who join later can see the shared canvas and take part in the next round.
6. The host can cancel a round, deleting its private contributions without publishing them.

Unsent changes remain in browser memory during a connection interruption. If the round changes, the app offers those changes as an `.excalidraw` download instead of publishing them in a different round. Closing or crashing the browser can lose changes that the server has not yet acknowledged.

## Development

Use JDK 21, Maven 3.9+, Node.js 22+, and PostgreSQL 17. Docker can provide PostgreSQL during development:

```sh
docker compose up -d db
```

In a backend terminal, supply the database credentials from `.env`:

```sh
cd backend
DB_USER=board DB_PASSWORD='<your database password>' \
TEAM_CANVAS_AUTH_REQUIRED=false TEAM_CANVAS_HTTP_POLICY=permit \
mvn quarkus:dev
```

Maven does not load `.env` automatically. If you change `DB_USER` or `DB_PORT`, set `DB_USER` and `JDBC_URL` accordingly. Run either the Compose backend or the development backend against the database; the database ownership guard prevents two active backends.

In a separate terminal, from the repository root:

```sh
npm ci --prefix frontend
npm run dev --prefix frontend
```

Open [http://localhost:5173](http://localhost:5173). Vite proxies API and WebSocket requests to the backend on port `8080`. Fonts are copied locally during frontend startup and builds; no external font service is needed at runtime.

### Checks

```sh
npm run test:sync --prefix frontend
npm run build --prefix frontend
(cd backend && mvn test)
```

PostgreSQL integration tests are opt-in and use an isolated schema within the supplied test database:

```sh
cd backend
DB_USER=board DB_PASSWORD='<test database password>' \
TEAM_CANVAS_TEST_JDBC_URL=jdbc:postgresql://localhost:5432/board mvn test
```

With the complete guest-mode Compose stack running, check HTTP and WebSocket behavior from the repository root:

```sh
BASE_URL=http://localhost:8088 node tests/smoke.mjs
```

CI runs frontend and backend checks, PostgreSQL integration tests, protocol smoke tests, container builds, and vulnerability scans. Company OIDC and multi-browser workflows should also be verified in the intended deployment environment.

## Company deployment

Production configuration requires OIDC by default. The [Kubernetes deployment guide](deploy/kubernetes/README.md) covers identity-provider configuration, HTTPS, secrets, database access, probes, and operational requirements.

Run exactly one backend instance per database. The PostgreSQL ownership guard enforces this limit; horizontal backend scaling and rolling backend updates are not supported. Frontend and backend protocol versions must be upgraded together. Plan database backups, restore checks, and a retention policy; automatic board deletion is not implemented.

## Project structure

| Path | Purpose |
| --- | --- |
| [`frontend/`](frontend/) | React UI, Excalidraw integration, and synchronization client |
| [`backend/`](backend/) | Quarkus REST/WebSocket API, access control, persistence, and migrations |
| [`tests/`](tests/) | Synchronization tests and HTTP/WebSocket smoke tests |
| [`deploy/`](deploy/) | Caddy configuration and Kubernetes templates |
| [`docs/`](docs/) | Architecture, protocol, operating limits, and upgrade notes |

Read the [architecture and protocol guide](docs/architecture.md) for synchronization, privacy, and operating limits. Existing installations should also read the [upgrade notes](docs/upgrading.md).

## Troubleshooting

```sh
docker compose version
docker info
docker compose config --quiet
docker compose ps -a
docker compose logs --tail=100 backend db frontend
```

| Symptom | What to check |
| --- | --- |
| `docker compose` is unavailable | Install the Compose plugin or enable Docker Desktop integration. |
| Docker socket permission denied | Check whether your user can access the Docker daemon. |
| `Set DB_PASSWORD in .env` | Create `.env` and set a nonempty database password. |
| Address already in use | Choose an unused `HTTP_PORT` or `DB_PORT` in `.env`. |
| Maven or npm downloads fail | Check DNS, network access, and build-time proxy configuration. |
| `Another Team Canvas backend owns this database` | Stop the other backend before starting this one. |
| WLAN requests or WebSockets fail | Check the bind address, exact allowed origin, host firewall, and WLAN client isolation. |
| Access expired or revoked | Use **Erneut beitreten** and a current invitation link. Board tokens expire after 24 hours; hosts can revoke guest access. |

## Contributing

Bug reports, focused improvements, and feature discussions are welcome. Describe the problem and expected behavior, include reproduction steps for bugs, and report the relevant checks with code changes. Include screenshots for UI changes. Changes to synchronization or poker behavior should cover privacy, permissions, reconnects, and multiple browser sessions.

Never include `.env`, access tokens, host keys, or real deployment secrets in contributions.

## License

Team Canvas is licensed under the [MIT License](LICENSE).

Third-party libraries, container images, and fonts retain their respective licenses and notices.
