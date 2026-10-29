# Team Canvas

A self-hosted whiteboard for team workshops, retrospectives, and architecture discussions. Draw together in real time, organize work across pages, and reuse layouts as templates. Poker mode lets everyone contribute privately before revealing their saved work together.

## Start using Team Canvas

If your organization already runs Team Canvas, open its app URL or a colleague’s invitation link. You need an account in your organization’s SSO; no local installation is required.

1. Choose **Login with SSO** and sign in.
2. Choose **New canvas** on the dashboard and give it a name. If you followed an invitation link, choose **Accept invitation** instead.
3. Draw, add text, sticky notes, or images. Changes save automatically; wait for **Saved** before leaving.
4. As the owner, choose **Share → Create invitation link** and send it to your colleagues. They sign in and accept the invitation to edit with you.
5. Return to the dashboard to reopen your work under **My canvases** or **Shared with me**.

See the [user guide](docs/user-guide.md) for pages, templates, poker rounds, sharing, and recovering unsaved work.

## What you can do

| Workflow | How it works |
| --- | --- |
| Draw together | Shared shapes, text, sticky notes, images, and live cursors. |
| Organize a workshop | Add blank pages or copy a page. Everyone follows the same selected page. |
| Collect ideas privately | **Start poker**, contribute, then **Stop poker and reveal**. Any member can reveal saved contributions. This is not numeric estimation poker. |
| Reuse a layout | Mark a canvas as a template; **Start template** creates an independent copy of all its pages. |
| Find and share work | Search by name or tags, reopen saved canvases, and manage editing membership. |

Everyone must sign in, and invitations grant editing access. A **public template** is available to all signed-in users of your deployment. Private poker contributions stay hidden from other members, including the owner, until reveal; infrastructure administrators can access stored data. There is no read-only sharing role or revision history.

## Try it locally

Install Docker with the Compose plugin and run these commands from the repository root. This starts a development instance with its own Keycloak sign-in service.

```sh
test -f .env || cp .env.example .env
openssl rand -hex 24
```

On first setup, put the generated password into `.env` as `DB_PASSWORD`, then start the stack. If you already have a database, keep its existing password.

```sh
docker compose up --build -d --wait --wait-timeout 300
```

Open **http://localhost:8088**, choose **Login with SSO**, and use one of the development accounts:

| Username | Default development password |
| --- | --- |
| `alice` | `alice-dev-only` |
| `bob` | `bob-dev-only` |

Use separate browser profiles to try sharing between Alice and Bob. Passwords can be configured before the first start; see [local setup and checks](docs/local-development.md) for details, WLAN access, and troubleshooting.

Data survives `docker compose down`. **`docker compose down -v` deletes the development database and Keycloak data.** The bundled setup and demo accounts are for development; use the [operator handover](docs/operator-handover.md) before admitting retained company data. For an existing database, read the [upgrade notes](docs/upgrading.md).

## Develop locally

For live reload of both the UI and API, use JDK 21, Maven 3.9+, Node.js 24 with npm 11.19.1, and Docker with Compose. Run the following commands from the repository root. First create `.env` as shown in [Try it locally](#try-it-locally), set a random `DB_PASSWORD`, and set `PUBLIC_ORIGIN=http://localhost:5173` **before Keycloak's first start**. Then start only the database and development identity provider:

```sh
docker compose up -d --wait db keycloak
```

In one terminal, load `.env` and start Quarkus:

```sh
set -a
. ./.env
set +a
export JDBC_URL="jdbc:postgresql://localhost:${DB_PORT:-5432}/board"
export OIDC_ISSUER="${KEYCLOAK_PUBLIC_URL}/realms/team-canvas"
export OIDC_CLIENT_ID=team-canvas
export OIDC_CLIENT_SECRET="$DEV_OIDC_CLIENT_SECRET"
export OIDC_SESSION_SECRET="$DEV_OIDC_SESSION_SECRET"
export TEAM_CANVAS_ALLOWED_ORIGINS=http://localhost:5173
export QUARKUS_OIDC_AUTHENTICATION_COOKIE_FORCE_SECURE=false
(cd backend && mvn quarkus:dev)
```

In another terminal, start Vite. It proxies `/api` and `/ws` to Quarkus on port `8080`:

```sh
npm ci --prefix frontend
npm run dev --prefix frontend
```

Open **http://localhost:5173** and sign in with `alice` / `alice-dev-only` or `bob` / `bob-dev-only`. If you previously started the full Compose stack, stop its `backend` and `frontend` services before starting Quarkus, and update the existing Keycloak `team-canvas` client's redirect URI to `http://localhost:5173/api/login`, post-logout URI to `http://localhost:5173/login`, and web origin to `http://localhost:5173`; changing `.env` alone does not update an imported realm. See [local development and checks](docs/local-development.md#development-and-checks) for tests and troubleshooting. Do not run the host and Compose backends against the same database.

## Documentation

| I want to… | Read |
| --- | --- |
| Use the app or run a workshop | [User guide](docs/user-guide.md) |
| Run locally, develop, or test | [Local development and checks](docs/local-development.md) |
| Deploy for my organization | [Operator handover](docs/operator-handover.md) → [production readiness](docs/production-readiness.md) |
| Upgrade, back up, restore, or offboard users | [Operations runbook](docs/operations-runbook.md) and [upgrade notes](docs/upgrading.md) |
| Understand permissions and implementation | [Security model](docs/security-model.md) and [architecture](docs/architecture.md) |
| Review documentation work | [Compact documentation plan](docs/documentation-plan.md) |

The app uses React/TypeScript with Excalidraw, Kotlin/Quarkus, PostgreSQL, and Keycloak. It supports **one active backend per database**. The default limit is 30 connections per canvas, including extra tabs; operators can configure it. The company chooses its hosting platform; [Helm](deploy/helm/README.md) is an optional reference. Production acceptance remains environment-specific; see the [local qualification record](docs/local-qualification-2026-10-25.md).

## Contributing

The UI lives in [frontend/](frontend/), the API and persistence in [backend/](backend/), and cross-session checks in [tests/](tests/). See [development and checks](docs/local-development.md#development-and-checks) for setup and validation commands, and the [implementation backlog](.features/company-readiness/README.md) for feature history.

Include reproduction steps, expected behavior, relevant checks, and screenshots for UI changes. Synchronization and poker changes need coverage for privacy, permissions, reconnects, and multiple sessions. Never commit `.env`, tokens, invitation secrets, or deployment credentials.

## License

[MIT](LICENSE). Third-party libraries, images, and fonts retain their own licenses and notices.
